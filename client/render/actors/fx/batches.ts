// Immediate-mode instanced batches: every frame `begin()`, push primitives, `end()` uploads.
// RingBatch  — glowing ground rings / discs (team rings, shockwaves, loot rings, radar pulses).
// BeamBatch  — camera-facing glowing ribbons between two points (tracers, lasers, light pillars).
// ShellBatch — fresnel spheres with styles (flash shells, fireballs, vault shell, Zora dome).

import * as THREE from 'three';
import { markRange } from './particles';

// ───────────────────────────── Rings ─────────────────────────────

const RING_VERTEX = /* glsl */ `
  attribute vec4 iA;      // x, y, z, radius
  attribute vec4 iColor;  // rgb, alpha
  attribute vec4 iB;      // width (fraction of radius), dashes, rotation (turns), fill
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec4 vB;
  const float PAD = 1.25;
  void main() {
    vLocal = position.xy * PAD;
    vec3 wp = vec3(iA.x + position.x * iA.w * PAD, iA.y, iA.z + position.y * iA.w * PAD);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    vColor = iColor;
    vB = iB;
  }
`;

const RING_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec4 vB;
  void main() {
    float d = length(vLocal);
    float w = max(vB.x, 0.005);
    float center = 1.0 - w * 0.5;
    float x = (d - center) / (w * 0.5);
    float a = exp(-x * x * 2.2);
    a += vB.w * smoothstep(1.0, 0.0, d) * 0.6;
    if (vB.y > 0.5) {
      float ang = atan(vLocal.y, vLocal.x) / 6.2831853 + vB.z;
      float seg = fract(ang * vB.y);
      a *= smoothstep(0.0, 0.08, seg) * smoothstep(0.62, 0.5, seg);
    }
    a *= vColor.a;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

export class RingBatch {
  readonly mesh: THREE.Mesh;
  private count = 0;
  private readonly cap: number;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly c: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(capacity: number, renderOrder: number) {
    this.cap = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.a);
    geo.setAttribute('iColor', this.c);
    geo.setAttribute('iB', this.b);
    geo.instanceCount = 0;
    this.geometry = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * Horizontal ring at height y. `width` = ring thickness as a fraction of radius (1 = filled disc edge),
   * `dashes` > 0 splits it into segments rotated by `turns`, `fill` adds an inner radial glow.
   */
  push(
    x: number,
    y: number,
    z: number,
    radius: number,
    color: THREE.Color,
    intensity: number,
    alpha: number,
    width: number,
    dashes = 0,
    turns = 0,
    fill = 0,
  ): void {
    if (this.count >= this.cap || alpha <= 0.002 || radius <= 0.01) return;
    const i4 = this.count * 4;
    const a = this.a.array as Float32Array;
    const c = this.c.array as Float32Array;
    const b = this.b.array as Float32Array;
    a[i4] = x;
    a[i4 + 1] = y;
    a[i4 + 2] = z;
    a[i4 + 3] = radius;
    c[i4] = color.r * intensity;
    c[i4 + 1] = color.g * intensity;
    c[i4 + 2] = color.b * intensity;
    c[i4 + 3] = alpha;
    b[i4] = width;
    b[i4 + 1] = dashes;
    b[i4 + 2] = turns;
    b[i4 + 3] = fill;
    this.count++;
  }

  end(): void {
    const n = this.count * 4;
    markRange(this.a, n);
    markRange(this.c, n);
    markRange(this.b, n);
    this.geometry.instanceCount = this.count;
  }
}

// ───────────────────────────── Beams ─────────────────────────────

const BEAM_VERTEX = /* glsl */ `
  attribute vec3 iStart;
  attribute vec3 iEnd;
  attribute vec4 iColor;   // rgb, alpha at start
  attribute vec4 iParams;  // width start, width end, alpha multiplier at end, white-hot core strength
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec2 vShape;
  void main() {
    vec3 axis = iEnd - iStart;
    vec3 p = mix(iStart, iEnd, position.x);
    vec3 toCam = cameraPosition - p;
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
    float w = mix(iParams.x, iParams.y, position.x);
    p += side * position.y * w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vUv = position.xy;
    vColor = vec4(iColor.rgb, iColor.a * mix(1.0, iParams.z, position.x));
    vShape = vec2(iParams.w, 0.0);
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec2 vShape;
  void main() {
    float x = clamp(abs(vUv.y), 0.0, 1.0);
    float glow = pow(1.0 - x, 2.2);
    float core = pow(1.0 - x, 12.0) * vShape.x;
    float ends = smoothstep(0.0, 0.02, vUv.x) * smoothstep(1.0, 0.98, vUv.x);
    float a = vColor.a * ends;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * glow + vec3(core), a * max(glow, core));
  }
`;

export class BeamBatch {
  readonly mesh: THREE.Mesh;
  private count = 0;
  private readonly cap: number;
  private readonly s: THREE.InstancedBufferAttribute;
  private readonly e: THREE.InstancedBufferAttribute;
  private readonly c: THREE.InstancedBufferAttribute;
  private readonly p: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(capacity: number, renderOrder: number) {
    this.cap = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 2, 8, 1);
    quad.translate(0.5, 0, 0);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const attr = (size: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    this.s = attr(3);
    this.e = attr(3);
    this.c = attr(4);
    this.p = attr(4);
    geo.setAttribute('iStart', this.s);
    geo.setAttribute('iEnd', this.e);
    geo.setAttribute('iColor', this.c);
    geo.setAttribute('iParams', this.p);
    geo.instanceCount = 0;
    this.geometry = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void {
    this.count = 0;
  }

  push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: THREE.Color,
    intensity: number,
    alpha: number,
    widthStart: number,
    widthEnd: number,
    endAlpha = 1,
    core = 0.6,
  ): void {
    if (this.count >= this.cap || alpha <= 0.002) return;
    const i3 = this.count * 3;
    const i4 = this.count * 4;
    const s = this.s.array as Float32Array;
    const e = this.e.array as Float32Array;
    const c = this.c.array as Float32Array;
    const p = this.p.array as Float32Array;
    s[i3] = ax;
    s[i3 + 1] = ay;
    s[i3 + 2] = az;
    e[i3] = bx;
    e[i3 + 1] = by;
    e[i3 + 2] = bz;
    c[i4] = color.r * intensity;
    c[i4 + 1] = color.g * intensity;
    c[i4 + 2] = color.b * intensity;
    c[i4 + 3] = alpha;
    p[i4] = widthStart;
    p[i4 + 1] = widthEnd;
    p[i4 + 2] = endAlpha;
    p[i4 + 3] = core;
    this.count++;
  }

  end(): void {
    markRange(this.s, this.count * 3);
    markRange(this.e, this.count * 3);
    markRange(this.c, this.count * 4);
    markRange(this.p, this.count * 4);
    this.geometry.instanceCount = this.count;
  }
}

// ───────────────────────────── Shells ─────────────────────────────

/** Shading styles of ShellBatch spheres. */
export const ShellStyle = {
  Glow: 0, // fresnel rim + inner fill
  Vault: 1, // golden hex-grid force field (Bankr vault mode)
  Orb: 2, // Zora gradient orb (colorA → colorB swirl)
  Fire: 3, // turbulent fireball (colorA hot core, colorB edge)
  Radar: 4, // scanning grid sweep (Pons reveal)
} as const;
export type ShellStyleId = (typeof ShellStyle)[keyof typeof ShellStyle];

const SHELL_VERTEX = /* glsl */ `
  attribute vec4 iColorA;  // rgb, alpha
  attribute vec4 iColorB;  // rgb, fill
  attribute vec4 iParams;  // style, fresnel power, seed, squash (y scale)
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vP;
  void main() {
    vec3 pos = position;
    vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vObj = position;
    vA = iColorA;
    vB = iColorB;
    vP = iParams;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vP;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(
        mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x),
        f.y),
      f.z);
  }

  void main() {
    float style = vP.x;
    float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float fres = pow(1.0 - ndv, vP.y);
    vec3 rgb;
    float a;
    float t = uTime + vP.z * 10.0;
    if (style < 0.5) {
      rgb = vA.rgb * (fres * 1.4 + vB.a);
      a = vA.a * clamp(fres + vB.a, 0.0, 1.0);
    } else if (style < 1.5) {
      // Vault: hex-ish lattice scrolling upward + strong gold rim.
      vec3 n = normalize(vObj);
      vec2 uv = vec2(atan(n.z, n.x) * 2.2, n.y * 6.0 + t * 0.6);
      vec2 g = abs(fract(uv + vec2(0.5 * floor(uv.y), 0.0)) - 0.5);
      float lines = smoothstep(0.42, 0.5, max(g.x * 1.1, g.y));
      float pulse = 0.6 + 0.4 * sin(t * 6.0 + n.y * 8.0);
      rgb = vA.rgb * (fres * 1.6 + lines * 0.9 * pulse + vB.a);
      a = vA.a * clamp(fres + lines * 0.7 + vB.a, 0.0, 1.0);
    } else if (style < 2.5) {
      // Zora orb: blue→pink gradient with slow swirl + bright rim.
      vec3 n = normalize(vObj);
      float swirl = noise(n * 2.5 + vec3(t * 0.25, t * 0.15, 0.0));
      float grad = clamp(0.5 + 0.5 * n.y + (swirl - 0.5) * 0.7, 0.0, 1.0);
      vec3 base = mix(vA.rgb, vB.rgb, grad);
      rgb = base * (0.2 + fres * 1.5) + base * pow(fres, 6.0) * 0.8;
      a = vA.a * clamp(0.18 + fres * 1.1, 0.0, 1.0);
    } else if (style < 3.5) {
      // Fireball: turbulent hot core fading to smoky edge.
      vec3 n = normalize(vObj);
      float turb = noise(n * 3.0 + vec3(0.0, -t * 2.5, t)) * 0.65 + noise(n * 7.0 - vec3(t * 3.0)) * 0.35;
      float heat = clamp(ndv * 1.2 * (0.45 + turb), 0.0, 1.0);
      rgb = mix(vB.rgb * 0.8, vA.rgb, heat * heat) * (0.35 + heat * 1.1);
      a = vA.a * clamp(heat * 1.3 + 0.1, 0.0, 1.0);
    } else {
      // Radar: sweeping latitude bands + rim.
      vec3 n = normalize(vObj);
      float band = smoothstep(0.9, 1.0, sin(n.y * 30.0 - t * 12.0));
      float sweep = pow(0.5 + 0.5 * sin(atan(n.z, n.x) - t * 5.0), 8.0);
      rgb = vA.rgb * (fres * 1.5 + band * 0.8 + sweep * 0.8);
      a = vA.a * clamp(fres + band * 0.5 + sweep * 0.5, 0.0, 1.0);
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(rgb, a);
  }
`;

const tmpMatrix = new THREE.Matrix4();

export class ShellBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private count = 0;
  private readonly cap: number;
  private readonly ca: THREE.InstancedBufferAttribute;
  private readonly cb: THREE.InstancedBufferAttribute;
  private readonly p: THREE.InstancedBufferAttribute;

  constructor(capacity: number, renderOrder: number) {
    this.cap = capacity;
    const geo = new THREE.SphereGeometry(1, 40, 24);
    const attr = (): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.ca = attr();
    this.cb = attr();
    this.p = attr();
    geo.setAttribute('iColorA', this.ca);
    geo.setAttribute('iColorB', this.cb);
    geo.setAttribute('iParams', this.p);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
  }

  begin(time: number): void {
    this.count = 0;
    this.material.uniforms.uTime!.value = time;
  }

  push(
    x: number,
    y: number,
    z: number,
    radius: number,
    style: ShellStyleId,
    colorA: THREE.Color,
    intensity: number,
    alpha: number,
    colorB: THREE.Color,
    fill: number,
    fresnelPower = 2.5,
    squash = 1,
    seed = 0,
  ): void {
    if (this.count >= this.cap || alpha <= 0.002 || radius <= 0.01) return;
    const i = this.count++;
    tmpMatrix.makeScale(radius, radius * squash, radius);
    tmpMatrix.setPosition(x, y, z);
    this.mesh.setMatrixAt(i, tmpMatrix);
    const i4 = i * 4;
    const ca = this.ca.array as Float32Array;
    const cb = this.cb.array as Float32Array;
    const p = this.p.array as Float32Array;
    ca[i4] = colorA.r * intensity;
    ca[i4 + 1] = colorA.g * intensity;
    ca[i4 + 2] = colorA.b * intensity;
    ca[i4 + 3] = alpha;
    cb[i4] = colorB.r * intensity;
    cb[i4 + 1] = colorB.g * intensity;
    cb[i4 + 2] = colorB.b * intensity;
    cb[i4 + 3] = fill;
    p[i4] = style;
    p[i4 + 1] = fresnelPower;
    p[i4 + 2] = seed;
    p[i4 + 3] = squash;
  }

  end(): void {
    const n = this.count;
    this.mesh.count = n;
    markRange(this.mesh.instanceMatrix, n * 16);
    markRange(this.ca, n * 4);
    markRange(this.cb, n * 4);
    markRange(this.p, n * 4);
  }
}
