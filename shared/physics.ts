// Collision, raycasts and the movement step. Shared by server simulation and client prediction —
// both MUST call stepMove with identical inputs to stay in sync.

import { DASH_COOLDOWN, DASH_SPEED, DASH_TIME, PLAYER_RADIUS, PLAYER_SPEED } from './constants';
import type { GameMap, Obstacle } from './map';

const CELL = 8;

interface MapIndex {
  min: number;
  cols: number;
  cells: Obstacle[][];
  stamp: Uint32Array; // per-obstacle query stamp for dedupe
  query: number;
}

const indexes = new WeakMap<GameMap, MapIndex>();

function getIndex(map: GameMap): MapIndex {
  let idx = indexes.get(map);
  if (idx) return idx;
  const min = -map.half - CELL;
  const cols = Math.ceil((map.half * 2 + CELL * 2) / CELL);
  const cells: Obstacle[][] = Array.from({ length: cols * cols }, () => []);
  for (const o of map.obstacles) {
    const ex = o.type === 'box' ? o.hw : o.r;
    const ez = o.type === 'box' ? o.hd : o.r;
    const c0 = Math.max(0, Math.floor((o.x - ex - min) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((o.x + ex - min) / CELL));
    const r0 = Math.max(0, Math.floor((o.z - ez - min) / CELL));
    const r1 = Math.min(cols - 1, Math.floor((o.z + ez - min) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c]!.push(o);
  }
  idx = { min, cols, cells, stamp: new Uint32Array(map.obstacles.length), query: 0 };
  indexes.set(map, idx);
  return idx;
}

/** Calls `fn` once for every obstacle whose grid cells overlap the AABB. */
export function forObstaclesInAabb(
  map: GameMap,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  fn: (o: Obstacle) => void,
): void {
  const idx = getIndex(map);
  const q = ++idx.query;
  const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - idx.min) / CELL));
  const c1 = Math.min(idx.cols - 1, Math.floor((Math.max(x0, x1) - idx.min) / CELL));
  const r0 = Math.max(0, Math.floor((Math.min(z0, z1) - idx.min) / CELL));
  const r1 = Math.min(idx.cols - 1, Math.floor((Math.max(z0, z1) - idx.min) / CELL));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const o of idx.cells[r * idx.cols + c]!) {
        if (idx.stamp[o.id] === q) continue;
        idx.stamp[o.id] = q;
        fn(o);
      }
    }
  }
}

/** Push a circle out of all overlapping obstacles and clamp to map bounds. Mutates and returns `p`. */
export function resolveCircle(map: GameMap, p: { x: number; z: number }, r: number): { x: number; z: number } {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    forObstaclesInAabb(map, p.x - r, p.z - r, p.x + r, p.z + r, (o) => {
      if (o.type === 'circle') {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1;
          const nz = d > 1e-6 ? dz / d : 0;
          p.x = o.x + nx * min;
          p.z = o.z + nz * min;
          moved = true;
        }
      } else {
        const cx = Math.max(o.x - o.hw, Math.min(p.x, o.x + o.hw));
        const cz = Math.max(o.z - o.hd, Math.min(p.z, o.z + o.hd));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            p.x = cx + (dx / d) * r;
            p.z = cz + (dz / d) * r;
          } else {
            // center inside the box: push out along the axis of least penetration
            const px = o.hw - Math.abs(p.x - o.x);
            const pz = o.hd - Math.abs(p.z - o.z);
            if (px < pz) p.x = o.x + Math.sign(p.x - o.x || 1) * (o.hw + r);
            else p.z = o.z + Math.sign(p.z - o.z || 1) * (o.hd + r);
          }
          moved = true;
        }
      }
    });
    if (!moved) break;
  }
  const lim = map.half - r;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}

/** True if a circle at (x,z) overlaps any obstacle or leaves the map. */
export function circleBlocked(map: GameMap, x: number, z: number, r: number): boolean {
  if (Math.abs(x) > map.half - r || Math.abs(z) > map.half - r) return true;
  let hit = false;
  forObstaclesInAabb(map, x - r, z - r, x + r, z + r, (o) => {
    if (hit) return;
    if (o.type === 'circle') hit = Math.hypot(x - o.x, z - o.z) < o.r + r;
    else {
      const cx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw));
      const cz = Math.max(o.z - o.hd, Math.min(z, o.z + o.hd));
      hit = (x - cx) ** 2 + (z - cz) ** 2 < r * r;
    }
  });
  return hit;
}

/** Nearest free spot for a circle of radius r, spiralling out from (x,z). */
export function findFreeSpot(map: GameMap, x: number, z: number, r = PLAYER_RADIUS): { x: number; z: number } {
  if (!circleBlocked(map, x, z, r)) return { x, z };
  for (let ring = 1; ring < 60; ring++) {
    const rad = ring * 0.75;
    const steps = 8 + ring * 4;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * rad;
      const pz = z + Math.sin(a) * rad;
      if (!circleBlocked(map, px, pz, r)) return { x: px, z: pz };
    }
  }
  return { x: 0, z: 20 };
}

export interface RayHit {
  t: number; // distance along the ray to the hit (== maxDist when nothing hit)
  ob: Obstacle | null;
  nx: number; // surface normal at the hit (0,0 if none)
  nz: number;
}

/** Cast a ray from (x,z) along unit direction (dx,dz) against obstacles (not players). */
export function raycast(map: GameMap, x: number, z: number, dx: number, dz: number, maxDist: number): RayHit {
  const hit: RayHit = { t: maxDist, ob: null, nx: 0, nz: 0 };
  forObstaclesInAabb(map, x, z, x + dx * maxDist, z + dz * maxDist, (o) => {
    if (o.type === 'circle') {
      const t = rayCircle(x, z, dx, dz, o.x, o.z, o.r);
      if (t >= 0 && t < hit.t) {
        hit.t = t;
        hit.ob = o;
        const hx = x + dx * t - o.x;
        const hz = z + dz * t - o.z;
        const l = Math.hypot(hx, hz) || 1;
        hit.nx = hx / l;
        hit.nz = hz / l;
      }
    } else {
      // slab method
      let tmin = -Infinity;
      let tmax = Infinity;
      let nx = 0;
      let nz = 0;
      if (Math.abs(dx) < 1e-9) {
        if (x < o.x - o.hw || x > o.x + o.hw) return;
      } else {
        const t1 = (o.x - o.hw - x) / dx;
        const t2 = (o.x + o.hw - x) / dx;
        const lo = Math.min(t1, t2);
        if (lo > tmin) {
          tmin = lo;
          nx = dx > 0 ? -1 : 1;
          nz = 0;
        }
        tmax = Math.min(tmax, Math.max(t1, t2));
      }
      if (Math.abs(dz) < 1e-9) {
        if (z < o.z - o.hd || z > o.z + o.hd) return;
      } else {
        const t1 = (o.z - o.hd - z) / dz;
        const t2 = (o.z + o.hd - z) / dz;
        const lo = Math.min(t1, t2);
        if (lo > tmin) {
          tmin = lo;
          nx = 0;
          nz = dz > 0 ? -1 : 1;
        }
        tmax = Math.min(tmax, Math.max(t1, t2));
      }
      if (tmax < Math.max(tmin, 0)) return;
      const t = Math.max(tmin, 0);
      if (t < hit.t) {
        hit.t = t;
        hit.ob = o;
        hit.nx = nx;
        hit.nz = nz;
      }
    }
  });
  return hit;
}

/** Ray (origin, unit dir) vs circle: distance to first intersection, 0 if origin inside, -1 if miss. */
export function rayCircle(x: number, z: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const ox = x - cx;
  const oz = z - cz;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0 || b > 0) return -1;
  return -b - Math.sqrt(disc);
}

/** Line of sight between two points (true = nothing blocks). */
export function hasLineOfSight(map: GameMap, x1: number, z1: number, x2: number, z2: number): boolean {
  const d = Math.hypot(x2 - x1, z2 - z1);
  if (d < 1e-6) return true;
  return raycast(map, x1, z1, (x2 - x1) / d, (z2 - z1) / d, d).ob === null;
}

export function bushAt(map: GameMap, x: number, z: number): boolean {
  for (const b of map.bushes) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r * 0.8) return true;
  return false;
}

// ───────────────────────────── Movement (predicted) ─────────────────────────────

export interface MoveState {
  x: number;
  z: number;
  dashT: number; // remaining dash time
  dashCd: number; // remaining dash cooldown
  dashDx: number;
  dashDz: number;
}

export interface MoveInput {
  mx: number; // desired move direction, x (−1..1)
  mz: number; // desired move direction, z (−1..1)
  dash: boolean; // dash pressed this step
}

/**
 * Advance one movement step. `speedMul` folds buffs/slows/channel penalty (server-authoritative value,
 * mirrored to the client in the snapshot's self state).
 */
export function stepMove(map: GameMap, s: MoveState, inp: MoveInput, speedMul: number, dt: number): void {
  let mx = inp.mx;
  let mz = inp.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  if (inp.dash && s.dashCd <= 0 && s.dashT <= 0 && len > 0.1) {
    s.dashT = DASH_TIME;
    s.dashCd = DASH_COOLDOWN;
    const ml = Math.hypot(mx, mz);
    s.dashDx = mx / ml;
    s.dashDz = mz / ml;
  }
  let vx: number;
  let vz: number;
  if (s.dashT > 0) {
    vx = s.dashDx * DASH_SPEED;
    vz = s.dashDz * DASH_SPEED;
    s.dashT = Math.max(0, s.dashT - dt);
  } else {
    vx = mx * PLAYER_SPEED * speedMul;
    vz = mz * PLAYER_SPEED * speedMul;
  }
  s.dashCd = Math.max(0, s.dashCd - dt);
  const dist = Math.hypot(vx, vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  const p = { x: s.x, z: s.z };
  for (let i = 0; i < steps; i++) {
    p.x += (vx * dt) / steps;
    p.z += (vz * dt) / steps;
    resolveCircle(map, p, PLAYER_RADIUS);
  }
  s.x = p.x;
  s.z = p.z;
}
