import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";

const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/src/main.ts", ["src/main.ts", "text/javascript"]],
  ["/src/camera-orientation.ts", ["src/camera-orientation.ts", "text/javascript"]],
  ["/src/rsvo.ts", ["src/rsvo.ts", "text/javascript"]],
  ["/src/dungeon/a-star.ts", ["src/dungeon/a-star.ts", "text/javascript"]],
  ["/src/dungeon/rooms.ts", ["src/dungeon/rooms.ts", "text/javascript"]],
  ["/src/dungeon/room-graph.ts", ["src/dungeon/room-graph.ts", "text/javascript"]],
  ["/src/dungeon/dungeon-generator.ts", ["src/dungeon/dungeon-generator.ts", "text/javascript"]],
  ["/src/dungeon/dungeon-routing.ts", ["src/dungeon/dungeon-routing.ts", "text/javascript"]],
  ["/src/dungeon/room-openings.ts", ["src/dungeon/room-openings.ts", "text/javascript"]],
  ["/src/dungeon/stairs.ts", ["src/dungeon/stairs.ts", "text/javascript"]],
  ["/src/dungeon/dungeon-voxels.ts", ["src/dungeon/dungeon-voxels.ts", "text/javascript"]],
  ["/src/dungeon/dungeon-walk.ts", ["src/dungeon/dungeon-walk.ts", "text/javascript"]],
  ["/src/dungeon/dungeon-worker.ts", ["src/dungeon/dungeon-worker.ts", "text/javascript"]],
  ["/src/raycast.wgsl", ["src/raycast.wgsl", "text/plain"]],
]);

const port = Number(process.env.PORT ?? 5173);
const host = "127.0.0.1";
const server = createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, "http://localhost").pathname);
  if (!route) {
    response.writeHead(404).end();
    return;
  }

  try {
    const [file, contentType] = route;
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    response.end(file.endsWith(".ts") ? stripTypeScriptTypes(source) : source);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end("Could not serve the requested file.");
  }
});

let attemptedPort = port;
server.on("error", error => {
  if (error.code === "EADDRINUSE" && process.env.PORT === undefined && attemptedPort === port) {
    console.log(`Port ${port} is busy. Choosing an available port.`);
    attemptedPort = 0;
    server.listen(attemptedPort, host);
    return;
  }

  console.error(`Could not start the viewer on ${host}:${attemptedPort}. ${error.message}`);
  process.exitCode = 1;
});

server.on("listening", () => {
  console.log(`http://${host}:${server.address().port}`);
});

server.listen(attemptedPort, host);
