import { floorHeight, roomCenter, seededRandom } from "./rooms.ts";
import type { DungeonRoom, DungeonSize, GridPoint } from "./rooms.ts";

export interface RoomEdge {
  a: number;
  b: number;
  distance: number;
}

type Tetrahedron = [number, number, number, number];

interface Sphere {
  center: GridPoint;
  radiusSquared: number;
}

function subtract(a: GridPoint, b: GridPoint): GridPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: GridPoint, b: GridPoint): GridPoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: GridPoint, b: GridPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function circumsphere(points: GridPoint[], vertices: Tetrahedron): Sphere | undefined {
  const [a, b, c, d] = vertices.map(index => points[index]);
  const u = subtract(b, a);
  const v = subtract(c, a);
  const w = subtract(d, a);
  const vw = cross(v, w);
  const wu = cross(w, u);
  const uv = cross(u, v);
  const determinant = 2 * dot(u, vw);
  if (Math.abs(determinant) < 1e-10) {
    return undefined;
  }

  const uu = dot(u, u);
  const vv = dot(v, v);
  const ww = dot(w, w);
  const offset = {
    x: (uu * vw.x + vv * wu.x + ww * uv.x) / determinant,
    y: (uu * vw.y + vv * wu.y + ww * uv.y) / determinant,
    z: (uu * vw.z + vv * wu.z + ww * uv.z) / determinant,
  };
  return {
    center: { x: a.x + offset.x, y: a.y + offset.y, z: a.z + offset.z },
    radiusSquared: dot(offset, offset),
  };
}

export function delaunayEdges(rooms: DungeonRoom[], size: DungeonSize): RoomEdge[] {
  const centers = rooms.map(room => {
    const { x, y, z } = roomCenter(room);
    return { x, y: y * floorHeight, z };
  });
  if (rooms.length < 4) {
    return centers.flatMap((_, a) => centers.slice(a + 1).map((_, b) =>
      makeEdge(centers, a, a + b + 1),
    ));
  }

  // Small deterministic offsets break ties between coplanar or cospherical centers.
  const jitter = seededRandom(0xa18d);
  const planar = centers.every(point => point.y === centers[0].y);
  const points = centers.map(point => ({
    x: point.x + (jitter() - 0.5) * 0.001,
    y: planar ? point.y : point.y + (jitter() - 0.5) * 0.001,
    z: point.z + (jitter() - 0.5) * 0.001,
  }));

  const span = Math.max(size.width, size.length, size.floors * floorHeight);
  if (planar) {
    // In the pyramid over a single floor, each tetrahedron has the apex
    // and a base triangle. Its sphere cuts the floor at that circumcircle.
    points.push({ x: size.width / 2, y: centers[0].y + span, z: size.length / 2 });
  }
  const extent = 128 * span;
  const firstSuperVertex = points.length;
  points.push(
    { x: extent, y: extent, z: extent },
    { x: extent, y: -extent, z: -extent },
    { x: -extent, y: extent, z: -extent },
    { x: -extent, y: -extent, z: extent },
  );

  const superTetrahedron: Tetrahedron = [
    firstSuperVertex, firstSuperVertex + 1, firstSuperVertex + 2, firstSuperVertex + 3,
  ];
  let tetrahedra = [{ vertices: superTetrahedron, sphere: circumsphere(points, superTetrahedron)! }];

  // Bowyer–Watson removes the tetrahedra whose spheres contain each new point,
  // then connects the exposed triangular faces of that cavity to the point.
  for (let index = 0; index < firstSuperVertex; index++) {
    const boundary = new Map<string, number[]>();
    tetrahedra = tetrahedra.filter(({ vertices, sphere }) => {
      const offset = subtract(points[index], sphere.center);
      if (dot(offset, offset) > sphere.radiusSquared) {
        return true;
      }
      for (let omitted = 0; omitted < 4; omitted++) {
        const face = vertices.filter((_, vertex) => vertex !== omitted);
        const key = face.join(",");
        if (boundary.has(key)) {
          boundary.delete(key);
        } else {
          boundary.set(key, face);
        }
      }
      return false;
    });

    for (const [a, b, c] of boundary.values()) {
      const vertices: Tetrahedron = [a, b, c, index];
      const sphere = circumsphere(points, vertices);
      if (sphere) {
        tetrahedra.push({ vertices, sphere });
      }
    }
  }

  const edges = new Map<number, RoomEdge>();
  for (const { vertices } of tetrahedra) {
    if (vertices.some(index => index >= firstSuperVertex)) {
      continue;
    }
    for (let first = 0; first < 4; first++) {
      for (let second = first + 1; second < 4; second++) {
        const a = vertices[first];
        const b = vertices[second];
        if (b >= rooms.length) {
          continue;
        }
        edges.set(a * rooms.length + b, makeEdge(centers, a, b));
      }
    }
  }
  return [...edges.values()];
}

function makeEdge(centers: GridPoint[], a: number, b: number): RoomEdge {
  const delta = subtract(centers[a], centers[b]);
  return { a, b, distance: Math.sqrt(dot(delta, delta)) };
}

export function minimumSpanningTree(roomCount: number, edges: RoomEdge[]): RoomEdge[] {
  if (roomCount < 2) {
    return [];
  }

  // Prim grows the tree by taking the lightest edge across its current boundary.
  const visited = new Set([0]);
  const tree: RoomEdge[] = [];
  const sorted = [...edges].sort((a, b) => a.distance - b.distance);
  while (visited.size < roomCount) {
    const edge = sorted.find(({ a, b }) => visited.has(a) !== visited.has(b));
    if (!edge) {
      throw new Error("The Delaunay room graph is disconnected.");
    }
    tree.push(edge);
    visited.add(edge.a);
    visited.add(edge.b);
  }
  return tree;
}

export function chooseHallways(
  edges: RoomEdge[],
  tree: RoomEdge[],
  random: () => number,
  loopPercent: number,
): RoomEdge[] {
  const included = new Set(tree);
  const candidates = edges.filter(edge => !included.has(edge));
  const cycles = candidates.filter(() => random() * 100 < loopPercent);
  if (loopPercent > 0 && cycles.length === 0 && candidates.length > 0) {
    cycles.push(candidates[Math.floor(random() * candidates.length)]);
  }
  return [...tree, ...cycles];
}

