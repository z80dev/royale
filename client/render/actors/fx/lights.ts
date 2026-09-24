// Fixed pool of point lights for muzzle flashes and explosions. The lights never leave the scene (a changing
// light count would recompile every lit material); idle lights just sit at intensity 0.

import * as THREE from 'three';

export const LIGHT_POOL_SIZE = 6;

interface LightSlot {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
  priority: number;
}

export class LightPool {
  readonly group = new THREE.Group();
  private readonly slots: LightSlot[] = [];

  constructor() {
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 1.6);
      light.castShadow = false;
      this.group.add(light);
      this.slots.push({ light, age: 0, life: 0, peak: 0, priority: 0 });
    }
  }

  /**
   * Flashes a light. Higher `priority` (explosions 2, muzzle 1) may steal lights from lower priorities;
   * among equals the most-faded slot is recycled.
   */
  flash(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    intensity: number,
    life: number,
    range: number,
    priority: number,
  ): void {
    let best: LightSlot | null = null;
    let bestScore = -Infinity;
    for (const s of this.slots) {
      const remaining = s.life > 0 ? 1 - s.age / s.life : 0;
      if (remaining <= 0) {
        best = s;
        break;
      }
      if (s.priority > priority) continue;
      const score = (priority - s.priority) * 10 + (1 - remaining);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return;
    best.light.position.set(x, y, z);
    best.light.color.copy(color);
    best.light.distance = range;
    best.age = 0;
    best.life = life;
    best.peak = intensity;
    best.priority = priority;
    best.light.intensity = intensity;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.life = 0;
        s.light.intensity = 0;
        continue;
      }
      s.light.intensity = s.peak * (1 - t) * (1 - t);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.life = 0;
      s.light.intensity = 0;
    }
  }
}
