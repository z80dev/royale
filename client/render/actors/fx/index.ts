// FX facade: owns every pooled effect primitive (particles, rings, beams, shells, debris, text, lights) plus
// short-lived timed rings/shells/beams. Actors push immediate-mode primitives between begin() and end().

import * as THREE from 'three';
import { easeOutCubic } from '../common';
import { BeamBatch, RingBatch, ShellBatch, type ShellStyleId } from './batches';
import { Debris } from './debris';
import { LightPool } from './lights';
import { ParticleBatch } from './particles';
import type { BurstPreset } from './presets';
import { TextPops } from './text';

interface TimedRing {
  life: number;
  age: number;
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  width: number;
  color: THREE.Color;
  intensity: number;
  alpha: number;
  dashes: number;
  spin: number;
  fill: number;
}

interface TimedShell {
  life: number;
  age: number;
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  style: ShellStyleId;
  colorA: THREE.Color;
  colorB: THREE.Color;
  intensity: number;
  alpha: number;
  fill: number;
  power: number;
  rise: number;
}

interface TimedBeam {
  life: number;
  age: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  w0: number;
  w1: number;
  color: THREE.Color;
  intensity: number;
  alpha: number;
  core: number;
}

function pool<T extends { life: number }>(n: number, make: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(make());
  return out;
}

/** Picks a free (life ≤ 0) slot, else the oldest-relative one. */
function claim<T extends { life: number; age: number }>(slots: T[]): T {
  let best = slots[0]!;
  let bestT = -1;
  for (const s of slots) {
    if (s.life <= 0) return s;
    const t = s.age / s.life;
    if (t > bestT) {
      bestT = t;
      best = s;
    }
  }
  return best;
}

const white = new THREE.Color(1, 1, 1);

export class Fx {
  readonly group = new THREE.Group();
  readonly add: ParticleBatch;
  readonly smoke: ParticleBatch;
  readonly rings: RingBatch;
  readonly beams: BeamBatch;
  readonly shells: ShellBatch;
  readonly debris: Debris;
  readonly text: TextPops;
  readonly lights: LightPool;
  private readonly timedRings: TimedRing[];
  private readonly timedShells: TimedShell[];
  private readonly timedBeams: TimedBeam[];

  constructor() {
    this.smoke = new ParticleBatch(2400, false, 20);
    this.add = new ParticleBatch(9000, true, 30);
    this.rings = new RingBatch(900, 10);
    this.beams = new BeamBatch(1400, 25);
    this.shells = new ShellBatch(160, 22);
    this.debris = new Debris();
    this.text = new TextPops();
    this.lights = new LightPool();
    this.group.add(
      this.rings.mesh,
      this.smoke.mesh,
      this.shells.mesh,
      this.beams.mesh,
      this.add.mesh,
      this.debris.group,
      this.text.group,
      this.lights.group,
    );
    this.timedRings = pool(220, () => ({
      life: 0, age: 0, x: 0, y: 0, z: 0, r0: 0, r1: 0, width: 0, color: white, intensity: 1, alpha: 1, dashes: 0,
      spin: 0, fill: 0,
    }));
    this.timedShells = pool(64, () => ({
      life: 0, age: 0, x: 0, y: 0, z: 0, r0: 0, r1: 0, style: 0 as ShellStyleId, colorA: white, colorB: white,
      intensity: 1, alpha: 1, fill: 0, power: 2, rise: 0,
    }));
    this.timedBeams = pool(160, () => ({
      life: 0, age: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, w0: 0, w1: 0, color: white, intensity: 1, alpha: 1,
      core: 0.5,
    }));
  }

  begin(time: number): void {
    this.rings.begin();
    this.beams.begin();
    this.shells.begin(time);
  }

  /** Simulates pools, emits timed primitives, uploads batches. */
  end(dt: number, time: number): void {
    for (const r of this.timedRings) {
      if (r.life <= 0) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.life = 0;
        continue;
      }
      const radius = r.r0 + (r.r1 - r.r0) * easeOutCubic(t);
      const fade = (1 - t) * (1 - t * 0.5);
      const alpha = r.alpha * fade;
      this.rings.push(r.x, r.y, r.z, radius, r.color, r.intensity, alpha, r.width, r.dashes, r.spin * r.age, r.fill * (1 - t));
    }
    for (const s of this.timedShells) {
      if (s.life <= 0) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.life = 0;
        continue;
      }
      const radius = s.r0 + (s.r1 - s.r0) * easeOutCubic(t);
      const fade = 1 - t * t;
      this.shells.push(
        s.x, s.y + s.rise * s.age, s.z, radius, s.style, s.colorA, s.intensity, s.alpha * fade, s.colorB,
        s.fill * (1 - t), s.power,
      );
    }
    for (const b of this.timedBeams) {
      if (b.life <= 0) continue;
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        b.life = 0;
        continue;
      }
      const fade = (1 - t) * (1 - t);
      const w = 0.35 + 0.65 * (1 - t);
      const alpha = b.alpha * fade;
      this.beams.push(b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.color, b.intensity, alpha, b.w0 * w, b.w1 * w, 1, b.core);
    }
    this.add.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.text.update(dt, time);
    this.lights.update(dt);
    this.rings.end();
    this.beams.end();
    this.shells.end();
  }

  clear(): void {
    this.add.clear();
    this.smoke.clear();
    this.debris.clear();
    this.text.clear();
    this.lights.clear();
    for (const r of this.timedRings) r.life = 0;
    for (const s of this.timedShells) s.life = 0;
    for (const b of this.timedBeams) b.life = 0;
  }

  // ───────────── particle helpers ─────────────

  /**
   * Burst of `count` particles. With a non-zero (dx, dy, dz) direction, velocities scatter around it by
   * `preset.cone`; otherwise directions are random (flattened by `preset.flat`).
   */
  burst(
    p: BurstPreset,
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    count: number,
    dx = 0,
    dy = 0,
    dz = 0,
    scale = 1,
  ): void {
    const batch = p.layer === 'add' ? this.add : this.smoke;
    const directed = dx !== 0 || dy !== 0 || dz !== 0;
    for (let i = 0; i < count; i++) {
      // Random unit vector.
      let ux = Math.random() * 2 - 1;
      let uy = Math.random() * 2 - 1;
      let uz = Math.random() * 2 - 1;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      let vx: number;
      let vy: number;
      let vz: number;
      if (directed) {
        vx = dx + ux * p.cone;
        vy = dy + uy * p.cone;
        vz = dz + uz * p.cone;
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
      } else {
        vx = ux;
        vy = uy * (1 - p.flat);
        vz = uz;
        const hl = Math.hypot(vx, vz) || 1;
        if (p.flat >= 1) {
          vx /= hl;
          vz /= hl;
        }
      }
      const speed = p.speed * scale * (1 - p.speedJitter * Math.random());
      const rx = p.radius > 0 ? (Math.random() * 2 - 1) * p.radius * scale : 0;
      const rz = p.radius > 0 ? (Math.random() * 2 - 1) * p.radius * scale : 0;
      const ry = p.radius > 0 ? Math.random() * p.radius * scale : 0;
      const size = p.size * scale * (1 + (Math.random() * 2 - 1) * p.sizeJitter);
      const k = p.glow * (0.8 + Math.random() * 0.4);
      batch.spawn(
        x + rx,
        y + ry,
        z + rz,
        vx * speed,
        vy * speed + p.up * scale + Math.random() * p.upJitter * scale,
        vz * speed,
        p.life * (1 - p.lifeJitter * 0.5 + Math.random() * p.lifeJitter),
        size,
        p.sizeEnd * scale * (size / (p.size * scale || 1)),
        color.r * k,
        color.g * k,
        color.b * k,
        p.alpha,
        p.gravity,
        p.drag,
        p.stretch,
        p.cell,
        p.spin > 0 ? Math.random() * 6.283 : p.rot,
        (Math.random() * 2 - 1) * p.spin,
        p.fadeIn,
        p.bounce,
      );
    }
  }

  /** One particle with a base velocity (trails, speed lines, swirls). */
  trail(
    p: BurstPreset,
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    vx: number,
    vy: number,
    vz: number,
    scale = 1,
  ): void {
    const batch = p.layer === 'add' ? this.add : this.smoke;
    const j = p.speed * scale;
    const k = p.glow * (0.85 + Math.random() * 0.3);
    batch.spawn(
      x,
      y,
      z,
      vx + (Math.random() * 2 - 1) * j,
      vy + (Math.random() * 2 - 1) * j + p.up * scale,
      vz + (Math.random() * 2 - 1) * j,
      p.life * (1 - p.lifeJitter * 0.5 + Math.random() * p.lifeJitter),
      p.size * scale,
      p.sizeEnd * scale,
      color.r * k,
      color.g * k,
      color.b * k,
      p.alpha,
      p.gravity,
      p.drag,
      p.stretch,
      p.cell,
      p.spin > 0 ? Math.random() * 6.283 : p.rot,
      (Math.random() * 2 - 1) * p.spin,
      p.fadeIn,
      p.bounce,
    );
  }

  // ───────────── timed primitives ─────────────

  ring(
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    life: number,
    color: THREE.Color,
    intensity = 2.5,
    width = 0.12,
    alpha = 1,
    dashes = 0,
    spin = 0,
    fill = 0,
  ): void {
    const r = claim(this.timedRings);
    r.life = life;
    r.age = 0;
    r.x = x;
    r.y = y;
    r.z = z;
    r.r0 = r0;
    r.r1 = r1;
    r.width = width;
    r.color = color;
    r.intensity = intensity;
    r.alpha = alpha;
    r.dashes = dashes;
    r.spin = spin;
    r.fill = fill;
  }

  shell(
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    life: number,
    style: ShellStyleId,
    colorA: THREE.Color,
    colorB: THREE.Color,
    intensity = 2,
    alpha = 1,
    fill = 0.2,
    power = 2.5,
    rise = 0,
  ): void {
    const s = claim(this.timedShells);
    s.life = life;
    s.age = 0;
    s.x = x;
    s.y = y;
    s.z = z;
    s.r0 = r0;
    s.r1 = r1;
    s.style = style;
    s.colorA = colorA;
    s.colorB = colorB;
    s.intensity = intensity;
    s.alpha = alpha;
    s.fill = fill;
    s.power = power;
    s.rise = rise;
  }

  beam(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    life: number,
    color: THREE.Color,
    width: number,
    intensity = 3,
    alpha = 1,
    core = 0.6,
    widthEnd = width,
  ): void {
    const b = claim(this.timedBeams);
    b.life = life;
    b.age = 0;
    b.ax = ax;
    b.ay = ay;
    b.az = az;
    b.bx = bx;
    b.by = by;
    b.bz = bz;
    b.w0 = width;
    b.w1 = widthEnd;
    b.color = color;
    b.intensity = intensity;
    b.alpha = alpha;
    b.core = core;
  }
}
