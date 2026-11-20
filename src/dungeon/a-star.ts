export interface PathNeighbor<Node> {
  node: Node;
  cost: number;
}

export interface PathSearch<Node, Key> {
  start: Node;
  goal: Node;
  key: (node: Node) => Key;
  neighbors: (node: Node) => Iterable<PathNeighbor<Node>>;
  heuristic: (node: Node, goal: Node) => number;
}

interface QueueEntry<Node> {
  node: Node;
  cost: number;
  estimate: number;
}

class MinQueue<Node> {
  private entries: QueueEntry<Node>[] = [];

  push(entry: QueueEntry<Node>) {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent].estimate <= entry.estimate) {
        break;
      }
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): QueueEntry<Node> | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || this.entries.length === 0) {
      return first;
    }

    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      const right = child + 1;
      if (right < this.entries.length && this.entries[right].estimate < this.entries[child].estimate) {
        child = right;
      }
      if (last.estimate <= this.entries[child].estimate) {
        break;
      }
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

export function aStar<Node, Key>(search: PathSearch<Node, Key>): Node[] | undefined {
  const { start, goal, key, neighbors, heuristic } = search;
  const startKey = key(start);
  const goalKey = key(goal);
  const open = new MinQueue<Node>();
  const costs = new Map<Key, number>([[startKey, 0]]);
  const previous = new Map<Key, Node>();
  open.push({ node: start, cost: 0, estimate: heuristic(start, goal) });

  for (let current = open.pop(); current; current = open.pop()) {
    const currentKey = key(current.node);
    if (current.cost !== costs.get(currentKey)) {
      continue;
    }
    if (currentKey === goalKey) {
      const path = [current.node];
      while (key(path[path.length - 1]) !== startKey) {
        path.push(previous.get(key(path[path.length - 1]))!);
      }
      return path.reverse();
    }

    for (const { node, cost } of neighbors(current.node)) {
      const nodeKey = key(node);
      const candidate = current.cost + cost;
      if (candidate >= (costs.get(nodeKey) ?? Infinity)) {
        continue;
      }
      costs.set(nodeKey, candidate);
      previous.set(nodeKey, current.node);
      open.push({ node, cost: candidate, estimate: candidate + heuristic(node, goal) });
    }
  }
  return undefined;
}
