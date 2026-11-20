import type { Dungeon } from "./dungeon-generator.ts";
import {
  dungeonFloors, dungeonLength, dungeonWidth, floorHeight, gridKey,
} from "./rooms.ts";

export const voxelsPerMeter = 32;
export const dungeonWorldScale = 8 / 64;

const octreeDepth = 11;
const voxelsPerChunk = 16;
const chunksPerMeter = voxelsPerMeter / voxelsPerChunk;
const floorChunks = floorHeight * chunksPerMeter;
const chunkVolume = voxelsPerChunk ** 3;
const chunkHeight = dungeonFloors * floorChunks;
const chunkWidth = dungeonWidth * chunksPerMeter;
const chunkLength = dungeonLength * chunksPerMeter;

const mortonAxis = Uint32Array.from({ length: 128 }, (_, value) => {
  let bits = 0;
  for (let bit = 0; bit < 7; bit++) {
    bits |= ((value >> bit) & 1) << (3 * bit);
  }
  return bits;
});

function morton(x: number, y: number, z: number): number {
  return mortonAxis[x] | (mortonAxis[y] << 1) | (mortonAxis[z] << 2);
}

function airIndex(x: number, y: number, z: number): number {
  return (y * chunkLength + z) * chunkWidth + x;
}

function brickThickness(u: number, v: number): number {
  // 25 × 12.5 cm bricks with alternating rows and recessed mortar.
  const row = Math.floor(v / 4);
  const stagger = (row & 1) * 4;
  return (v % 4 === 0 || (u + stagger) % 8 === 0) ? 1 : 3;
}

type WallAxis = "x" | "z";

function lineWithBricks(
  chunk: Uint8Array,
  axis: WallAxis,
  positive: boolean,
  tileU: number,
  tileV: number,
) {
  for (let v = 0; v < voxelsPerChunk; v++) {
    for (let u = 0; u < voxelsPerChunk; u++) {
      const thickness = brickThickness(tileU * voxelsPerChunk + u, tileV * voxelsPerChunk + v);
      for (let inset = 0; inset < thickness; inset++) {
        const w = positive ? voxelsPerChunk - inset - 1 : inset;
        const index = axis === "x" ? morton(w, v, u) : morton(u, v, w);
        chunk[index] = 1;
      }
    }
  }
}

function lineWithTiles(chunk: Uint8Array, ceiling: boolean) {
  const backing = ceiling ? voxelsPerChunk - 1 : 0;
  const tileFace = ceiling ? backing - 1 : backing + 1;
  for (let z = 0; z < voxelsPerChunk; z++) {
    for (let x = 0; x < voxelsPerChunk; x++) {
      chunk[morton(x, backing, z)] = 1;
      // Each half-meter chunk is one square tile with a recessed grout seam.
      if (x > 0 && z > 0) {
        chunk[morton(x, tileFace, z)] = 1;
      }
    }
  }
}

function addLadder(chunk: Uint8Array) {
  // Leave the centre of the climb cell open.
  for (let y = 0; y < voxelsPerChunk; y++) {
    chunk[morton(3, y, 3)] = 1;
    chunk[morton(11, y, 3)] = 1;
    if (y % 8 === 4) {
      for (let x = 4; x < 11; x++) {
        chunk[morton(x, y, 3)] = 1;
      }
    }
  }
}

function dungeonChunks(dungeon: Dungeon): Map<number, Uint8Array> {
  const air = new Uint8Array(chunkWidth * chunkHeight * chunkLength);
  for (const { x, y, z } of [...dungeon.roomSpace.values(), ...dungeon.walkable.values()]) {
    const floorY = y * floorChunks;
    for (let offset = 0; offset < floorChunks; offset++) {
      for (let dz = 0; dz < chunksPerMeter; dz++) {
        for (let dx = 0; dx < chunksPerMeter; dx++) {
          air[airIndex(x * chunksPerMeter + dx, floorY + offset, z * chunksPerMeter + dz)] = 1;
        }
      }
    }
  }

  function isAir(x: number, y: number, z: number): boolean {
    return x >= 0 && x < chunkWidth &&
      y >= 0 && y < chunkHeight &&
      z >= 0 && z < chunkLength &&
      air[airIndex(x, y, z)] === 1;
  }

  const chunks = new Map<number, Uint8Array>();
  for (let y = 0; y < chunkHeight; y++) {
    for (let z = 0; z < chunkLength; z++) {
      for (let x = 0; x < chunkWidth; x++) {
        if (!isAir(x, y, z)) {
          continue;
        }

        const floor = y / floorChunks;
        const cellX = Math.floor(x / chunksPerMeter);
        const cellZ = Math.floor(z / chunksPerMeter);
        // An upper gallery has a floor only under its walkable rim. Its
        // central atrium and dedicated climb cells stay open between levels.
        const galleryFloor = Number.isInteger(floor) && floor > 0 &&
          dungeon.walkable.has(gridKey({ x: cellX, y: floor, z: cellZ })) &&
          !dungeon.verticalLinks.has(gridKey({ x: cellX, y: floor - 1, z: cellZ }));
        const floorFace = galleryFloor || !isAir(x, y - 1, z);
        const ceilingFace = !isAir(x, y + 1, z);
        const westFace = !isAir(x - 1, y, z);
        const eastFace = !isAir(x + 1, y, z);
        const northFace = !isAir(x, y, z - 1);
        const southFace = !isAir(x, y, z + 1);
        const hasLadder = x % chunksPerMeter === 1 && z % chunksPerMeter === 0 &&
          dungeon.verticalLinks.has(gridKey({ x: cellX, y: Math.floor(floor), z: cellZ }));
        if (!(floorFace || ceilingFace || westFace || eastFace || northFace || southFace || hasLadder)) {
          continue;
        }

        const chunk = new Uint8Array(chunkVolume);
        if (floorFace) {
          lineWithTiles(chunk, false);
        }
        if (ceilingFace) {
          lineWithTiles(chunk, true);
        }
        if (westFace) {
          lineWithBricks(chunk, "x", false, z, y);
        }
        if (eastFace) {
          lineWithBricks(chunk, "x", true, z, y);
        }
        if (northFace) {
          lineWithBricks(chunk, "z", false, x, y);
        }
        if (southFace) {
          lineWithBricks(chunk, "z", true, x, y);
        }
        if (hasLadder) {
          addLadder(chunk);
        }
        chunks.set(morton(x, y, z), chunk);
      }
    }
  }
  return chunks;
}

export function dungeonToRsvo(dungeon: Dungeon): ArrayBuffer {
  const chunks = dungeonChunks(dungeon);
  const masks: number[][] = Array.from({ length: octreeDepth }, () => []);
  const lastParent = new Int32Array(octreeDepth).fill(-1);
  let leafCount = 0;

  // Morton order visits a parent's children consecutively. Build each
  // breadth-first mask level directly from sparse, sorted half-metre chunks.
  const sortedChunks = [...chunks.keys()].sort((a, b) => a - b);
  for (const chunkKey of sortedChunks) {
    const chunk = chunks.get(chunkKey)!;
    const base = chunkKey * chunkVolume;
    for (let voxel = 0; voxel < chunk.length; voxel++) {
      if (chunk[voxel] === 0) {
        continue;
      }
      leafCount++;
      let code = base + voxel;
      for (let level = octreeDepth - 1; level >= 0; level--) {
        // Depth 11 uses 33-bit Morton codes, so a bitwise shift would truncate them.
        const parent = Math.floor(code / 8);
        const bit = 1 << (code & 7);
        const levelMasks = masks[level];
        if (lastParent[level] === parent) {
          levelMasks[levelMasks.length - 1] |= bit;
          break;
        }
        levelMasks.push(bit);
        lastParent[level] = parent;
        code = parent;
      }
    }
  }

  const headerSize = 20 + 4 * (octreeDepth + 1);
  const byteLength = masks.reduce((size, level) => size + level.length, headerSize);
  const buffer = new ArrayBuffer(byteLength);
  const header = new DataView(buffer);
  header.setUint32(0, 0x5253564f);
  header.setUint32(4, 1, true);
  header.setUint32(16, octreeDepth, true);
  header.setUint32(20 + octreeDepth * 4, leafCount, true);

  const bytes = new Uint8Array(buffer);
  let offset = headerSize;
  for (const [level, levelMasks] of masks.entries()) {
    header.setUint32(20 + level * 4, levelMasks.length, true);
    bytes.set(levelMasks, offset);
    offset += levelMasks.length;
  }
  return buffer;
}
