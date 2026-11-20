export interface Octree {
  depth: number;
  masks: Uint8Array;
  firstChild: Uint32Array;
  counts: number[];
}

const popcount = Uint8Array.from({ length: 256 }, (_, mask) => {
  let count = 0;
  for (; mask; mask &= mask - 1) {
    count++;
  }
  return count;
});

export function parseRsvo(buffer: ArrayBuffer): Octree {
  const view = new DataView(buffer);
  if (
    view.byteLength < 28 ||
    view.getUint32(0) !== 0x5253564f ||
    view.getUint32(4, true) !== 1
  ) {
    throw new Error("Expected an RSVO version 1 file.");
  }

  const depth = view.getUint32(16, true);
  const headerSize = 20 + 4 * (depth + 1);
  if (depth < 1 || depth > 32 || headerSize > view.byteLength) {
    throw new Error("Invalid RSVO depth or truncated header.");
  }

  const counts = Array.from(
    { length: depth + 1 },
    (_, level) => view.getUint32(20 + level * 4, true),
  );
  const size = counts.slice(0, depth).reduce((total, count) => total + count, 0);
  if (
    counts[0] !== 1 ||
    size !== view.byteLength - headerSize ||
    size + counts[depth] > 0x100000000
  ) {
    throw new Error("Invalid RSVO node counts or file length.");
  }

  const masks = new Uint8Array(buffer, headerSize, size);
  const firstChild = new Uint32Array(size);
  let node = 0;
  let child = 1;

  // RSVO stores masks in breadth-first order. Child offsets follow that order.
  for (let level = 0; level < depth; level++) {
    const end = node + counts[level];
    const childStart = child;
    for (; node < end; node++) {
      firstChild[node] = child;
      child += popcount[masks[node]];
    }
    if (child - childStart !== counts[level + 1]) {
      throw new Error("RSVO masks do not match the level counts.");
    }
  }

  return { depth, masks, firstChild, counts };
}

export function sampleRsvo(): ArrayBuffer {
  const depth = 6;
  const counts = [1];
  const masks: number[] = [];
  let origins = [[0, 0, 0]];

  for (let level = 1; level <= depth; level++) {
    const next: number[][] = [];
    const size = 2 ** (depth - level);
    const halfSize = size / 2;
    const halfDiagonal = size === 1 ? 0 : Math.sqrt(3) * halfSize;

    for (const [x, y, z] of origins) {
      let mask = 0;

      for (let child = 0; child < 8; child++) {
        const childX = x + (child & 1) * size;
        const childY = y + ((child >> 1) & 1) * size;
        const childZ = z + (child >> 2) * size;

        const dx = childX + halfSize - 32;
        const dy = childY + halfSize - 32;
        const dz = childZ + halfSize - 32;
        const distance = Math.hypot(Math.hypot(dx, dz) - 19, dy);

        if (distance <= 7 + halfDiagonal) {
          mask |= 1 << child;
          next.push([childX, childY, childZ]);
        }
      }

      masks.push(mask);
    }

    counts.push(next.length);
    origins = next;
  }

  const headerSize = 20 + 4 * counts.length;
  const buffer = new ArrayBuffer(headerSize + masks.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x5253564f);
  view.setUint32(4, 1, true);
  view.setUint32(16, depth, true);
  counts.forEach((count, level) => view.setUint32(20 + 4 * level, count, true));
  new Uint8Array(buffer, headerSize).set(masks);
  return buffer;
}
