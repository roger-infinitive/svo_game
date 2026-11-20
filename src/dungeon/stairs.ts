import { floorHeight } from "./rooms.ts";
import type { GridPoint } from "./rooms.ts";

export interface DungeonStair {
  lower: GridPoint;
  upper: GridPoint;
  dx: number;
  dz: number;
}

export const stairRun = 2 * floorHeight;
export const stairSpan = stairRun + 1;

export function stairBetween(a: GridPoint, b: GridPoint): DungeonStair {
  const lower = a.y < b.y ? a : b;
  const upper = a.y < b.y ? b : a;
  return {
    lower,
    upper,
    dx: Math.sign(upper.x - lower.x),
    dz: Math.sign(upper.z - lower.z),
  };
}

export function* stairFootprint(stair: DungeonStair) {
  for (let step = 1; step <= stairRun; step++) {
    const x = stair.lower.x + step * stair.dx;
    const z = stair.lower.z + step * stair.dz;
    yield { cell: { x, y: stair.lower.y, z }, step };
    yield { cell: { x, y: stair.upper.y, z }, step };
  }
}

export function stairWalkPoints(stair: DungeonStair): GridPoint[] {
  const baseY = stair.lower.y * floorHeight;
  const points: GridPoint[] = [{ ...stair.lower, y: baseY }];
  for (let step = 1; step <= stairRun; step++) {
    points.push({
      x: stair.lower.x + step * stair.dx,
      y: baseY + (step * floorHeight) / stairRun,
      z: stair.lower.z + step * stair.dz,
    });
  }
  points.push({ ...stair.upper, y: stair.upper.y * floorHeight });
  return points;
}
