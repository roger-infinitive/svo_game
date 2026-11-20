import { addGridPoints, gridDirections, insideDungeon } from "./dungeon-routing.ts";
import { footprintsOverlap, gridKey } from "./rooms.ts";
import type { DungeonRoom, DungeonSettings, GridPoint } from "./rooms.ts";

export interface RoomOpening {
  x: number;
  z: number;
  floor: number;
  width: number;
  length: number;
  full: boolean;
}

const horizontalDirections = gridDirections.slice(0, 4);

function intersection(lower: DungeonRoom, upper: DungeonRoom, full: boolean): RoomOpening {
  const inset = full ? 0 : 1;
  const x = Math.max(lower.x, upper.x) + inset;
  const z = Math.max(lower.z, upper.z) + inset;
  return {
    x,
    z,
    floor: upper.floor,
    width: Math.min(lower.x + lower.width, upper.x + upper.width) - x - inset,
    length: Math.min(lower.z + lower.length, upper.z + upper.length) - z - inset,
    full,
  };
}

function tryOpening(
  opening: RoomOpening,
  walkable: Map<number, GridPoint>,
  protectedCells: Set<number>,
  settings: DungeonSettings,
): boolean {
  const keyFor = (point: GridPoint) => gridKey(point, settings);
  const cut = new Map<number, GridPoint>();
  for (let z = opening.z; z < opening.z + opening.length; z++) {
    for (let x = opening.x; x < opening.x + opening.width; x++) {
      const point = { x, y: opening.floor, z };
      const key = keyFor(point);
      if (protectedCells.has(key) || !walkable.has(key)) {
        return false;
      }
      cut.set(key, point);
    }
  }
  if (cut.size === 0) {
    return false;
  }

  const rim: number[] = [];
  if (!opening.full) {
    const minX = opening.x - 1;
    const maxX = opening.x + opening.width;
    const minZ = opening.z - 1;
    const maxZ = opening.z + opening.length;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (x === minX || x === maxX || z === minZ || z === maxZ) {
          const key = keyFor({ x, y: opening.floor, z });
          if (!walkable.has(key)) {
            return false;
          }
          rim.push(key);
        }
      }
    }
  }

  // All remaining neighbors of the cut must stay connected. This keeps
  // the floor traversable without relying on a detour through other levels.
  const boundary = new Map<number, GridPoint>();
  for (const point of cut.values()) {
    for (const direction of horizontalDirections) {
      const neighbor = addGridPoints(point, direction);
      if (!insideDungeon(neighbor, settings)) {
        continue;
      }
      const key = keyFor(neighbor);
      if (!cut.has(key) && walkable.has(key)) {
        boundary.set(key, neighbor);
      }
    }
  }
  const start = boundary.values().next().value;
  if (!start) {
    return false;
  }
  const queue = [start];
  const visited = new Set([keyFor(start)]);
  boundary.delete(keyFor(start));
  for (let index = 0; index < queue.length && boundary.size > 0; index++) {
    for (const direction of horizontalDirections) {
      const neighbor = addGridPoints(queue[index], direction);
      if (!insideDungeon(neighbor, settings)) {
        continue;
      }
      const key = keyFor(neighbor);
      if (visited.has(key) || cut.has(key) || !walkable.has(key)) {
        continue;
      }
      visited.add(key);
      boundary.delete(key);
      queue.push(neighbor);
    }
  }
  if (boundary.size > 0) {
    return false;
  }

  for (const key of cut.keys()) {
    walkable.delete(key);
  }
  for (const key of rim) {
    protectedCells.add(key);
  }
  return true;
}

export function carveRoomOpenings(
  settings: DungeonSettings,
  rooms: DungeonRoom[],
  walkable: Map<number, GridPoint>,
  hallways: GridPoint[][],
  entrance: GridPoint,
  random: () => number,
): RoomOpening[] {
  if (settings.roomOpeningPercent === 0 || settings.floors < 2) {
    return [];
  }

  const keyFor = (point: GridPoint) => gridKey(point, settings);
  const protectedCells = new Set([keyFor(entrance)]);
  for (const hallway of hallways) {
    protectedCells.add(keyFor(hallway[0]));
    protectedCells.add(keyFor(hallway[hallway.length - 1]));
  }

  const singleFloorRooms = rooms.filter(room => room.floors === 1);
  const openings: RoomOpening[] = [];
  for (const lower of singleFloorRooms) {
    const upperRooms = singleFloorRooms.filter(upper =>
      upper.floor === lower.floor + 1 && footprintsOverlap(lower, upper),
    );
    if (upperRooms.length === 0 || random() * 100 >= settings.roomOpeningPercent) {
      continue;
    }

    const full = random() * 100 < settings.fullOpeningPercent;
    for (const upper of upperRooms) {
      const modes = full ? [true, false] : [false];
      for (const removeRim of modes) {
        const opening = intersection(lower, upper, removeRim);
        if (tryOpening(opening, walkable, protectedCells, settings)) {
          openings.push(opening);
          break;
        }
      }
    }
  }
  return openings;
}
