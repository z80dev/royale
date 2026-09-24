// Holographic 3D text pops ("NGMI", "REKT", "RUG PULLED", "WHALE ALERT"…) as pooled sprites.
// Textures are cached per string (bounded set of short phrases) and get baked hologram scanlines.

import * as THREE from 'three';
import { textTexture } from '../../assets';
import { easeOutBack } from '../common';

const textureCache = new Map<string, THREE.CanvasTexture>();

function hologramTexture(text: string): THREE.CanvasTexture {
  let tex = textureCache.get(text);
  if (tex) return tex;
  tex = textTexture(text, {
    width: 1024,
    height: 256,
    color: '#ffffff',
    glow: '#ffffff',
    font: '900 {px}px "Space Grotesk", "Inter", system-ui, sans-serif',
  });
  const canvas = tex.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < canvas.height; y += 6) ctx.fillRect(0, y, canvas.width, 2);
  ctx.globalCompositeOperation = 'source-over';
  tex.needsUpdate = true;
  textureCache.set(text, tex);
  return tex;
}

interface TextSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rise: number;
  r: number;
  g: number;
  b: number;
}

export class TextPops {
  readonly group = new THREE.Group();
  private readonly slots: TextSlot[] = [];

  constructor(capacity = 14) {
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 60;
      this.group.add(sprite);
      this.slots.push({ sprite, material, age: 0, life: 0, x: 0, y: 0, z: 0, scale: 1, rise: 0, r: 1, g: 1, b: 1 });
    }
  }

  /** Pops `text` at a world point; width in meters ≈ 4·scale. */
  pop(text: string, x: number, y: number, z: number, color: THREE.Color, scale = 1, life = 1.8, rise = 1.6): void {
    let slot = this.slots[0]!;
    for (const s of this.slots) {
      if (s.life <= 0) {
        slot = s;
        break;
      }
      if (s.age / s.life > slot.age / slot.life) slot = s;
    }
    slot.material.map = hologramTexture(text);
    slot.material.needsUpdate = true;
    slot.age = 0;
    slot.life = life;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.scale = scale;
    slot.rise = rise;
    slot.r = color.r * 2.2;
    slot.g = color.g * 2.2;
    slot.b = color.b * 2.2;
    slot.sprite.visible = true;
  }

  update(dt: number, time: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.life = 0;
        s.sprite.visible = false;
        continue;
      }
      const grow = easeOutBack(Math.min(1, s.age / 0.28));
      const w = 4.2 * s.scale * grow;
      s.sprite.scale.set(w, w * 0.25, 1);
      s.sprite.position.set(s.x, s.y + s.rise * (1 - (1 - t) * (1 - t)), s.z);
      const flicker = 0.82 + 0.18 * Math.sin(time * 47 + s.x) * Math.sin(time * 13.7);
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const k = flicker * fade;
      s.material.color.setRGB(s.r * k, s.g * k, s.b * k);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.life = 0;
      s.sprite.visible = false;
    }
  }
}
