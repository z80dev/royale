// "The Liquidation Zone": phased shrinking circle per ZONE_PHASES.

import { MAP_HALF, ZONE_PHASES, ZONE_START_RADIUS } from '../shared/constants';
import type { GameMap } from '../shared/map';
import { findFreeSpot } from '../shared/physics';
import type { GameEvent, ZoneSnap } from '../shared/protocol';

export class Zone {
  readonly state: ZoneSnap = {
    cx: 0,
    cz: 0,
    r: ZONE_START_RADIUS,
    ncx: 0,
    ncz: 0,
    nr: ZONE_START_RADIUS,
    phase: -1,
    shrinking: false,
    t: 0,
    dps: 0,
  };
  // circle at the start of the current shrink (interpolation origin)
  private fromX = 0;
  private fromZ = 0;
  private fromR = ZONE_START_RADIUS;

  constructor(
    private readonly map: GameMap,
    private readonly timeScale: number,
    private readonly emit: (ev: GameEvent) => void,
  ) {}

  /** Begin phase 0 when the match goes live. */
  start(): void {
    this.enterWait(0);
  }

  /** Is (x,z) outside the current safe circle? */
  outside(x: number, z: number): boolean {
    const s = this.state;
    return (x - s.cx) ** 2 + (z - s.cz) ** 2 > s.r * s.r;
  }

  /** Is (x,z) inside the upcoming circle with `margin` meters to spare? */
  insideNext(x: number, z: number, margin = 0): boolean {
    const s = this.state;
    const r = Math.max(0, s.nr - margin);
    return (x - s.ncx) ** 2 + (z - s.ncz) ** 2 <= r * r;
  }

  /** Advance zone time by `dt` (already multiplied by any fast-forward factor). */
  update(dt: number): void {
    const s = this.state;
    if (s.phase < 0 || (s.r === 0 && !s.shrinking)) return;
    s.t = Math.max(0, s.t - dt);
    const def = ZONE_PHASES[s.phase]!;
    if (s.shrinking) {
      const total = def.shrink * this.timeScale;
      const f = total > 0 ? 1 - s.t / total : 1;
      s.cx = this.fromX + (s.ncx - this.fromX) * f;
      s.cz = this.fromZ + (s.ncz - this.fromZ) * f;
      s.r = this.fromR + (s.nr - this.fromR) * f;
      if (s.t > 0) return;
      s.cx = s.ncx;
      s.cz = s.ncz;
      s.r = s.nr;
      s.shrinking = false;
      if (s.phase + 1 < ZONE_PHASES.length) this.enterWait(s.phase + 1);
      return;
    }
    if (s.t > 0) return;
    this.enterShrink();
  }

  private enterWait(phase: number): void {
    const s = this.state;
    const def = ZONE_PHASES[phase]!;
    s.phase = phase;
    s.shrinking = false;
    s.t = def.wait * this.timeScale;
    s.dps = def.dps;
    const next = this.pickNextCircle(def.r);
    s.ncx = next.x;
    s.ncz = next.z;
    s.nr = def.r;
    const secs = Math.round(s.t);
    this.emit({
      e: 'zone',
      phase,
      shrinking: false,
      msg: `${def.name} — liquidation zone moves in ${secs}s`,
    });
  }

  private enterShrink(): void {
    const s = this.state;
    const def = ZONE_PHASES[s.phase]!;
    s.shrinking = true;
    s.t = def.shrink * this.timeScale;
    this.fromX = s.cx;
    this.fromZ = s.cz;
    this.fromR = s.r;
    this.emit({ e: 'zone', phase: s.phase, shrinking: true, msg: `${def.name} — the zone is closing` });
    this.emit({
      e: 'announce',
      text: def.r === 0 ? 'TOTAL LIQUIDATION' : 'LIQUIDATION ZONE SHRINKING',
      sub: `${def.name} · gas: ${def.dps} gwei`,
      color: '#FF3B6B',
    });
  }

  /** Next circle: fully inside the current one and inside the map; tiny final circles land on walkable ground. */
  private pickNextCircle(nr: number): { x: number; z: number } {
    const s = this.state;
    const slack = Math.max(0, s.r - nr);
    const limit = Math.max(0, MAP_HALF - nr - 4);
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * slack * 0.9;
      const x = s.cx + Math.cos(a) * d;
      const z = s.cz + Math.sin(a) * d;
      if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
      const candidate = nr < 12 ? findFreeSpot(this.map, x, z, 1.5) : { x, z };
      if (Math.hypot(candidate.x - s.cx, candidate.z - s.cz) > slack) continue;
      if (Math.abs(candidate.x) > limit || Math.abs(candidate.z) > limit) continue;
      return candidate;
    }
    const x = Math.max(-limit, Math.min(limit, s.cx));
    const z = Math.max(-limit, Math.min(limit, s.cz));
    if (nr < 12) {
      const free = findFreeSpot(this.map, x, z, 1.5);
      if (Math.hypot(free.x - s.cx, free.z - s.cz) <= slack &&
          Math.abs(free.x) <= limit && Math.abs(free.z) <= limit) return free;
    }
    return { x, z };
  }
}
