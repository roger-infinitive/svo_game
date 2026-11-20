# SVO Raycaster

Explore voxel models in your browser. The viewer starts with a sample torus and can open RSVO files.

## Get started

1. With Node.js 24 or newer installed, run `node serve.mjs` from this folder.
2. Open the URL it prints in a browser that supports WebGPU.
3. To try the included model, choose **Open RSVO** and select `data/render_me.rsvo`.

## Generate a dungeon

Click **Generate dungeon**. Leave **Seed** empty for a random layout or enter a number to repeat a layout. Rooms and hallways are built across three floors. Some rooms have an open centre with a gallery above.

Click the viewer and use **W A S D** to move one metre at a time. Floors are two metres apart. Use **Space** or **Shift** at a brown ladder to climb one metre at a time. The footer shows your floor and tells you when you can climb.

Press **F** or click **Fly** to move freely through walls and between floors. Switch back to **Walk** to return to your last grid position.

Click **Export RSVO** to save the dungeon's voxel geometry. Use the same seed to get the walkable layout back in the viewer.

## Controls

| Control | Action |
| --- | --- |
| Click the viewer | Look around with the mouse |
| **W A S D** | Fly forward, left, back, and right |
| **Space / Shift** | Fly up or down |
| **Esc** | Release the mouse |
| **R** | Shoot a debug ray and outline the cells it crosses |
| **C** | Clear all debug rays |

Each debug ray stays in place as you move. Fly sideways to see it from an angle.

## Detail and speed

- **Resolution** controls how sharp the image is. Choose **Native** for full detail or **Auto** or **640 × 360 (fixed)** for less GPU work.
- **Depth** controls how small the visible voxel cells can get. Lower it for a coarser view.
- **LOD pixels** lets distant cells use less detail when they appear small on screen. Set it to **0** to turn this off.

To see how long the GPU takes to draw a frame, add `?profile=1` to the viewer URL and move the camera. The footer shows the render time if your GPU supports timing.
