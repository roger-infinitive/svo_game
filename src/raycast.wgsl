struct Camera {
  positionAndLod: vec4f,
  forward: vec4f,
  right: vec4f,
  up: vec4f,
  viewport: vec4f,
  scene: vec4f,
}

struct Frame {
  // Parametric distances to the center and far faces of this parent.
  middle: vec3f,
  node: u32,
  far: vec3f,
  octant: u32,
}

struct Hit {
  t: f32,
  exit: f32,
  normal: vec3f,
  cell: vec4f,
}

struct TraceRecords {
  start: vec4f,
  end: vec4f,
  cells: array<vec4f>,
}

struct GizmoVertex {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> masks: array<u32>;
@group(0) @binding(2) var<storage, read> childBase: array<u32>;
@group(0) @binding(3) var<storage, read> childBaseHigh: array<u32>;
@group(0) @binding(4) var<storage, read_write> traceOutput: TraceRecords;
@group(0) @binding(5) var<storage, read> trace: TraceRecords;

fn firstChild(node: u32) -> u32 {
  let split = arrayLength(&childBase);
  if (node < split) {
    return childBase[node];
  }
  return childBaseHigh[node - split];
}

fn maxAxis(v: vec3f) -> u32 {
  if (v.x >= v.y && v.x >= v.z) {
    return 0u;
  }
  return select(2u, 1u, v.y >= v.z);
}

fn octantAt(middle: vec3f, position: vec3f) -> u32 {
  let high = position >= middle;
  return u32(high.x) | (u32(high.y) << 1u) | (u32(high.z) << 2u);
}

fn raycast(origin: vec3f, direction: vec3f, start: f32) -> Hit {
  let miss = Hit(-1.0, -1.0, vec3f(0), vec4f(0));

  // Reflect negative axes so every ray walks from low to high octants.
  let negative = direction < vec3f(0);
  let reflection = u32(negative.x)
    | (u32(negative.y) << 1u)
    | (u32(negative.z) << 2u);
  let p = select(origin, vec3f(8) - origin, negative);
  let parallel = direction == vec3f(0);
  if (any(parallel & ((p < vec3f(0)) | (p >= vec3f(8))))) {
    return miss;
  }

  // Parallel axes store spatial distances instead of ray times. Use zero
  // on those axes when selecting a child and exclude them from exit tests.
  let inv = 1.0 / select(max(abs(direction), vec3f(1e-30)), vec3f(1), parallel);
  let near = select(-p * inv, vec3f(-1e30), parallel);
  let far = (vec3f(8) - p) * inv;
  let rootMiddle = (vec3f(4) - p) * inv;
  var axis = maxAxis(near);
  var t = max(start, near[axis]);
  let rootExit = select(far, vec3f(1e30), parallel);
  if (t >= min(rootExit.x, min(rootExit.y, rootExit.z))) {
    return miss;
  }

  let rootPosition = select(vec3f(t), vec3f(0), parallel);
  var frames: array<Frame, 32>;
  frames[0] = Frame(rootMiddle, 0u, far, octantAt(rootMiddle, rootPosition));

  var level = 0u;
  var size = 4.0;
  let depth = u32(camera.viewport.w);
  let lodPixels = camera.positionAndLod.w;
  // The camera ray advances one unit along camera-forward for each unit of t.
  // At a 90-degree vertical FOV, projected cell size is size * halfHeight / t.
  let halfHeight = 0.5 * camera.viewport.y;

  loop {
    let frame = frames[level];
    let octant = frame.octant;
    let high = (vec3u(octant) & vec3u(1u, 2u, 4u)) != vec3u(0u);
    let childFar = select(frame.middle, frame.far, high);
    let exits = select(childFar, vec3f(1e30), parallel);
    let exitAxis = maxAxis(-exits);
    let exit = exits[exitAxis];

    let child = octant ^ reflection;
    let mask = (masks[frame.node >> 2u] >> ((frame.node & 3u) * 8u)) & 255u;
    let bit = 1u << child;

    // Descend into an occupied child that the ray actually crosses.
    if (exit > t && (mask & bit) != 0u) {
      let belowPixelThreshold = size * halfHeight <= t * lodPixels;
      if (level + 1u == depth || belowPixelThreshold) {
        var normal = vec3f(0);
        normal[axis] = select(-1.0, 1.0, negative[axis]);
        let reflectedFar = round((p + childFar / inv) / size) * size;
        let corner = select(reflectedFar - size, vec3f(8) - reflectedFar, negative);
        return Hit(t, exit, normal, vec4f(corner, size));
      }

      let middle = childFar - size * 0.5 * inv;
      let next = firstChild(frame.node) + countOneBits(mask & (bit - 1u));
      level++;
      size *= 0.5;
      let position = select(vec3f(t), vec3f(0), parallel);
      frames[level] = Frame(middle, next, childFar, octantAt(middle, position));
      continue;
    }

    // Advance past this child and pop any ancestors the ray has left.
    t = max(t, exit);
    axis = exitAxis;
    loop {
      let parent = frames[level];
      let parentExit = select(parent.far, vec3f(1e30), parallel);
      if (t < min(parentExit.x, min(parentExit.y, parentExit.z))) {
        let position = select(vec3f(t), vec3f(0), parallel);
        frames[level].octant = octantAt(parent.middle, position);
        break;
      }

      if (level == 0u) {
        return miss;
      }
      level--;
      size *= 2.0;
    }
  }
  return miss;
}

@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i], 0, 1);
}

fn dungeonColor(hit: Hit, origin: vec3f, direction: vec3f) -> vec3f {
  let meterScale = camera.scene.x;
  let surface = origin + direction * hit.t - hit.normal * (meterScale / 512.0);
  let voxel = surface * (16.0 / meterScale);
  var face = voxel.xy;
  if (abs(hit.normal.x) > 0.5) {
    face = voxel.zy;
  } else if (abs(hit.normal.y) > 0.5) {
    face = voxel.xz;
  }

  let row = floor(face.y / 4.0);
  let offset = 8.0 * fract(row * 0.5);
  let column = floor((face.x + offset) / 8.0);
  let mortar = fract(face.y / 4.0) < 0.25 || fract((face.x + offset) / 8.0) < 0.125;
  let variation = fract(column * 0.618 + row * 0.413);
  let brick = mix(vec3f(0.50, 0.23, 0.14), vec3f(0.77, 0.43, 0.28), variation);
  let material = select(brick, vec3f(0.29, 0.25, 0.22), mortar);
  let distance = length(direction) * hit.t / meterScale;
  let falloff = 1.0 / (1.0 + 0.021 * distance * distance);
  let facing = max(0.0, dot(hit.normal, -normalize(direction)));
  return material * (0.28 + falloff * (0.23 + 0.55 * facing));
}

@fragment fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let ndc = pixel.xy / camera.viewport.xy * vec2f(2, -2) + vec2f(-1, 1);
  let direction = camera.forward.xyz
    + camera.right.xyz * ndc.x * camera.viewport.z
    + camera.up.xyz * ndc.y;
  let hit = raycast(camera.positionAndLod.xyz, direction, 0.0);
  if (hit.t < 0.0) {
    return vec4f(0.07, 0.08, 0.1, 1);
  }
  if (camera.scene.x > 0.0) {
    return vec4f(dungeonColor(hit, camera.positionAndLod.xyz, direction), 1);
  }
  return vec4f(0.5 * (hit.normal + 1.0), 1);
}

@compute @workgroup_size(1)
fn shootRay() {
  let origin = camera.positionAndLod.xyz;
  let direction = camera.forward.xyz;
  let rayLength = 12.0 * select(1.0, camera.scene.x, camera.scene.x > 0.0);
  traceOutput.start = vec4f(origin, 1.0);
  traceOutput.end = vec4f(origin + direction * rayLength, 1.0);

  // Reuse the first-hit traversal, resuming at each occupied cell's exit.
  let capacity = arrayLength(&traceOutput.cells);
  var start = 0.0;
  var count = 0u;
  while (count < capacity && start < rayLength) {
    let hit = raycast(origin, direction, start);
    if (hit.t < 0.0 || hit.t >= rayLength) {
      break;
    }
    traceOutput.cells[count] = hit.cell;
    count++;
    start = hit.exit;
  }
  for (var i = count; i < capacity; i++) {
    traceOutput.cells[i] = vec4f(0);
  }
}

fn boxVertex(cell: vec4f, vertexIndex: u32) -> vec3f {
  let corners = array(
    0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u,
    0u, 2u, 1u, 3u, 4u, 6u, 5u, 7u,
    0u, 4u, 1u, 5u, 2u, 6u, 3u, 7u,
  );
  let bits = vec3u(corners[vertexIndex]) & vec3u(1u, 2u, 4u);
  let corner = select(vec3f(0), vec3f(1), bits != vec3u(0));
  return cell.xyz + corner * cell.w;
}

@vertex
fn gizmoVertex(@builtin(vertex_index) i: u32) -> GizmoVertex {
  var point: vec3f;
  var color: vec3f;
  if (i < 2u) {
    point = select(trace.start.xyz, trace.end.xyz, i == 1u);
    color = vec3f(1.0, 0.77, 0.23);
  } else if (i < 26u) {
    point = boxVertex(vec4f(0, 0, 0, 8), i - 2u);
    color = vec3f(0.56, 0.65, 0.76);
  } else {
    // Draw the first hit last so neighboring boxes cannot cover its edges.
    let index = ((i - 26u) / 24u + 1u) % arrayLength(&trace.cells);
    let cell = trace.cells[index];
    if (cell.w == 0.0) {
      return GizmoVertex(vec4f(2, 2, 0, 1), vec3f(0));
    }
    point = boxVertex(cell, (i - 26u) % 24u);
    color = select(vec3f(0.2, 0.83, 1.0), vec3f(0.43, 1.0, 0.29), index == 0u);
  }

  let relative = point - camera.positionAndLod.xyz;
  let z = dot(relative, camera.forward.xyz);
  let x = dot(relative, camera.right.xyz) / camera.viewport.z;
  let y = dot(relative, camera.up.xyz);
  return GizmoVertex(vec4f(x, y, z - 0.01, z), color);
}

@fragment
fn gizmoFragment(input: GizmoVertex) -> @location(0) vec4f {
  return vec4f(input.color, 1);
}
