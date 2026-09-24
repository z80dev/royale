// Projectiles: stretched additive tracers per weapon, fat shotgun pellets, rocket models with exhaust + smoke
// trails, crimson laser beams that fade out, and the sniper's lingering vapor trail.

import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../../shared/constants';
import type { FrameView, ViewProjectile } from '../../view';
import { col, FX_COLORS, glowMaterial, litMaterial, PartBuilder, TAU } from './common';
import type { Fx } from './fx';
import { markRange } from './fx/particles';
import { P } from './fx/presets';

/** Height at which bullets fly (≈ gun height; turret barrels sit at the same height). */
export const SHOT_Y = 1.36;
const LASER_LIFE = 0.42;

interface TracerStyle {
  tail: number; // m
  width: number; // m
  head: number; // head flare width
  intensity: number;
}

const TRACERS: Record<WeaponId, TracerStyle> = {
  pistol: { tail: 2.4, width: 0.085, head: 0.22, intensity: 3 },
  smg: { tail: 2.0, width: 0.075, head: 0.2, intensity: 3 },
  shotgun: { tail: 1.1, width: 0.1, head: 0.24, intensity: 3.2 },
  ar: { tail: 3.2, width: 0.1, head: 0.26, intensity: 3.2 },
  sniper: { tail: 9, width: 0.14, head: 0.34, intensity: 3.8 },
  rocket: { tail: 0, width: 0, head: 0, intensity: 0 },
  laser: { tail: 0, width: 0, head: 0, intensity: 0 },
  minigun: { tail: 2.4, width: 0.085, head: 0.2, intensity: 3 },
};

interface ProjState {
  seenFrame: number;
  emit: number;
  lastX: number;
  lastZ: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpDir = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, 1);

function rocketGeometry(): { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const lit = new PartBuilder()
    .tube(0.1, 0.55, col('#e8e9f0'), 0, 0, 0, 14)
    .cone(0.1, 0.22, col('#ff4d2e'), 0, 0, 0.385, Math.PI / 2, 0, 0, 14);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    lit.box(0.012, 0.13, 0.16, col('#2a2d38'), Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.22, 0, 0, a, 0);
  }
  const glow = new PartBuilder()
    .torus(0.102, 0.016, col(WEAPONS.rocket.color), 0, 0, 0.1, 0, 0, 0, 3)
    .cyl(0.08, 0.05, 0.08, col('#ffd27a'), 0, 0, -0.3, Math.PI / 2, 0, 0, 12, 4);
  return { lit: lit.build(), glow: glow.build() };
}

export class ProjectileRenderer {
  readonly group = new THREE.Group();
  private readonly rocketLit: THREE.InstancedMesh;
  private readonly rocketGlow: THREE.InstancedMesh;
  private readonly states = new Map<number, ProjState>();
  private readonly spare: ProjState[] = [];
  private frame = 0;

  constructor() {
    const g = rocketGeometry();
    this.rocketLit = new THREE.InstancedMesh(g.lit, litMaterial(), 48);
    this.rocketGlow = new THREE.InstancedMesh(g.glow, glowMaterial(), 48);
    for (const m of [this.rocketLit, this.rocketGlow]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    this.rocketLit.castShadow = true;
  }

  clear(): void {
    for (const s of this.states.values()) this.spare.push(s);
    this.states.clear();
  }

  update(view: FrameView, fx: Fx): void {
    this.frame++;
    let rockets = 0;
    for (const p of view.projectiles) {
      let st = this.states.get(p.id);
      const fresh = !st;
      if (!st) {
        st = this.spare.pop() ?? { seenFrame: 0, emit: 0, lastX: 0, lastZ: 0 };
        st.emit = 0;
        st.lastX = p.ox;
        st.lastZ = p.oz;
        this.states.set(p.id, st);
      }
      st.seenFrame = this.frame;
      if (p.w === 'laser' || p.len !== undefined) this.drawLaser(p, fx, fresh);
      else if (p.w === 'rocket') {
        if (rockets < this.rocketLit.instanceMatrix.count) this.drawRocket(p, fx, st, rockets++);
      } else this.drawTracer(p, fx);
      st.lastX = p.x;
      st.lastZ = p.z;
    }
    this.rocketLit.count = rockets;
    this.rocketGlow.count = rockets;
    markRange(this.rocketLit.instanceMatrix, rockets * 16);
    markRange(this.rocketGlow.instanceMatrix, rockets * 16);
    for (const [id, st] of this.states) {
      if (st.seenFrame !== this.frame) {
        this.states.delete(id);
        this.spare.push(st);
      }
    }
  }

  private drawTracer(p: ViewProjectile, fx: Fx): void {
    const style = TRACERS[p.w];
    const color = col(WEAPONS[p.w].color);
    const y = SHOT_Y;
    const traveled = Math.hypot(p.x - p.ox, p.z - p.oz);
    const tail = Math.min(style.tail, traveled);
    const tx = p.x - p.dx * tail;
    const tz = p.z - p.dz * tail;
    fx.beams.push(tx, y, tz, p.x, y, p.z, color, style.intensity, 0.9, style.width * 0.3, style.width, 0.9, 1.1);
    fx.beams.push(p.x - p.dx * 0.35, y, p.z - p.dz * 0.35, p.x + p.dx * 0.1, y, p.z + p.dz * 0.1, color, 3,
      0.8, style.head, style.head * 0.8, 1, 1.5);
    if (p.w === 'sniper') {
      // Lingering vapor trail from the muzzle.
      const fade = Math.max(0, 1 - p.age / 0.9);
      fx.beams.push(p.ox, y, p.oz, tx, y, tz, color, 1.6, 0.35 * fade, 0.05, 0.03, 0.4, 0.2);
    }
  }

  private drawRocket(p: ViewProjectile, fx: Fx, st: ProjState, index: number): void {
    const y = SHOT_Y + 0.05;
    tmpDir.set(p.dx, 0, p.dz).normalize();
    tmpQuat.setFromUnitVectors(forward, tmpDir);
    tmpMatrix.compose(tmpPos.set(p.x, y, p.z), tmpQuat, tmpScale);
    this.rocketLit.setMatrixAt(index, tmpMatrix);
    this.rocketGlow.setMatrixAt(index, tmpMatrix);
    const flame = col(WEAPONS.rocket.color);
    // Exhaust flame + glow ribbon behind the nozzle.
    const bx = p.x - p.dx * 0.35;
    const bz = p.z - p.dz * 0.35;
    fx.beams.push(bx, y, bz, bx - p.dx * 1.6, y, bz - p.dz * 1.6, flame, 3.5, 1, 0.35, 0.05, 0.1, 1.2);
    // Smoke trail emitted by distance so it's continuous regardless of frame rate.
    const dist = Math.hypot(p.x - st.lastX, p.z - st.lastZ);
    st.emit += dist;
    const step = 0.35;
    let n = 0;
    while (st.emit > step && n < 12) {
      st.emit -= step;
      const k = st.emit / Math.max(dist, 1e-3);
      const sx = bx - (p.x - st.lastX) * k;
      const sz = bz - (p.z - st.lastZ) * k;
      fx.trail(P.puff, sx, y, sz, FX_COLORS.smoke, 0, 0.3, 0, 1.3);
      fx.trail(P.exhaust, sx, y, sz, flame, -p.dx * 2, 0, -p.dz * 2);
      n++;
    }
    if (Math.random() < 0.5) fx.burst(P.ember, bx, y, bz, flame, 1, -p.dx, 0.2, -p.dz, 0.6);
  }

  /**
   * Lasers are instant beams: on first sight spawn self-timed fading beams (independent of how long the core
   * keeps the projectile alive) plus sparkles along the beam and an impact flare at its end.
   */
  private drawLaser(p: ViewProjectile, fx: Fx, fresh: boolean): void {
    if (!fresh) return;
    const len = p.len ?? WEAPONS.laser.range;
    const color = col(WEAPONS.laser.color);
    const y = SHOT_Y;
    const ex = p.ox + p.dx * len;
    const ez = p.oz + p.dz * len;
    fx.beam(p.ox, y, p.oz, ex, y, ez, LASER_LIFE, color, 0.5, 3, 1, 0, 0.4);
    fx.beam(p.ox, y, p.oz, ex, y, ez, LASER_LIFE * 0.8, FX_COLORS.white, 0.14, 2.4, 1, 1.5, 0.11);
    const steps = Math.min(40, Math.floor(len / 1.4));
    for (let i = 0; i < steps; i++) {
      const k = (i + Math.random()) / steps;
      fx.burst(P.ember, p.ox + p.dx * len * k, y, p.oz + p.dz * len * k, color, 1, 0, 0, 0, 0.8);
    }
    fx.burst(P.flash, ex, y, ez, color, 2, 0, 0, 0, 1.4);
    fx.burst(P.spark, ex, y, ez, color, 14, -p.dx, 0.3, -p.dz);
    fx.ring(ex, 0.08, ez, 0.2, 1.6, 0.35, color, 3, 0.2);
  }
}
