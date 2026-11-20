import { aStar } from "./a-star.ts";
import { chooseHallways, delaunayEdges, minimumSpanningTree } from "./room-graph.ts";
import type { RoomEdge } from "./room-graph.ts";
import {
  defaultDungeonSettings, gridKey, placeRooms, roomCenter, seededRandom, validateDungeonSettings,
} from "./rooms.ts";
import type { DungeonRoom, DungeonSettings, DungeonSize, GridPoint } from "./rooms.ts";

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
  entrance: GridPoint;
}

interface Portal {
  inside: GridPoint;
  outside: GridPoint;
}

export const gridDirections: GridPoint[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

export function addGridPoints(a: GridPoint, b: GridPoint): GridPoint {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function insideDungeon(point: GridPoint, size: DungeonSize): boolean {
  return (
    point.x >= 0 && point.x < size.width &&
    point.z >= 0 && point.z < size.length &&
    point.y >= 0 && point.y < size.floors
  );
}

function distance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
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
      if (distance(door, portal.inside) <= 1) {
        penalty += 12;
      }
    }
  }
  return penalty;
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

  const roomPortals = rooms.map(portals);
  const towerDoors = rooms.map(() => [] as GridPoint[]);
  for (const [index, edge] of connections.entries()) {
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
      const score = distance(from.outside, to.outside) +
        3 * Math.abs(from.outside.y - to.outside.y) - 2 * reused + start.penalty + end.penalty;
      return { start: from, end: to, reused, score };
    }));
    pairs.sort((a, b) => (addLoop ? a.reused - b.reused : 0) || a.score - b.score);

    let path: GridPoint[] | undefined;
    let doors: [GridPoint, GridPoint] | undefined;
    for (const { start, end } of pairs) {
      path = aStar({
        start: start.outside,
        goal: end.outside,
        key: keyFor,
        heuristic: distance,
        *neighbors(point) {
          for (const direction of gridDirections) {
            const node = addGridPoints(point, direction);
            if (!insideDungeon(node, settings) || roomSpace.has(keyFor(node))) {
              continue;
            }
            const reused = corridors.has(keyFor(node));
            if (direction.y === 0) {
              yield { node, cost: reused ? 1 : 3 };
            } else {
              const lower = direction.y > 0 ? point : node;
              yield { node, cost: verticalLinks.has(keyFor(lower)) ? 2 : 10 };
            }
          }
        },
      });
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
      if (previous && point.y !== previous.y) {
        verticalLinks.add(keyFor(point.y < previous.y ? point : previous));
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
  return {
    seed, settings, rooms, graph, tree, hallways, roomSpace, walkable, verticalLinks,
    entrance: roomCenter(entranceRoom),
  };
}
