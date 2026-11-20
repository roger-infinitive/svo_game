import { addGridPoints, insideDungeon } from "./dungeon-generator.ts";
import type { Dungeon } from "./dungeon-generator.ts";
import { floorHeight, gridKey } from "./rooms.ts";
import type { GridPoint } from "./rooms.ts";

export function moveInDungeon(
  dungeon: Dungeon,
  player: GridPoint,
  direction: GridPoint,
): GridPoint {
  const next = addGridPoints(player, direction);
  const floor = Math.floor(player.y / floorHeight);
  const size = dungeon.settings;

  if (direction.y !== 0) {
    if (next.y < 0 || next.y > (size.floors - 1) * floorHeight) {
      return player;
    }
    const lowerFloor = Math.floor(Math.min(player.y, next.y) / floorHeight);
    const link = gridKey({ ...player, y: lowerFloor }, size);
    return dungeon.verticalLinks.has(link) ? next : player;
  }

  if (player.y % floorHeight !== 0) {
    return player;
  }
  const cell = { ...next, y: floor };
  return insideDungeon(cell, size) && dungeon.walkable.has(gridKey(cell, size)) ? next : player;
}

export function climbDirections(dungeon: Dungeon, player: GridPoint): string {
  const up = moveInDungeon(dungeon, player, { x: 0, y: 1, z: 0 }) !== player;
  const down = moveInDungeon(dungeon, player, { x: 0, y: -1, z: 0 }) !== player;
  if (up && down) {
    return " · Space / Shift to climb";
  }
  if (up) {
    return " · Space to climb up";
  }
  return down ? " · Shift to climb down" : "";
}
