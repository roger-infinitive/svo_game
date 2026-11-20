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
  overlappingRooms: boolean;
  roomOpeningPercent: number;
  fullOpeningPercent: number;
  minRoomSize: number;
  maxRoomSize: number;
  towerPercent: number;
  minTowerFloors: number;
  maxTowerFloors: number;
  fullHeightTowers: boolean;
  towerConnections: number;
  stairsPercent: number;
  loopPercent: number;
}

export const defaultDungeonSettings: DungeonSettings = {
  width: 48,
  length: 48,
  floors: 3,
  roomCount: 15,
  overlappingRooms: false,
  roomOpeningPercent: 0,
  fullOpeningPercent: 35,
  minRoomSize: 6,
  maxRoomSize: 9,
  towerPercent: 22,
  minTowerFloors: 2,
  maxTowerFloors: 2,
  fullHeightTowers: false,
  towerConnections: 5,
  stairsPercent: 80,
  loopPercent: 12,
};

export const dungeonSettingLimits = {
  width: [1],
  length: [1],
  floors: [1],
  roomCount: [1],
  roomOpeningPercent: [0, 100],
  fullOpeningPercent: [0, 100],
  minRoomSize: [3],
  maxRoomSize: [3],
  towerPercent: [0, 100],
  minTowerFloors: [2],
  maxTowerFloors: [2],
  towerConnections: [0],
  stairsPercent: [0, 100],
  loopPercent: [0, 100],
} as const satisfies Record<
  Exclude<keyof DungeonSettings, "fullHeightTowers" | "overlappingRooms">,
  readonly [number, number?]
>;

export function validateDungeonSettings(settings: DungeonSettings) {
  for (const key of Object.keys(dungeonSettingLimits) as (keyof typeof dungeonSettingLimits)[]) {
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
  if (settings.minTowerFloors > settings.maxTowerFloors) {
    throw new Error("Minimum tower height must be at most the maximum tower height.");
  }
  if (!settings.fullHeightTowers && settings.towerPercent > 0 &&
      settings.floors > 1 && settings.minTowerFloors > settings.floors) {
    throw new Error("Minimum tower height needs to fit within the dungeon's floor count.");
  }
  if (Math.min(settings.width, settings.length) < settings.minRoomSize + 2) {
    throw new Error("The smallest room needs to fit inside the map with space for a hallway on each side.");
  }
  if (settings.roomCount < settings.floors &&
      !(settings.fullHeightTowers && settings.towerPercent > 0)) {
    throw new Error("Add a room for each floor or enable full-height towers.");
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

export function roomsOverlap(a: DungeonRoom, b: DungeonRoom): boolean {
  return (
    a.floors === 1 && b.floors === 1 && a.floor === b.floor && footprintsOverlap(a, b)
  );
}

export function footprintsOverlap(a: DungeonRoom, b: DungeonRoom): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.z < b.z + b.length && b.z < a.z + a.length;
}

export function placeRooms(random: () => number, settings: DungeonSettings): DungeonRoom[] {
  const rooms: DungeonRoom[] = [];
  const randomInt = (limit: number) => Math.floor(random() * limit);
  const { roomCount, minRoomSize, maxRoomSize, width, length, floors, towerPercent } = settings;
  const minTowerFloors = settings.fullHeightTowers ? 2 : settings.minTowerFloors;
  const hasTower = floors >= minTowerFloors && towerPercent > 0 &&
    (roomCount > floors || settings.fullHeightTowers);
  const reservedRooms = floors + Number(hasTower);
  const xMargin = width >= minRoomSize + 4 ? 2 : 1;
  const zMargin = length >= minRoomSize + 4 ? 2 : 1;
  const widestRoom = Math.min(maxRoomSize, width - 2 * xMargin);
  const longestRoom = Math.min(maxRoomSize, length - 2 * zMargin);

  for (let id = 0; id < roomCount; id++) {
    const startFloor = id < reservedRooms ? Math.max(0, id - Number(hasTower)) : randomInt(floors);
    const isTower = (hasTower && id === 0) ||
      (id >= reservedRooms && floors - startFloor >= minTowerFloors && randomInt(100) < towerPercent);
    const fullHeight = isTower && settings.fullHeightTowers;
    const floor = fullHeight ? 0 : startFloor;
    let roomFloors = 1;
    if (fullHeight) {
      roomFloors = floors;
    } else if (isTower) {
      const maxTowerFloors = Math.min(settings.maxTowerFloors, floors - startFloor);
      roomFloors = minTowerFloors;
      if (maxTowerFloors > minTowerFloors) {
        roomFloors += randomInt(maxTowerFloors - minTowerFloors + 1);
      }
    }

    const lowerRooms = roomFloors === 1 && settings.roomOpeningPercent > 0
      ? rooms.filter(other => other.floors === 1 && other.floor === floor - 1)
      : [];
    const anchor = lowerRooms.length > 0 && randomInt(2) === 0
      ? lowerRooms[randomInt(lowerRooms.length)]
      : undefined;

    for (let attempt = 0; attempt < 400; attempt++) {
      const stack = attempt === 0 ? anchor : undefined;
      let roomWidth = minRoomSize + randomInt(widestRoom - minRoomSize + 1);
      let roomLength = minRoomSize + randomInt(longestRoom - minRoomSize + 1);
      if (stack) {
        roomWidth = Math.max(roomWidth, Math.min(widestRoom, stack.width + 2));
        roomLength = Math.max(roomLength, Math.min(longestRoom, stack.length + 2));
      }
      let x: number;
      let z: number;
      if (stack) {
        const centeredX = stack.x - Math.floor((roomWidth - stack.width) / 2);
        const centeredZ = stack.z - Math.floor((roomLength - stack.length) / 2);
        x = Math.max(xMargin, Math.min(width - roomWidth - xMargin, centeredX));
        z = Math.max(zMargin, Math.min(length - roomLength - zMargin, centeredZ));
      } else {
        x = xMargin + randomInt(width - roomWidth - 2 * xMargin + 1);
        z = zMargin + randomInt(length - roomLength - 2 * zMargin + 1);
      }
      const room = {
        id,
        x,
        z,
        floor,
        width: roomWidth,
        length: roomLength,
        floors: roomFloors,
      };

      const center = roomCenter(room);
      if (rooms.every(other => {
        if (separated(room, other)) {
          return true;
        }
        if (settings.roomOpeningPercent > 0 && room.floors === 1 && other.floors === 1 &&
            Math.abs(room.floor - other.floor) === 1 && footprintsOverlap(room, other)) {
          return true;
        }
        if (!settings.overlappingRooms || !roomsOverlap(room, other)) {
          return false;
        }
        const otherCenter = roomCenter(other);
        return center.x !== otherCenter.x || center.z !== otherCenter.z;
      })) {
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
