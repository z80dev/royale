// GPU-instanced CPU-simulated particles. One draw call per batch (additive glow batch + alpha smoke batch).
// Particles are camera-facing sprites sampled from a procedurally drawn 4×2 shape atlas; with `stretch`
// they become velocity-aligned streaks (sparks, speed lines, tracers' embers).

import * as THREE from 'three';

/** Cells of the procedural particle atlas. */
export const Atlas = {
  Dot: 0,
  Star: 1,
  Ring: 2,
  Arrow: 3,
  Plus: 4,
  Shard: 5,
  Smoke: 6,
  Bitcoin: 7,
} as const;
export type AtlasCell = (typeof Atlas)[keyof typeof Atlas];

const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
const CELL = 128;

let atlasTexture: THREE.CanvasTexture | null = null;

function drawAtlasCell(ctx: CanvasRenderingContext2D, index: number): void {
  const ox = (index % ATLAS_COLS) * CELL;
  const oy = Math.floor(index / ATLAS_COLS) * CELL;
  const c = CELL / 2;
  ctx.save();
  ctx.translate(ox + c, oy + c);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  switch (index) {
    case Atlas.Dot: {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-c, -c, CELL, CELL);
      break;
    }
    case Atlas.Star: {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.45);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-c, -c, CELL, CELL);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.98);
        ctx.lineTo(c * 0.07, 0);
        ctx.lineTo(-c * 0.07, 0);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case Atlas.Ring: {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case Atlas.Arrow: {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.85);
      ctx.lineTo(c * 0.62, -c * 0.05);
      ctx.lineTo(c * 0.24, -c * 0.05);
      ctx.lineTo(c * 0.24, c * 0.8);
      ctx.lineTo(-c * 0.24, c * 0.8);
      ctx.lineTo(-c * 0.24, -c * 0.05);
      ctx.lineTo(-c * 0.62, -c * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case Atlas.Plus: {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 12;
      const t = c * 0.2;
      const l = c * 0.72;
      ctx.fillRect(-t, -l, t * 2, l * 2);
      ctx.fillRect(-l, -t, l * 2, t * 2);
      break;
    }
    case Atlas.Shard: {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.9);
      ctx.lineTo(c * 0.32, c * 0.1);
      ctx.lineTo(0, c * 0.9);
      ctx.lineTo(-c * 0.32, c * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case Atlas.Smoke: {
      // Soft lumpy puff: several overlapping radial blobs.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = i === 0 ? 0 : c * 0.3;
        const bx = Math.cos(a) * r;
        const by = Math.sin(a) * r;
        const rad = c * (i === 0 ? 0.62 : 0.42);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-c, -c, CELL, CELL);
      }
      break;
    }
    case Atlas.Bitcoin: {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `900 ${Math.round(c * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₿', 0, c * 0.05);
      break;
    }
  }
  ctx.restore();
}

export function particleAtlas(): THREE.CanvasTexture {
  if (atlasTexture) return atlasTexture;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * ATLAS_COLS;
  canvas.height = CELL * ATLAS_ROWS;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) drawAtlasCell(ctx, i);
  atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.generateMipmaps = true;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  return atlasTexture;
}

const VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iColor;
  attribute vec4 iParams; // size, stretch, rotation, atlas index
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float size = iParams.x;
    vec2 axis = vec2(cos(iParams.z), sin(iParams.z));
    float along = size;
    if (iParams.y > 0.0) {
      vec2 v = (modelViewMatrix * vec4(iVel, 0.0)).xy;
      float speed = length(v);
      if (speed > 1e-4) {
        axis = v / speed;
        along = size + speed * iParams.y;
      }
    }
    vec2 perp = vec2(-axis.y, axis.x);
    mv.xy += axis * position.x * along + perp * position.y * size;
    gl_Position = projectionMatrix * mv;
    float cell = iParams.w;
    vec2 cellOrigin = vec2(mod(cell, ${ATLAS_COLS}.0), ${ATLAS_ROWS - 1}.0 - floor(cell / ${ATLAS_COLS}.0));
    vUv = (cellOrigin + (position.xy * 0.5 + 0.5)) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
    vColor = iColor;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vColor.a;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  }
`;

/** Flags the first `count` floats of a dynamic attribute for upload. */
export function markRange(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

/**
 * SoA particle pool. Dead particles are swap-removed so the live set is always [0, count).
 * All tunables are per-particle so one batch hosts every effect.
 */
export class ParticleBatch {
  readonly mesh: THREE.Mesh;
  count = 0;
  private readonly cap: number;

  // Simulation state.
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly alpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly stretch: Float32Array;
  private readonly cell: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly bounce: Float32Array;
  private readonly fields: Float32Array[];

  // GPU attributes.
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aParams: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(capacity: number, additive: boolean, renderOrder: number) {
    this.cap = capacity;
    const f = (): Float32Array => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.size1 = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.alpha = f();
    this.gravity = f();
    this.drag = f();
    this.stretch = f();
    this.cell = f();
    this.rot = f();
    this.spin = f();
    this.fadeIn = f();
    this.bounce = f();
    this.fields = [
      this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.size0, this.size1,
      this.cr, this.cg, this.cb, this.alpha, this.gravity, this.drag, this.stretch, this.cell, this.rot,
      this.spin, this.fadeIn, this.bounce,
    ];

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const a of [this.aPos, this.aVel, this.aColor, this.aParams]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iParams', this.aParams);
    geo.instanceCount = 0;
    this.geometry = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: particleAtlas() } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  /**
   * Spawns one particle. Returns false when the pool is full (the effect silently thins out).
   * Colors are linear and may exceed 1 (bloom).
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    gravity: number,
    drag: number,
    stretch: number,
    cell: AtlasCell,
    rot: number,
    spin: number,
    fadeIn: number,
    bounce: number,
  ): boolean {
    if (this.count >= this.cap) return false;
    const i = this.count++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.alpha[i] = alpha;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.stretch[i] = stretch;
    this.cell[i] = cell;
    this.rot[i] = rot;
    this.spin[i] = spin;
    this.fadeIn[i] = fadeIn;
    this.bounce[i] = bounce;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt: number): void {
    let n = this.count;
    const { px, py, pz, vx, vy, vz, age, life } = this;
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        n--;
        if (i !== n) for (const field of this.fields) field[i] = field[n];
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      vx[i] *= k;
      vy[i] = vy[i] * k - this.gravity[i] * dt;
      vz[i] *= k;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      if (this.bounce[i] > 0 && py[i] < 0.05 && vy[i] < 0) {
        py[i] = 0.05;
        vy[i] = -vy[i] * this.bounce[i];
        vx[i] *= 0.6;
        vz[i] *= 0.6;
      }
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this.count = n;
    this.upload();
  }

  private upload(): void {
    const n = this.count;
    const pos = this.aPos.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    const color = this.aColor.array as Float32Array;
    const params = this.aParams.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const fi = this.fadeIn[i];
      const envelope = (fi > 0 && t < fi ? t / fi : 1) * (1 - t) * (1 - t * 0.35);
      const i3 = i * 3;
      const i4 = i * 4;
      pos[i3] = this.px[i];
      pos[i3 + 1] = this.py[i];
      pos[i3 + 2] = this.pz[i];
      vel[i3] = this.vx[i];
      vel[i3 + 1] = this.vy[i];
      vel[i3 + 2] = this.vz[i];
      color[i4] = this.cr[i];
      color[i4 + 1] = this.cg[i];
      color[i4 + 2] = this.cb[i];
      color[i4 + 3] = this.alpha[i] * envelope;
      params[i4] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      params[i4 + 1] = this.stretch[i];
      params[i4 + 2] = this.rot[i];
      params[i4 + 3] = this.cell[i];
    }
    markRange(this.aPos, n * 3);
    markRange(this.aVel, n * 3);
    markRange(this.aColor, n * 4);
    markRange(this.aParams, n * 4);
    this.geometry.instanceCount = n;
  }
}
