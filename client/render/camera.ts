// Camera rig: per-mode desired framing (lobby flyover, deploy, play look-ahead, spectate, ended orbit), exponential
// damping between them, and trauma-based screen shake that never leaks into picking/projection.
//
// Framing is aspect-aware: the vertical FOV widens on narrow/portrait viewports and the play/deploy distance is
// solved so a minimum patch of ground is always visible in BOTH axes, whatever the window shape.

import * as THREE from 'three';
import type { CameraMode, FrameView } from '../view';

const DEG = Math.PI / 180;
const BASE_FOV = 45; // vertical, degrees (landscape)
const MAX_FOV = 68; // vertical cap for very tall viewports
/** tan(horizontal half-FOV) every viewport gets at least (= a 1.25:1 viewport at BASE_FOV). */
const MIN_H_HALF_TAN = 1.25 * Math.tan((BASE_FOV / 2) * DEG);
/** tan(horizontal half-FOV) the lobby/ended orbits were composed for (16:10 at BASE_FOV). */
const ORBIT_REF_H_HALF_TAN = 1.6 * Math.tan((BASE_FOV / 2) * DEG);

const PLAY_PITCH = 58 * DEG;
const PLAY_MIN_W = 54; // m of ground visible across the focus row (52 m at player height + margin)
const PLAY_MIN_H = 34; // m of ground visible from bottom to top edge
const DEPLOY_PITCH = 68 * DEG;
const DEPLOY_MIN_W = 92;
const DEPLOY_MIN_H = 60;
const LOOK_AHEAD = 0.22; // fraction of focus→aim vector
const LOOK_AHEAD_FRACTION_MAX = 0.18; // cap as a fraction of the smaller visible ground extent
const GROUND_RADIUS_CAP = 150; // rays that miss the ground (sky) count as this far

interface Framing {
  targetRate: number;
  offsetRate: number;
}

const FRAMING: Record<CameraMode, Framing> = {
  lobby: { targetRate: 1.2, offsetRate: 1.2 },
  deploy: { targetRate: 4, offsetRate: 2.2 },
  play: { targetRate: 10, offsetRate: 3 },
  spectate: { targetRate: 5, offsetRate: 3 },
  ended: { targetRate: 2.5, offsetRate: 1.5 },
};

const CORNERS: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 1.5, 2400); // near 1.5: depth precision
  /** Smoothed look-at point (the "focus" used for shadows, fake lights, sky, audio attenuation). */
  readonly target = new THREE.Vector3();
  /** Farthest visible ground point from `target` (m, capped) — sizes the shadow frustum. */
  groundRadius = 60;
  mode: CameraMode = 'lobby';
  private offset = new THREE.Vector3(60, 40, 60);
  private desiredTarget = new THREE.Vector3();
  private desiredOffset = new THREE.Vector3();
  private initialized = false;
  private trauma = 0;
  private shakePos = new THREE.Vector3();
  private shakeRoll = 0;
  private orbitScale = 1;
  private readonly corner = new THREE.Vector3();

  /** Viewport changed: pick the vertical FOV for this aspect and update the projection. */
  setAspect(aspect: number): void {
    const halfTan = Math.min(
      Math.tan((MAX_FOV / 2) * DEG),
      Math.max(Math.tan((BASE_FOV / 2) * DEG), MIN_H_HALF_TAN / aspect),
    );
    this.camera.aspect = aspect;
    this.camera.fov = (2 * Math.atan(halfTan)) / DEG;
    this.camera.updateProjectionMatrix();
    this.orbitScale = Math.max(1, ORBIT_REF_H_HALF_TAN / (aspect * halfTan));
  }

  /**
   * Camera distance at `pitch` so at least minW × minH metres of ground are visible around the target:
   * minW across the target row, minH between the bottom and top screen edges.
   */
  private fitDistance(pitch: number, minW: number, minH: number): number {
    const halfV = (this.camera.fov / 2) * DEG;
    const halfTan = Math.tan(halfV);
    const byWidth = minW / (2 * this.camera.aspect * halfTan);
    const depthPerMetre = Math.sin(pitch) * (1 / Math.tan(pitch - halfV) - 1 / Math.tan(pitch + halfV));
    return Math.max(byWidth, minH / depthPerMetre);
  }

  update(view: FrameView, dt: number, time: number): void {
    this.mode = view.cameraMode;
    const f = view.focus;
    const dT = this.desiredTarget;
    const dO = this.desiredOffset;
    switch (view.cameraMode) {
      case 'lobby': {
        // Slow orbit that alternates between a high overview and low sweeping passes that show the skyline,
        // the ₿ moon and the whale. Pulled back on narrow viewports so the composition survives portrait.
        const low = 0.5 + 0.5 * Math.sin(time * 0.045 + 1); // 0 = high, 1 = low
        dT.set(Math.sin(time * 0.05) * 26, 3 + low * 12, Math.cos(time * 0.043) * 22);
        const a = time * 0.035 + 0.6;
        const radius = (74 + 22 * Math.sin(time * 0.061)) * this.orbitScale;
        dO.set(Math.cos(a) * radius, (44 - low * 30) * this.orbitScale, Math.sin(a) * radius);
        break;
      }
      case 'deploy': {
        dT.set(f.x, f.y, f.z);
        if (view.deployTarget) {
          const lx = (view.deployTarget.x - f.x) * 0.25;
          const lz = (view.deployTarget.z - f.z) * 0.25;
          const len = Math.hypot(lx, lz);
          const k = len > 14 ? 14 / len : 1;
          dT.x += lx * k;
          dT.z += lz * k;
        }
        const dist = this.fitDistance(DEPLOY_PITCH, DEPLOY_MIN_W, DEPLOY_MIN_H);
        dO.set(0, Math.sin(DEPLOY_PITCH) * dist, Math.cos(DEPLOY_PITCH) * dist);
        break;
      }
      case 'play':
      case 'spectate': {
        dT.set(f.x, f.y, f.z);
        if (view.cameraMode === 'play' && view.aimWorld) {
          const maxLead = LOOK_AHEAD_FRACTION_MAX * Math.min(PLAY_MIN_W, PLAY_MIN_H);
          const lx = (view.aimWorld.x - f.x) * LOOK_AHEAD;
          const lz = (view.aimWorld.z - f.z) * LOOK_AHEAD;
          const len = Math.hypot(lx, lz);
          const k = len > maxLead ? maxLead / len : 1;
          dT.x += lx * k;
          dT.z += lz * k;
        }
        const dist = this.fitDistance(PLAY_PITCH, PLAY_MIN_W, PLAY_MIN_H);
        dO.set(0, Math.sin(PLAY_PITCH) * dist, Math.cos(PLAY_PITCH) * dist);
        break;
      }
      case 'ended': {
        dT.set(f.x, f.y + 1, f.z);
        const a = time * 0.14;
        const r = 21 * this.orbitScale;
        dO.set(Math.sin(a) * r, (12 + Math.sin(time * 0.3) * 2) * this.orbitScale, Math.cos(a) * r);
        break;
      }
    }
    const framing = FRAMING[view.cameraMode];
    if (!this.initialized || this.target.distanceToSquared(dT) > 170 * 170) {
      this.target.copy(dT);
      this.offset.copy(dO);
      this.initialized = true;
    } else {
      this.target.lerp(dT, 1 - Math.exp(-dt * framing.targetRate));
      this.offset.lerp(dO, 1 - Math.exp(-dt * framing.offsetRate));
    }
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.groundRadius = this.measureGroundRadius();
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
  }

  /** Max distance from the target to where the four screen corners hit the ground (y = 0). */
  private measureGroundRadius(): number {
    let radius = 0;
    const eye = this.camera.position;
    for (const [x, y] of CORNERS) {
      const c = this.corner.set(x, y, 0.5).unproject(this.camera).sub(eye);
      if (c.y >= -1e-4) return GROUND_RADIUS_CAP;
      const t = -eye.y / c.y;
      const d = Math.hypot(eye.x + c.x * t - this.target.x, eye.z + c.z * t - this.target.z);
      radius = Math.max(radius, d);
    }
    return Math.min(radius, GROUND_RADIUS_CAP);
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  /** Offsets the camera by the current shake for rendering; call removeShake() after the render. */
  applyShake(time: number): void {
    const s = this.trauma * this.trauma;
    if (s <= 0.0001) {
      this.shakePos.set(0, 0, 0);
      this.shakeRoll = 0;
      return;
    }
    const t = time * 28;
    this.shakePos.set(
      (Math.sin(t * 1.13) + Math.sin(t * 2.71 + 1.7) * 0.5) * s * 0.9,
      (Math.sin(t * 1.37 + 0.3) + Math.sin(t * 3.1 + 2.2) * 0.5) * s * 0.6,
      (Math.sin(t * 0.97 + 2.1) + Math.sin(t * 2.3 + 0.6) * 0.5) * s * 0.9,
    );
    this.shakeRoll = Math.sin(t * 0.83 + 4.2) * s * 0.035;
    this.camera.position.add(this.shakePos);
    this.camera.rotateZ(this.shakeRoll);
    this.camera.updateMatrixWorld();
  }

  removeShake(): void {
    if (this.shakeRoll === 0 && this.shakePos.lengthSq() === 0) return;
    this.camera.rotateZ(-this.shakeRoll);
    this.camera.position.sub(this.shakePos);
    this.camera.updateMatrixWorld();
  }
}
