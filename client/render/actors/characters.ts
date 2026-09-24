// "Degen operator" character rigs: armored brand-colored soldiers built from merged primitives, animated
// procedurally from the interpolated ViewPlayer (walk cycle, lean, aim, recoil, reload, leap, skydive) plus
// every status-flag visual (dash afterimages, buffs, slows, vault shell, x-ray reveal, heal swirl, laser eyes…).

import * as THREE from 'three';
import { CHARACTER_BY_ID, PLAYER_SPEED, type CharacterId, type WeaponId } from '../../../shared/constants';
import { ST } from '../../../shared/protocol';
import type { ViewPlayer } from '../../view';
import { badgeTexture } from '../assets';
import {
  brandGlowColor,
  brandPrimary,
  brandTrim,
  clamp,
  col,
  damp,
  dampAngle,
  fresnelOverlayMaterial,
  FX_COLORS,
  ghostGlowMaterial,
  ghostLitMaterial,
  glowMaterial,
  litMaterial,
  PartBuilder,
  TAU,
  wrapAngle,
  yawFromAim,
} from './common';
import type { Fx } from './fx';
import { ShellStyle } from './fx/batches';
import { P } from './fx/presets';
import { weaponModel } from './weapons';

// Skeleton anchor heights (meters, root space).
const HIP_Y = 0.92;
const WAIST_Y = 1.0;
const SHOULDER_Y = 1.56;
const NECK_Y = 1.7;
const THIGH_LEN = 0.42;
const HIP_X = 0.14;
/** Right-hand grip position in arms space (origin at shoulder center). */
const GRIP = new THREE.Vector3(0.1, -0.22, 0.46);

const DARK = col('#1b1e27');
const BLACK = col('#0e0f14');
const GOLD = col('#d9a53c');

interface CharacterGeometry {
  torso: THREE.BufferGeometry;
  torsoGlow: THREE.BufferGeometry;
  badges: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  arms: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
}

const geometryCache = new Map<CharacterId, CharacterGeometry>();
const badgeMaterials = new Map<CharacterId, THREE.MeshStandardMaterial>();
let badgeGeometry: THREE.BufferGeometry | null = null;
let eyesGeometry: THREE.BufferGeometry | null = null;

function sharedBadgeGeometry(): THREE.BufferGeometry {
  if (badgeGeometry) return badgeGeometry;
  const chest = new THREE.PlaneGeometry(0.3, 0.3);
  chest.translate(0, 0.44, 0.224);
  const back = new THREE.PlaneGeometry(0.34, 0.34);
  back.rotateY(Math.PI);
  back.translate(0, 0.46, -0.445);
  const merged = new THREE.BufferGeometry();
  // Manual merge keeps uv (PartBuilder strips it).
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const g of [chest, back]) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    for (const i of g.index!.array as Uint16Array) idx.push(base + i);
    g.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(1), 3));
  merged.setIndex(idx);
  merged.computeBoundingSphere();
  badgeGeometry = merged;
  return merged;
}

function badgeMaterial(id: CharacterId): THREE.MeshStandardMaterial {
  let m = badgeMaterials.get(id);
  if (!m) {
    const tex = badgeTexture(id);
    m = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.1,
      alphaTest: 0.5,
    });
    badgeMaterials.set(id, m);
  }
  return m;
}

function buildCharacterGeometry(id: CharacterId): CharacterGeometry {
  const primary = brandPrimary(id);
  const secondary = brandTrim(id);
  const plateDark = primary.clone().multiplyScalar(0.55);
  // Normalize emissive strength by luminance so white visors don't blow out while dark ones still bloom.
  const lum = secondary.r * 0.2126 + secondary.g * 0.7152 + secondary.b * 0.0722;
  const glowK = clamp(1.3 / (lum + 0.3), 1, 3);

  // Torso (origin at the waist). Pelvis + belt + chest armor + shoulder pads + backpack.
  const torso = new PartBuilder()
    .box(0.44, 0.2, 0.3, DARK, 0, -0.03, 0)
    .box(0.47, 0.06, 0.32, BLACK, 0, 0.06, 0, 0, 0, 0, 0.02)
    .box(0.1, 0.07, 0.04, GOLD, 0, 0.06, 0.165, 0, 0, 0, 0.01)
    .box(0.1, 0.12, 0.1, DARK, 0.25, 0.0, 0.05)
    .box(0.1, 0.12, 0.1, DARK, -0.25, 0.0, 0.05)
    .box(0.4, 0.26, 0.28, DARK, 0, 0.2, 0)
    .box(0.64, 0.44, 0.4, primary, 0, 0.44, 0, 0, 0, 0, 0.09)
    .box(0.36, 0.36, 0.04, BLACK, 0, 0.44, 0.2, 0, 0, 0, 0.02)
    .box(0.52, 0.1, 0.36, plateDark, 0, 0.23, 0.02, 0, 0, 0, 0.04)
    .cyl(0.15, 0.17, 0.1, DARK, 0, 0.69, 0)
    .box(0.26, 0.14, 0.32, primary, 0.41, 0.6, 0, 0, 0, -0.38, 0.05)
    .box(0.26, 0.14, 0.32, primary, -0.41, 0.6, 0, 0, 0, 0.38, 0.05)
    .sphere(0.11, DARK, 0.37, 0.54, 0)
    .sphere(0.11, DARK, -0.37, 0.54, 0)
    .box(0.48, 0.52, 0.24, DARK, 0, 0.45, -0.32, 0, 0, 0, 0.06)
    .box(0.06, 0.44, 0.2, primary, 0.27, 0.45, -0.32, 0, 0, 0, 0.02)
    .box(0.06, 0.44, 0.2, primary, -0.27, 0.45, -0.32, 0, 0, 0, 0.02)
    .cyl(0.085, 0.085, 0.46, plateDark, 0, 0.75, -0.3, 0, 0, Math.PI / 2, 12)
    .limb(0.16, 0.7, -0.4, 0.21, 1.12, -0.46, 0.012, BLACK)
    .build();

  const torsoGlow = new PartBuilder()
    .box(0.025, 0.3, 0.012, secondary, 0.2, 0.44, 0.205, 0, 0, 0, 0, glowK)
    .box(0.025, 0.3, 0.012, secondary, -0.2, 0.44, 0.205, 0, 0, 0, 0, glowK)
    .box(0.3, 0.022, 0.012, secondary, 0, 0.26, -0.443, 0, 0, 0, 0, glowK)
    .box(0.3, 0.022, 0.012, secondary, 0, 0.21, -0.443, 0, 0, 0, 0, glowK)
    .box(0.2, 0.018, 0.012, secondary, 0, 0.065, 0.187, 0, 0, 0, 0, glowK)
    .sphere(0.035, secondary, 0.21, 1.13, -0.46, 1, 1, 1, glowK * 1.3)
    .sphere(0.028, secondary, 0.46, 0.66, 0.1, 1, 1, 1, glowK * 1.2)
    .sphere(0.028, secondary, -0.46, 0.66, 0.1, 1, 1, 1, glowK * 1.2)
    .build();

  // Head (origin at the neck).
  const helmet = new PartBuilder()
    .sphere(0.25, primary, 0, 0.2, 0, 1, 1.02, 1.08, 1, 20, 14)
    .box(0.3, 0.14, 0.18, DARK, 0, 0.07, 0.14, 0, 0, 0, 0.05)
    .box(0.06, 0.09, 0.34, plateDark, 0, 0.44, -0.03, 0, 0, 0, 0.025)
    .cyl(0.085, 0.085, 0.07, DARK, 0.25, 0.18, 0, 0, 0, Math.PI / 2, 14)
    .cyl(0.085, 0.085, 0.07, DARK, -0.25, 0.18, 0, 0, 0, Math.PI / 2, 14)
    .build();

  const visorGeo = new THREE.SphereGeometry(0.262, 22, 8, Math.PI / 2 - 0.95, 1.9, 1.05, 0.62);
  const visor = new PartBuilder()
    .add(visorGeo, secondary, 0.95 * glowK, 0, 0.2, 0, 0, 0, 0, 1, 1.02, 1.08)
    .torus(0.09, 0.012, secondary, 0.29, 0.18, 0, 0, Math.PI / 2, 0, glowK)
    .torus(0.09, 0.012, secondary, -0.29, 0.18, 0, 0, Math.PI / 2, 0, glowK)
    .build();

  // Arms in a two-handed aiming pose (origin at the shoulder center).
  const rElbow = [0.31, -0.27, 0.17] as const;
  const lElbow = [-0.3, -0.25, 0.3] as const;
  const lHand = [-0.04, -0.19, 0.64] as const;
  const arms = new PartBuilder()
    .limb(0.37, 0, 0, rElbow[0], rElbow[1], rElbow[2], 0.085, DARK)
    .limb(rElbow[0], rElbow[1], rElbow[2], GRIP.x, GRIP.y, GRIP.z, 0.078, DARK)
    .limb(-0.37, 0, 0, lElbow[0], lElbow[1], lElbow[2], 0.085, DARK)
    .limb(lElbow[0], lElbow[1], lElbow[2], lHand[0], lHand[1], lHand[2], 0.078, DARK)
    .limb(
      rElbow[0] * 0.75 + GRIP.x * 0.25,
      rElbow[1] * 0.75 + GRIP.y * 0.25,
      rElbow[2] * 0.75 + GRIP.z * 0.25,
      rElbow[0] * 0.3 + GRIP.x * 0.7,
      rElbow[1] * 0.3 + GRIP.y * 0.7,
      rElbow[2] * 0.3 + GRIP.z * 0.7,
      0.1,
      primary,
    )
    .limb(
      lElbow[0] * 0.75 + lHand[0] * 0.25,
      lElbow[1] * 0.75 + lHand[1] * 0.25,
      lElbow[2] * 0.75 + lHand[2] * 0.25,
      lElbow[0] * 0.3 + lHand[0] * 0.7,
      lElbow[1] * 0.3 + lHand[1] * 0.7,
      lElbow[2] * 0.3 + lHand[2] * 0.7,
      0.1,
      primary,
    )
    .sphere(0.075, BLACK, GRIP.x, GRIP.y, GRIP.z)
    .sphere(0.075, BLACK, lHand[0], lHand[1], lHand[2])
    .build();

  // Legs (origin at the joint, extending down −y).
  const thigh = new PartBuilder()
    .limb(0, 0, 0, 0, -THIGH_LEN, 0, 0.1, DARK)
    .box(0.17, 0.26, 0.1, primary, 0, -0.2, 0.07, 0, 0, 0, 0.035)
    .build();
  const shin = new PartBuilder()
    .limb(0, 0, 0, 0, -0.36, 0, 0.085, DARK)
    .box(0.16, 0.13, 0.1, primary, 0, 0, 0.085, 0, 0, 0, 0.04)
    .box(0.15, 0.24, 0.08, primary, 0, -0.2, 0.075, 0, 0, 0, 0.03)
    .box(0.2, 0.15, 0.34, DARK, 0, -0.39, 0.05, 0, 0, 0, 0.05)
    .box(0.21, 0.05, 0.36, BLACK, 0, -0.45, 0.05, 0, 0, 0, 0.02)
    .box(0.19, 0.07, 0.1, primary, 0, -0.39, 0.2, 0, 0, 0, 0.03)
    .build();

  eyesGeometry ??= new PartBuilder()
    .sphere(0.05, FX_COLORS.laserEye, 0.085, 0.22, 0.27, 1, 1, 0.6, 6)
    .sphere(0.05, FX_COLORS.laserEye, -0.085, 0.22, 0.27, 1, 1, 0.6, 6)
    .build();

  return {
    torso,
    torsoGlow,
    badges: sharedBadgeGeometry(),
    helmet,
    visor,
    eyes: eyesGeometry,
    arms,
    thigh,
    shin,
  };
}

function characterGeometry(id: CharacterId): CharacterGeometry {
  let g = geometryCache.get(id);
  if (!g) {
    g = buildCharacterGeometry(id);
    geometryCache.set(id, g);
  }
  return g;
}

// ───────────────────────────── Overlays ─────────────────────────────

let xrayMaterial: THREE.ShaderMaterial | null = null;

function sharedXrayMaterial(): THREE.ShaderMaterial {
  if (!xrayMaterial) {
    xrayMaterial = fresnelOverlayMaterial(FX_COLORS.danger, 0.85, false);
    xrayMaterial.uniforms.uFill!.value = 0.35;
  }
  return xrayMaterial;
}

/** Duplicate of the rig's body meshes rendered with an overlay material (same parents, identity transforms). */
class Overlay {
  readonly meshes: THREE.Mesh[] = [];
  private readonly sources: THREE.Mesh[];
  visible = false;

  constructor(sources: THREE.Mesh[], material: THREE.Material, renderOrder: number) {
    this.sources = sources;
    for (const src of sources) {
      const m = new THREE.Mesh(src.geometry, material);
      m.renderOrder = renderOrder;
      m.castShadow = false;
      m.visible = false;
      m.frustumCulled = false;
      src.parent!.add(m);
      this.meshes.push(m);
    }
  }

  set(visible: boolean): void {
    if (visible) {
      for (let i = 0; i < this.meshes.length; i++) {
        const m = this.meshes[i]!;
        const src = this.sources[i]!;
        m.geometry = src.geometry;
        m.visible = src.visible;
      }
    } else if (this.visible) {
      for (const m of this.meshes) m.visible = false;
    }
    this.visible = visible;
  }
}

// ───────────────────────────── Afterimages ─────────────────────────────

const AFTERIMAGE_PARTS = 9;

interface AfterimageSlot {
  meshes: THREE.Mesh[];
  material: THREE.ShaderMaterial;
  age: number;
  life: number;
  rise: number;
  alpha: number;
}

/** Frozen fresnel copies of a rig pose: dash trails, blink echoes and the rising death ghost. */
export class Afterimages {
  readonly group = new THREE.Group();
  private readonly slots: AfterimageSlot[] = [];

  constructor(capacity = 28) {
    for (let i = 0; i < capacity; i++) {
      const material = fresnelOverlayMaterial(FX_COLORS.white, 0, true);
      const meshes: THREE.Mesh[] = [];
      for (let j = 0; j < AFTERIMAGE_PARTS; j++) {
        const m = new THREE.Mesh(undefined, material);
        m.matrixAutoUpdate = false;
        m.visible = false;
        m.frustumCulled = false;
        m.renderOrder = 15;
        this.group.add(m);
        meshes.push(m);
      }
      this.slots.push({ meshes, material, age: 0, life: 0, rise: 0, alpha: 0 });
    }
  }

  spawn(parts: THREE.Mesh[], color: THREE.Color, life: number, alpha: number, rise = 0, fill = 0.3): void {
    let slot = this.slots[0]!;
    let oldest = -1;
    for (const s of this.slots) {
      if (s.life <= 0) {
        slot = s;
        break;
      }
      const t = s.age / s.life;
      if (t > oldest) {
        oldest = t;
        slot = s;
      }
    }
    slot.age = 0;
    slot.life = life;
    slot.rise = rise;
    slot.alpha = alpha;
    slot.material.uniforms.uColor!.value.copy(color);
    slot.material.uniforms.uFill!.value = fill;
    for (let j = 0; j < AFTERIMAGE_PARTS; j++) {
      const m = slot.meshes[j]!;
      const src = parts[j];
      if (!src || !src.visible) {
        m.visible = false;
        continue;
      }
      m.geometry = src.geometry;
      m.matrix.copy(src.matrixWorld);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    }
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.life = 0;
        for (const m of s.meshes) m.visible = false;
        continue;
      }
      s.material.uniforms.uOpacity!.value = s.alpha * (1 - t) * (1 - t);
      if (s.rise !== 0) {
        for (const m of s.meshes) {
          m.matrix.elements[13] += s.rise * dt;
          m.matrixWorldNeedsUpdate = true;
        }
      }
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.life = 0;
      for (const m of s.meshes) m.visible = false;
    }
  }
}

// ───────────────────────────── Rig ─────────────────────────────

export interface RigServices {
  fx: Fx;
  afterimages: Afterimages;
  shake(amount: number, x: number, z: number): void;
}

const tmpVec = new THREE.Vector3();
const DMG_BUFF_COLOR = brandTrim('long');
const RUSH_COLOR = brandTrim('fomo');
const RUSH_COLOR_2 = brandGlowColor('fomo');
const LEAP_RADIUS = CHARACTER_BY_ID.jump.ability.radius ?? 4;

function makeMesh(geo: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = castShadow;
  m.receiveShadow = false;
  return m;
}

export class CharacterRig {
  readonly root = new THREE.Group();
  readonly character: CharacterId;
  /** Muzzle anchor (world position used for flashes and tracer origins). */
  readonly muzzle = new THREE.Object3D();
  /** Body meshes copied by afterimages / ghosts (fixed order, AFTERIMAGE_PARTS long). */
  readonly ghostParts: THREE.Mesh[];
  /** Lit armor color (raw brand primary). */
  readonly primary: THREE.Color;
  /** Saturated brand neon (brandGlowColor) for emissive/additive FX. */
  readonly glow: THREE.Color;
  /** Glow-safe accent color (brandTrim) for visor-matched FX. */
  readonly secondary: THREE.Color;

  alive = false;
  seen = false;
  /**
   * Set by the kill event: keeps the rig hidden even while the interpolated snapshot (rendered ~100 ms in the
   * past) still reports the victim alive, so the death FX never shows a body popping back in.
   */
  killed = false;
  x = 0;
  y = 0;
  z = 0;
  aim = 0;
  /** Id of the player this rig currently represents (rigs are pooled per character). */
  playerId = '';

  private readonly services: RigServices;
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms = new THREE.Group();
  private readonly weapon = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly thighL = new THREE.Group();
  private readonly thighR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();
  private readonly litMeshes: THREE.Mesh[] = [];
  private readonly glowMeshes: THREE.Mesh[] = [];
  private readonly badgeMesh: THREE.Mesh;
  private readonly eyesMesh: THREE.Mesh;
  private readonly weaponLit: THREE.Mesh;
  private readonly weaponGlow: THREE.Mesh;
  private readonly spinLit: THREE.Mesh;
  private readonly spinGlow: THREE.Mesh;
  private readonly overlaySources: THREE.Mesh[];
  private xray: Overlay | null = null;
  private tint: Overlay | null = null;
  private tintMaterial: THREE.ShaderMaterial | null = null;

  /** Weapon currently shown in hand (set via setWeapon). */
  weaponId: WeaponId | null = null;
  private concealed = false;
  private yaw = 0;
  private legYaw = 0;
  private phase = 0;
  private stride = 0;
  private leanX = 0;
  private leanZ = 0;
  private recoil = 0;
  private reloadPose = 0;
  private leapPose = 0;
  private skydive = 0;
  private spinSpeed = 0;
  private squash = 0;
  private squashAge = 0;
  private hitFlash = 0;
  private hitArmor = false;
  private prevSt = 0;
  private prevY = 0;
  private vy = 0;
  private dashEmit = 0;
  private fxEmit = 0;
  private trailEmit = 0;

  constructor(character: CharacterId, services: RigServices) {
    this.character = character;
    this.services = services;
    this.primary = brandPrimary(character);
    this.glow = brandGlowColor(character);
    this.secondary = brandTrim(character);
    const g = characterGeometry(character);
    const lit = litMaterial();
    const glow = glowMaterial();

    this.root.add(this.body);
    this.body.add(this.hips, this.torso);
    this.hips.position.y = HIP_Y;
    this.torso.position.y = WAIST_Y;

    const torsoMesh = makeMesh(g.torso, lit, true);
    const torsoGlow = makeMesh(g.torsoGlow, glow, false);
    this.badgeMesh = makeMesh(g.badges, badgeMaterial(character), false);
    this.torso.add(torsoMesh, torsoGlow, this.badgeMesh, this.head, this.arms);

    this.head.position.y = NECK_Y - WAIST_Y;
    const helmet = makeMesh(g.helmet, lit, true);
    const visor = makeMesh(g.visor, glow, false);
    this.eyesMesh = makeMesh(g.eyes, glow, false);
    this.eyesMesh.visible = false;
    this.head.add(helmet, visor, this.eyesMesh);

    this.arms.position.y = SHOULDER_Y - WAIST_Y;
    const armsMesh = makeMesh(g.arms, lit, true);
    this.arms.add(armsMesh, this.weapon);
    this.weapon.position.copy(GRIP);
    this.weaponLit = makeMesh(g.arms, lit, true);
    this.weaponGlow = makeMesh(g.arms, glow, false);
    this.spinLit = makeMesh(g.arms, lit, true);
    this.spinGlow = makeMesh(g.arms, glow, false);
    this.spinner.add(this.spinLit, this.spinGlow);
    this.weapon.add(this.weaponLit, this.weaponGlow, this.spinner, this.muzzle);

    for (const [thigh, shin, side] of [
      [this.thighL, this.shinL, -1],
      [this.thighR, this.shinR, 1],
    ] as const) {
      thigh.position.set(HIP_X * side, 0, 0);
      shin.position.y = -THIGH_LEN;
      thigh.add(makeMesh(g.thigh, lit, true), shin);
      shin.add(makeMesh(g.shin, lit, true));
      this.hips.add(thigh);
    }

    const thighLMesh = this.thighL.children[0] as THREE.Mesh;
    const thighRMesh = this.thighR.children[0] as THREE.Mesh;
    const shinLMesh = this.shinL.children[0] as THREE.Mesh;
    const shinRMesh = this.shinR.children[0] as THREE.Mesh;
    this.ghostParts = [
      torsoMesh, helmet, armsMesh, this.weaponLit, this.spinLit, thighLMesh, thighRMesh, shinLMesh, shinRMesh,
    ];
    this.litMeshes.push(...this.ghostParts);
    this.glowMeshes.push(torsoGlow, visor, this.weaponGlow, this.spinGlow);
    this.overlaySources = this.ghostParts;
    this.root.visible = false;
  }

  /** Swaps the held weapon model. */
  setWeapon(w: WeaponId | null): void {
    if (w === this.weaponId) return;
    this.weaponId = w;
    // Toggle the meshes themselves (not their groups): afterimages/overlays copy per-mesh visibility.
    this.weaponLit.visible = this.weaponGlow.visible = w !== null;
    if (!w) {
      this.spinLit.visible = this.spinGlow.visible = false;
      return;
    }
    const model = weaponModel(w);
    this.weaponLit.geometry = model.lit;
    this.weaponGlow.geometry = model.glow;
    this.spinLit.visible = this.spinGlow.visible = model.spin !== null;
    if (model.spin) {
      this.spinLit.geometry = model.spin.lit;
      this.spinGlow.geometry = model.spin.glow;
      this.spinner.position.set(0, model.spin.y, 0);
    }
    this.muzzle.position.set(0, model.muzzleY, model.muzzleZ);
  }

  /** Recoil kick from a shot (0..1). */
  kick(amount: number): void {
    this.recoil = Math.min(1.4, this.recoil + 0.4 + amount);
  }

  hit(armor: boolean): void {
    this.hitFlash = 1;
    this.hitArmor = armor;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  hide(): void {
    this.root.visible = false;
    this.alive = false;
    this.xray?.set(false);
    this.tint?.set(false);
  }

  /** Detaches the rig; shared geometry/materials stay cached, only the per-rig tint material is freed. */
  dispose(): void {
    this.root.removeFromParent();
    this.tintMaterial?.dispose();
  }

  /** Resets transient animation state when the rig is (re)assigned to a player. */
  reset(p: ViewPlayer): void {
    this.playerId = p.id;
    this.seen = false;
    this.killed = false;
    this.prevSt = p.st;
    this.prevY = p.y;
    this.vy = 0;
    this.yaw = yawFromAim(p.aim);
    this.recoil = this.hitFlash = this.squash = this.leapPose = this.reloadPose = 0;
    this.skydive = (p.st & ST.DEPLOYING) !== 0 ? 1 : 0;
    this.setConcealed(false);
  }

  private setConcealed(concealed: boolean): void {
    if (concealed === this.concealed) return;
    this.concealed = concealed;
    const lit = concealed ? ghostLitMaterial() : litMaterial();
    const glow = concealed ? ghostGlowMaterial() : glowMaterial();
    for (const m of this.litMeshes) {
      m.material = lit;
      m.castShadow = !concealed;
    }
    for (const m of this.glowMeshes) m.material = glow;
    this.badgeMesh.material = concealed ? ghostLitMaterial() : badgeMaterial(this.character);
  }

  update(p: ViewPlayer, dt: number, time: number): void {
    const { fx } = this.services;
    const st = p.st;
    const prevSt = this.prevSt;
    this.prevSt = st;

    if (!p.alive || this.killed) {
      if (this.root.visible) this.hide();
      return;
    }
    this.alive = true;
    this.root.visible = true;
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.aim = p.aim;
    this.setWeapon(p.w);
    this.setConcealed(p.concealed);

    const rawVy = dt > 0 ? (p.y - this.prevY) / dt : 0;
    this.vy = damp(this.vy, rawVy, 12, dt);
    this.prevY = p.y;

    // ── Facing + locomotion ──
    const targetYaw = yawFromAim(p.aim);
    this.yaw = this.seen ? dampAngle(this.yaw, targetYaw, 28, dt) : targetYaw;
    this.seen = true;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = this.yaw;

    const deploying = (st & ST.DEPLOYING) !== 0 && p.y > 0.3;
    const leaping = (st & ST.LEAP) !== 0;
    const grounded = !deploying && !leaping && p.y < 0.2;
    const speed = Math.hypot(p.vx, p.vz);
    let legYawTarget = 0;
    let strideDir = 1;
    if (speed > 0.4 && grounded) {
      const rel = wrapAngle(Math.atan2(p.vx, p.vz) - this.yaw);
      if (Math.abs(rel) > 1.75) {
        legYawTarget = wrapAngle(rel - Math.PI);
        strideDir = -1;
      } else legYawTarget = rel;
      legYawTarget = clamp(legYawTarget, -0.9, 0.9);
    }
    this.legYaw = dampAngle(this.legYaw, legYawTarget, 10, dt);
    this.hips.rotation.y = this.legYaw;
    const targetStride = grounded ? clamp(speed / PLAYER_SPEED, 0, 1.25) : 0;
    this.stride = damp(this.stride, targetStride, 10, dt);
    this.phase += strideDir * (speed * dt / 2.1) * TAU;

    // Lean into movement (root-local velocity).
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwd = p.vx * sinY + p.vz * cosY;
    const right = p.vx * cosY - p.vz * sinY;
    this.leanX = damp(this.leanX, clamp(fwd * 0.028, -0.2, 0.26), 8, dt);
    this.leanZ = damp(this.leanZ, clamp(-right * 0.028, -0.22, 0.22), 8, dt);

    // ── Pose blending ──
    this.skydive = damp(this.skydive, deploying ? 1 : 0, 6, dt);
    this.leapPose = damp(this.leapPose, leaping ? 1 : 0, 14, dt);
    this.reloadPose = damp(this.reloadPose, (st & ST.RELOAD) !== 0 ? 1 : 0, 10, dt);
    this.recoil = damp(this.recoil, 0, 16, dt);
    this.hitFlash = damp(this.hitFlash, 0, 9, dt);

    const s = this.stride;
    const swing = Math.sin(this.phase) * 0.8 * s;
    const kneeL = Math.max(0, Math.cos(this.phase)) * 1.15 * s + 0.08 * s;
    const kneeR = Math.max(0, Math.cos(this.phase + Math.PI)) * 1.15 * s + 0.08 * s;
    const tuck = this.leapPose;
    const dive = this.skydive;
    this.thighL.rotation.x = -swing * (1 - tuck) - 1.0 * tuck + 0.35 * dive;
    this.thighR.rotation.x = swing * (1 - tuck) - 0.7 * tuck + 0.2 * dive;
    this.shinL.rotation.x = kneeL * (1 - tuck) + 1.5 * tuck + 0.9 * dive;
    this.shinR.rotation.x = kneeR * (1 - tuck) + 1.2 * tuck + 0.6 * dive;
    this.thighL.rotation.z = -0.25 * dive;
    this.thighR.rotation.z = 0.25 * dive;

    const breathe = Math.sin(time * 2.1 + this.x) * 0.012;
    const bob = -Math.abs(Math.sin(this.phase)) * 0.075 * s + (1 - s) * breathe;
    this.body.position.y = bob;
    const sway = dive * Math.sin(time * 1.7 + this.z) * 0.18;
    this.body.rotation.x = this.leanX * (1 - dive) + dive * 1.25;
    this.body.rotation.z = this.leanZ * (1 - dive) + sway;
    this.body.rotation.y = Math.sin(this.phase) * 0.06 * s;
    this.torso.rotation.y = -this.legYaw * 0.25;

    // Squash & stretch: stretch with vertical speed during leaps, damped spring on landing.
    this.squashAge += dt;
    const spring = this.squash * Math.cos(this.squashAge * 20) * Math.exp(-this.squashAge * 7);
    const stretch = leaping ? clamp(Math.abs(this.vy) * 0.018, 0, 0.22) : 0;
    const sy = 1 + stretch - spring * 0.28;
    const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    this.body.scale.set(sxz, sy, sxz);

    this.arms.position.z = -this.recoil * 0.1;
    this.arms.rotation.x = -this.recoil * 0.14 + this.reloadPose * 0.6 - dive * 0.5;
    this.weapon.rotation.z = this.reloadPose * 0.9;
    this.head.rotation.x = this.reloadPose * 0.3 - dive * 0.6 + this.leanX * -0.5;

    // Minigun spin-up.
    const firing = (st & ST.FIRING) !== 0;
    this.spinSpeed = damp(this.spinSpeed, firing ? 38 : 0, firing ? 3 : 1.5, dt);
    this.spinner.rotation.z += this.spinSpeed * dt;

    // ── Transitions ──
    if ((prevSt & ST.LEAP) !== 0 && !leaping) this.onLeapLand();
    if ((prevSt & ST.DEPLOYING) !== 0 && (st & ST.DEPLOYING) === 0) {
      this.squash = 0.8;
      this.squashAge = 0;
    }

    this.updateStatusFx(p, st, dt, time, deploying, speed);
    this.updateOverlays(p, st, time);

    if (!p.concealed) this.pushTeamRing(p, fx, time);
  }

  private onLeapLand(): void {
    const { fx } = this.services;
    this.squash = 1;
    this.squashAge = 0;
    fx.ring(this.x, 0.08, this.z, 0.5, LEAP_RADIUS, 0.5, this.secondary, 3, 0.25);
    fx.ring(this.x, 0.08, this.z, 0.3, LEAP_RADIUS * 0.7, 0.7, FX_COLORS.white, 2, 0.12);
    fx.burst(P.dust, this.x, 0.2, this.z, FX_COLORS.dust, 22, 0, 0, 0, 1.2);
    fx.burst(P.spark, this.x, 0.3, this.z, this.secondary, 26, 0, 0.6, 0, 1.2);
    fx.debris.burst(1, this.x, 0.2, this.z, 10, FX_COLORS.dust, 7, 6, 1.2, 0.8);
    this.services.shake(0.45, this.x, this.z);
  }

  private pushTeamRing(p: ViewPlayer, fx: Fx, time: number): void {
    const color = p.isSelf ? FX_COLORS.self : p.isTeammate ? FX_COLORS.team : FX_COLORS.enemy;
    const ground = 0.07;
    const alt = Math.max(0, p.y);
    const fade = clamp(1 - alt / 25, 0.25, 1);
    fx.rings.push(p.x, ground, p.z, 0.95, color, 2, 0.85 * fade, 0.12, 0, 0, 0.1);
    if (p.isSelf) {
      fx.rings.push(p.x, ground, p.z, 1.22, FX_COLORS.white, 1.4, 0.55 * fade, 0.06, 12, time * 0.08);
      const c = Math.cos(p.aim);
      const sn = Math.sin(p.aim);
      fx.beams.push(p.x + c * 1.15, ground + 0.02, p.z + sn * 1.15, p.x + c * 1.75, ground + 0.02, p.z + sn * 1.75,
        FX_COLORS.self, 2.2, 0.9 * fade, 0.1, 0.02, 0.4, 0.5);
    }
  }

  private updateOverlays(p: ViewPlayer, st: number, time: number): void {
    const revealed = (st & ST.REVEALED) !== 0 && !p.isSelf && !p.isTeammate;
    if (revealed && !this.xray) this.xray = new Overlay(this.overlaySources, sharedXrayMaterial(), 50);
    this.xray?.set(revealed);

    const zone = (st & ST.IN_ZONE_DMG) !== 0;
    const buff = (st & ST.DMG_BUFF) !== 0;
    let tintAlpha = 0;
    let tintColor = FX_COLORS.white;
    if (this.hitFlash > 0.05) {
      tintAlpha = this.hitFlash * 0.9;
      tintColor = this.hitArmor ? FX_COLORS.armor : FX_COLORS.white;
    } else if (zone) {
      tintAlpha = 0.35 + 0.35 * Math.sin(time * 26) * Math.sin(time * 9.3);
      tintColor = FX_COLORS.danger;
    } else if (buff) {
      tintAlpha = 0.28 + 0.12 * Math.sin(time * 8);
      tintColor = DMG_BUFF_COLOR;
    }
    const wantTint = tintAlpha > 0.02 && !p.concealed;
    if (wantTint && !this.tint) {
      this.tintMaterial = fresnelOverlayMaterial(FX_COLORS.white, 0, true);
      this.tint = new Overlay(this.overlaySources, this.tintMaterial, 16);
    }
    if (this.tint && this.tintMaterial) {
      if (wantTint) {
        this.tintMaterial.uniforms.uColor!.value.copy(tintColor);
        this.tintMaterial.uniforms.uOpacity!.value = tintAlpha;
      }
      this.tint.set(wantTint);
    }
  }

  private updateStatusFx(p: ViewPlayer, st: number, dt: number, time: number, deploying: boolean, speed: number): void {
    const { fx, afterimages } = this.services;
    const hidden = p.concealed;
    const x = p.x;
    const y = p.y;
    const z = p.z;

    // DASH → afterimages + puff trail.
    if ((st & ST.DASH) !== 0 && !hidden) {
      this.dashEmit -= dt;
      if (this.dashEmit <= 0) {
        this.dashEmit = 0.035;
        afterimages.spawn(this.ghostParts, this.secondary, 0.32, 0.85, 0, 0.45);
        fx.burst(P.puff, x, 0.2, z, FX_COLORS.dust, 2);
      }
    }

    this.fxEmit += dt;
    const tick = this.fxEmit >= 1 / 30;
    if (tick) this.fxEmit = 0;

    // DMG_BUFF → green chart arrows + dashed ring.
    if ((st & ST.DMG_BUFF) !== 0 && !hidden) {
      fx.rings.push(x, 0.08, z, 1.35, DMG_BUFF_COLOR, 2.4, 0.8, 0.1, 8, time * 0.35);
      if (tick) fx.burst(P.arrow, x, y + 0.2, z, DMG_BUFF_COLOR, 1);
    }

    // RUSH → speed lines streaming opposite to motion.
    if ((st & ST.RUSH) !== 0 && !hidden) {
      const n = tick ? 3 : 0;
      const dirX = speed > 0.5 ? -p.vx / speed : 0;
      const dirZ = speed > 0.5 ? -p.vz / speed : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const r = 0.5 + Math.random() * 0.5;
        const color = i === 0 ? RUSH_COLOR_2 : RUSH_COLOR;
        fx.trail(P.speedLine, x + Math.cos(a) * r, y + 0.3 + Math.random() * 1.7, z + Math.sin(a) * r, color,
          dirX * 16, speed > 0.5 ? 0 : 6, dirZ * 16);
      }
      fx.rings.push(x, 0.08, z, 1.1, RUSH_COLOR, 2.2, 0.55, 0.3, 16, -time * 0.7);
    }

    // SLOWED → blue sonic rings hugging the body.
    if ((st & ST.SLOWED) !== 0 && !hidden) {
      for (let i = 0; i < 3; i++) {
        const ph = (time * 1.6 + i / 3) % 1;
        fx.rings.push(x, y + 0.2 + ph * 1.9, z, 0.6 + Math.sin(ph * Math.PI) * 0.35, FX_COLORS.slow, 2.4,
          Math.sin(ph * Math.PI) * 0.9, 0.16);
      }
    }

    // INVULN → golden vault shell.
    if ((st & ST.INVULN) !== 0) {
      fx.shells.push(x, y + 1.05, z, 1.35, ShellStyle.Vault, FX_COLORS.gold, 1.6, hidden ? 0.15 : 0.85,
        FX_COLORS.gold, 0.04, 2.2, 1.12, 0.3);
    }

    // REVEALED → spinning target lock under the enemy (x-ray silhouette handled by overlay).
    if ((st & ST.REVEALED) !== 0 && !p.isSelf && !p.isTeammate) {
      fx.rings.push(x, 0.09, z, 1.4, FX_COLORS.danger, 2.5, 0.9, 0.1, 4, time * 0.5);
    }

    // CHANNEL → heal swirl.
    if ((st & ST.CHANNEL) !== 0 && !hidden) {
      for (let k = 0; k < 2; k++) {
        const a = time * 7 + k * Math.PI;
        const r = 0.85;
        const hy = y + ((time * 0.9 + k * 0.5) % 1) * 2;
        fx.trail(P.swirl, x + Math.cos(a) * r, hy, z + Math.sin(a) * r, FX_COLORS.heal,
          -Math.sin(a) * 5, 1.5, Math.cos(a) * 5);
      }
      if (tick && Math.random() < 0.4) fx.burst(P.plus, x, y + 0.6, z, FX_COLORS.heal, 1);
      fx.rings.push(x, 0.08, z, 1.05, FX_COLORS.heal, 2, 0.6, 0.1, 10, time * 0.5, 0.15);
    }

    // DEPLOYING → glowing comet streak + wind lines.
    if (deploying) {
      this.trailEmit += dt;
      tmpVec.set(0, 1.1, 0);
      this.body.localToWorld(tmpVec);
      while (this.trailEmit > 1 / 60) {
        this.trailEmit -= 1 / 60;
        fx.trail(P.trail, tmpVec.x, tmpVec.y, tmpVec.z, this.secondary, 0, 0, 0, 1.2);
      }
      if (tick) {
        fx.trail(P.speedLine, x + (Math.random() - 0.5) * 2, y + Math.random() * 2, z + (Math.random() - 0.5) * 2,
          FX_COLORS.white, 0, 22, 0, 0.8);
      }
      // Landing shadow so everyone can read where they're falling.
      fx.rings.push(x, 0.08, z, 0.6 + Math.min(3, y * 0.05), this.secondary, 1.6, 0.5, 0.25, 6, time * 0.4);
    } else this.trailEmit = 0;

    // LASER_EYES → red eyes + beams along aim.
    const laser = (st & ST.LASER_EYES) !== 0 && !hidden;
    this.eyesMesh.visible = laser;
    if (laser) {
      const c = Math.cos(p.aim);
      const sn = Math.sin(p.aim);
      const flicker = 0.85 + Math.random() * 0.3;
      for (let side = -1; side <= 1; side += 2) {
        tmpVec.set(0.085 * side, 0.22, 0.3);
        this.head.localToWorld(tmpVec);
        const len = 16;
        fx.beams.push(tmpVec.x, tmpVec.y, tmpVec.z, tmpVec.x + c * len, tmpVec.y - 0.6, tmpVec.z + sn * len,
          FX_COLORS.laserEye, 3.2 * flicker, 0.9, 0.09, 0.05, 0.1, 0.8);
      }
      if (tick) {
        fx.burst(P.ember, tmpVec.x + c * 16, tmpVec.y - 0.6, tmpVec.z + sn * 16, FX_COLORS.laserEye, 1);
      }
    }

    // IN_ZONE_DMG → embers (the red flicker tint is an overlay).
    if ((st & ST.IN_ZONE_DMG) !== 0 && !hidden && tick && Math.random() < 0.6) {
      fx.burst(P.ember, x, y + 1, z, FX_COLORS.danger, 1);
    }
  }
}
