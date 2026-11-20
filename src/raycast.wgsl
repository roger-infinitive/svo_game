struct Camera {
  position: vec4f,
  forward: vec4f,
  right: vec4f,
  up: vec4f,
  viewport: vec4f,
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
  normal: vec3f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> masks: array<u32>;
@group(0) @binding(2) var<storage, read> childBase: array<u32>;
@group(0) @binding(3) var<storage, read> childBaseHigh: array<u32>;

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

fn raycast(origin: vec3f, direction: vec3f) -> Hit {
  let miss = Hit(-1.0, vec3f(0));

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
  var t = max(0.0, near[axis]);
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
      if (level + 1u == depth) {
        var normal = vec3f(0);
        normal[axis] = select(-1.0, 1.0, negative[axis]);
        return Hit(t, normal);
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

@fragment fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let ndc = pixel.xy / camera.viewport.xy * vec2f(2, -2) + vec2f(-1, 1);
  let direction = camera.forward.xyz
    + camera.right.xyz * ndc.x * camera.viewport.z
    + camera.up.xyz * ndc.y;
  let hit = raycast(camera.position.xyz, direction);
  if (hit.t < 0.0) {
    return vec4f(0.07, 0.08, 0.1, 1);
  }
  return vec4f(0.5 * (hit.normal + 1.0), 1);
}
