import type { Dungeon } from "./dungeon-generator.ts";
import { gridKey, roomCenter } from "./rooms.ts";
import type { DungeonRoom, DungeonSettings, GridPoint } from "./rooms.ts";
import type { RoomEdge } from "./room-graph.ts";

export function compactDungeon(
  seed: number,
  requested: DungeonSettings,
  generationNote: string,
): Dungeon {
  const settings = {
    ...requested,
    width: 5,
    length: 5,
    roomCount: requested.floors,
    minRoomSize: 3,
    maxRoomSize: 3,
    towerPercent: 0,
    roomOpeningPercent: 0,
    loopPercent: 0,
    stairsPercent: 0,
  };
  const x = 1;
  const z = 1;
  const rooms: DungeonRoom[] = [];
  const roomSpace = new Map<number, GridPoint>();
  const verticalLinks = new Set<number>();
  const hallways: GridPoint[][] = [];
  const tree: RoomEdge[] = [];

  // A stack of rooms with an open ladder shaft always fits, including on
  // maps too narrow for randomly spaced rooms or staircase footprints.
  for (let floor = 0; floor < settings.floors; floor++) {
    rooms.push({ id: floor, x, z, floor, width: 3, length: 3, floors: 1 });
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        const point = { x: x + dx, y: floor, z: z + dz };
        roomSpace.set(gridKey(point, settings), point);
      }
    }

    if (floor + 1 < settings.floors) {
      const shaft = { x, y: floor, z };
      verticalLinks.add(gridKey(shaft, settings));
      hallways.push([shaft, { ...shaft, y: floor + 1 }]);
      tree.push({ a: floor, b: floor + 1, distance: 2 });
    }
  }

  return {
    seed,
    settings,
    rooms,
    graph: [...tree],
    tree,
    hallways,
    roomSpace,
    walkable: new Map(roomSpace),
    verticalLinks,
    stairs: [],
    openings: [],
    entrance: roomCenter(rooms[0]),
    generationNote,
  };
}
