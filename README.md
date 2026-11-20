# SVO Raycaster

A TypeScript and WebGPU port of the native DirectX 11 sparse voxel raycaster. It reads RSVO version 1 files and renders voxel face normals. A generated torus is included so the viewer opens without a model download.

## Run locally

With Node.js 24 or newer, run `node serve.mjs` from this directory and open the URL it prints in a browser with WebGPU enabled. The server uses port 5173 by default and picks an available port if 5173 is busy. Set the `PORT` environment variable to require a specific port.

The local server strips TypeScript annotations as it serves the modules and requires no package install. To check the TypeScript types, run `npm install` followed by `npm run typecheck`.

Choose **Open RSVO** to load a model, including `data/render_me.rsvo` from the native project. The browser reads the file locally. Click the canvas to look around, use WASD to fly, Space and Shift to move vertically, and Escape to release the mouse.

## Rendering performance

- TypeScript validates the tree and builds a flat child-offset table at import. The GPU receives packed 8-bit masks and 32-bit offsets, about five bytes per internal node before buffer padding. The offset table is split across two bindings so the original 47 MB RSVO fits within a 128 MiB per-binding limit.
- A fullscreen WebGPU pass traverses the tree directly and writes to the canvas. Each frame updates only an 80-byte camera uniform. The renderer submits work when the view changes.
- **Auto** resolution caps rendering at roughly 921,600 pixels and avoids high-DPI supersampling. Use **100%** for the full high-DPI view or decrease **Depth** to stop traversal earlier. The renderer keeps one GPU frame in flight so camera movement does not queue stale frames. The footer counts completed frames during interaction.

The port covers the active GPU rendering path, RSVO imports, fly controls, and depth adjustment. The old mesh renderer and CPU raycast gizmos are outside the current port.
