// Lit, physically tumbling debris: brand coins (kill bursts, chest payouts), rubble chunks (explosions)
// and brass casings (shell ejection). Each kind is one InstancedMesh; simulation is SoA + swap-remove.

import * as THREE from 'three';
import { selfLitMaterial } from '../common';

export const DebrisKind = { Coin: 0, Chunk: 1, Casing: 2 } as const;
export type DebrisKindId = (typeof DebrisKind)[keyof typeof DebrisKind];

class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly cap: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly rz: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly scale: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly fields: Float32Array[];
  private readonly euler = new THREE.Euler();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.cap = capacity;
    const f = (): Float32Array => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.rz = f();
    this.wx = f();
    this.wy = f();
    this.wz = f();
    this.age = f();
    this.life = f();
    this.scale = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.fields = [
      this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz,
      this.age, this.life, this.scale, this.cr, this.cg, this.cb,
    ];
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    scale: number,
    color: THREE.Color,
    intensity: number,
  ): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28;
    this.ry[i] = Math.random() * 6.28;
    this.rz[i] = Math.random() * 6.28;
    this.wx[i] = (Math.random() - 0.5) * 22;
    this.wy[i] = (Math.random() - 0.5) * 14;
    this.wz[i] = (Math.random() - 0.5) * 22;
    this.age[i] = 0;
    this.life[i] = life;
    this.scale[i] = scale;
    this.cr[i] = color.r * intensity;
    this.cg[i] = color.g * intensity;
    this.cb[i] = color.b * intensity;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    let n = this.count;
    let i = 0;
    while (i < n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        n--;
        if (i !== n) for (const field of this.fields) field[i] = field[n];
        continue;
      }
      this.vy[i] -= 22 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const grounded = this.py[i] <= 0.04;
      if (grounded) {
        this.py[i] = 0.04;
        if (this.vy[i] < -1.5) {
          this.vy[i] = -this.vy[i] * 0.38;
          this.vx[i] *= 0.55;
          this.vz[i] *= 0.55;
          this.wx[i] *= 0.5;
          this.wz[i] *= 0.5;
        } else {
          // Settle flat: kill spin and slide to a stop.
          this.vy[i] = 0;
          this.vx[i] *= Math.exp(-8 * dt);
          this.vz[i] *= Math.exp(-8 * dt);
          this.wx[i] = this.wy[i] = this.wz[i] = 0;
          this.rx[i] += (Math.round(this.rx[i] / Math.PI) * Math.PI - this.rx[i]) * Math.min(1, dt * 10);
          this.rz[i] += (Math.round(this.rz[i] / Math.PI) * Math.PI - this.rz[i]) * Math.min(1, dt * 10);
        }
      }
      this.rx[i] += this.wx[i] * dt;
      this.ry[i] += this.wy[i] * dt;
      this.rz[i] += this.wz[i] * dt;
      i++;
    }
    this.count = n;
    for (let j = 0; j < n; j++) {
      const t = this.age[j] / this.life[j];
      const shrink = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      const s = this.scale[j] * shrink;
      this.euler.set(this.rx[j], this.ry[j], this.rz[j]);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(this.px[j], this.py[j], this.pz[j]), this.quat, this.scl.set(s, s, s));
      this.mesh.setMatrixAt(j, this.matrix);
      this.mesh.setColorAt(j, this.color.setRGB(this.cr[j], this.cg[j], this.cb[j]));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, n * 3);
    ic.needsUpdate = true;
  }
}

export class Debris {
  readonly group = new THREE.Group();
  private readonly pools: DebrisPool[];

  constructor() {
    const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 14);
    const chunkGeo = new THREE.DodecahedronGeometry(0.16, 0);
    const casingGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6);
    casingGeo.rotateZ(Math.PI / 2);
    this.pools = [
      new DebrisPool(coinGeo, selfLitMaterial(0.55, 0.25, 0.85), 420),
      new DebrisPool(chunkGeo, selfLitMaterial(0.15, 0.8, 0.1), 260),
      new DebrisPool(casingGeo, selfLitMaterial(0.35, 0.3, 0.9), 200),
    ];
    for (const p of this.pools) this.group.add(p.mesh);
  }

  /** Radial burst of `count` pieces from (x, y, z). */
  burst(
    kind: DebrisKindId,
    x: number,
    y: number,
    z: number,
    count: number,
    color: THREE.Color,
    speed: number,
    up: number,
    life: number,
    scale = 1,
    intensity = 1,
  ): void {
    const pool = this.pools[kind]!;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      pool.spawn(
        x,
        y,
        z,
        Math.cos(a) * s,
        up * (0.6 + Math.random() * 0.6),
        Math.sin(a) * s,
        life * (0.75 + Math.random() * 0.5),
        scale * (0.7 + Math.random() * 0.5),
        color,
        intensity,
      );
    }
  }

  /** One piece with an explicit velocity (casing ejection). */
  one(
    kind: DebrisKindId,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: THREE.Color,
    scale = 1,
  ): void {
    this.pools[kind]!.spawn(x, y, z, vx, vy, vz, life, scale, color, 1);
  }

  update(dt: number): void {
    for (const p of this.pools) p.update(dt);
  }

  clear(): void {
    for (const p of this.pools) p.clear();
  }
}
