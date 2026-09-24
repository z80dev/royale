// Static world built from a GameMap: ground/roads/boundary/skyline, props, HQs, landmarks, billboards, lights.
// setMap() tears down the previous build completely (every GPU resource is tracked in a Bag).

import * as THREE from 'three';
import type { BoxOb, GameMap } from '../../../shared/map';
import { buildGround } from './ground';
import { buildHqs } from './hq';
import { Bag, Batcher, batchMaterials, glowTexture, MAX_FAKE_LIGHTS, worldUniforms, type BuildCtx } from './kit';
import { buildLandmarks } from './landmarks';
import { buildProps } from './props';
import { buildBillboards, buildLightHalos } from './signs';

interface FakeLight {
  x: number;
  y: number;
  z: number;
  color: THREE.Color; // premultiplied by intensity
  range: number;
  dist2: number;
}

const PROP_STYLES = new Set(['tree', 'rock', 'crate', 'container', 'barrier', 'wall']);
/** Obstacles at least this tall can hide a standing player from the tilted camera. */
const OCCLUDER_MIN_HEIGHT = 2.2;
const OCCLUDER_STRIDE = 5; // minX, maxX, minZ, maxZ, height

export class World {
  readonly root = new THREE.Group();
  private bag = new Bag();
  private animators: ((time: number, dt: number, camera: THREE.Vector3) => void)[] = [];
  private lights: FakeLight[] = [];
  private lightFocus = new THREE.Vector3(1e9, 0, 0);
  private occluders: Float32Array = new Float32Array(0);

  constructor(scene: THREE.Scene) {
    this.root.name = 'world';
    scene.add(this.root);
  }

  setMap(map: GameMap): void {
    this.clear();
    const bag = this.bag;
    const batch = new Batcher();
    const mats = batchMaterials(bag);
    const ctx: BuildCtx = {
      map,
      root: this.root,
      bag,
      batch,
      glowTex: glowTexture(bag),
      animate: (fn) => this.animators.push(fn),
      light: (x, y, z, color, intensity, range = 12) => {
        this.lights.push({ x, y, z, color: new THREE.Color(color).multiplyScalar(intensity), range, dist2: 0 });
      },
    };
    this.occluders = buildOccluders(map);
    buildGround(ctx);
    buildProps(
      ctx,
      map.obstacles.filter((o) => PROP_STYLES.has(o.style)),
    );
    buildHqs(
      ctx,
      map.obstacles.filter((o): o is BoxOb => o.style === 'tower' && o.type === 'box'),
    );
    buildLandmarks(
      ctx,
      map.obstacles.filter((o) => !PROP_STYLES.has(o.style) && o.style !== 'tower'),
    );
    buildBillboards(ctx);
    buildLightHalos(ctx);
    batch.flush(this.root, mats, bag);
    this.lightFocus.set(1e9, 0, 0); // force light re-selection
  }

  /** Per-frame: animations + choose the fake lights nearest to the focus. */
  update(time: number, dt: number, focus: THREE.Vector3, camera: THREE.Vector3): void {
    for (const fn of this.animators) fn(time, dt, camera);
    if (focus.distanceToSquared(this.lightFocus) > 16) {
      this.lightFocus.copy(focus);
      this.selectLights(focus);
    }
  }

  /** True if any tall obstacle intersects the segment from `eye` to `focus` (3D slab test against AABBs). */
  occludes(eye: THREE.Vector3, focus: THREE.Vector3): boolean {
    const o = this.occluders;
    const dx = focus.x - eye.x;
    const dy = focus.y - eye.y;
    const dz = focus.z - eye.z;
    for (let i = 0; i < o.length; i += OCCLUDER_STRIDE) {
      let t0 = 0;
      let t1 = 1;
      // x slab
      if (Math.abs(dx) < 1e-9) {
        if (eye.x < o[i]! || eye.x > o[i + 1]!) continue;
      } else {
        let a = (o[i]! - eye.x) / dx;
        let b = (o[i + 1]! - eye.x) / dx;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) continue;
      }
      // z slab
      if (Math.abs(dz) < 1e-9) {
        if (eye.z < o[i + 2]! || eye.z > o[i + 3]!) continue;
      } else {
        let a = (o[i + 2]! - eye.z) / dz;
        let b = (o[i + 3]! - eye.z) / dz;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) continue;
      }
      // y slab [0, h]: the segment descends, so only the top face matters
      if (Math.abs(dy) > 1e-9) {
        let a = (0 - eye.y) / dy;
        let b = (o[i + 4]! - eye.y) / dy;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 <= t1) return true;
    }
    return false;
  }

  private selectLights(focus: THREE.Vector3): void {
    for (const l of this.lights) l.dist2 = (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2;
    this.lights.sort((a, b) => a.dist2 - b.dist2);
    const n = Math.min(MAX_FAKE_LIGHTS, this.lights.length);
    const pos = worldUniforms.uLightPos.value;
    const col = worldUniforms.uLightColor.value;
    for (let i = 0; i < n; i++) {
      const l = this.lights[i]!;
      pos[i]!.set(l.x, l.y, l.z, l.range);
      col[i]!.set(l.color.r, l.color.g, l.color.b);
    }
    worldUniforms.uLightCount.value = n;
  }

  private clear(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.root.clear();
    this.bag.dispose();
    this.animators.length = 0;
    this.lights.length = 0;
    worldUniforms.uLightCount.value = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}

/** Flattened AABBs of everything tall enough to hide a player (tree canopies are wider than their trunks). */
function buildOccluders(map: GameMap): Float32Array {
  const out: number[] = [];
  for (const o of map.obstacles) {
    if (o.h < OCCLUDER_MIN_HEIGHT) continue;
    const hx = o.type === 'box' ? o.hw : o.style === 'tree' ? o.r * 1.75 : o.r;
    const hz = o.type === 'box' ? o.hd : hx;
    out.push(o.x - hx, o.x + hx, o.z - hz, o.z + hz, o.h);
  }
  return new Float32Array(out);
}
