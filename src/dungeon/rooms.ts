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

export const floorHeight = 2;

export interface DungeonSize {
  width: number;
  length: number;
  floors: number;
}

export interface DungeonSettings extends DungeonSize {
  roomCount: number;
  minRoomSize: number;
  maxRoomSize: number;
  towerPercent: number;
  loopPercent: number;
}

export const defaultDungeonSettings: DungeonSettings = {
  width: 48,
  length: 48,
  floors: 3,
  roomCount: 15,
  minRoomSize: 6,
  maxRoomSize: 9,
  towerPercent: 22,
  loopPercent: 12,
};

export const dungeonSettingLimits = {
  width: [1],
  length: [1],
  floors: [1],
  roomCount: [1],
  minRoomSize: [3],
  maxRoomSize: [3],
  towerPercent: [0, 100],
  loopPercent: [0, 100],
} as const satisfies Record<keyof DungeonSettings, readonly [number, number?]>;

export function validateDungeonSettings(settings: DungeonSettings) {
  for (const key of Object.keys(dungeonSettingLimits) as (keyof DungeonSettings)[]) {
    const [min, max]: readonly [number, number?] = dungeonSettingLimits[key];
    const value = settings[key];
    if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
      const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
      throw new Error(`${key} must be a whole number ${range}.`);
    }
  }
  if (settings.minRoomSize > settings.maxRoomSize) {
    throw new Error("Minimum room size must be at most the maximum room size.");
  }
  if (Math.min(settings.width, settings.length) < settings.minRoomSize + 2) {
    throw new Error("The smallest room needs to fit inside the map with space for a hallway on each side.");
  }
  if (settings.roomCount < settings.floors) {
    throw new Error("Add at least one room per floor.");
  }
  const span = Math.max(settings.width, settings.length, settings.floors * floorHeight);
  // RSVO stores at most 32 subdivisions. Each metre uses 5 of those bits.
  if (span > 2 ** 27) {
    throw new Error("This map exceeds the RSVO depth limit.");
  }
  if (!Number.isSafeInteger(settings.width * settings.length * settings.floors)) {
    throw new Error("This map exceeds the exact grid address range.");
  }
}

export function gridKey(point: GridPoint, size: DungeonSize): number {
  return (point.y * size.length + point.z) * size.width + point.x;
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

export function placeRooms(random: () => number, settings: DungeonSettings): DungeonRoom[] {
  const rooms: DungeonRoom[] = [];
  const randomInt = (limit: number) => Math.floor(random() * limit);
  const { roomCount, minRoomSize, maxRoomSize, width, length, floors, towerPercent } = settings;
  const hasTower = floors > 1 && towerPercent > 0 && roomCount > floors;
  const reservedRooms = floors + Number(hasTower);
  const xMargin = width >= minRoomSize + 4 ? 2 : 1;
  const zMargin = length >= minRoomSize + 4 ? 2 : 1;
  const widestRoom = Math.min(maxRoomSize, width - 2 * xMargin);
  const longestRoom = Math.min(maxRoomSize, length - 2 * zMargin);

  for (let id = 0; id < roomCount; id++) {
    const floor = id < reservedRooms ? Math.max(0, id - Number(hasTower)) : randomInt(floors);
    const isTower = (hasTower && id === 0) ||
      (id >= reservedRooms && floor < floors - 1 && randomInt(100) < towerPercent);
    for (let attempt = 0; attempt < 400; attempt++) {
      const roomWidth = minRoomSize + randomInt(widestRoom - minRoomSize + 1);
      const roomLength = minRoomSize + randomInt(longestRoom - minRoomSize + 1);
      const room = {
        id,
        x: xMargin + randomInt(width - roomWidth - 2 * xMargin + 1),
        z: zMargin + randomInt(length - roomLength - 2 * zMargin + 1),
        floor,
        width: roomWidth,
        length: roomLength,
        floors: isTower ? 2 : 1,
      };

      if (rooms.every(other => separated(room, other))) {
        rooms.push(room);
        break;
      }
    }
    if (rooms.length !== id + 1) {
      break;
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
