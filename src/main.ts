import { parseRsvo, sampleRsvo } from "./rsvo.ts";
import type { Octree } from "./rsvo.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const file = document.querySelector<HTMLInputElement>("#file")!;
const depth = document.querySelector<HTMLInputElement>("#depth")!;
const level = document.querySelector<HTMLOutputElement>("#level")!;
const lod = document.querySelector<HTMLInputElement>("#lod")!;
const lodValue = document.querySelector<HTMLOutputElement>("#lod-value")!;
const resolution = document.querySelector<HTMLSelectElement>("#resolution")!;
const reset = document.querySelector<HTMLButtonElement>("#reset")!;
const fps = document.querySelector<HTMLOutputElement>("#fps")!;
const gpuInfo = document.querySelector<HTMLOutputElement>("#gpu-info")!;
const gpuTime = document.querySelector<HTMLOutputElement>("#gpu-time")!;
const movementKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);

const autoPixelBudget = 1280 * 720;
const fixedRenderWidth = 640;
const fixedRenderHeight = 360;
const position = [4, 5.5, -5];
const keys = new Set<string>();
let yaw = 0;
let pitch = -0.17;
let dirty = true;

function resetCamera() {
  position[0] = 4;
  position[1] = 5.5;
  position[2] = -5;
  yaw = 0;
  pitch = -0.17;
  dirty = true;
}

async function start() {
  const gpu = navigator.gpu;
  const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!gpu || !adapter) {
    throw new Error("WebGPU is unavailable in this browser.");
  }
  const { maxBufferSize, maxStorageBufferBindingSize } = adapter.limits;
  const profiling = new URLSearchParams(location.search).get("profile") === "1";
  const timestampSupported = profiling && adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredLimits: { maxBufferSize, maxStorageBufferBindingSize },
    requiredFeatures: timestampSupported ? ["timestamp-query"] : [],
  });
  if (profiling) {
    gpuInfo.hidden = false;
    gpuTime.hidden = false;
    gpuTime.value = timestampSupported ? "GPU timing pending" : "GPU timestamps unavailable";
  }

  const gpuTimer = timestampSupported ? createGpuTimer(device) : undefined;
  const adapterInfo = profiling ? adapter.info : undefined;
  const adapterName = adapterInfo?.description || adapterInfo?.vendor || "Unknown GPU";
  const adapterLabel = adapterInfo?.isFallbackAdapter ? adapterName + " (fallback)" : adapterName;
  void device.lost.then(({ message }) => {
    status.value = "GPU device lost. Reload the page. " + message;
    file.disabled = true;
  });

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Could not create a WebGPU canvas.");
  }
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const response = await fetch("./src/raycast.wgsl");
  if (!response.ok) {
    throw new Error("Could not load the raycasting shader.");
  }
  const module = device.createShaderModule({ code: await response.text() });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === "error");
  if (errors.length) {
    throw new Error(errors.map(error => error.message).join("\n"));
  }

  const pipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module, entryPoint: "vertex" },
    fragment: { module, entryPoint: "fragment", targets: [{ format }] },
  });
  const uniforms = new Float32Array(20);
  const cameraBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  let buffers: GPUBuffer[] = [];
  let group: GPUBindGroup;

  function upload(tree: Octree) {
    const split = Math.ceil(tree.masks.length / 2);
    const sources = [
      tree.masks,
      tree.firstChild.subarray(0, split),
      tree.firstChild.subarray(split),
    ];

    const storageLimit = Math.min(maxBufferSize, maxStorageBufferBindingSize);
    for (const source of sources) {
      const alignedSize = Math.max(4, Math.ceil(source.byteLength / 4) * 4);
      if (alignedSize > storageLimit) {
        throw new Error("This model exceeds the GPU storage buffer limit.");
      }
    }

    const next: GPUBuffer[] = [];
    try {
      for (const source of sources) {
        const buffer = device.createBuffer({
          size: Math.max(4, Math.ceil(source.byteLength / 4) * 4),
          usage: GPUBufferUsage.STORAGE,
          mappedAtCreation: true,
        });
        next.push(buffer);
        new Uint8Array(buffer.getMappedRange()).set(
          new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
        );
        buffer.unmap();
      }
      group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [cameraBuffer, ...next].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
    } catch (error) {
      next.forEach(buffer => buffer.destroy());
      throw error;
    }
    buffers.forEach(buffer => buffer.destroy());
    buffers = next;

    depth.max = String(tree.depth);
    depth.value = String(Math.min(8, tree.depth));
    level.value = depth.value;
    dirty = true;
  }

  const sample = parseRsvo(sampleRsvo());
  upload(sample);
  status.value = "Sample torus";
  file.disabled = false;

  file.addEventListener("change", async () => {
    const model = file.files?.[0];
    if (!model) {
      return;
    }
    file.disabled = true;
    status.value = "Loading " + model.name + "…";
    try {
      upload(parseRsvo(await model.arrayBuffer()));
      resetCamera();
      status.value = model.name;
    } catch (error) {
      status.value = String(error);
    } finally {
      file.value = "";
      file.disabled = false;
    }
  });

  depth.addEventListener("input", () => {
    level.value = depth.value;
    dirty = true;
  });
  lod.addEventListener("input", () => {
    lodValue.value = lod.value;
    dirty = true;
  });
  resolution.addEventListener("change", () => {
    dirty = true;
  });
  reset.addEventListener("click", resetCamera);
  new ResizeObserver(() => {
    dirty = true;
  }).observe(canvas);

  canvas.addEventListener("click", () => {
    void canvas.requestPointerLock()?.catch(error => {
      status.value = String(error);
    });
  });
  window.addEventListener("keydown", event => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    if (movementKeys.has(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", event => {
    keys.delete(event.code);
  });
  document.addEventListener("pointerlockchange", () => {
    keys.clear();
    canvas.classList.toggle("locked", document.pointerLockElement === canvas);
  });
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("mousemove", event => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    yaw += event.movementX * 0.0025;
    pitch = Math.max(-1.56, Math.min(1.56, pitch - event.movementY * 0.0025));
    dirty = true;
  });

  function updateCamera(deltaSeconds: number) {
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);

    const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const side = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    const vertical = Number(keys.has("Space")) -
      Number(keys.has("ShiftLeft") || keys.has("ShiftRight"));
    const step = 4 * deltaSeconds / (Math.hypot(forward, side, vertical) || 1);
    position[0] += (forward * sinYaw * cosPitch + side * cosYaw) * step;
    position[1] += (forward * sinPitch + vertical) * step;
    position[2] += (forward * cosYaw * cosPitch - side * sinYaw) * step;

    // The first vec4 stores the camera position and the LOD threshold.
    uniforms.set(position, 0);
    uniforms[4] = sinYaw * cosPitch;
    uniforms[5] = sinPitch;
    uniforms[6] = cosYaw * cosPitch;
    uniforms[8] = cosYaw;
    uniforms[10] = -sinYaw;
    uniforms[12] = -sinYaw * sinPitch;
    uniforms[13] = cosPitch;
    uniforms[14] = -cosYaw * sinPitch;
  }

  function render() {
    const displayWidth = Math.max(1, canvas.clientWidth);
    const displayHeight = Math.max(1, canvas.clientHeight);
    const cssPixels = displayWidth * displayHeight;
    const fixedResolution = resolution.value === "fixed";
    let scale = 1;
    if (resolution.value === "auto") {
      scale = Math.min(1, Math.sqrt(autoPixelBudget / cssPixels));
    } else if (!fixedResolution) {
      scale = Number(resolution.value) * devicePixelRatio;
    }
    const limit = device.limits.maxTextureDimension2D;
    const width = fixedResolution
      ? fixedRenderWidth
      : Math.max(1, Math.min(limit, Math.round(displayWidth * scale)));
    const height = fixedResolution
      ? fixedRenderHeight
      : Math.max(1, Math.min(limit, Math.round(displayHeight * scale)));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    if (profiling) {
      const profileInfo = adapterLabel + " · " + width + " × " + height;
      if (gpuInfo.value !== profileInfo) {
        gpuInfo.value = profileInfo;
      }
    }

    // The final vec4 stores viewport size, aspect ratio, and traversal depth.
    uniforms[16] = width;
    uniforms[17] = height;
    uniforms[18] = displayWidth / displayHeight;
    uniforms[19] = Number(depth.value);
    uniforms[3] = Number(lod.value);
    device.queue.writeBuffer(cameraBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder();
    const timestampWrites = gpuTimer?.beginSample();
    const pass = encoder.beginRenderPass({
      timestampWrites,
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 1],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    if (timestampWrites) {
      gpuTimer?.resolveSample(encoder);
    }
    device.queue.submit([encoder.finish()]);
    if (timestampWrites) {
      gpuTimer?.readSample();
    }
  }

  let previous = performance.now();
  let reportTime = previous;
  let frameCount = 0;
  let frameInFlight = false;

  function frame(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000);
    previous = now;

    dirty ||= keys.size > 0;

    if (dirty) {
      updateCamera(dt);
    }

    if (dirty && !frameInFlight) {
      render();
      dirty = false;
      frameInFlight = true;

      // Keep the next frame available for the newest camera position.
      void device.queue.onSubmittedWorkDone().then(
        () => {
          frameCount++;
          frameInFlight = false;
        },
        error => {
          status.value = String(error);
        },
      );
    }

    if (now - reportTime >= 1000) {
      const elapsedSeconds = (now - reportTime) / 1000;
      fps.value = frameCount > 1
        ? Math.round(frameCount / elapsedSeconds) + " frames/s"
        : "Idle";
      frameCount = 0;
      reportTime = now;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function createGpuTimer(device: GPUDevice) {
  const querySet = device.createQuerySet({ type: "timestamp", count: 2 });
  const size = 2 * BigUint64Array.BYTES_PER_ELEMENT;
  const resolved = device.createBuffer({
    size,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let pending = false;
  let nextSample = 0;

  return {
    beginSample(): GPURenderPassTimestampWrites | undefined {
      const now = performance.now();
      if (pending || now < nextSample) {
        return undefined;
      }
      pending = true;
      nextSample = now + 250;
      return { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    },

    resolveSample(encoder: GPUCommandEncoder) {
      encoder.resolveQuerySet(querySet, 0, 2, resolved, 0);
      encoder.copyBufferToBuffer(resolved, 0, readback, 0, size);
    },

    readSample() {
      void readback.mapAsync(GPUMapMode.READ).then(() => {
        const [start, end] = new BigUint64Array(readback.getMappedRange());
        readback.unmap();
        gpuTime.value = end >= start
          ? (Number(end - start) / 1e6).toFixed(2) + " ms GPU pass"
          : "GPU timestamp sample invalid";
        pending = false;
      }, () => {
        gpuTime.value = "GPU timestamp readback failed";
      });
    },
  };
}

void start().catch(error => {
  status.value = String(error);
  file.disabled = true;
});
