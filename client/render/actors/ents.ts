// Ability / world entities: Uniswap liquidity pool, Clanker turret, Zora orb dome, Pump grenade, falling
// airdrop — plus the local player's deploy landing beacon. Visuals are pooled per kind and reused.

import * as THREE from 'three';
import { CHARACTER_BY_ID } from '../../../shared/constants';
import type { EntKind, EntSnap } from '../../../shared/protocol';
import type { FrameView } from '../../view';
import {
  brandPrimary,
  brandSecondary,
  clamp,
  col,
  dampAngle,
  easeOutBack,
  FX_COLORS,
  glowMaterial,
  litMaterial,
  PartBuilder,
  TAU,
  vivid,
  yawFromAim,
} from './common';
import type { Fx } from './fx';
import { ShellStyle } from './fx/batches';
import { P } from './fx/presets';
import { crateGeometry } from './items';

const POOL_RADIUS = CHARACTER_BY_ID.uniswap.ability.radius ?? 4;
const DOME_RADIUS = CHARACTER_BY_ID.zora.ability.radius ?? 4;
const TURRET_RANGE = CHARACTER_BY_ID.clanker.ability.range ?? 22;
const GRENADE_RADIUS = CHARACTER_BY_ID.pump.ability.radius ?? 4.5;
const TURRET_HEAD_Y = 1.3;
/** Turret model scale (modelled at ~1.6 m; scaled up to read from the top-down camera). */
const TURRET_SCALE = 1.3;

// ───────────────────────────── Geometry ─────────────────────────────

interface TurretGeometry {
  base: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  headGlow: THREE.BufferGeometry;
}

let turretGeo: TurretGeometry | null = null;

function turretGeometry(): TurretGeometry {
  if (turretGeo) return turretGeo;
  const primary = brandPrimary('clanker');
  const secondary = brandSecondary('clanker');
  const dark = col('#1c1a26');
  const base = new PartBuilder()
    .cyl(0.28, 0.36, 0.22, dark, 0, 0.62, 0, 0, 0, 0, 16)
    .cyl(0.12, 0.16, 0.5, dark, 0, 0.95, 0, 0, 0, 0, 12)
    .cyl(0.22, 0.22, 0.14, primary, 0, 1.12, 0, 0, 0, 0, 16);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    base.limb(0, 0.6, 0, Math.cos(a) * 0.62, 0.02, Math.sin(a) * 0.62, 0.045, dark);
    base.sphere(0.07, primary, Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62);
  }
  const head = new PartBuilder()
    .box(0.62, 0.42, 0.58, primary, 0, 0.1, 0, 0, 0, 0, 0.1)
    .box(0.5, 0.2, 0.2, dark, 0, 0.14, 0.26, 0, 0, 0, 0.05)
    .tube(0.055, 0.62, dark, 0.13, 0.04, 0.5, 12)
    .tube(0.055, 0.62, dark, -0.13, 0.04, 0.5, 12)
    .tube(0.075, 0.1, col('#0e0d14'), 0.13, 0.04, 0.82, 12)
    .tube(0.075, 0.1, col('#0e0d14'), -0.13, 0.04, 0.82, 12)
    .box(0.18, 0.24, 0.3, dark, 0.4, 0.02, -0.05, 0, 0, 0, 0.04)
    .limb(-0.2, 0.3, -0.2, -0.24, 0.62, -0.26, 0.015, dark);
  const headGlow = new PartBuilder()
    .box(0.42, 0.07, 0.02, secondary, 0, 0.16, 0.365, 0, 0, 0, 0.02, 3)
    .sphere(0.035, secondary, -0.24, 0.64, -0.26, 1, 1, 1, 3.2)
    .torus(0.06, 0.012, secondary, 0.13, 0.04, 0.87, 0, 0, 0, 2.6)
    .torus(0.06, 0.012, secondary, -0.13, 0.04, 0.87, 0, 0, 0, 2.6)
    .box(0.02, 0.26, 0.36, secondary, 0.315, 0.1, 0.02, 0, 0, 0, 0, 2);
  turretGeo = { base: base.build(), head: head.build(), headGlow: headGlow.build() };
  return turretGeo;
}

interface GrenadeGeometry {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
}

let grenadeGeo: GrenadeGeometry | null = null;

function grenadeGeometry(): GrenadeGeometry {
  if (grenadeGeo) return grenadeGeo;
  const green = brandPrimary('pump');
  const lit = new PartBuilder().limb(0, -0.14, 0, 0, 0.14, 0, 0.13, FX_COLORS.white);
  const glow = new PartBuilder()
    .limb(0, 0.0, 0, 0, 0.16, 0, 0.135, green)
    .torus(0.14, 0.02, brandSecondary('pump'), 0, 0.0, 0, Math.PI / 2, 0, 0, 3);
  // Green half glows (dump side), white half is lit plastic — a proper pill.
  grenadeGeo = { lit: lit.build(), glow: glow.build() };
  return grenadeGeo;
}

// ───────────────────────────── Pool shader ─────────────────────────────

const POOL_VERTEX = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy / ${POOL_RADIUS.toFixed(2)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POOL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform vec3 uA;
  uniform vec3 uB;
  varying vec2 vP;
  void main() {
    vec2 p = vP;
    float d = length(p);
    if (d > 1.0) discard;
    float t = uTime;
    float ripple = 0.5 + 0.5 * sin(d * 20.0 - t * 4.0);
    float c = sin(p.x * 9.0 + t * 1.7 + sin(p.y * 7.0 - t)) * sin(p.y * 9.0 - t * 1.3 + sin(p.x * 6.0 + t));
    float caustic = pow(abs(c), 3.0);
    // x · y = k — constant-product hyperbolas drifting through the liquid.
    float hv = p.x * p.y * 7.0;
    float curve = 1.0 - smoothstep(0.0, 0.06, abs(fract(hv - t * 0.35) - 0.5) - 0.44);
    float rim = smoothstep(0.86, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
    vec3 color = mix(uA, uB, caustic * 0.45 + ripple * 0.1);
    color *= 0.35 + caustic * 0.9;
    color += uB * curve * 0.5 * (1.0 - d) + uB * rim * 1.4;
    float a = uAlpha * (0.5 + caustic * 0.3 + rim * 0.4 + curve * 0.2) * smoothstep(1.0, 0.95, d);
    gl_FragColor = vec4(color, a);
  }
`;

// ───────────────────────────── Visuals ─────────────────────────────

interface EntVisual {
  kind: EntKind;
  group: THREE.Group;
  born: number;
  // Kind-specific parts (unused ones stay null).
  poolMat: THREE.ShaderMaterial | null;
  head: THREE.Group | null;
  muzzle: THREE.Object3D | null;
  yaw: number;
  flash: number;
  barrel: number;
  prevX: number;
  prevZ: number;
  trail: number;
  spin: number;
}

function newVisual(kind: EntKind): EntVisual {
  const group = new THREE.Group();
  const v: EntVisual = {
    kind,
    group,
    born: 0,
    poolMat: null,
    head: null,
    muzzle: null,
    yaw: 0,
    flash: 0,
    barrel: 0,
    prevX: 0,
    prevZ: 0,
    trail: 0,
    spin: 0,
  };
  const lit = litMaterial();
  const glow = glowMaterial();
  switch (kind) {
    case 'pool': {
      v.poolMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uA: { value: brandPrimary('uniswap').clone() },
          uB: { value: vivid(brandSecondary('uniswap')).clone() },
        },
        vertexShader: POOL_VERTEX,
        fragmentShader: POOL_FRAGMENT,
        transparent: true,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(POOL_RADIUS, 64), v.poolMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.09;
      disc.renderOrder = 8;
      group.add(disc);
      break;
    }
    case 'turret': {
      const g = turretGeometry();
      const base = new THREE.Mesh(g.base, lit);
      base.castShadow = true;
      const head = new THREE.Group();
      head.position.y = TURRET_HEAD_Y;
      const headLit = new THREE.Mesh(g.head, lit);
      headLit.castShadow = true;
      head.add(headLit, new THREE.Mesh(g.headGlow, glow));
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.04, 0.9);
      head.add(muzzle);
      group.add(base, head);
      v.head = head;
      v.muzzle = muzzle;
      break;
    }
    case 'grenade': {
      const g = grenadeGeometry();
      const pill = new THREE.Group();
      pill.add(new THREE.Mesh(g.lit, lit), new THREE.Mesh(g.glow, glow));
      v.head = pill;
      group.add(pill);
      break;
    }
    case 'airdrop': {
      const g = crateGeometry();
      const crate = new THREE.Group();
      const baseLit = new THREE.Mesh(g.base.lit, lit);
      baseLit.castShadow = true;
      const lidLit = new THREE.Mesh(g.lid.lit, lit);
      lidLit.position.y = 1.4 * 0.8;
      const lidGlow = new THREE.Mesh(g.lid.glow, glow);
      lidGlow.position.y = 1.4 * 0.8;
      const chute = new THREE.Mesh(g.chute, lit);
      chute.position.y = 1.4 * 0.8 + 0.12;
      chute.castShadow = true;
      crate.add(baseLit, new THREE.Mesh(g.base.glow, glow), lidLit, lidGlow, chute);
      v.head = crate;
      group.add(crate);
      break;
    }
    case 'dome':
      // Drawn entirely through the shell batch.
      break;
  }
  return v;
}

const tmpVec = new THREE.Vector3();

export class EntRenderer {
  readonly group = new THREE.Group();
  private readonly active = new Map<number, EntVisual>();
  private readonly free: Record<EntKind, EntVisual[]> = { pool: [], turret: [], dome: [], grenade: [], airdrop: [] };
  private readonly seen = new Set<number>();
  /** Grenade landing targets by owner id (from 'ability' events). */
  private readonly grenadeTargets = new Map<string, { x: number; z: number; t: number }>();
  private readonly redSmoke = new THREE.Color(0.45, 0.04, 0.05);

  clear(): void {
    for (const [id, v] of this.active) this.release(id, v);
    this.grenadeTargets.clear();
  }

  private release(id: number, v: EntVisual): void {
    this.group.remove(v.group);
    this.active.delete(id);
    this.free[v.kind].push(v);
  }

  grenadeTarget(owner: string, x: number, z: number, time: number): void {
    this.grenadeTargets.set(owner, { x, z, t: time });
  }

  /** Marks a turret shot (flash + recoil) and writes its muzzle world position. */
  turretFired(entId: number, out: THREE.Vector3): boolean {
    const v = this.active.get(entId);
    if (!v || !v.muzzle || !v.head) return false;
    v.flash = 1;
    v.barrel = 1 - v.barrel;
    v.muzzle.position.x = v.barrel ? 0.13 : -0.13;
    v.muzzle.getWorldPosition(out);
    return true;
  }

  /**
   * True when a 'boom' at (x, z) is `owner`'s Pump & Dump grenade landing (its thrown target is nearby);
   * consumes the target so the explosion can use the pump palette.
   */
  takeGrenadeBoom(owner: string | null, x: number, z: number): boolean {
    if (owner === null) return false;
    const target = this.grenadeTargets.get(owner);
    if (!target || Math.hypot(target.x - x, target.z - z) > GRENADE_RADIUS) return false;
    this.grenadeTargets.delete(owner);
    return true;
  }

  update(view: FrameView, fx: Fx, time: number, dt: number): void {
    this.seen.clear();
    for (const e of view.ents) {
      this.seen.add(e.id);
      let v = this.active.get(e.id);
      if (!v) {
        v = this.free[e.k].pop() ?? newVisual(e.k);
        v.born = time;
        v.yaw = e.aim !== undefined ? yawFromAim(e.aim) : 0;
        v.flash = 0;
        v.prevX = e.x;
        v.prevZ = e.z;
        v.trail = 0;
        v.spin = 0;
        this.active.set(e.id, v);
        this.group.add(v.group);
      }
      this.updateVisual(e, v, view, fx, time, dt);
    }
    for (const [id, v] of this.active) if (!this.seen.has(id)) this.release(id, v);
    this.drawDeployMarker(view, fx, time);
    for (const [owner, g] of this.grenadeTargets) if (time - g.t > 4) this.grenadeTargets.delete(owner);
  }

  private updateVisual(e: EntSnap, v: EntVisual, view: FrameView, fx: Fx, time: number, dt: number): void {
    const age = time - v.born;
    const intro = clamp(age / 0.35, 0, 1);
    const outro = clamp(e.ttl / 0.5, 0, 1);
    v.group.position.set(e.x, 0, e.z);
    switch (e.k) {
      case 'pool': {
        const a = Math.min(intro, outro);
        v.poolMat!.uniforms.uTime!.value = time;
        v.poolMat!.uniforms.uAlpha!.value = a;
        const s = 0.3 + 0.7 * easeOutBack(intro);
        v.group.scale.set(s, 1, s);
        fx.rings.push(e.x, 0.1, e.z, POOL_RADIUS * s, brandPrimary('uniswap'), 2.4, 0.8 * a, 0.05, 24, time * 0.1);
        if (Math.random() < 0.6 * a) {
          const ang = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * POOL_RADIUS * 0.9;
          const bubble = vivid(brandSecondary('uniswap'));
          fx.burst(P.bubble, e.x + Math.cos(ang) * r, 0.12, e.z + Math.sin(ang) * r, bubble, 1);
        }
        if (Math.random() < 0.25 * a) {
          fx.burst(P.plus, e.x + (Math.random() - 0.5) * POOL_RADIUS, 0.3, e.z + (Math.random() - 0.5) * POOL_RADIUS,
            FX_COLORS.heal, 1);
        }
        break;
      }
      case 'turret': {
        const s = easeOutBack(intro) * (0.4 + 0.6 * outro) * TURRET_SCALE;
        v.group.scale.setScalar(Math.max(0.01, s));
        if (e.aim !== undefined) v.yaw = dampAngle(v.yaw, yawFromAim(e.aim), 18, dt);
        v.head!.rotation.y = v.yaw;
        v.flash = Math.max(0, v.flash - dt * 9);
        v.head!.position.z = -v.flash * 0.08;
        v.head!.position.y = TURRET_HEAD_Y + Math.sin(time * 3 + e.id) * 0.02;
        const teamColor = e.team === view.myTeam ? FX_COLORS.team : FX_COLORS.enemy;
        fx.rings.push(e.x, 0.08, e.z, 1.2, vivid(brandPrimary('clanker')), 2.4, 0.9, 0.15, 0, 0, 0.15);
        fx.rings.push(e.x, 0.08, e.z, TURRET_RANGE, teamColor, 1.2, 0.18 * outro, 0.012, 48, time * 0.02);
        if (e.ttl < 1.5 && Math.sin(time * 30) > 0) {
          fx.rings.push(e.x, 1.2, e.z, 0.7, FX_COLORS.danger, 3, 0.8, 0.2);
        }
        break;
      }
      case 'dome': {
        const a = Math.min(intro, outro);
        const r = DOME_RADIUS * (0.2 + 0.8 * easeOutBack(intro));
        const flicker = e.ttl < 1.2 ? 0.6 + 0.4 * Math.sin(time * 40) : 1;
        fx.shells.push(e.x, 0, e.z, r, ShellStyle.Orb, vivid(brandPrimary('zora')), 1.1, 0.9 * a * flicker,
          vivid(brandSecondary('zora')), 0.2, 2.2, 1, e.id);
        fx.rings.push(e.x, 0.1, e.z, r, vivid(brandPrimary('zora')), 2.6, 0.9 * a, 0.08, 0, 0, 0.1);
        break;
      }
      case 'grenade': {
        v.group.position.y = e.y;
        const vx = (e.x - v.prevX) / Math.max(dt, 1e-3);
        const vz = (e.z - v.prevZ) / Math.max(dt, 1e-3);
        v.spin += dt * 14;
        v.head!.rotation.set(v.spin, Math.atan2(vx, vz), 0);
        const green = brandPrimary('pump');
        v.trail += dt;
        while (v.trail > 1 / 60) {
          v.trail -= 1 / 60;
          fx.trail(P.trail, e.x, e.y + 0.1, e.z, green, 0, 0, 0, 0.7);
        }
        const target = e.owner ? this.grenadeTargets.get(e.owner) : undefined;
        if (target) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 14);
          const alpha = 0.5 + pulse * 0.4;
          fx.rings.push(target.x, 0.08, target.z, GRENADE_RADIUS, FX_COLORS.danger, 2.4, alpha, 0.06, 20, time * 0.4);
          fx.rings.push(target.x, 0.08, target.z, GRENADE_RADIUS * 0.4, green, 2.6, 0.8, 0.3, 0, 0, 0.5);
        }
        fx.rings.push(e.x, 0.08, e.z, 0.4, FX_COLORS.smokeDark, 1, 0.4, 1, 0, 0, 0);
        break;
      }
      case 'airdrop': {
        v.group.position.y = e.y;
        const sway = Math.sin(time * 1.3 + e.id) * 0.1;
        v.head!.rotation.set(sway, time * 0.3, Math.cos(time * 1.1) * 0.08);
        const red = FX_COLORS.danger;
        fx.beams.push(e.x, 0.05, e.z, e.x, 45, e.z, red, 2.4, 0.6 + 0.2 * Math.sin(time * 6), 0.7, 0.3, 0.1, 0.6);
        const closeness = clamp(1 - e.y / 60, 0, 1);
        fx.rings.push(e.x, 0.08, e.z, 3.2 - closeness * 1.6, red, 2.6, 0.9, 0.08, 12, time * 0.3);
        fx.rings.push(e.x, 0.08, e.z, 1.2 + ((time * 1.5) % 1) * 3, red, 2.2, 1 - ((time * 1.5) % 1), 0.08);
        if (Math.random() < 0.7) {
          fx.trail(P.smoke, e.x + 1.2, 0.2, e.z + 0.8, this.redSmoke, 0.6, 2.5, 0.3, 0.8);
        }
        if (Math.random() < 0.5) fx.burst(P.ember, e.x + 1.2, 0.3, e.z + 0.8, red, 1);
        break;
      }
    }
    v.prevX = e.x;
    v.prevZ = e.z;
  }

  private drawDeployMarker(view: FrameView, fx: Fx, time: number): void {
    const t = view.deployTarget;
    if (!t || view.phase !== 'deploy') return;
    const c = FX_COLORS.self;
    fx.beams.push(t.x, 0.05, t.z, t.x, 60, t.z, c, 2.2, 0.75, 0.9, 0.25, 0.05, 0.7);
    fx.beams.push(t.x, 0.05, t.z, t.x, 8, t.z, FX_COLORS.white, 2.5, 0.8, 0.25, 0.1, 0, 1);
    for (let i = 0; i < 3; i++) {
      const ph = (time * 0.8 + i / 3) % 1;
      fx.rings.push(t.x, 0.08, t.z, 0.6 + ph * 4.5, c, 2.6, 1 - ph, 0.07);
    }
    fx.rings.push(t.x, 0.08, t.z, 1.6, FX_COLORS.white, 2.6, 0.9, 0.08, 4, time * 0.25);
    fx.rings.push(t.x, 0.08, t.z, 0.7, c, 3, 1, 0.4, 0, 0, 0.9);
    if (Math.random() < 0.25) {
      tmpVec.set(t.x, 7 + Math.random() * 4, t.z);
      fx.trail(P.chevronDown, tmpVec.x, tmpVec.y, tmpVec.z, c, 0, -9, 0, 1.6);
    }
  }
}
