import { generateDungeon } from "./dungeon-generator.ts";
import { dungeonToRsvo } from "./dungeon-voxels.ts";

// The viewer loads this module as a dedicated worker.
const worker = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<number>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

worker.addEventListener("message", event => {
  const dungeon = generateDungeon(event.data);
  const buffer = dungeonToRsvo(dungeon);
  worker.postMessage({ dungeon, buffer }, [buffer]);
});
