import { PLAYER_RADIUS } from '../../shared/constants';
import type { GameMap } from '../../shared/map';
import { circleBlocked } from '../../shared/physics';

export interface Waypoint { x: number; z: number }

/** Static, per-match clearance grid. Search buffers are shared because bot thinking is sequential. */
export class NavGrid {
  readonly cell = 1.25;
  readonly cols: number;
  private readonly blocked: Uint8Array;
  private readonly seen: Uint32Array;
  private readonly edgeTested: Uint16Array;
  private readonly edgeOpen: Uint16Array;
  private readonly closed: Uint32Array;
  private readonly cost: Float32Array;
  private readonly estimate: Float32Array;
  private readonly parent: Int32Array;
  private readonly heap: Int32Array;
  private readonly heapAt: Int32Array;
  private heapSize = 0;
  private searchId = 0;

  constructor(private readonly map: GameMap) {
    this.cols = Math.floor(map.half * 2 / this.cell);
    const count = this.cols * this.cols;
    this.blocked = new Uint8Array(count);
    this.seen = new Uint32Array(count);
    this.edgeTested = new Uint16Array(count);
    this.edgeOpen = new Uint16Array(count);
    this.closed = new Uint32Array(count);
    this.cost = new Float32Array(count);
    this.estimate = new Float32Array(count);
    this.parent = new Int32Array(count);
    this.heap = new Int32Array(count);
    this.heapAt = new Int32Array(count);
    for (let row = 0; row < this.cols; row++) {
      for (let col = 0; col < this.cols; col++) {
        const id = row * this.cols + col;
        this.blocked[id] = Number(circleBlocked(map, this.x(col), this.z(row), 0.8));
      }
    }
  }

  /** Swept player clearance, not just a raycast: rays alone can clip the corners of cover. */
  clear(x: number, z: number, tx: number, tz: number): boolean {
    const distance = Math.hypot(tx - x, tz - z);
    const steps = Math.ceil(distance / 0.7);
    for (let i = 0; i <= steps; i++) {
      const f = steps ? i / steps : 0;
      if (circleBlocked(this.map, x + (tx - x) * f, z + (tz - z) * f, PLAYER_RADIUS)) return false;
    }
    return true;
  }

  /** Returns smoothed world-space waypoints, or [] when no traversable route was found. */
  path(x: number, z: number, gx: number, gz: number, maxExpansions = 4200): Waypoint[] {
    if (this.clear(x, z, gx, gz)) return [{ x: gx, z: gz }];
    const start = this.closest(x, z);
    const goal = this.closest(gx, gz);
    if (start < 0 || goal < 0) return [];
    const search = ++this.searchId;
    // Searches that stopped on the expansion bound still have open heap entries.
    for (let i = 0; i < this.heapSize; i++) this.heapAt[this.heap[i]!] = 0;
    this.heapSize = 0;
    this.seen[start] = search;
    this.parent[start] = -1;
    this.cost[start] = 0;
    this.estimate[start] = this.heuristic(start, goal);
    this.push(start);
    let best = start;
    let bestH = this.estimate[start]!;
    let reached = false;
    for (let expanded = 0; this.heapSize && expanded < maxExpansions; expanded++) {
      const current = this.pop();
      if (current === goal) {
        best = current;
        reached = true;
        break;
      }
      this.closed[current] = search;
      const cx = current % this.cols;
      const cz = (current / this.cols) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || cx + dx < 0 || cx + dx >= this.cols || cz + dz < 0 || cz + dz >= this.cols) {
          continue;
        }
        const next = current + dz * this.cols + dx;
        if (this.blocked[next] || this.closed[next] === search) continue;
        // Both adjacent cardinal cells must be open: diagonal movement cannot cut corners.
        if (dx && dz && (this.blocked[current + dx] || this.blocked[current + dz * this.cols])) continue;
        const direction = (dz + 1) * 3 + dx + 1;
        const bit = 1 << direction;
        if (!(this.edgeTested[current]! & bit)) {
          const reverse = 1 << (8 - direction);
          this.edgeTested[current] |= bit;
          this.edgeTested[next] |= reverse;
          if (this.clear(this.x(cx), this.z(cz), this.x(cx + dx), this.z(cz + dz))) {
            this.edgeOpen[current] |= bit;
            this.edgeOpen[next] |= reverse;
          }
        }
        if (!(this.edgeOpen[current]! & bit)) continue;
        const nextCost = this.cost[current]! + (dx && dz ? Math.SQRT2 : 1);
        if (this.seen[next] === search && nextCost >= this.cost[next]!) continue;
        this.seen[next] = search;
        this.parent[next] = current;
        this.cost[next] = nextCost;
        const h = this.heuristic(next, goal);
        this.estimate[next] = nextCost + h;
        if (h < bestH) { bestH = h; best = next; }
        if (this.heapAt[next]) this.bubbleUp(this.heapAt[next]! - 1);
        else this.push(next);
      }
    }
    if (!reached && best === start) return [];
    const chain: number[] = [];
    for (let node = best; node !== -1; node = this.parent[node]!) chain.push(node);
    chain.reverse();
    const route: Waypoint[] = [];
    let fromX = x;
    let fromZ = z;
    let at = 0;
    while (at < chain.length) {
      let furthest = at;
      // Only consider cells up to the next bend. Swept clearance verifies the whole shortcut.
      for (let i = chain.length - 1; i >= at; i--) {
        const id = chain[i]!;
        if (this.clear(fromX, fromZ, this.x(id % this.cols), this.z((id / this.cols) | 0))) {
          furthest = i;
          break;
        }
      }
      const id = chain[furthest]!;
      const wx = this.x(id % this.cols);
      const wz = this.z((id / this.cols) | 0);
      if (furthest === at && !this.clear(fromX, fromZ, wx, wz)) return [];
      route.push({ x: wx, z: wz });
      fromX = wx;
      fromZ = wz;
      at = furthest + 1;
    }
    if (reached && this.clear(fromX, fromZ, gx, gz)) route.push({ x: gx, z: gz });
    return route;
  }

  private x(col: number): number { return -this.map.half + (col + 0.5) * this.cell; }
  private z(row: number): number { return -this.map.half + (row + 0.5) * this.cell; }

  private closest(x: number, z: number): number {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((x + this.map.half) / this.cell)));
    const row = Math.max(0, Math.min(this.cols - 1, Math.floor((z + this.map.half) / this.cell)));
    const center = row * this.cols + col;
    if (!this.blocked[center] && this.clear(x, z, this.x(col), this.z(row))) return center;
    for (let radius = 1; radius <= 12; radius++) {
      let nearest = -1;
      let distance = Infinity;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const c = col + dx;
        const r = row + dz;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.cols || this.blocked[r * this.cols + c] ||
          !this.clear(x, z, this.x(c), this.z(r))) continue;
        const d = (x - this.x(c)) ** 2 + (z - this.z(r)) ** 2;
        if (d < distance) { distance = d; nearest = r * this.cols + c; }
      }
      if (nearest >= 0) return nearest;
    }
    return -1;
  }

  private heuristic(id: number, goal: number): number {
    const dx = Math.abs(id % this.cols - goal % this.cols);
    const dz = Math.abs(((id / this.cols) | 0) - ((goal / this.cols) | 0));
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  private less(a: number, b: number): boolean {
    return this.estimate[a]! < this.estimate[b]! ||
      (this.estimate[a] === this.estimate[b] && this.cost[a]! > this.cost[b]!);
  }

  private push(id: number): void {
    const index = this.heapSize++;
    this.heap[index] = id;
    this.heapAt[id] = index + 1;
    this.bubbleUp(index);
  }

  private bubbleUp(index: number): void {
    const id = this.heap[index]!;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const other = this.heap[parent]!;
      if (!this.less(id, other)) break;
      this.heap[index] = other;
      this.heapAt[other] = index + 1;
      index = parent;
    }
    this.heap[index] = id;
    this.heapAt[id] = index + 1;
  }

  private pop(): number {
    const first = this.heap[0]!;
    const last = this.heap[--this.heapSize]!;
    this.heapAt[first] = 0;
    if (this.heapSize) {
      let index = 0;
      while (index * 2 + 1 < this.heapSize) {
        let child = index * 2 + 1;
        if (child + 1 < this.heapSize && this.less(this.heap[child + 1]!, this.heap[child]!)) child++;
        if (!this.less(this.heap[child]!, last)) break;
        const other = this.heap[child]!;
        this.heap[index] = other;
        this.heapAt[other] = index + 1;
        index = child;
      }
      this.heap[index] = last;
      this.heapAt[last] = index + 1;
    }
    return first;
  }
}
