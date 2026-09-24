// Shared texture helpers for all render modules (world + actors). Cached; safe to call every build.

import * as THREE from 'three';
import { CHARACTER_BY_ID, type CharacterId } from '../../shared/constants';

const badgeCache = new Map<CharacterId, THREE.Texture>();

function drawFallbackBadge(ctx: CanvasRenderingContext2D, id: CharacterId, size: number): void {
  const c = CHARACTER_BY_ID[id];
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.22);
  ctx.fillStyle = c.primary;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(size * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(c.name.slice(0, 1).toUpperCase(), size / 2, size / 2 + size * 0.03);
}

/**
 * Square brand badge texture (public/badges/<id>.png, 512×512, rounded corners, sRGB).
 * Returns immediately with a generated fallback drawn in; swaps to the real image once loaded.
 */
export function badgeTexture(id: CharacterId): THREE.Texture {
  const cached = badgeCache.get(id);
  if (cached) return cached;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  drawFallbackBadge(ctx, id, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    tex.needsUpdate = true;
  };
  img.src = CHARACTER_BY_ID[id].logo;
  badgeCache.set(id, tex);
  return tex;
}

export interface TextTextureOpts {
  width?: number; // canvas px (default 1024)
  height?: number; // canvas px (default 256)
  font?: string; // CSS font (default bold sans sized to height)
  color?: string; // fill color
  glow?: string; // shadow color for neon glow
  background?: string; // fill behind text (default transparent)
  align?: CanvasTextAlign;
}

/** Canvas texture with a single (neon) line of text, auto-shrunk to fit width. Not cached. */
export function textTexture(text: string, opts: TextTextureOpts = {}): THREE.CanvasTexture {
  const w = opts.width ?? 1024;
  const h = opts.height ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  }
  let px = Math.round(h * 0.62);
  const family = opts.font ?? '900 {px}px "Space Grotesk", system-ui, sans-serif';
  ctx.font = family.replace('{px}', String(px));
  while (ctx.measureText(text).width > w * 0.92 && px > 8) {
    px -= 2;
    ctx.font = family.replace('{px}', String(px));
  }
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  const x = ctx.textAlign === 'left' ? w * 0.04 : w / 2;
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = h * 0.12;
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(text, x, h / 2);
  if (opts.glow) ctx.fillText(text, x, h / 2); // second pass intensifies the glow
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
