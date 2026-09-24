// Shared helpers for the actor modules: color cache, math, vertex-colored part builder and the global
// material set. Everything here is allocation-free at runtime once warmed up.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHARACTER_BY_ID, RARITY_COLORS, type CharacterId, type Rarity } from '../../../shared/constants';
import { brandGlow } from '../world/kit';

export const TAU = Math.PI * 2;

// ───────────────────────────── Colors ─────────────────────────────

const colorCache = new Map<string, THREE.Color>();

/** Cached linear-space color for a CSS color string. Shared instance — never mutate it. */
export function col(css: string): THREE.Color {
  let c = colorCache.get(css);
  if (!c) {
    c = new THREE.Color(css);
    colorCache.set(css, c);
  }
  return c;
}

export function brandPrimary(id: CharacterId): THREE.Color {
  return col(CHARACTER_BY_ID[id].primary);
}

export function brandSecondary(id: CharacterId): THREE.Color {
  return col(CHARACTER_BY_ID[id].secondary);
}

/**
 * Saturated brand neon shared with RenderWorld's HQ trims (pale primaries like Long/Pons fall back to a vivid
 * variant). Use for every emissive/additive brand color; keep brandPrimary for lit armor.
 */
export function brandGlowColor(id: CharacterId): THREE.Color {
  return col(brandGlow(id).main);
}

const trimCache = new Map<CharacterId, THREE.Color>();
const tmpHsl = { h: 0, s: 0, l: 0 };

/**
 * Visor / trim / FX accent color: the brand secondary when it is saturated enough to survive bloom, otherwise
 * the brand glow color (near-white secondaries such as Pons #FFFFFF or Uniswap #FFD6EA turn into white haze).
 */
export function brandTrim(id: CharacterId): THREE.Color {
  let c = trimCache.get(id);
  if (!c) {
    const secondary = CHARACTER_BY_ID[id].secondary;
    new THREE.Color(secondary).getHSL(tmpHsl, THREE.SRGBColorSpace);
    const readable = tmpHsl.s >= 0.45 && tmpHsl.l >= 0.25 && tmpHsl.l <= 0.8;
    c = readable ? col(secondary) : brandGlowColor(id);
    trimCache.set(id, c);
  }
  return c;
}

const vividCache = new Map<THREE.Color, THREE.Color>();

/**
 * Saturation-boosted, max-channel-normalized variant of a color for additive glow FX. Pale brand colors
 * (e.g. #FFD6EA) otherwise wash out to white under bloom. Cached per input instance.
 */
export function vivid(c: THREE.Color): THREE.Color {
  let v = vividCache.get(c);
  if (!v) {
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const k = 2.2;
    v = new THREE.Color(
      Math.max(0, l + (c.r - l) * k),
      Math.max(0, l + (c.g - l) * k),
      Math.max(0, l + (c.b - l) * k),
    );
    const m = Math.max(v.r, v.g, v.b, 1e-4);
    v.multiplyScalar(1 / m);
    vividCache.set(c, v);
  }
  return v;
}

export function rarityColor(r: Rarity): THREE.Color {
  return col(RARITY_COLORS[r]);
}

/** Semantic FX colors (not brand colors). */
export const FX_COLORS = {
  white: col('#ffffff'),
  gold: col('#ffc83d'),
  goldDeep: col('#ff9a1a'),
  fire: col('#ff7a1f'),
  fireCore: col('#ffe7a8'),
  ember: col('#ff3b1f'),
  smoke: col('#3a3947'),
  smokeDark: col('#1c1b24'),
  dust: col('#8d8aa3'),
  blood: col('#ff2d55'),
  armor: col('#4fc8ff'),
  heal: col('#3dff8b'),
  slow: col('#58b6ff'),
  danger: col('#ff2340'),
  self: col('#7ff6ff'),
  team: col('#43ff8a'),
  enemy: col('#ff2d6f'),
  rugGreen: col('#1dff6b'),
  rugRed: col('#ff1e3c'),
  brass: col('#d9a441'),
  laserEye: col('#ff1a2e'),
} as const;

// ───────────────────────────── Math ─────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
}

/** Object yaw (rotation.y) for a model built facing +z, given a protocol aim angle (dir = cos, sin on x,z). */
export function yawFromAim(aim: number): number {
  return Math.PI / 2 - aim;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeOutBack(t: number): number {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// ───────────────────────────── Vertex-colored part builder ─────────────────────────────

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();

type ColorLike = THREE.Color | string;

/**
 * Accumulates transformed primitives with baked vertex colors into ONE merged non-indexed geometry
 * (position + normal + color). Used for every character, weapon, loot and chest model so each
 * model costs one draw call per material.
 */
export class PartBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Adds a geometry (consumed) with a uniform color. `intensity` > 1 pushes glow parts into bloom. */
  add(
    geo: THREE.BufferGeometry,
    color: ColorLike,
    intensity = 1,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ): this {
    tmpEuler.set(rx, ry, rz);
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(sx, sy, sz));
    return this.addMatrix(geo, color, intensity, tmpMatrix);
  }

  addMatrix(geo: THREE.BufferGeometry, color: ColorLike, intensity: number, matrix: THREE.Matrix4): this {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    flat.deleteAttribute('uv');
    flat.deleteAttribute('uv1');
    flat.applyMatrix4(matrix);
    const c = typeof color === 'string' ? col(color) : color;
    const count = flat.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r * intensity;
      colors[i * 3 + 1] = c.g * intensity;
      colors[i * 3 + 2] = c.b * intensity;
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(flat);
    return this;
  }

  /** Rounded box centered at (x, y, z). */
  box(
    w: number,
    h: number,
    d: number,
    color: ColorLike,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    radius = -1,
    intensity = 1,
  ): this {
    const r = radius < 0 ? Math.min(w, h, d) * 0.22 : radius;
    const geo = r > 0.001 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, color, intensity, x, y, z, rx, ry, rz);
  }

  cyl(
    rTop: number,
    rBottom: number,
    h: number,
    color: ColorLike,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    segments = 12,
    intensity = 1,
    open = false,
  ): this {
    return this.add(
      new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open),
      color,
      intensity,
      x,
      y,
      z,
      rx,
      ry,
      rz,
    );
  }

  /** Cylinder along +z (barrels, tubes, scopes): centered at (x, y, z). */
  tube(r: number, len: number, color: ColorLike, x: number, y: number, z: number, segments = 12, intensity = 1): this {
    return this.cyl(r, r, len, color, x, y, z, Math.PI / 2, 0, 0, segments, intensity);
  }

  sphere(
    r: number,
    color: ColorLike,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    intensity = 1,
    wSeg = 14,
    hSeg = 10,
  ): this {
    return this.add(new THREE.SphereGeometry(r, wSeg, hSeg), color, intensity, x, y, z, 0, 0, 0, sx, sy, sz);
  }

  /** Capsule-ish limb between two points. */
  limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: ColorLike): this {
    tmpDir.set(bx - ax, by - ay, bz - az);
    const len = tmpDir.length();
    tmpDir.divideScalar(len || 1);
    tmpQuat.setFromUnitVectors(upAxis, tmpDir);
    tmpMatrix.compose(tmpPos.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQuat, tmpScale.set(1, 1, 1));
    return this.addMatrix(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 10), color, 1, tmpMatrix);
  }

  torus(
    r: number,
    tube: number,
    color: ColorLike,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    intensity = 1,
    arc = TAU,
  ): this {
    return this.add(new THREE.TorusGeometry(r, tube, 8, 24, arc), color, intensity, x, y, z, rx, ry, rz);
  }

  cone(
    r: number,
    h: number,
    color: ColorLike,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    seg = 12,
    intensity = 1,
  ): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, intensity, x, y, z, rx, ry, rz);
  }

  build(): THREE.BufferGeometry {
    const merged = this.parts.length === 0 ? emptyGeometry() : mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

function emptyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
  return g;
}

// ───────────────────────────── Shared materials ─────────────────────────────

let litMat: THREE.MeshStandardMaterial | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
let ghostLitMat: THREE.MeshStandardMaterial | null = null;
let ghostGlowMat: THREE.MeshBasicMaterial | null = null;

/**
 * Lit, vertex-colored armor/metal material shared by every actor model. A small self-illumination term keeps
 * brand colors readable under the moonlit night lighting.
 */
export function litMaterial(): THREE.MeshStandardMaterial {
  if (!litMat) {
    litMat = selfLitMaterial(0.16, 0.45, 0.3);
    litMat.vertexColors = true;
  }
  return litMat;
}

/** Unlit vertex-colored material for emissive details (colors > 1 bloom). */
export function glowMaterial(): THREE.MeshBasicMaterial {
  glowMat ??= new THREE.MeshBasicMaterial({ vertexColors: true });
  return glowMat;
}

/** Concealed (in-bush) variants: ~15% opacity, no depth write. */
export function ghostLitMaterial(): THREE.MeshStandardMaterial {
  ghostLitMat ??= new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.1,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  return ghostLitMat;
}

export function ghostGlowMaterial(): THREE.MeshBasicMaterial {
  ghostGlowMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  return ghostGlowMat;
}

/**
 * Lit material whose vertex/instance color also drives an emissive term (gold coins and brand chips glow a
 * little under bloom; armor stays readable at night).
 */
export function selfLitMaterial(glow: number, roughness = 0.35, metalness = 0.6): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined( USE_COLOR )
      totalEmissiveRadiance += vColor.rgb * ${glow.toFixed(3)};
#endif`,
    );
  };
  m.customProgramCacheKey = () => `selfLit:${glow}`;
  return m;
}

/** Fresnel rim shader used for overlays (x-ray reveal, hit flash, zone burn, afterimages). */
export function fresnelOverlayMaterial(color: THREE.Color, opacity: number, depthTest: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uFill: { value: 0.18 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFill;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
        float rim = pow(f, 2.2);
        gl_FragColor = vec4(uColor * (rim * 1.6 + uFill), uOpacity);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest,
  });
}
