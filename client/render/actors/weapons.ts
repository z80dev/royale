// Procedural weapon models (one silhouette per WeaponId). Built once, shared by held weapons (Mesh) and
// floating loot (InstancedMesh). Model space: grip at the origin, barrel along +z, y up, meters.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, type WeaponId } from '../../../shared/constants';
import { col, PartBuilder, rarityColor, TAU } from './common';

export interface WeaponModel {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** Rotating barrel cluster (minigun), spun around the z axis at (0, spinY). */
  spin: { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry; y: number } | null;
  /** lit + spin merged (static loot rendering). */
  lootLit: THREE.BufferGeometry;
  lootGlow: THREE.BufferGeometry;
  muzzleY: number;
  muzzleZ: number;
}

const GUNMETAL = col('#23262f');
const STEEL = col('#4a5060');
const WOOD = col('#6b3a26');
const WHITE = col('#e6e8f0');
const BLACK = col('#121319');

const GLOW = 2.6;

function pistol(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color, tracer: THREE.Color): number[] {
  lit
    .box(0.09, 0.1, 0.34, STEEL, 0, 0.1, 0.1)
    .box(0.08, 0.06, 0.26, GUNMETAL, 0, 0.03, 0.08)
    .box(0.075, 0.2, 0.11, GUNMETAL, 0, -0.07, -0.02, 0.28, 0, 0)
    .tube(0.022, 0.06, BLACK, 0, 0.1, 0.285, 10)
    .torus(0.04, 0.008, GUNMETAL, 0, -0.005, 0.06, 0, Math.PI / 2, 0);
  glow
    .box(0.006, 0.018, 0.28, accent, 0.047, 0.11, 0.1, 0, 0, 0, 0, GLOW)
    .box(0.006, 0.018, 0.28, accent, -0.047, 0.11, 0.1, 0, 0, 0, 0, GLOW)
    .sphere(0.012, tracer, 0, 0.16, -0.04, 1, 1, 1, 3);
  return [0.1, 0.32];
}

function smg(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color): number[] {
  lit
    .box(0.11, 0.15, 0.42, GUNMETAL, 0, 0.07, 0.12)
    .box(0.1, 0.05, 0.3, STEEL, 0, 0.165, 0.1)
    .tube(0.036, 0.18, STEEL, 0, 0.08, 0.42, 10)
    .tube(0.018, 0.06, BLACK, 0, 0.08, 0.53, 8)
    .box(0.06, 0.26, 0.08, STEEL, 0, -0.1, 0.22, 0.12, 0, 0)
    .box(0.07, 0.17, 0.09, GUNMETAL, 0, -0.06, -0.03, 0.3, 0, 0)
    .box(0.05, 0.06, 0.22, GUNMETAL, 0, 0.07, -0.18)
    .box(0.04, 0.12, 0.05, GUNMETAL, 0, 0.03, -0.29);
  glow
    // MEV bot "eyes" on both sides of the receiver.
    .sphere(0.024, accent, 0.058, 0.1, 0.2, 0.5, 1, 1, GLOW * 1.2)
    .sphere(0.024, accent, -0.058, 0.1, 0.2, 0.5, 1, 1, GLOW * 1.2)
    .box(0.086, 0.008, 0.26, accent, 0, 0.196, 0.1, 0, 0, 0, 0, GLOW)
    .torus(0.037, 0.006, accent, 0, 0.08, 0.5, 0, 0, 0, GLOW);
  return [0.08, 0.56];
}

function shotgun(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color): number[] {
  lit
    .tube(0.036, 0.72, GUNMETAL, 0.038, 0.1, 0.38, 12)
    .tube(0.036, 0.72, GUNMETAL, -0.038, 0.1, 0.38, 12)
    .box(0.13, 0.13, 0.3, STEEL, 0, 0.08, 0.02)
    .box(0.12, 0.08, 0.22, WOOD, 0, 0.03, 0.36)
    .box(0.09, 0.15, 0.4, WOOD, 0, 0.02, -0.3, -0.14, 0, 0)
    .box(0.07, 0.15, 0.08, GUNMETAL, 0, -0.06, -0.06, 0.35, 0, 0)
    .box(0.1, 0.03, 0.06, BLACK, 0, 0.1, 0.735);
  glow
    .torus(0.04, 0.008, accent, 0.038, 0.1, 0.72, 0, 0, 0, GLOW)
    .torus(0.04, 0.008, accent, -0.038, 0.1, 0.72, 0, 0, 0, GLOW)
    .box(0.14, 0.02, 0.2, accent, 0, 0.12, 0.02, 0, 0, 0, 0, GLOW * 0.9);
  return [0.1, 0.76];
}

function ar(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color): number[] {
  lit
    .box(0.1, 0.16, 0.5, GUNMETAL, 0, 0.08, 0.1)
    .box(0.095, 0.11, 0.32, STEEL, 0, 0.09, 0.5)
    .tube(0.022, 0.26, GUNMETAL, 0, 0.1, 0.78, 10)
    .tube(0.036, 0.08, BLACK, 0, 0.1, 0.92, 10)
    .box(0.07, 0.25, 0.1, STEEL, 0, -0.09, 0.2, 0.3, 0, 0)
    .box(0.08, 0.15, 0.32, GUNMETAL, 0, 0.05, -0.28)
    .box(0.07, 0.16, 0.08, GUNMETAL, 0, -0.06, -0.04, 0.3, 0, 0)
    .box(0.06, 0.07, 0.09, BLACK, 0, 0.2, 0.12)
    .box(0.03, 0.012, 0.3, BLACK, 0, 0.15, 0.5);
  glow
    .torus(0.024, 0.005, accent, 0, 0.215, 0.165, 0, 0, 0, GLOW * 1.3)
    .box(0.004, 0.02, 0.28, accent, 0.049, 0.1, 0.5, 0, 0, 0, 0, GLOW)
    .box(0.004, 0.02, 0.28, accent, -0.049, 0.1, 0.5, 0, 0, 0, 0, GLOW)
    .box(0.09, 0.02, 0.1, accent, 0, 0.1, -0.4, 0, 0, 0, 0, GLOW * 0.8);
  return [0.1, 0.97];
}

function sniper(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color, tracer: THREE.Color): number[] {
  lit
    .box(0.09, 0.13, 0.46, GUNMETAL, 0, 0.08, 0.05)
    .tube(0.02, 0.84, STEEL, 0, 0.1, 0.7, 10)
    .tube(0.036, 0.11, BLACK, 0, 0.1, 1.13, 10)
    .tube(0.046, 0.38, BLACK, 0, 0.225, 0.08, 14)
    .tube(0.056, 0.06, GUNMETAL, 0, 0.225, 0.29, 14)
    .box(0.03, 0.07, 0.03, GUNMETAL, 0, 0.17, 0.0)
    .box(0.03, 0.07, 0.03, GUNMETAL, 0, 0.17, 0.18)
    .box(0.08, 0.17, 0.42, GUNMETAL, 0, 0.04, -0.36, -0.06, 0, 0)
    .box(0.07, 0.06, 0.2, STEEL, 0, 0.14, -0.3)
    .box(0.07, 0.16, 0.08, GUNMETAL, 0, -0.06, -0.06, 0.3, 0, 0)
    .limb(0.03, 0.06, 0.62, 0.07, -0.16, 0.66, 0.012, BLACK)
    .limb(-0.03, 0.06, 0.62, -0.07, -0.16, 0.66, 0.012, BLACK);
  glow
    .cyl(0.04, 0.04, 0.004, tracer, 0, 0.225, 0.322, Math.PI / 2, 0, 0, 16, 3)
    .add(new THREE.OctahedronGeometry(0.075, 0), accent, 3, 0.07, 0.07, -0.32, 0, 0.4, 0, 0.5, 1, 1)
    .add(new THREE.OctahedronGeometry(0.075, 0), accent, 3, -0.07, 0.07, -0.32, 0, 0.4, 0, 0.5, 1, 1)
    .box(0.004, 0.016, 0.36, accent, 0.047, 0.1, 0.05, 0, 0, 0, 0, GLOW);
  return [0.1, 1.2];
}

function rocket(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color, tracer: THREE.Color): number[] {
  lit
    .tube(0.12, 1.05, WHITE, 0, 0.16, 0.18, 18)
    .cyl(0.155, 0.12, 0.12, GUNMETAL, 0, 0.16, 0.74, Math.PI / 2, 0, 0, 18)
    .cyl(0.12, 0.16, 0.12, GUNMETAL, 0, 0.16, -0.38, Math.PI / 2, 0, 0, 18)
    .cone(0.085, 0.16, tracer, 0, 0.16, 0.77, Math.PI / 2, 0, 0, 14)
    .box(0.07, 0.16, 0.08, GUNMETAL, 0, -0.02, 0.0, 0.25, 0, 0)
    .box(0.07, 0.14, 0.08, GUNMETAL, 0, -0.02, 0.36, 0.1, 0, 0)
    .box(0.06, 0.08, 0.16, BLACK, 0.15, 0.2, 0.3)
    .torus(0.123, 0.012, GUNMETAL, 0, 0.16, 0.45, 0, 0, 0);
  glow
    .torus(0.124, 0.01, accent, 0, 0.16, 0.05, 0, 0, 0, GLOW)
    .torus(0.124, 0.01, accent, 0, 0.16, -0.1, 0, 0, 0, GLOW)
    .sphere(0.04, col('#ffe9a8'), -0.12, 0.2, 0.2, 0.3, 1, 1, 2.6)
    .cyl(0.02, 0.02, 0.004, accent, 0.15, 0.2, 0.382, Math.PI / 2, 0, 0, 10, 3);
  return [0.16, 0.8];
}

function laser(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color, tracer: THREE.Color): number[] {
  lit
    .box(0.1, 0.15, 0.56, WHITE, 0, 0.08, 0.1)
    .box(0.085, 0.06, 0.5, BLACK, 0, 0.0, 0.1)
    .box(0.06, 0.08, 0.3, WHITE, 0, 0.1, -0.3)
    .box(0.07, 0.17, 0.06, BLACK, 0, -0.03, -0.46)
    .box(0.07, 0.16, 0.08, BLACK, 0, -0.06, -0.04, 0.3, 0, 0)
    .box(0.02, 0.025, 0.2, WHITE, 0.05, 0.1, 0.82)
    .box(0.02, 0.025, 0.2, WHITE, -0.05, 0.1, 0.82);
  for (let i = 0; i < 4; i++) lit.torus(0.055, 0.014, GUNMETAL, 0, 0.1, 0.42 + i * 0.1, 0, 0, 0);
  glow
    .tube(0.028, 0.56, tracer, 0, 0.1, 0.6, 12, 3.2)
    .box(0.012, 0.012, 0.05, tracer, 0.05, 0.1, 0.93, 0, 0, 0, 0, 3.5)
    .box(0.012, 0.012, 0.05, tracer, -0.05, 0.1, 0.93, 0, 0, 0, 0, 3.5)
    .box(0.004, 0.02, 0.44, accent, 0.052, 0.12, 0.08, 0, 0, 0, 0, GLOW)
    .box(0.004, 0.02, 0.44, accent, -0.052, 0.12, 0.08, 0, 0, 0, 0, GLOW)
    .sphere(0.035, tracer, 0, 0.17, -0.02, 1.2, 0.6, 1.6, 3);
  for (let i = 0; i < 3; i++) glow.torus(0.058, 0.006, tracer, 0, 0.1, 0.47 + i * 0.1, 0, 0, 0, 3);
  return [0.1, 0.95];
}

function minigunBody(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color, tracer: THREE.Color): number[] {
  lit
    .box(0.22, 0.22, 0.38, GUNMETAL, 0, 0.08, 0.02)
    .cyl(0.15, 0.15, 0.17, STEEL, 0, -0.1, -0.06, 0, 0, Math.PI / 2, 18)
    .torus(0.1, 0.018, GUNMETAL, 0, 0.2, 0.02, 0, Math.PI / 2, 0, 1, Math.PI)
    .box(0.07, 0.16, 0.08, GUNMETAL, 0, -0.1, 0.22, 0.2, 0, 0)
    .tube(0.1, 0.06, BLACK, 0, 0.08, 0.24, 16);
  glow
    // "$" money-printer vents + legendary trim.
    .box(0.004, 0.03, 0.26, tracer, 0.112, 0.12, 0.02, 0, 0, 0, 0, 3)
    .box(0.004, 0.03, 0.26, tracer, 0.112, 0.05, 0.02, 0, 0, 0, 0, 3)
    .box(0.004, 0.03, 0.26, tracer, -0.112, 0.12, 0.02, 0, 0, 0, 0, 3)
    .box(0.004, 0.03, 0.26, tracer, -0.112, 0.05, 0.02, 0, 0, 0, 0, 3)
    .box(0.225, 0.012, 0.012, accent, 0, 0.195, 0.2, 0, 0, 0, 0, GLOW)
    .box(0.225, 0.012, 0.012, accent, 0, 0.195, -0.16, 0, 0, 0, 0, GLOW)
    .torus(0.151, 0.008, accent, 0.086, -0.1, -0.06, 0, Math.PI / 2, 0, GLOW);
  return [0.08, 0.86];
}

function minigunBarrels(lit: PartBuilder, glow: PartBuilder, accent: THREE.Color): void {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    lit.tube(0.022, 0.62, STEEL, Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0.55, 8);
  }
  lit.tube(0.035, 0.64, GUNMETAL, 0, 0, 0.55, 8);
  lit.torus(0.075, 0.016, GUNMETAL, 0, 0, 0.36, 0, 0, 0);
  lit.torus(0.075, 0.016, GUNMETAL, 0, 0, 0.82, 0, 0, 0);
  glow.torus(0.082, 0.007, accent, 0, 0, 0.6, 0, 0, 0, GLOW);
}

const cache = new Map<WeaponId, WeaponModel>();

export function weaponModel(id: WeaponId): WeaponModel {
  const cached = cache.get(id);
  if (cached) return cached;
  const def = WEAPONS[id];
  const accent = rarityColor(def.rarity);
  const tracer = col(def.color);
  const lit = new PartBuilder();
  const glow = new PartBuilder();
  let muzzle: number[];
  let spin: WeaponModel['spin'] = null;
  switch (id) {
    case 'pistol':
      muzzle = pistol(lit, glow, accent, tracer);
      break;
    case 'smg':
      muzzle = smg(lit, glow, accent);
      break;
    case 'shotgun':
      muzzle = shotgun(lit, glow, accent);
      break;
    case 'ar':
      muzzle = ar(lit, glow, accent);
      break;
    case 'sniper':
      muzzle = sniper(lit, glow, accent, tracer);
      break;
    case 'rocket':
      muzzle = rocket(lit, glow, accent, tracer);
      break;
    case 'laser':
      muzzle = laser(lit, glow, accent, tracer);
      break;
    case 'minigun': {
      muzzle = minigunBody(lit, glow, accent, tracer);
      const sl = new PartBuilder();
      const sg = new PartBuilder();
      minigunBarrels(sl, sg, accent);
      spin = { lit: sl.build(), glow: sg.build(), y: 0.08 };
      break;
    }
  }
  const litGeo = lit.build();
  const glowGeo = glow.build();
  let lootLit = litGeo;
  let lootGlow = glowGeo;
  if (spin) {
    const offsetLit = spin.lit.clone().translate(0, spin.y, 0);
    const offsetGlow = spin.glow.clone().translate(0, spin.y, 0);
    lootLit = mergeGeometries([litGeo, offsetLit], false);
    lootGlow = mergeGeometries([glowGeo, offsetGlow], false);
    offsetLit.dispose();
    offsetGlow.dispose();
    lootLit.computeBoundingSphere();
    lootGlow.computeBoundingSphere();
  }
  const model: WeaponModel = {
    lit: litGeo,
    glow: glowGeo,
    spin,
    lootLit,
    lootGlow,
    muzzleY: muzzle[0]!,
    muzzleZ: muzzle[1]!,
  };
  cache.set(id, model);
  return model;
}
