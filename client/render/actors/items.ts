// Loot + treasury chests. Everything is instanced (one InstancedMesh per model/material) and rebuilt every
// frame from the FrameView, so hundreds of floating items cost a fixed ~40 draw calls.

import * as THREE from 'three';
import {
  CONSUMABLES,
  WEAPONS,
  type AmmoType,
  type ConsumableId,
  type Rarity,
  type WeaponId,
} from '../../../shared/constants';
import type { ChestSnap, LootItem } from '../../../shared/protocol';
import type { FrameView } from '../../view';
import {
  clamp,
  col,
  easeOutBack,
  FX_COLORS,
  glowMaterial,
  litMaterial,
  PartBuilder,
  rarityColor,
  TAU,
} from './common';
import type { Fx } from './fx';
import { markRange } from './fx/particles';
import { P } from './fx/presets';
import { weaponModel } from './weapons';

const AMMO_RARITY: Record<AmmoType, Rarity> = { light: 0, shells: 1, heavy: 2, rocket: 3, energy: 4 };
const AMMO_GLOW: Record<AmmoType, WeaponId> = {
  light: 'pistol',
  shells: 'shotgun',
  heavy: 'ar',
  rocket: 'rocket',
  energy: 'laser',
};
/** Loot farther than this from the camera focus is skipped entirely. */
const LOOT_DRAW_DIST = 85;

export function lootRarity(item: LootItem): Rarity {
  if (item.k === 'weapon') return WEAPONS[item.w].rarity;
  if (item.k === 'cons') return CONSUMABLES[item.c].rarity;
  return AMMO_RARITY[item.a];
}

// ───────────────────────────── Item models ─────────────────────────────

interface ItemModel {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  scale: number;
}

const BRASS = col('#c9a13a');
const DARK = col('#1d2029');

function consumableModel(id: ConsumableId): ItemModel {
  const lit = new PartBuilder();
  const glow = new PartBuilder();
  const accent = rarityColor(CONSUMABLES[id].rarity);
  switch (id) {
    case 'stable': {
      const green = col('#27b86a');
      lit.cyl(0.34, 0.34, 0.08, green, 0, 0, 0, Math.PI / 2, 0, 0, 28);
      lit.torus(0.34, 0.03, col('#1a7f49'), 0, 0, 0);
      // "$" glyph on both faces.
      for (const face of [-1, 1]) {
        const zf = face * 0.045;
        glow
          .box(0.035, 0.44, 0.01, FX_COLORS.white, 0, 0, zf, 0, 0, 0, 0, 2.2)
          .box(0.2, 0.04, 0.01, FX_COLORS.white, 0, 0.13, zf, 0, 0, 0, 0, 2.2)
          .box(0.2, 0.04, 0.01, FX_COLORS.white, 0, 0, zf, 0, 0, 0, 0, 2.2)
          .box(0.2, 0.04, 0.01, FX_COLORS.white, 0, -0.13, zf, 0, 0, 0, 0, 2.2)
          .box(0.04, 0.13, 0.01, FX_COLORS.white, -0.08, 0.065, zf, 0, 0, 0, 0, 2.2)
          .box(0.04, 0.13, 0.01, FX_COLORS.white, 0.08, -0.065, zf, 0, 0, 0, 0, 2.2);
      }
      glow.torus(0.3, 0.012, FX_COLORS.heal, 0, 0, 0.045, 0, 0, 0, 2.5);
      glow.torus(0.3, 0.012, FX_COLORS.heal, 0, 0, -0.045, 0, 0, 0, 2.5);
      return { lit: lit.build(), glow: glow.build(), scale: 1.1 };
    }
    case 'medkit': {
      const ice = col('#bfe6ff');
      const e = 0.46;
      const h = e / 2;
      for (const a of [-h, h]) {
        for (const b of [-h, h]) {
          lit.box(e, 0.05, 0.05, ice, 0, a, b, 0, 0, 0, 0.01);
          lit.box(0.05, e, 0.05, ice, a, 0, b, 0, 0, 0, 0.01);
          lit.box(0.05, 0.05, e, ice, a, b, 0, 0, 0, 0, 0.01);
        }
      }
      glow.box(0.3, 0.3, 0.3, col('#6fd8ff'), 0, 0, 0, 0, 0, 0, 0.04, 2.4);
      glow.box(0.34, 0.34, 0.34, accent, 0, 0, 0, 0.6, 0.6, 0, 0.02, 0.6);
      return { lit: lit.build(), glow: glow.build(), scale: 1 };
    }
    case 'armorS': {
      const paper = col('#efe4c6');
      const ink = col('#3b3325');
      lit.box(0.44, 0.56, 0.014, paper, 0, 0, 0, 0, 0, 0.05, 0.002);
      lit.box(0.44, 0.56, 0.014, col('#d8cba8'), 0.05, -0.03, -0.03, 0, 0, -0.08, 0.002);
      for (let row = 0; row < 6; row++) {
        for (let c = 0; c < 2; c++) {
          lit.box(0.15, 0.025, 0.01, ink, -0.1 + c * 0.2, 0.19 - row * 0.075, 0.012, 0, 0, 0.05, 0.001);
        }
      }
      glow
        .box(0.46, 0.012, 0.012, accent, 0, 0.29, 0.01, 0, 0, 0.05, 0, 2.4)
        .box(0.46, 0.012, 0.012, accent, 0, -0.29, 0.01, 0, 0, 0.05, 0, 2.4)
        .box(0.012, 0.58, 0.012, accent, 0.23, 0, 0.01, 0, 0, 0.05, 0, 2.4)
        .box(0.012, 0.58, 0.012, accent, -0.23, 0, 0.01, 0, 0, 0.05, 0, 2.4);
      return { lit: lit.build(), glow: glow.build(), scale: 1.05 };
    }
    case 'armorL': {
      lit
        .box(0.17, 0.52, 0.07, col('#15161c'), 0, 0, 0, 0, 0, 0, 0.03)
        .box(0.18, 0.4, 0.02, col('#b8bfcc'), 0, -0.08, 0.05, 0, 0, 0, 0.008)
        .cyl(0.045, 0.045, 0.2, col('#b8bfcc'), 0, -0.26, 0.02, 0, 0, Math.PI / 2, 14)
        .box(0.1, 0.08, 0.04, col('#8b92a0'), 0, 0.3, 0, 0, 0, 0, 0.01);
      glow
        .box(0.11, 0.16, 0.006, col('#dff4ff'), 0, 0.14, 0.037, 0, 0, 0, 0, 1.9)
        .sphere(0.025, accent, 0.09, 0.05, 0, 1, 1, 1, 3)
        .sphere(0.025, accent, -0.09, 0.05, 0, 1, 1, 1, 3)
        .box(0.004, 0.46, 0.074, accent, 0.087, 0, 0, 0, 0, 0, 0, 2.2);
      return { lit: lit.build(), glow: glow.build(), scale: 1.35 };
    }
  }
}

function ammoModel(a: AmmoType): ItemModel {
  const lit = new PartBuilder();
  const glow = new PartBuilder();
  const label = col(WEAPONS[AMMO_GLOW[a]].color);
  switch (a) {
    case 'light':
      lit.box(0.36, 0.22, 0.26, col('#a88a2c'), 0, 0, 0, 0, 0, 0, 0.03);
      for (let i = 0; i < 3; i++) lit.cyl(0.03, 0.03, 0.12, BRASS, -0.1 + i * 0.1, 0.16, 0, 0, 0, 0, 8);
      glow.box(0.365, 0.04, 0.265, label, 0, 0.02, 0, 0, 0, 0, 0, 2.2);
      break;
    case 'shells':
      lit.box(0.42, 0.2, 0.28, col('#8e1f26'), 0, 0, 0, 0, 0, 0, 0.03);
      for (let i = 0; i < 4; i++) {
        lit.cyl(0.045, 0.045, 0.16, col('#d0302f'), -0.14 + i * 0.093, 0.18, 0, 0, 0, 0, 10);
        lit.cyl(0.048, 0.048, 0.04, BRASS, -0.14 + i * 0.093, 0.1, 0, 0, 0, 0, 10);
      }
      glow.box(0.425, 0.035, 0.285, label, 0, -0.03, 0, 0, 0, 0, 0, 2.2);
      break;
    case 'heavy':
      lit.box(0.46, 0.26, 0.3, col('#44512f'), 0, 0, 0, 0, 0, 0, 0.03);
      lit.box(0.12, 0.05, 0.05, DARK, 0, 0.15, 0);
      for (let i = 0; i < 4; i++) lit.cyl(0.028, 0.02, 0.16, BRASS, -0.15 + i * 0.1, 0.2, 0.08, 0, 0, 0, 8);
      glow.box(0.465, 0.04, 0.305, label, 0, -0.04, 0, 0, 0, 0, 0, 2.2);
      break;
    case 'rocket':
      lit.cyl(0.1, 0.1, 0.5, col('#e5e7ee'), 0, 0, 0, 0, 0, Math.PI / 2, 14);
      lit.cone(0.1, 0.2, col('#ff5a36'), 0.35, 0, 0, 0, 0, -Math.PI / 2, 14);
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TAU;
        lit.box(0.14, 0.012, 0.1, DARK, -0.22, Math.cos(ang) * 0.12, Math.sin(ang) * 0.12, ang, 0, 0, 0);
      }
      glow.torus(0.102, 0.014, label, 0.08, 0, 0, 0, Math.PI / 2, 0, 2.6);
      glow.torus(0.102, 0.014, label, -0.05, 0, 0, 0, Math.PI / 2, 0, 2.6);
      break;
    case 'energy':
      lit.cyl(0.13, 0.13, 0.08, col('#e8e8f0'), 0, 0.2, 0, 0, 0, 0, 16);
      lit.cyl(0.13, 0.13, 0.08, col('#e8e8f0'), 0, -0.2, 0, 0, 0, 0, 16);
      lit.cyl(0.05, 0.05, 0.06, DARK, 0, 0.27, 0, 0, 0, 0, 10);
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TAU;
        lit.box(0.02, 0.34, 0.02, DARK, Math.cos(ang) * 0.12, 0, Math.sin(ang) * 0.12);
      }
      glow.cyl(0.09, 0.09, 0.32, label, 0, 0, 0, 0, 0, 0, 16, 3);
      break;
  }
  return { lit: lit.build(), glow: glow.build(), scale: 1.15 };
}

// ───────────────────────────── Instanced model slots ─────────────────────────────

class InstancedPair {
  readonly lit: THREE.InstancedMesh;
  readonly glow: THREE.InstancedMesh;
  count = 0;

  constructor(model: ItemModel, capacity: number, group: THREE.Group, castShadow: boolean) {
    this.lit = new THREE.InstancedMesh(model.lit, litMaterial(), capacity);
    this.glow = new THREE.InstancedMesh(model.glow, glowMaterial(), capacity);
    for (const m of [this.lit, this.glow]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      group.add(m);
    }
    this.glow.setColorAt(0, FX_COLORS.white);
    this.glow.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.lit.castShadow = castShadow;
  }

  get capacity(): number {
    return this.lit.instanceMatrix.count;
  }

  push(matrix: THREE.Matrix4, glowColor: THREE.Color): void {
    if (this.count >= this.capacity) return;
    this.lit.setMatrixAt(this.count, matrix);
    this.glow.setMatrixAt(this.count, matrix);
    this.glow.setColorAt(this.count, glowColor);
    this.count++;
  }

  commit(): void {
    const n = this.count;
    this.lit.count = n;
    this.glow.count = n;
    markRange(this.lit.instanceMatrix, n * 16);
    markRange(this.glow.instanceMatrix, n * 16);
    markRange(this.glow.instanceColor!, n * 3);
    this.count = 0;
  }
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const lidMatrix = new THREE.Matrix4();

function outlineMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ───────────────────────────── Loot ─────────────────────────────

type LootKey = `w:${WeaponId}` | `c:${ConsumableId}` | `a:${AmmoType}`;

function lootKey(item: LootItem): LootKey {
  if (item.k === 'weapon') return `w:${item.w}`;
  if (item.k === 'cons') return `c:${item.c}`;
  return `a:${item.a}`;
}

export class LootRenderer {
  readonly group = new THREE.Group();
  private readonly pairs = new Map<LootKey, InstancedPair>();
  private readonly models = new Map<LootKey, ItemModel>();
  private readonly outline: THREE.Mesh;
  private readonly outlineMat: THREE.MeshBasicMaterial;
  /** Spawn time per loot id (pop-in animation). */
  private readonly born = new Map<number, number>();
  private readonly alive = new Set<number>();

  constructor() {
    for (const w of Object.keys(WEAPONS) as WeaponId[]) {
      const m = weaponModel(w);
      this.register(`w:${w}`, { lit: m.lootLit, glow: m.lootGlow, scale: 2.1 }, 48);
    }
    for (const c of Object.keys(CONSUMABLES) as ConsumableId[]) this.register(`c:${c}`, consumableModel(c), 72);
    for (const a of Object.keys(AMMO_RARITY) as AmmoType[]) this.register(`a:${a}`, ammoModel(a), 96);
    this.outlineMat = outlineMaterial();
    this.outline = new THREE.Mesh(undefined, this.outlineMat);
    this.outline.visible = false;
    this.outline.renderOrder = 12;
    this.group.add(this.outline);
  }

  private register(key: LootKey, model: ItemModel, capacity: number): void {
    this.models.set(key, model);
    this.pairs.set(key, new InstancedPair(model, capacity, this.group, false));
  }

  clear(): void {
    this.born.clear();
  }

  update(view: FrameView, fx: Fx, time: number): void {
    const fxz = view.focus;
    this.alive.clear();
    this.outline.visible = false;
    for (const item of view.loot) {
      this.alive.add(item.id);
      if (!this.born.has(item.id)) this.born.set(item.id, time);
      const dx = item.x - fxz.x;
      const dz = item.z - fxz.z;
      if (dx * dx + dz * dz > LOOT_DRAW_DIST * LOOT_DRAW_DIST) continue;
      const key = lootKey(item);
      const pair = this.pairs.get(key)!;
      const model = this.models.get(key)!;
      const rarity = lootRarity(item);
      const rc = rarityColor(rarity);
      const age = time - this.born.get(item.id)!;
      const pop = age < 0.45 ? Math.max(0.02, easeOutBack(clamp(age / 0.45, 0, 1))) : 1;
      const highlighted = view.highlightLoot === item.id;
      const hover = 0.8 + Math.sin(time * 2.2 + item.id * 1.7) * 0.12;
      const spinY = time * 1.3 + item.id * 2.39;
      const tilt = item.k === 'weapon' ? 0.35 : 0.15;
      const focusPulse = highlighted ? 1.15 + Math.sin(time * 8) * 0.04 : 1;
      const s = model.scale * (item.k === 'weapon' ? 1 : 1.35) * pop * focusPulse;
      tmpEuler.set(tilt * Math.sin(time + item.id), spinY, item.k === 'weapon' ? 0.25 : 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(item.x, hover, item.z);
      if (item.k === 'weapon') {
        // Rotate around the weapon's visual center rather than its grip.
        const len = weaponModel(item.w).muzzleZ;
        tmpScale.set(0, 0, -len * 0.4 * s).applyQuaternion(tmpQuat);
        tmpPos.add(tmpScale);
      }
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.set(s, s, s));
      const pulse = highlighted ? 1.6 + Math.sin(time * 10) * 0.4 : 1;
      pair.push(tmpMatrix, tmpColor.setRGB(pulse, pulse, pulse));

      // Rarity light pillar + ground ring.
      const pillar = 1.8 + rarity * 1.3;
      const beamAlpha = (0.35 + rarity * 0.08) * pop;
      const pillarWidth = 0.28 + rarity * 0.04;
      fx.beams.push(item.x, 0.05, item.z, item.x, pillar, item.z, rc, 1.7, beamAlpha, pillarWidth, 0.06, 0, 0.25);
      const ringPulse = highlighted ? 1 + Math.sin(time * 9) * 0.08 : 1;
      fx.rings.push(item.x, 0.07, item.z, 0.7 * ringPulse, rc, highlighted ? 3.2 : 2, 0.85 * pop, 0.16, 0, 0, 0.35);
      if (rarity >= 3) fx.rings.push(item.x, 0.07, item.z, 1.0, rc, 1.8, 0.5, 0.05, 10, time * 0.2);
      if (highlighted) {
        const r = 1.25 + Math.sin(time * 6) * 0.1;
        fx.rings.push(item.x, 0.07, item.z, r, FX_COLORS.white, 2.4, 0.9, 0.06, 6, -time * 0.4);
        this.outline.geometry = model.lit;
        this.outline.matrix.copy(tmpMatrix);
        const k = 1.12;
        this.outline.matrix.scale(tmpScale.set(k, k, k));
        this.outline.matrixAutoUpdate = false;
        this.outline.matrixWorldNeedsUpdate = true;
        this.outlineMat.color.copy(rc).multiplyScalar(2.2 + Math.sin(time * 10) * 0.6);
        this.outline.visible = true;
        if (Math.random() < 0.15) fx.burst(P.sparkle, item.x, hover, item.z, rc, 1);
      }
    }
    for (const pair of this.pairs.values()) pair.commit();
    for (const id of this.born.keys()) if (!this.alive.has(id)) this.born.delete(id);
  }
}

// ───────────────────────────── Chests ─────────────────────────────

const OBSIDIAN = col('#17121f');
const OBSIDIAN_EDGE = col('#2a2138');
const GOLD = col('#e2b03c');
const CRATE = col('#2b303b');
const CHEST_W = 1.3;
const CHEST_H = 0.7;
const CHEST_D = 0.86;
const CRATE_E = 1.4;

function chestModels(): { base: ItemModel; lid: ItemModel; closed: THREE.BufferGeometry } {
  const gold = GOLD;
  const hot = FX_COLORS.gold;
  const base = new PartBuilder()
    .box(CHEST_W, CHEST_H, CHEST_D, OBSIDIAN, 0, CHEST_H / 2, 0, 0, 0, 0, 0.05)
    .box(CHEST_W + 0.04, 0.08, CHEST_D + 0.04, gold, 0, 0.04, 0, 0, 0, 0, 0.02)
    .box(CHEST_W + 0.04, 0.06, CHEST_D + 0.04, gold, 0, CHEST_H - 0.03, 0, 0, 0, 0, 0.02);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (CHEST_W / 2 - 0.02);
      const pz = sz * (CHEST_D / 2 - 0.02);
      base.box(0.1, CHEST_H, 0.1, gold, px, CHEST_H / 2, pz, 0, 0, 0, 0.02);
    }
  }
  base.box(0.26, 0.3, 0.06, gold, 0, CHEST_H - 0.14, CHEST_D / 2 + 0.02, 0, 0, 0, 0.03);
  const baseGlow = new PartBuilder()
    .box(0.07, 0.11, 0.02, hot, 0, CHEST_H - 0.16, CHEST_D / 2 + 0.055, 0, 0, 0, 0, 3.4)
    .box(CHEST_W - 0.12, 0.025, 0.02, hot, 0, CHEST_H - 0.07, CHEST_D / 2 + 0.005, 0, 0, 0, 0, 2.4)
    .box(CHEST_W - 0.12, 0.025, 0.02, hot, 0, CHEST_H - 0.07, -CHEST_D / 2 - 0.005, 0, 0, 0, 0, 2.4)
    .box(0.02, 0.025, CHEST_D - 0.12, hot, CHEST_W / 2 + 0.005, CHEST_H - 0.07, 0, 0, 0, 0, 0, 2.4)
    .box(0.02, 0.025, CHEST_D - 0.12, hot, -CHEST_W / 2 - 0.005, CHEST_H - 0.07, 0, 0, 0, 0, 0, 2.4)
    .box(CHEST_W - 0.2, 0.04, CHEST_D - 0.2, hot, 0, CHEST_H - 0.02, 0, 0, 0, 0, 0, 3);

  // Lid: half-cylinder vault whose hinge is at its back edge (origin), extending toward +z.
  const r = CHEST_D / 2;
  const lidShell = (radius: number, len: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(radius, radius, len, 18, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0, r);
    return g;
  };
  const lid = new PartBuilder()
    .add(lidShell(r, CHEST_W), OBSIDIAN_EDGE)
    .add(lidShell(r + 0.025, 0.09), gold, 1, 0.42)
    .add(lidShell(r + 0.025, 0.09), gold, 1, -0.42)
    .add(lidShell(r + 0.025, 0.09), gold, 1, 0);
  const lidGlow = new PartBuilder()
    .cyl(0.13, 0.13, 0.02, hot, 0, r + 0.02, r + 0.02, 0, 0, 0, 20, 2.8)
    .torus(0.13, 0.012, FX_COLORS.white, 0, r + 0.035, r + 0.02, Math.PI / 2, 0, 0, 2.2);
  const closed = new PartBuilder()
    .box(CHEST_W, CHEST_H, CHEST_D, OBSIDIAN, 0, CHEST_H / 2, 0)
    .add(lidShell(r, CHEST_W), OBSIDIAN, 1, 0, CHEST_H, -r)
    .build();
  return {
    base: { lit: base.build(), glow: baseGlow.build(), scale: 1 },
    lid: { lit: lid.build(), glow: lidGlow.build(), scale: 1 },
    closed,
  };
}

export interface CrateModels {
  base: ItemModel;
  lid: ItemModel;
  /** Parachute canopy + lines, origin at the crate's top center. */
  chute: THREE.BufferGeometry;
  /** Closed silhouette for the highlight outline. */
  closed: THREE.BufferGeometry;
}

function crateModels(): CrateModels {
  const e = CRATE_E;
  const hot = rarityColor(4);
  const stripe = col('#f2c230');
  const base = new PartBuilder().box(e, e * 0.8, e, CRATE, 0, e * 0.4, 0, 0, 0, 0, 0.06);
  for (const sx of [-1, 1]) {
    base.box(0.1, e * 0.8, e + 0.03, stripe, sx * (e / 2 - 0.12), e * 0.4, 0, 0, 0, 0, 0.02);
    base.box(e + 0.03, e * 0.8, 0.1, stripe, 0, e * 0.4, sx * (e / 2 - 0.12), 0, 0, 0, 0.02);
  }
  const baseGlow = new PartBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    // Glowing ₿ plates on each side.
    const face = e / 2 + 0.01;
    baseGlow.box(0.34, 0.34, 0.02, hot, Math.sin(a) * face, e * 0.42, Math.cos(a) * face, 0, a, 0, 0.05, 2.6);
  }
  baseGlow.box(e + 0.02, 0.04, e + 0.02, hot, 0, e * 0.79, 0, 0, 0, 0, 0, 2.4);
  const lid = new PartBuilder()
    .box(e + 0.06, 0.12, e + 0.06, CRATE, 0, 0.06, 0, 0, 0, 0, 0.03)
    .box(e * 0.6, 0.05, 0.12, stripe, 0, 0.13, 0)
    .box(0.12, 0.05, e * 0.6, stripe, 0, 0.13, 0);
  const lidGlow = new PartBuilder().sphere(0.08, col('#ff3b3b'), 0.55, 0.16, 0.55, 1, 1, 1, 3.5);
  // Parachute canopy (alternating gores) + lines; origin at crate top center.
  const canopy = new PartBuilder();
  const gores = 10;
  for (let i = 0; i < gores; i++) {
    const g = new THREE.SphereGeometry(2.4, 4, 8, (i / gores) * TAU, TAU / gores, 0, Math.PI / 2.1);
    canopy.add(g, i % 2 ? col('#f5f5f5') : stripe, 1, 0, 3.2, 0, 0, 0, 0, 1, 0.55, 1);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    canopy.limb(0, 0.05, 0, Math.cos(a) * 2.25, 3.4, Math.sin(a) * 2.25, 0.012, col('#d0d0d0'));
  }
  const closed = new PartBuilder()
    .box(e, e * 0.8, e, CRATE, 0, e * 0.4, 0)
    .box(e + 0.06, 0.12, e + 0.06, CRATE, 0, e * 0.8 + 0.06, 0)
    .build();
  return {
    base: { lit: base.build(), glow: baseGlow.build(), scale: 1 },
    lid: { lit: lid.build(), glow: lidGlow.build(), scale: 1 },
    chute: canopy.build(),
    closed,
  };
}

let crateCache: CrateModels | null = null;

/** Airdrop crate + parachute geometry (shared with the falling airdrop ent). */
export function crateGeometry(): CrateModels {
  crateCache ??= crateModels();
  return crateCache;
}

interface ChestAnim {
  seen: number; // time first seen
  openT: number; // 0 closed … 1 open
  wasOpen: boolean;
  rugAge: number; // −1 = not rugged; else seconds since the rug pull
  flipDir: number;
}

export class ChestRenderer {
  readonly group = new THREE.Group();
  private readonly chestBase: InstancedPair;
  private readonly chestLid: InstancedPair;
  private readonly crateBase: InstancedPair;
  private readonly crateLid: InstancedPair;
  private readonly chute: THREE.InstancedMesh;
  private chuteCount = 0;
  private readonly anims = new Map<number, ChestAnim>();
  private readonly alive = new Set<number>();
  private readonly outline: THREE.Mesh;
  private readonly outlineMat: THREE.MeshBasicMaterial;
  private readonly chestClosed: THREE.BufferGeometry;
  private readonly crateClosed: THREE.BufferGeometry;
  private readonly flare = new THREE.Color();
  private readonly allPairs: InstancedPair[];

  constructor() {
    const chest = chestModels();
    const crate = crateGeometry();
    this.chestBase = new InstancedPair(chest.base, 64, this.group, true);
    this.chestLid = new InstancedPair(chest.lid, 64, this.group, true);
    this.crateBase = new InstancedPair(crate.base, 12, this.group, true);
    this.crateLid = new InstancedPair(crate.lid, 12, this.group, true);
    this.allPairs = [this.chestBase, this.chestLid, this.crateBase, this.crateLid];
    this.chute = new THREE.InstancedMesh(crate.chute, litMaterial(), 12);
    this.chute.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chute.frustumCulled = false;
    this.chute.count = 0;
    this.group.add(this.chute);
    this.chestClosed = chest.closed;
    this.crateClosed = crate.closed;
    this.outlineMat = outlineMaterial();
    this.outline = new THREE.Mesh(chest.closed, this.outlineMat);
    this.outline.visible = false;
    this.outline.matrixAutoUpdate = false;
    this.outline.renderOrder = 12;
    this.group.add(this.outline);
  }

  clear(): void {
    this.anims.clear();
  }

  /** Called on the 'chest' event: starts the lid animation (and the rug flip). */
  opened(id: number, rug: boolean): void {
    const a = this.anims.get(id);
    if (!a) return;
    a.wasOpen = true;
    if (rug) {
      a.rugAge = 0;
      a.openT = 0;
      a.flipDir = Math.random() < 0.5 ? -1 : 1;
    }
  }

  update(view: FrameView, fx: Fx, time: number, dt: number): void {
    this.alive.clear();
    this.outline.visible = false;
    this.chuteCount = 0;
    for (const c of view.chests) {
      this.alive.add(c.id);
      let a = this.anims.get(c.id);
      if (!a) {
        a = { seen: time, openT: c.open ? 1 : 0, wasOpen: c.open, rugAge: -1, flipDir: 1 };
        this.anims.set(c.id, a);
      }
      if (c.open) a.wasOpen = true;
      // Rugged chests stay shut (the whole chest flips instead of the lid opening).
      if (a.rugAge < 0) a.openT = Math.min(1, a.openT + (a.wasOpen ? dt / 0.45 : 0));
      if (a.rugAge >= 0) a.rugAge += dt;
      this.drawChest(c, a, view, fx, time);
    }
    for (const p of this.allPairs) p.commit();
    this.chute.count = this.chuteCount;
    markRange(this.chute.instanceMatrix, this.chuteCount * 16);
    for (const id of this.anims.keys()) if (!this.alive.has(id)) this.anims.delete(id);
  }

  private drawChest(c: ChestSnap, a: ChestAnim, view: FrameView, fx: Fx, time: number): void {
    const highlighted = view.highlightChest === c.id && !c.open;
    const spawnPop = Math.max(0.02, easeOutBack(clamp((time - a.seen) / 0.4, 0, 1)));
    // Rug flip: jump, spin 1.5 turns, land upside down.
    let lift = 0;
    let flip = 0;
    if (a.rugAge >= 0) {
      const t = clamp(a.rugAge / 0.9, 0, 1);
      lift = Math.sin(t * Math.PI) * 3.2;
      flip = a.flipDir * t * Math.PI * 3;
    }
    const dim = c.open ? 0.22 : highlighted ? 1.6 + Math.sin(time * 10) * 0.4 : 1;
    tmpColor.setRGB(dim, dim, dim);
    const facing = c.id * 1.618;
    tmpEuler.set(flip, facing, 0);
    tmpQuat.setFromEuler(tmpEuler);
    // Once flipped upside down the model hangs below its origin; lift it back onto the ground.
    const baseY = lift + (a.rugAge > 0.9 ? (c.airdrop ? CRATE_E * 0.8 : CHEST_H) : 0);
    tmpPos.set(c.x, baseY, c.z);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.set(spawnPop, spawnPop, spawnPop));
    const base = c.airdrop ? this.crateBase : this.chestBase;
    const lidPair = c.airdrop ? this.crateLid : this.chestLid;
    base.push(tmpMatrix, tmpColor);

    // Lid transform relative to the base.
    if (c.airdrop) {
      // Crate lid pops up and slides off to one side.
      const t = easeOutBack(a.openT);
      lidMatrix.makeRotationZ(-0.9 * t);
      const hop = 0.6 * Math.sin(Math.min(1, a.openT) * Math.PI);
      lidMatrix.setPosition(CRATE_E * 0.55 * t, CRATE_E * 0.8 + hop - 0.55 * t, 0);
    } else {
      lidMatrix.makeRotationX(-1.95 * easeOutBack(a.openT));
      lidMatrix.setPosition(0, CHEST_H, -CHEST_D / 2);
    }
    lidMatrix.premultiply(tmpMatrix);
    lidPair.push(lidMatrix, tmpColor);

    if (c.airdrop && !c.open) {
      // Draped chute next to the crate + red smoke flare + beacon.
      if (this.chuteCount < this.chute.instanceMatrix.count) {
        tmpEuler.set(1.35, facing, 0.2);
        tmpQuat.setFromEuler(tmpEuler);
        tmpMatrix.compose(tmpPos.set(c.x + 1.8, 0.15, c.z + 1.2), tmpQuat, tmpScale.set(0.9, 0.35, 0.9));
        this.chute.setMatrixAt(this.chuteCount++, tmpMatrix);
      }
      if (Math.random() < 0.5) {
        this.flare.setRGB(0.45, 0.04, 0.05);
        fx.trail(P.smoke, c.x + 0.9, 0.3, c.z - 0.9, this.flare, 0.4, 2.2, 0.2, 0.45);
      }
      fx.beams.push(c.x, 0.1, c.z, c.x, 28, c.z, rarityColor(4), 1.8, 0.45, 0.5, 0.15, 0, 0.3);
      if (Math.random() < 0.3) fx.burst(P.sparkle, c.x, 1.4, c.z, rarityColor(4), 1, 0, 0, 0, 1.4);
    }
    if (!c.open) {
      const ringR = c.airdrop ? 1.6 : 1.15;
      fx.rings.push(c.x, 0.07, c.z, ringR, FX_COLORS.gold, highlighted ? 3.2 : 2, 0.6, 0.12, 0, 0, 0.3);
      if (!c.airdrop && Math.random() < 0.06) fx.burst(P.sparkle, c.x, 0.9, c.z, FX_COLORS.gold, 1, 0, 0, 0, 0.8);
    }
    if (highlighted) {
      this.outline.geometry = c.airdrop ? this.crateClosed : this.chestClosed;
      const k = 1.08;
      tmpQuat.setFromEuler(tmpEuler.set(0, facing, 0));
      this.outline.matrix.compose(tmpPos.set(c.x, 0, c.z), tmpQuat, tmpScale.set(k, k, k));
      this.outline.matrixWorldNeedsUpdate = true;
      this.outlineMat.color.copy(FX_COLORS.gold).multiplyScalar(2 + Math.sin(time * 10) * 0.6);
      this.outline.visible = true;
      fx.rings.push(c.x, 0.07, c.z, 1.6 + Math.sin(time * 6) * 0.1, FX_COLORS.white, 2.4, 0.9, 0.06, 6, -time * 0.4);
    }
  }

  /** World position of a chest (for event FX); null if unknown. */
  find(view: FrameView, id: number): ChestSnap | null {
    for (const c of view.chests) if (c.id === id) return c;
    return null;
  }
}
