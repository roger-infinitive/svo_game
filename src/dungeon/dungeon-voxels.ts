import type { Dungeon } from "./dungeon-generator.ts";
import { dungeonFloors, dungeonLength, dungeonWidth, floorHeight, gridKey } from "./rooms.ts";

export const voxelsPerMeter = 16;
export const dungeonWorldScale = 8 / 64;

const octreeDepth = 10;
const chunkVolume = voxelsPerMeter ** 3;
const meterHeight = dungeonFloors * floorHeight;

const mortonAxis = Uint32Array.from({ length: 64 }, (_, value) => {
  let bits = 0;
  for (let bit = 0; bit < 6; bit++) {
    bits |= ((value >> bit) & 1) << (3 * bit);
  }
  return bits;
});

function morton(x: number, y: number, z: number): number {
  return mortonAxis[x] | (mortonAxis[y] << 1) | (mortonAxis[z] << 2);
}

function airIndex(x: number, y: number, z: number): number {
  return (y * dungeonLength + z) * dungeonWidth + x;
}

function brickThickness(u: number, v: number): number {
  // 50 × 25 cm bricks with alternating rows and recessed mortar.
  const row = Math.floor(v / 4);
  const stagger = (row & 1) * 4;
  return (v % 4 === 0 || (u + stagger) % 8 === 0) ? 1 : 3;
}

type Axis = "x" | "y" | "z";

function lineWithBricks(
  chunk: Uint8Array,
  axis: Axis,
  positive: boolean,
  tileU: number,
  tileV: number,
) {
  for (let v = 0; v < voxelsPerMeter; v++) {
    for (let u = 0; u < voxelsPerMeter; u++) {
      const thickness = brickThickness(tileU * voxelsPerMeter + u, tileV * voxelsPerMeter + v);
      for (let inset = 0; inset < thickness; inset++) {
        const w = positive ? voxelsPerMeter - inset - 1 : inset;
        const index = axis === "x" ? morton(w, v, u)
          : axis === "y" ? morton(u, w, v)
          : morton(u, v, w);
        chunk[index] = 1;
      }
    }
  }
}

function dungeonChunks(dungeon: Dungeon): Map<number, Uint8Array> {
  const air = new Uint8Array(dungeonWidth * meterHeight * dungeonLength);
  for (const { x, y, z } of [...dungeon.roomSpace.values(), ...dungeon.walkable.values()]) {
    const floorY = y * floorHeight;
    for (let offset = 0; offset < floorHeight; offset++) {
      air[airIndex(x, floorY + offset, z)] = 1;
    }
  }

  function isAir(x: number, y: number, z: number): boolean {
    return x >= 0 && x < dungeonWidth &&
      y >= 0 && y < meterHeight &&
      z >= 0 && z < dungeonLength &&
      air[airIndex(x, y, z)] === 1;
  }

  const chunks = new Map<number, Uint8Array>();
  for (let y = 0; y < meterHeight; y++) {
    for (let z = 0; z < dungeonLength; z++) {
      for (let x = 0; x < dungeonWidth; x++) {
        if (!isAir(x, y, z)) {
          continue;
        }

        const floor = y / floorHeight;
        // An upper gallery has a floor only under its walkable rim. Its
        // central atrium and dedicated climb cells stay open between levels.
        const galleryFloor = Number.isInteger(floor) && floor > 0 &&
          dungeon.walkable.has(gridKey({ x, y: floor, z })) &&
          !dungeon.verticalLinks.has(gridKey({ x, y: floor - 1, z }));
        const floorFace = galleryFloor || !isAir(x, y - 1, z);
        const ceilingFace = !isAir(x, y + 1, z);
        const westFace = !isAir(x - 1, y, z);
        const eastFace = !isAir(x + 1, y, z);
        const northFace = !isAir(x, y, z - 1);
        const southFace = !isAir(x, y, z + 1);
        if (!(floorFace || ceilingFace || westFace || eastFace || northFace || southFace)) {
          continue;
        }

        const chunk = new Uint8Array(chunkVolume);
        if (floorFace) {
          lineWithBricks(chunk, "y", false, x, z);
        }
        if (ceilingFace) {
          lineWithBricks(chunk, "y", true, x, z);
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
  // breadth-first mask level directly from sparse, sorted metre chunks.
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
        const parent = code >>> 3;
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
