import { gridDistance, routeHallway, stairKey } from "./dungeon-routing.ts";
import { chooseHallways, delaunayEdges, minimumSpanningTree } from "./room-graph.ts";
import type { RoomEdge } from "./room-graph.ts";
import { carveRoomOpenings } from "./room-openings.ts";
import type { RoomOpening } from "./room-openings.ts";
import {
  defaultDungeonSettings, gridKey, placeRooms, roomCenter, roomsOverlap, seededRandom,
  validateDungeonSettings,
} from "./rooms.ts";
import type { DungeonRoom, DungeonSettings, GridPoint } from "./rooms.ts";
import { stairBetween, stairFootprint } from "./stairs.ts";
import type { DungeonStair } from "./stairs.ts";

export { addGridPoints, gridDirections, insideDungeon } from "./dungeon-routing.ts";

export interface Dungeon {
  seed: number;
  settings: DungeonSettings;
  rooms: DungeonRoom[];
  graph: RoomEdge[];
  tree: RoomEdge[];
  hallways: GridPoint[][];
  roomSpace: Map<number, GridPoint>;
  walkable: Map<number, GridPoint>;
  verticalLinks: Set<number>;
  stairs: DungeonStair[];
  openings: RoomOpening[];
  entrance: GridPoint;
}

interface Portal {
  inside: GridPoint;
  outside: GridPoint;
}

function* perimeterPortals(room: DungeonRoom, y: number, inset: number): Generator<Portal> {
  const farX = room.x + room.width - 1;
  const farZ = room.z + room.length - 1;
  for (let x = room.x + inset; x <= farX - inset; x++) {
    yield { inside: { x, y, z: room.z }, outside: { x, y, z: room.z - 1 } };
    yield { inside: { x, y, z: farZ }, outside: { x, y, z: farZ + 1 } };
  }
  for (let z = room.z + inset; z <= farZ - inset; z++) {
    yield { inside: { x: room.x, y, z }, outside: { x: room.x - 1, y, z } };
    yield { inside: { x: farX, y, z }, outside: { x: farX + 1, y, z } };
  }
}

function portals(room: DungeonRoom): Portal[] {
  const result: Portal[] = [];
  for (let y = room.floor; y < room.floor + room.floors; y++) {
    result.push(...perimeterPortals(room, y, 1));
  }
  return result;
}

function towerEntrancePenalty(portal: Portal, doors: GridPoint[]): number {
  let penalty = 0;
  for (const door of doors) {
    if (door.y === portal.inside.y) {
      penalty += 6;
      if (gridDistance(door, portal.inside) <= 1) {
        penalty += 12;
      }
    }
  }
  return penalty;
}

function roomClusters(rooms: DungeonRoom[], overlapsAllowed: boolean): number[] {
  const parents = rooms.map((_, index) => index);
  if (!overlapsAllowed) {
    return parents;
  }

  function root(index: number): number {
    while (parents[index] !== index) {
      index = parents[index];
    }
    return index;
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = 0; j < i; j++) {
      if (roomsOverlap(rooms[i], rooms[j])) {
        parents[root(i)] = root(j);
      }
    }
  }
  return parents.map((_, index) => root(index));
}

export function generateDungeon(
  seed: number,
  settings: DungeonSettings = defaultDungeonSettings,
): Dungeon {
  validateDungeonSettings(settings);
  const random = seededRandom(seed);
  let rooms = placeRooms(random, settings);
  for (let attempt = 0; rooms.length < settings.roomCount && attempt < 8; attempt++) {
    rooms = placeRooms(random, settings);
  }
  if (rooms.length < settings.roomCount) {
    throw new Error("Could not fit all rooms. Try a larger map, smaller rooms, or fewer rooms.");
  }

  const keyFor = (point: GridPoint) => gridKey(point, settings);
  const graph = delaunayEdges(rooms, settings);
  const tree = minimumSpanningTree(rooms.length, graph);
  const connections = chooseHallways(
    rooms, graph, tree, random, settings.loopPercent, settings.towerConnections,
  );
  const roomSpace = new Map<number, GridPoint>();
  const walkable = new Map<number, GridPoint>();
  const verticalLinks = new Set<number>();
  const corridors = new Set<number>();
  const stairCells = new Set<number>();
  const stairs = new Map<string, DungeonStair>();
  const routingGrid = { size: settings, roomSpace, corridors, verticalLinks, stairCells, stairs };
  const hallways: GridPoint[][] = [];

  for (const room of rooms) {
    for (let y = room.floor; y < room.floor + room.floors; y++) {
      for (let z = room.z; z < room.z + room.length; z++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          const point = { x, y, z };
          const key = keyFor(point);
          roomSpace.set(key, point);
          if (y === room.floor) {
            walkable.set(key, point);
          }
        }
      }
    }
  }

  const clusters = roomClusters(rooms, settings.overlappingRooms);
  const clusterPortals = new Map<number, Map<string, Portal>>();
  for (const [index, room] of rooms.entries()) {
    const cluster = clusters[index];
    const exterior = clusterPortals.get(cluster) ?? new Map<string, Portal>();
    for (const portal of portals(room)) {
      const outsideKey = keyFor(portal.outside);
      if (!roomSpace.has(outsideKey)) {
        exterior.set(`${keyFor(portal.inside)}:${outsideKey}`, portal);
      }
    }
    clusterPortals.set(cluster, exterior);
  }
  const roomPortals = clusters.map(cluster => [...clusterPortals.get(cluster)!.values()]);
  const towerDoors = rooms.map(() => [] as GridPoint[]);
  for (const [index, edge] of connections.entries()) {
    if (clusters[edge.a] === clusters[edge.b]) {
      continue;
    }
    const addLoop = index >= tree.length;
    const startTower = settings.towerConnections > 0 && rooms[edge.a].floors > 1;
    const endTower = settings.towerConnections > 0 && rooms[edge.b].floors > 1;
    const startChoices = roomPortals[edge.a].map(portal => ({
      portal,
      penalty: startTower ? towerEntrancePenalty(portal, towerDoors[edge.a]) : 0,
      reused: Number(corridors.has(keyFor(portal.outside))),
    }));
    const endChoices = roomPortals[edge.b].map(portal => ({
      portal,
      penalty: endTower ? towerEntrancePenalty(portal, towerDoors[edge.b]) : 0,
      reused: Number(corridors.has(keyFor(portal.outside))),
    }));
    const pairs = startChoices.flatMap(start => endChoices.map(end => {
      const from = start.portal;
      const to = end.portal;
      const reused = start.reused + end.reused;
      const score = gridDistance(from.outside, to.outside) +
        3 * Math.abs(from.outside.y - to.outside.y) - 2 * reused + start.penalty + end.penalty;
      return { start: from, end: to, reused, score };
    }));
    pairs.sort((a, b) => (addLoop ? a.reused - b.reused : 0) || a.score - b.score);

    let path: GridPoint[] | undefined;
    let doors: [GridPoint, GridPoint] | undefined;
    const preferStairs = settings.stairsPercent > 0 && random() * 100 < settings.stairsPercent;
    for (const { start, end } of pairs) {
      path = routeHallway(routingGrid, start.outside, end.outside, preferStairs);
      if (!path && settings.stairsPercent > 0) {
        path = routeHallway(routingGrid, start.outside, end.outside, !preferStairs);
      }
      if (path) {
        doors = [start.inside, end.inside];
        break;
      }
    }
    if (!path || !doors) {
      throw new Error(`Could not carve a hallway between rooms ${edge.a + 1} and ${edge.b + 1}.`);
    }
    if (startTower) {
      towerDoors[edge.a].push(doors[0]);
    }
    if (endTower) {
      towerDoors[edge.b].push(doors[1]);
    }

    for (const [step, point] of path.entries()) {
      const key = keyFor(point);
      corridors.add(key);
      walkable.set(key, point);
      const previous = path[step - 1];
      if (!previous || point.y === previous.y) {
        continue;
      }
      if (point.x === previous.x && point.z === previous.z) {
        verticalLinks.add(keyFor(point.y < previous.y ? point : previous));
      } else {
        const stair = stairBetween(previous, point);
        stairs.set(stairKey(stair, settings), stair);
        for (const { cell } of stairFootprint(stair)) {
          stairCells.add(keyFor(cell));
        }
      }
    }
    hallways.push([doors[0], ...path, doors[1]]);
  }

  // Check the hallways that were actually carved, including incidental
  // openings where a corridor passes alongside a tower.
  for (const room of rooms) {
    let highestGallery = room.floor;
    for (let y = room.floor + 1; y < room.floor + room.floors; y++) {
      const perimeter = [...perimeterPortals(room, y, 0)];
      if (!perimeter.some(({ outside }) => corridors.has(keyFor(outside)))) {
        continue;
      }
      for (const { inside } of perimeter) {
        walkable.set(keyFor(inside), inside);
      }
      highestGallery = y;
    }

    // A ladder can pass through an open level to reach a connected gallery.
    for (let y = room.floor; y < highestGallery; y++) {
      const ladder = { x: room.x, y, z: room.z };
      const above = { ...ladder, y: y + 1 };
      verticalLinks.add(keyFor(ladder));
      walkable.set(keyFor(above), above);
    }
  }

  const entranceRoom = rooms.find(room => room.floor === 0 && room.floors === 1) ?? rooms[0];
  const entrance = roomCenter(entranceRoom);
  const openings = carveRoomOpenings(settings, rooms, walkable, hallways, entrance, random);
  return {
    seed, settings, rooms, graph, tree, hallways, roomSpace, walkable, verticalLinks,
    stairs: [...stairs.values()],
    openings,
    entrance,
  };
}
