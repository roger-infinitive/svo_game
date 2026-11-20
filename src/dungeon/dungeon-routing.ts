import { aStar } from "./a-star.ts";
import { gridKey } from "./rooms.ts";
import type { DungeonSize, GridPoint } from "./rooms.ts";
import { stairBetween, stairFootprint, stairSpan } from "./stairs.ts";
import type { DungeonStair } from "./stairs.ts";

export const gridDirections: GridPoint[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

const horizontalDirections = gridDirections.slice(0, 4);

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

export function gridDistance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

interface RoutingGrid {
  size: DungeonSize;
  roomSpace: Map<number, GridPoint>;
  corridors: Set<number>;
  verticalLinks: Set<number>;
  stairCells: Set<number>;
  stairs: Map<string, DungeonStair>;
}

export function stairKey(stair: DungeonStair, size: DungeonSize): string {
  return `${gridKey(stair.lower, size)}:${gridKey(stair.upper, size)}`;
}

export function routeHallway(
  grid: RoutingGrid,
  start: GridPoint,
  goal: GridPoint,
  useStairs: boolean,
): GridPoint[] | undefined {
  const { size, roomSpace, corridors, verticalLinks, stairCells, stairs } = grid;
  const key = (point: GridPoint) => gridKey(point, size);
  function available(point: GridPoint): boolean {
    return insideDungeon(point, size) && !roomSpace.has(key(point)) && !stairCells.has(key(point));
  }
  if (!available(start) || !available(goal)) {
    return undefined;
  }

  const blockedStairs = new Set<string>();
  while (true) {
    const path = aStar({
      start, goal, key, heuristic: gridDistance,
      *neighbors(point) {
        for (const direction of horizontalDirections) {
          const node = addGridPoints(point, direction);
          if (available(node)) {
            yield { node, cost: corridors.has(key(node)) ? 1 : 3 };
          }
        }

        for (const dy of [-1, 1]) {
          if (!useStairs) {
            const node = { ...point, y: point.y + dy };
            if (available(node)) {
              const lower = dy > 0 ? point : node;
              yield { node, cost: verticalLinks.has(key(lower)) ? 2 : 10 };
            }
          }

          for (const direction of horizontalDirections) {
            const node = {
              x: point.x + direction.x * stairSpan,
              y: point.y + dy,
              z: point.z + direction.z * stairSpan,
            };
            if (!available(node)) {
              continue;
            }
            const stair = stairBetween(point, node);
            const id = stairKey(stair, size);
            if (stairs.has(id)) {
              yield { node, cost: stairSpan + 1 };
              continue;
            }
            if (!useStairs || blockedStairs.has(id)) {
              continue;
            }

            let fits = true;
            for (const { cell } of stairFootprint(stair)) {
              if (!available(cell) || corridors.has(key(cell))) {
                fits = false;
                break;
              }
            }
            if (fits) {
              yield { node, cost: 14 };
            }
          }
        }
      },
    });
    if (!path) {
      return undefined;
    }

    // A* checks existing corridors while expanding. Check the chosen path's
    // own landings and stair footprints before committing any of them.
    const occupied = new Set(path.map(key));
    let conflict: string | undefined;
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1];
      const to = path[index];
      if (from.y === to.y || (from.x === to.x && from.z === to.z)) {
        continue;
      }
      const stair = stairBetween(from, to);
      const id = stairKey(stair, size);
      if (stairs.has(id)) {
        continue;
      }
      for (const { cell } of stairFootprint(stair)) {
        const cellKey = key(cell);
        if (occupied.has(cellKey)) {
          conflict = id;
          break;
        }
        occupied.add(cellKey);
      }
      if (conflict) {
        break;
      }
    }
    if (!conflict) {
      return path;
    }
    blockedStairs.add(conflict);
  }
}
