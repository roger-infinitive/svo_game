import { aStar } from "./a-star.ts";
import { chooseHallways, delaunayEdges, minimumSpanningTree } from "./room-graph.ts";
import type { RoomEdge } from "./room-graph.ts";
import {
  dungeonFloors, dungeonLength, dungeonWidth, gridKey, placeRooms, roomCenter, seededRandom,
} from "./rooms.ts";
import type { DungeonRoom, GridPoint } from "./rooms.ts";

export interface Dungeon {
  seed: number;
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

export function insideDungeon(point: GridPoint): boolean {
  return (
    point.x >= 0 && point.x < dungeonWidth &&
    point.z >= 0 && point.z < dungeonLength &&
    point.y >= 0 && point.y < dungeonFloors
  );
}

function distance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function portals(room: DungeonRoom): Portal[] {
  const result: Portal[] = [];
  for (let y = room.floor; y < room.floor + room.floors; y++) {
    for (let x = room.x + 1; x < room.x + room.width - 1; x++) {
      const far = room.z + room.length - 1;
      result.push(
        { inside: { x, y, z: room.z }, outside: { x, y, z: room.z - 1 } },
        { inside: { x, y, z: far }, outside: { x, y, z: far + 1 } },
      );
    }
    for (let z = room.z + 1; z < room.z + room.length - 1; z++) {
      const far = room.x + room.width - 1;
      result.push(
        { inside: { x: room.x, y, z }, outside: { x: room.x - 1, y, z } },
        { inside: { x: far, y, z }, outside: { x: far + 1, y, z } },
      );
    }
  }
  return result;
}

export function generateDungeon(seed: number): Dungeon {
  const random = seededRandom(seed);
  const rooms = placeRooms(random);
  const graph = delaunayEdges(rooms);
  const tree = minimumSpanningTree(rooms.length, graph);
  const connections = chooseHallways(graph, tree, random);
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
          const key = gridKey(point);
          roomSpace.set(key, point);
          const alongWall = x === room.x || x === room.x + room.width - 1 ||
            z === room.z || z === room.z + room.length - 1;
          if (y === room.floor || alongWall) {
            walkable.set(key, point);
          }
        }
      }
      if (y < room.floor + room.floors - 1) {
        verticalLinks.add(gridKey({ x: room.x, y, z: room.z }));
      }
    }
  }

  const roomPortals = rooms.map(portals);
  for (const [index, edge] of connections.entries()) {
    const addLoop = index >= tree.length;
    const startChoices = roomPortals[edge.a];
    const endChoices = roomPortals[edge.b];
    const pairs = startChoices.flatMap(start => endChoices.map(end => {
      const reused = Number(corridors.has(gridKey(start.outside))) +
        Number(corridors.has(gridKey(end.outside)));
      const score = distance(start.outside, end.outside) +
        3 * Math.abs(start.outside.y - end.outside.y) - 2 * reused;
      return { start, end, reused, score };
    }));
    pairs.sort((a, b) => (addLoop ? a.reused - b.reused : 0) || a.score - b.score);

    let path: GridPoint[] | undefined;
    let doors: [GridPoint, GridPoint] | undefined;
    for (const { start, end } of pairs) {
      path = aStar({
        start: start.outside,
        goal: end.outside,
        key: gridKey,
        heuristic: distance,
        *neighbors(point) {
          for (const direction of gridDirections) {
            const node = addGridPoints(point, direction);
            if (!insideDungeon(node) || roomSpace.has(gridKey(node))) {
              continue;
            }
            const reused = corridors.has(gridKey(node));
            if (direction.y === 0) {
              yield { node, cost: reused ? 1 : 3 };
            } else {
              const lower = direction.y > 0 ? point : node;
              yield { node, cost: verticalLinks.has(gridKey(lower)) ? 2 : 10 };
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

    for (const [step, point] of path.entries()) {
      const key = gridKey(point);
      corridors.add(key);
      walkable.set(key, point);
      const previous = path[step - 1];
      if (previous && point.y !== previous.y) {
        verticalLinks.add(gridKey(point.y < previous.y ? point : previous));
      }
    }
    hallways.push([doors[0], ...path, doors[1]]);
  }

  return {
    seed, rooms, graph, tree, hallways, roomSpace, walkable, verticalLinks,
    entrance: roomCenter(rooms[1]),
  };
}
