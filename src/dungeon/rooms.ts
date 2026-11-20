export interface GridPoint {
  x: number;
  y: number;
  z: number;
}

export interface DungeonRoom {
  id: number;
  x: number;
  z: number;
  floor: number;
  width: number;
  length: number;
  floors: number;
}

export const dungeonWidth = 48;
export const dungeonLength = 48;
export const dungeonFloors = 3;
export const floorHeight = 4;

export function gridKey(point: GridPoint): number {
  return (point.y * dungeonLength + point.z) * dungeonWidth + point.x;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function separated(a: DungeonRoom, b: DungeonRoom): boolean {
  // Bounds are exclusive. A room must have at least one empty cell on one axis.
  return (
    a.x + a.width < b.x || b.x + b.width < a.x ||
    a.z + a.length < b.z || b.z + b.length < a.z ||
    a.floor + a.floors < b.floor || b.floor + b.floors < a.floor
  );
}

export function placeRooms(random: () => number): DungeonRoom[] {
  const rooms: DungeonRoom[] = [];
  const randomInt = (limit: number) => Math.floor(random() * limit);
  const roomCount = 15;

  for (let id = 0; id < roomCount; id++) {
    // Reserve a tower and a single-storey room on every floor.
    const floor = id <= dungeonFloors ? Math.max(0, id - 1) : randomInt(dungeonFloors);
    const floors = id === 0 ? 2 : id > dungeonFloors && floor < dungeonFloors - 1 &&
      random() < 0.22 ? 2 : 1;

    for (let attempt = 0; attempt < 400; attempt++) {
      const width = 6 + randomInt(4);
      const length = 6 + randomInt(4);
      const room = {
        id,
        x: 2 + randomInt(dungeonWidth - width - 3),
        z: 2 + randomInt(dungeonLength - length - 3),
        floor,
        width,
        length,
        floors,
      };

      if (rooms.every(other => separated(room, other))) {
        rooms.push(room);
        break;
      }
    }
  }
  return rooms;
}

export function roomCenter(room: DungeonRoom): GridPoint {
  return {
    x: room.x + Math.floor(room.width / 2),
    y: room.floor,
    z: room.z + Math.floor(room.length / 2),
  };
}
