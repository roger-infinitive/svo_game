import type { Dungeon } from "./dungeon-generator.ts";
import { floorHeight, gridKey } from "./rooms.ts";
import type { DungeonSize } from "./rooms.ts";

export const voxelsPerMeter = 32;

const chunkDepth = 4;
const voxelsPerChunk = 2 ** chunkDepth;
const chunksPerMeter = voxelsPerMeter / voxelsPerChunk;
const floorChunks = floorHeight * chunksPerMeter;
const chunkVolume = voxelsPerChunk ** 3;

function dungeonOctreeDepth(size: DungeonSize): number {
  const meters = Math.max(size.width, size.length, size.floors * floorHeight);
  return Math.ceil(Math.log2(meters * voxelsPerMeter));
}

export function dungeonWorldScale(size: DungeonSize): number {
  return 8 * voxelsPerMeter / 2 ** dungeonOctreeDepth(size);
}

const mortonAxis = Uint32Array.from({ length: voxelsPerChunk }, (_, value) => {
  let bits = 0;
  for (let bit = 0; bit < chunkDepth; bit++) {
    bits |= ((value >> bit) & 1) << (3 * bit);
  }
  return bits;
});

function morton(x: number, y: number, z: number): number {
  return mortonAxis[x] | (mortonAxis[y] << 1) | (mortonAxis[z] << 2);
}

function chunkMorton(x: number, y: number, z: number): bigint {
  let code = 0n;
  for (let shift = 0n; x !== 0 || y !== 0 || z !== 0; shift += 3n) {
    const child = (x & 1) | ((y & 1) << 1) | ((z & 1) << 2);
    code |= BigInt(child) << shift;
    x >>>= 1;
    y >>>= 1;
    z >>>= 1;
  }
  return code;
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

function dungeonChunks(dungeon: Dungeon): Map<bigint, Uint8Array> {
  const { settings } = dungeon;

  function isAir(x: number, y: number, z: number): boolean {
    const cell = {
      x: Math.floor(x / chunksPerMeter),
      y: Math.floor(y / floorChunks),
      z: Math.floor(z / chunksPerMeter),
    };
    if (cell.x < 0 || cell.x >= settings.width ||
        cell.y < 0 || cell.y >= settings.floors ||
        cell.z < 0 || cell.z >= settings.length) {
      return false;
    }
    const key = gridKey(cell, settings);
    return dungeon.roomSpace.has(key) || dungeon.walkable.has(key);
  }

  const cells = new Map([...dungeon.roomSpace, ...dungeon.walkable]);
  const chunks = new Map<bigint, Uint8Array>();
  for (const cell of cells.values()) {
    for (let dy = 0; dy < floorChunks; dy++) {
      for (let dz = 0; dz < chunksPerMeter; dz++) {
        for (let dx = 0; dx < chunksPerMeter; dx++) {
          const x = cell.x * chunksPerMeter + dx;
          const y = cell.y * floorChunks + dy;
          const z = cell.z * chunksPerMeter + dz;

          // An upper gallery keeps an open atrium and open climb cells.
          const galleryFloor = dy === 0 && cell.y > 0 &&
            dungeon.walkable.has(gridKey(cell, settings)) &&
            !dungeon.verticalLinks.has(gridKey({ ...cell, y: cell.y - 1 }, settings));
          const floorFace = galleryFloor || !isAir(x, y - 1, z);
          const ceilingFace = !isAir(x, y + 1, z);
          const westFace = !isAir(x - 1, y, z);
          const eastFace = !isAir(x + 1, y, z);
          const northFace = !isAir(x, y, z - 1);
          const southFace = !isAir(x, y, z + 1);
          const hasLadder = dx === 1 && dz === 0 &&
            dungeon.verticalLinks.has(gridKey(cell, settings));
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
          chunks.set(chunkMorton(x, y, z), chunk);
        }
      }
    }
  }
  return chunks;
}

export function dungeonToRsvo(dungeon: Dungeon): ArrayBuffer {
  const chunks = dungeonChunks(dungeon);
  const octreeDepth = dungeonOctreeDepth(dungeon.settings);
  const chunkLevel = octreeDepth - chunkDepth;
  const masks: number[][] = Array.from({ length: octreeDepth }, () => []);
  const lastChunkParents = Array<bigint>(chunkLevel).fill(-1n);
  const lastVoxelParents = new Int32Array(chunkDepth);
  let leafCount = 0;

  // Keep the wide Morton addresses at chunk level. Each chunk's voxels
  // use small integer addresses, even when the world is much larger.
  const sortedChunks = [...chunks.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (const chunkKey of sortedChunks) {
    let chunkCode = chunkKey;
    for (let level = chunkLevel - 1; level >= 0; level--) {
      const parent = chunkCode >> 3n;
      const bit = 1 << Number(chunkCode & 7n);
      const levelMasks = masks[level];
      if (lastChunkParents[level] === parent) {
        levelMasks[levelMasks.length - 1] |= bit;
        break;
      }
      levelMasks.push(bit);
      lastChunkParents[level] = parent;
      chunkCode = parent;
    }

    lastVoxelParents.fill(-1);
    const chunk = chunks.get(chunkKey)!;
    for (let voxel = 0; voxel < chunk.length; voxel++) {
      if (chunk[voxel] === 0) {
        continue;
      }
      leafCount++;
      let code = voxel;
      for (let local = chunkDepth - 1; local >= 0; local--) {
        const parent = code >>> 3;
        const bit = 1 << (code & 7);
        const levelMasks = masks[chunkLevel + local];
        if (lastVoxelParents[local] === parent) {
          levelMasks[levelMasks.length - 1] |= bit;
          break;
        }
        levelMasks.push(bit);
        lastVoxelParents[local] = parent;
        code = parent;
      }
    }
  }

  const totalNodes = masks.reduce((count, level) => count + level.length, leafCount);
  if (totalNodes > 0xffffffff) {
    throw new Error("This dungeon exceeds the number of nodes an RSVO file can store.");
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
