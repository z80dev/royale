// Shared building blocks for the static world: resource tracking, the global "world" shader patch
// (occlusion cutout, fake neon light pools, zone tint, ground zone rings), and a static-geometry batcher
// that merges thousands of primitives into a handful of vertex-colored draw calls per spatial cell.

import { CHARACTER_BY_ID, CHARACTERS, type CharacterId } from '../../../shared/constants';
import type { GameMap } from '../../../shared/map';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textTexture, type TextTextureOpts } from '../assets';

/** Everything a world builder needs; created by World for each setMap(). */
export interface BuildCtx {
  map: GameMap;
  root: THREE.Group; // add standalone meshes here
  bag: Bag; // track every geometry/material/texture you create
  batch: Batcher; // static geometry merged per material kind
  glowTex: THREE.Texture; // radial glow sprite texture
  animate(fn: (time: number, dt: number, camera: THREE.Vector3) => void): void; // per-frame hook (camera = eye)
  /** Registers a fake point light (neon pool on nearby lit surfaces). */
  light(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, range?: number): void;
}

export const MAX_FAKE_LIGHTS = 24;

/** Uniforms shared (by reference) with every patched world material. Updated once per frame by the Renderer. */
export const worldUniforms = {
  uTime: { value: 0 },
  uOccCam: { value: new THREE.Vector3(0, 100, 0) },
  uOccFocus: { value: new THREE.Vector3() },
  uOccStrength: { value: 0 },
  uLightPos: { value: Array.from({ length: MAX_FAKE_LIGHTS }, () => new THREE.Vector4()) }, // xyz + range
  uLightColor: { value: Array.from({ length: MAX_FAKE_LIGHTS }, () => new THREE.Vector3()) }, // rgb · intensity
  uLightCount: { value: 0 },
  uZone: { value: new THREE.Vector4(0, 0, 1e5, 0) }, // cx, cz, r, strength (0 = no zone)
  uZoneNext: { value: new THREE.Vector4(0, 0, 0, 0) }, // ncx, ncz, nr, visibility
  uZonePulse: { value: 0 },
};

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uOccCam;
uniform vec3 uOccFocus;
uniform float uOccStrength;
uniform vec4 uLightPos[${MAX_FAKE_LIGHTS}];
uniform vec3 uLightColor[${MAX_FAKE_LIGHTS}];
uniform int uLightCount;
uniform vec4 uZone;
uniform vec4 uZoneNext;
uniform float uZonePulse;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec2 vKitUv;
float kitHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kitNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(kitHash(i), kitHash(i + vec2(1.0, 0.0)), f.x),
    mix(kitHash(i + vec2(0.0, 1.0)), kitHash(i + 1.0), f.x),
    f.y);
}
`;

const GLSL_FRAGMENT_FUNCS = /* glsl */ `
// See-through cut around the camera→focus line: a clean hole whose radius grows with uOccStrength.
// Returns > 1 inside the hole, 0..1 across its thin rim, < 0 outside (or when no cut applies).
float kitOccCut(vec3 p) {
  if (uOccStrength <= 0.0 || p.y <= 0.6) return -1.0;
  vec3 axis = uOccFocus - uOccCam;
  float len = length(axis);
  vec3 dir = axis / len;
  vec3 rel = p - uOccCam;
  float t = dot(rel, dir);
  if (t <= 0.0 || t >= len - 1.3) return -1.0;
  float d = length(rel - dir * t);
  return (uOccStrength * 3.6 - d) / 0.3;
}
vec3 kitFakeLights(vec3 p, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_FAKE_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i].xyz - p;
    float dist = length(d);
    float att = clamp(1.0 - dist / uLightPos[i].w, 0.0, 1.0);
    att *= att;
    float lambert = 0.3 + 0.7 * max(dot(n, d / max(dist, 0.001)), 0.0);
    acc += uLightColor[i] * att * lambert;
  }
  // soft knee: overlapping pools saturate instead of washing surfaces out
  return acc / (1.0 + 0.35 * max(max(acc.r, acc.g), acc.b));
}
vec3 kitZoneRings(vec3 p) {
  vec3 acc = vec3(0.0);
  if (uZone.w > 0.0) {
    float zd = length(p.xz - uZone.xy) - uZone.z;
    acc += vec3(1.0, 0.12, 0.42) * exp(-abs(zd) * 1.2) * (1.4 + uZonePulse * 3.0) * uZone.w;
  }
  if (uZoneNext.w > 0.0) {
    vec2 nd = p.xz - uZoneNext.xy;
    float nr = length(nd);
    float arc = atan(nd.y, nd.x) * uZoneNext.z;
    float ph = fract(arc / 4.0 - uTime * 0.35);
    float dash = smoothstep(0.0, 0.06, ph) * smoothstep(0.62, 0.56, ph);
    float d = abs(nr - uZoneNext.z);
    float aa = fwidth(nr) * 1.5 + 0.02;
    float line = 1.0 - smoothstep(0.07, 0.07 + aa, d);
    float halo = exp(-d * 2.5);
    acc += vec3(0.8, 0.95, 1.0) * (line * dash * 1.7 + halo * 0.1) * uZoneNext.w;
  }
  return acc;
}
`;

export interface PatchOpts {
  /** Unique key for this snippet combination (program cache). */
  key: string;
  occlude?: boolean; // dithered see-through when between camera and focus (default true)
  lights?: boolean; // fake neon light pools (lit materials only; default true for MeshStandardMaterial)
  zoneTint?: boolean; // red tint outside the zone (default true)
  ground?: boolean; // draw zone edge + next-circle dashes (ground surfaces)
  sway?: number; // vertex sway amplitude in m per m of height (foliage)
  vertex?: string; // GLSL after begin_vertex (can modify `transformed`)
  color?: string; // GLSL after color_fragment (modify `diffuseColor`)
  emissive?: string; // GLSL after emissivemap_fragment (add to `totalEmissiveRadiance`) — lit only
  header?: string; // extra GLSL declarations for the fragment shader
  vertexHeader?: string; // extra GLSL declarations for the vertex shader (attributes, varyings)
  uniforms?: Record<string, THREE.IUniform>; // extra uniforms (declare them in `header`)
}

/** Injects the world shader features into a built-in material. Returns the same material. */
export function patchWorld<M extends THREE.Material>(mat: M, opts: PatchOpts): M {
  const lit = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshLambertMaterial;
  const occlude = opts.occlude ?? true;
  const lights = (opts.lights ?? true) && lit;
  const zoneTint = opts.zoneTint ?? true;
  const ground = !!opts.ground && lit;
  const emissive = lit ? (opts.emissive ?? '') : '';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms, opts.uniforms);
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${opts.vertexHeader ?? ''}`);
    let pre = '';
    if (opts.sway) {
      pre += `
      {
        #ifdef USE_INSTANCING
          vec2 kitSeed = instanceMatrix[3].xz;
        #else
          vec2 kitSeed = modelMatrix[3].xz;
        #endif
        float kitPhase = uTime * 1.3 + kitSeed.x * 0.37 + kitSeed.y * 0.23;
        float kitAmp = ${opts.sway.toFixed(4)} * max(transformed.y, 0.0);
        transformed.x += sin(kitPhase) * kitAmp + sin(kitPhase * 2.3) * kitAmp * 0.3;
        transformed.z += cos(kitPhase * 0.8) * kitAmp * 0.6;
      }`;
    }
    if (opts.vertex) pre += `\n${opts.vertex}\n`;
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${pre}`);
    vs = vs.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 kitWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          kitWp = instanceMatrix * kitWp;
        #endif
        vWPos = (modelMatrix * kitWp).xyz;
        vKitUv = uv;
        ${
          lights || ground
            ? `vec3 kitN = objectNormal;
        #ifdef USE_INSTANCING
          kitN = mat3(instanceMatrix) * kitN;
        #endif
        vWNormal = normalize(mat3(modelMatrix) * kitN);`
            : 'vWNormal = vec3(0.0, 1.0, 0.0);'
        }
      }`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace(
      '#include <common>',
      `#include <common>\n${GLSL_COMMON}\n${GLSL_FRAGMENT_FUNCS}\n${opts.header ?? ''}`,
    );
    if (occlude) {
      fs = fs.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          float kitCut = kitOccCut(vWPos);
          if (kitCut >= 1.0) discard;
          if (kitCut > 0.0) {
            float kitIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (kitCut > kitIgn) discard;
          }
        }`,
      );
    }
    if (opts.color) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.color}\n`);
    let emit = emissive;
    if (lights) emit += '\ntotalEmissiveRadiance += diffuseColor.rgb * kitFakeLights(vWPos, normalize(vWNormal));';
    if (ground) emit += '\ntotalEmissiveRadiance += kitZoneRings(vWPos);';
    if (occlude && lit) {
      // thin cyan outline where the cut slices through geometry, so the hole reads as intentional x-ray
      emit += `
      {
        float kitRim = kitOccCut(vWPos);
        if (kitRim > -0.8) totalEmissiveRadiance += vec3(0.15, 0.85, 1.0) * (1.0 - smoothstep(0.0, 0.8, -kitRim)) * 1.1;
      }`;
    }
    if (emit) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emit}\n`);
    if (zoneTint) {
      fs = fs.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        if (uZone.w > 0.0) {
          float kitZd = length(vWPos.xz - uZone.xy) - uZone.z;
          float kitZt = smoothstep(0.0, 4.0, kitZd) * uZone.w;
          vec3 kitRed = gl_FragColor.rgb * vec3(1.35, 0.3, 0.42) + vec3(0.05, 0.0, 0.012);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, kitRed, kitZt * 0.8);
        }`,
      );
    }
    shader.fragmentShader = fs;
  };
  const cacheKey = `kit:${opts.key}:${occlude}:${lights}:${zoneTint}:${ground}:${opts.sway ?? 0}`;
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
}

/** Tracks GPU resources created for one world build so the whole build can be disposed at once. */
export class Bag {
  private items: { dispose(): void }[] = [];
  track<T extends { dispose(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }
  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
  }
}

/** Parses a CSS color into linear RGB scaled by `intensity` (HDR values > 1 bloom). */
export function hdr(color: THREE.ColorRepresentation, intensity = 1): THREE.Color {
  return new THREE.Color(color).multiplyScalar(intensity);
}

function neonInto(out: THREE.Color, color: THREE.ColorRepresentation, intensity: number): THREE.Color {
  out.set(color);
  // Bright hues (white, yellow, cyan) bloom far more than deep ones at the same intensity; even them out.
  const lum = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  return out.multiplyScalar(intensity * Math.min(1, Math.sqrt(0.3 / Math.max(lum, 1e-3))));
}

/** Like hdr(), but luminance-compensated so every brand color blooms about equally. Use for neon light. */
export function neon(color: THREE.ColorRepresentation, intensity = 1): THREE.Color {
  return neonInto(new THREE.Color(), color, intensity);
}

// ───────────────────────────── Brand glow colors ─────────────────────────────

interface BrandGlow {
  main: string; // saturated neon for trims, beams, walls, light pools
  alt: string; // lighter companion for accent strips
}

const brandGlowCache = new Map<CharacterId, BrandGlow>();
const glowByPrimary = new Map<string, string>();

function hsl(hex: string): { h: number; s: number; l: number } {
  return new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
}

function isVivid(hex: string): boolean {
  const c = hsl(hex);
  return c.s >= 0.45 && c.l >= 0.25 && c.l <= 0.68;
}

/**
 * Saturated neon colors for a brand. Pale/grey primaries (Long's mint-white, Pons' chrome) turn into a milky
 * white haze once bloom and light pools stack up, so they fall back to a vivid secondary or a saturated variant.
 */
export function brandGlow(id: CharacterId): BrandGlow {
  const cached = brandGlowCache.get(id);
  if (cached) return cached;
  const c = CHARACTER_BY_ID[id];
  let main = c.primary;
  if (!isVivid(main)) {
    if (isVivid(c.secondary)) main = c.secondary;
    else {
      const p = hsl(c.primary);
      const hue = p.s < 0.2 ? 0.53 : p.h; // achromatic chrome → icy cyan
      main = `#${new THREE.Color().setHSL(hue, Math.max(p.s, 0.78), 0.55, THREE.SRGBColorSpace).getHexString()}`;
    }
  }
  const m = hsl(main);
  const altColor = new THREE.Color().setHSL(m.h, m.s * 0.85, Math.min(m.l + 0.14, 0.72), THREE.SRGBColorSpace);
  const alt = `#${altColor.getHexString()}`;
  const glow = { main, alt };
  brandGlowCache.set(id, glow);
  return glow;
}

/** Maps a brand primary (e.g. from map.lights / obstacle.color) to its glow color; other colors pass through. */
export function glowFor(color: string): string {
  if (!glowByPrimary.size) for (const c of CHARACTERS) glowByPrimary.set(c.primary.toLowerCase(), brandGlow(c.id).main);
  return glowByPrimary.get(color.toLowerCase()) ?? color;
}

// ───────────────────────────── Static batching ─────────────────────────────

export type BatchKind = 'lit' | 'rough' | 'metal' | 'glass' | 'glow' | 'blink';

const CELL = 50;
const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

/** Template geometries (never rendered themselves → never uploaded to the GPU). */
export const TPL = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  cyl32: new THREE.CylinderGeometry(1, 1, 1, 32),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  cone16: new THREE.ConeGeometry(1, 1, 16),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  sphereLo: new THREE.SphereGeometry(1, 10, 7),
  plane: new THREE.PlaneGeometry(1, 1),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 48),
  band: new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), // open ring band (glowing rims)
  ico: new THREE.IcosahedronGeometry(1, 0),
};

export interface PlaceOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  intensity?: number;
}

/** Local coordinate frame (origin + yaw) for placing parts of a landmark. */
export class Placer {
  private base = new THREE.Matrix4();
  constructor(
    private batch: Batcher,
    x: number,
    z: number,
    rotY = 0,
    y = 0,
  ) {
    this.base.makeRotationY(rotY).setPosition(x, y, z);
  }
  /** Adds `geo` scaled by (sx, sy, sz) with its center at local (lx, ly, lz). */
  add(
    kind: BatchKind,
    geo: THREE.BufferGeometry,
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation,
    opts: PlaceOpts = {},
  ): void {
    tmpEuler.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(lx, ly, lz);
    tmpScale.set(sx, sy, sz);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale).premultiply(this.base);
    this.batch.add(kind, geo, tmpMatrix, color, opts.intensity ?? 1);
  }
  box(
    kind: BatchKind,
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    opts?: PlaceOpts,
  ): void {
    this.add(kind, TPL.box, lx, ly, lz, w, h, d, color, opts);
  }
  /** Cylinder with radius r and height h, centered at (lx, ly, lz). */
  cyl(
    kind: BatchKind,
    lx: number,
    ly: number,
    lz: number,
    r: number,
    h: number,
    color: THREE.ColorRepresentation,
    opts?: PlaceOpts,
    segs: 8 | 16 | 32 = 16,
  ): void {
    const geo = segs === 8 ? TPL.cyl8 : segs === 16 ? TPL.cyl16 : TPL.cyl32;
    this.add(kind, geo, lx, ly, lz, r, h, r, color, opts);
  }
  /** Rectangular outline (4 thin boxes) of outer size w×d centered at local (0, ly, 0). */
  frame(
    kind: BatchKind,
    ly: number,
    w: number,
    d: number,
    t: number,
    h: number,
    color: THREE.ColorRepresentation,
    opts?: PlaceOpts,
  ): void {
    this.box(kind, 0, ly, d / 2 - t / 2, w, h, t, color, opts);
    this.box(kind, 0, ly, -d / 2 + t / 2, w, h, t, color, opts);
    this.box(kind, w / 2 - t / 2, ly, 0, t, h, d - 2 * t, color, opts);
    this.box(kind, -w / 2 + t / 2, ly, 0, t, h, d - 2 * t, color, opts);
  }
  /** Open vertical ring band of radius r and height h (e.g. a glowing rim around a podium). */
  band(
    kind: BatchKind,
    lx: number,
    ly: number,
    lz: number,
    r: number,
    h: number,
    color: THREE.ColorRepresentation,
    opts?: PlaceOpts,
  ): void {
    this.add(kind, TPL.band, lx, ly, lz, r, h, r, color, opts);
  }
  sphere(
    kind: BatchKind,
    lx: number,
    ly: number,
    lz: number,
    rx: number,
    ry: number,
    rz: number,
    color: THREE.ColorRepresentation,
    opts?: PlaceOpts,
  ): void {
    this.add(kind, TPL.sphere, lx, ly, lz, rx, ry, rz, color, opts);
  }
}

/**
 * Collects static primitives and merges them per (material kind × 50 m cell) into single meshes.
 * Colors are baked into a vertex attribute (HDR for glow kinds), so the whole city costs a few dozen draws.
 */
export class Batcher {
  private buckets = new Map<string, { kind: BatchKind; geos: THREE.BufferGeometry[] }>();

  add(
    kind: BatchKind,
    template: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    color: THREE.ColorRepresentation,
    intensity = 1,
  ): void {
    const geo = template.index ? template.clone() : withSequentialIndex(template.clone());
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const count = geo.getAttribute('position').count;
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    geo.applyMatrix4(matrix);
    if (kind === 'glow' || kind === 'blink') neonInto(tmpColor, color, intensity);
    else tmpColor.set(color).multiplyScalar(intensity);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.clearGroups();
    const cx = Math.floor(matrix.elements[12]! / CELL);
    const cz = Math.floor(matrix.elements[14]! / CELL);
    const key = `${kind}:${cx}:${cz}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { kind, geos: [] }));
    bucket.geos.push(geo);
  }

  /** Placer at world (x, z) rotated by rotY. */
  at(x: number, z: number, rotY = 0, y = 0): Placer {
    return new Placer(this, x, z, rotY, y);
  }

  /** Merges everything into meshes under `root`. Geometries are tracked in `bag`. */
  flush(root: THREE.Object3D, materials: Record<BatchKind, THREE.Material>, bag: Bag): void {
    for (const { kind, geos } of this.buckets.values()) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      bag.track(merged);
      const mesh = new THREE.Mesh(merged, materials[kind]);
      const solid = kind !== 'glow' && kind !== 'blink';
      mesh.castShadow = solid;
      mesh.receiveShadow = solid;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    this.buckets.clear();
  }
}

function withSequentialIndex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** Standard materials for each batch kind (vertex colors, world-patched). Tracked in `bag`. */
export function batchMaterials(bag: Bag): Record<BatchKind, THREE.Material> {
  const lit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.18 });
  const rough = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.88 });
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.95 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const blink = new THREE.MeshBasicMaterial({ vertexColors: true });
  patchWorld(lit, { key: 'batch-lit' });
  patchWorld(rough, { key: 'batch-rough' });
  patchWorld(metal, { key: 'batch-metal' });
  patchWorld(glass, { key: 'batch-glass' });
  patchWorld(glow, { key: 'batch-glow' });
  patchWorld(blink, {
    key: 'batch-blink',
    color: `{
      vec2 cell = floor(vWPos.xz * 3.1 + vWPos.y * 1.7);
      float rate = 1.5 + kitHash(cell) * 5.0;
      float on = step(0.45, fract(uTime * rate * 0.5 + kitHash(cell + 7.0)));
      diffuseColor.rgb *= mix(0.08, 1.0, on);
    }`,
  });
  for (const m of [lit, rough, metal, glass, glow, blink]) bag.track(m);
  return { lit, rough, metal, glass, glow, blink };
}

// ───────────────────────────── Text / sign textures ─────────────────────────────

export const FONT_DISPLAY = '900 {px}px "Orbitron", "Space Grotesk", system-ui, sans-serif';
export const FONT_BODY = '700 {px}px "Space Grotesk", system-ui, sans-serif';
export const FONT_SCRIPT = 'italic 800 {px}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive';

/**
 * Neon text texture (see assets.textTexture) that redraws itself once web fonts finish loading,
 * so signs built before Orbitron arrives still end up in the right typeface.
 */
export function signTexture(bag: Bag, text: string, opts: TextTextureOpts): THREE.CanvasTexture {
  const tex = bag.track(textTexture(text, opts));
  whenFontsReady(() => {
    const fresh = textTexture(text, opts);
    tex.image = fresh.image;
    tex.needsUpdate = true;
    fresh.dispose();
  });
  return tex;
}

export interface MultiLineOpts {
  width: number;
  height: number;
  font: string; // with {px}
  color: string;
  glow?: string;
  background?: string;
  border?: string;
}

/** Multi-line centered text texture, each line auto-fit to width. Redraws after fonts load. */
export function multiLineTexture(bag: Bag, lines: string[], opts: MultiLineOpts): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, opts.width, opts.height);
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, opts.width, opts.height);
    }
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = opts.height * 0.02;
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, opts.width - ctx.lineWidth * 2, opts.height - ctx.lineWidth * 2);
    }
    const lineH = opts.height / (lines.length + 0.6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      let px = Math.round(lineH * 0.72);
      ctx.font = opts.font.replace('{px}', String(px));
      while (ctx.measureText(line).width > opts.width * 0.9 && px > 6) {
        px -= 1;
        ctx.font = opts.font.replace('{px}', String(px));
      }
      const y = lineH * (i + 0.8);
      if (opts.glow) {
        ctx.shadowColor = opts.glow;
        ctx.shadowBlur = lineH * 0.12;
      }
      ctx.fillStyle = opts.color;
      ctx.fillText(line, opts.width / 2, y);
    });
  };
  draw();
  const tex = bag.track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  whenFontsReady(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

let fontsSettled = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
const fontWaiters: (() => void)[] = [];
if (!fontsSettled) {
  void document.fonts.ready.then(() => {
    fontsSettled = true;
    for (const fn of fontWaiters.splice(0)) fn();
  });
}
function whenFontsReady(fn: () => void): void {
  if (!fontsSettled) fontWaiters.push(fn);
}

/** Canvas texture drawn by `paint` (size w×h), sRGB, tracked. */
export function paintedTexture(
  bag: Bag,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!);
  const tex = bag.track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Radial glow sprite texture (white core → transparent), shared by light sprites. */
export function glowTexture(bag: Bag): THREE.CanvasTexture {
  return paintedTexture(bag, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Unlit textured plane (sign). `intensity` > 1 makes it bloom. */
export function signPlane(
  bag: Bag,
  tex: THREE.Texture,
  w: number,
  h: number,
  color: THREE.ColorRepresentation = '#ffffff',
  intensity = 1.6,
  opts: { additive?: boolean; doubleSide?: boolean; occlude?: boolean } = {},
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mat = bag.track(
    new THREE.MeshBasicMaterial({
      map: tex,
      color: hdr(color, intensity),
      transparent: true,
      depthWrite: !opts.additive,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }),
  );
  patchWorld(mat, { key: 'sign', occlude: opts.occlude ?? true });
  const mesh = new THREE.Mesh(bag.track(new THREE.PlaneGeometry(w, h)), mat);
  return mesh;
}
