import { generateDungeon } from "./dungeon-generator.ts";
import { dungeonToRsvo } from "./dungeon-voxels.ts";
import type { DungeonSettings } from "./rooms.ts";

interface DungeonRequest {
  seed: number;
  settings: DungeonSettings;
}

// The viewer loads this module as a dedicated worker.
const worker = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<DungeonRequest>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

worker.addEventListener("message", event => {
  const { seed, settings } = event.data;
  const dungeon = generateDungeon(seed, settings);
  const buffer = dungeonToRsvo(dungeon);
  worker.postMessage({ dungeon, buffer }, [buffer]);
});
