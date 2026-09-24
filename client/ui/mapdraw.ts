// Top-down 2D map rendering shared by the deploy picker, the minimap and the big map (M).
// The static layer (ground, roads, obstacles, bushes) is pre-rendered once per match into an offscreen canvas;
// dynamic layers (zone, HQ badges, labels, players, markers) are drawn every frame on top.

import { CHARACTER_BY_ID } from '../../shared/constants';
import type { GameMap, Obstacle } from '../../shared/map';
import { ST, type ZoneSnap } from '../../shared/protocol';
import type { FrameView } from '../view';
import { drawBadge, hexAlpha } from './dom';

const STYLE_FILL: Partial<Record<Obstacle['style'], string>> = {
  barrier: '#3a4452',
  crate: '#6b5236',
  tree: '#1d4a33',
  rock: '#4a4f58',
  statue: '#d9b25a',
  monolith: '#b7c4d6',
  pizza: '#d8613a',
  lambo: '#ffcf3a',
  ruin: '#5a4a52',
  doge: '#e0a84a',
  rig: '#3d5d7a',
  letter: '#f7c948',
  atm: '#f7931a',
  rocket: '#e8edf5',
  gantry: '#58657a',
  vault: '#8a93a3',
  luna: '#c6b7ff',
};

export const MAP_COLORS = {
  self: '#7CFFD4',
  teammate: '#3DDC84',
  enemy: '#FF3B5C',
  zone: '#8FE3FF',
  nextZone: '#FFFFFF',
  storm: 'rgba(120, 30, 110, 0.38)',
  airdrop: '#FFB627',
};

export class MapBase {
  readonly canvas: HTMLCanvasElement;
  readonly half: number;

  constructor(
    readonly map: GameMap,
    readonly pxPerMeter = 5,
  ) {
    this.half = map.half;
    const size = Math.round(map.half * 2 * pxPerMeter);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    const ctx = this.canvas.getContext('2d')!;
    this.paint(ctx, size);
  }

  private paint(ctx: CanvasRenderingContext2D, size: number): void {
    const s = this.pxPerMeter;
    const half = this.half;
    const px = (v: number) => (v + half) * s;

    // Ground: deep night asphalt with a radial glow toward Genesis Plaza.
    const ground = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.72);
    ground.addColorStop(0, '#14202b');
    ground.addColorStop(1, '#070b11');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size, size);

    // 10 m grid
    ctx.strokeStyle = 'rgba(124, 255, 212, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = -half; m <= half; m += 10) {
      ctx.moveTo(px(m) + 0.5, 0);
      ctx.lineTo(px(m) + 0.5, size);
      ctx.moveTo(0, px(m) + 0.5);
      ctx.lineTo(size, px(m) + 0.5);
    }
    ctx.stroke();

    // Roads
    ctx.lineCap = 'round';
    for (const road of this.map.roads) {
      ctx.strokeStyle = '#1c2633';
      ctx.lineWidth = road.w * s;
      ctx.beginPath();
      ctx.moveTo(px(road.x1), px(road.z1));
      ctx.lineTo(px(road.x2), px(road.z2));
      ctx.stroke();
    }
    ctx.setLineDash([s * 2, s * 2]);
    ctx.strokeStyle = 'rgba(255, 214, 90, 0.22)';
    ctx.lineWidth = Math.max(1, s * 0.2);
    for (const road of this.map.roads) {
      ctx.beginPath();
      ctx.moveTo(px(road.x1), px(road.z1));
      ctx.lineTo(px(road.x2), px(road.z2));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // HQ compounds: brand-tinted pads
    for (const hq of this.map.hqs) {
      const brand = CHARACTER_BY_ID[hq.brand];
      const x0 = px(hq.x - hq.half);
      const z0 = px(hq.z - hq.half);
      const w = hq.half * 2 * s;
      ctx.fillStyle = hexAlpha(brand.primary, 0.14);
      ctx.fillRect(x0, z0, w, w);
      ctx.strokeStyle = hexAlpha(brand.primary, 0.55);
      ctx.lineWidth = Math.max(1, s * 0.3);
      ctx.strokeRect(x0, z0, w, w);
    }

    // Landmark pads
    for (const lm of this.map.landmarks) {
      if (lm.id.startsWith('hq-')) continue;
      ctx.beginPath();
      ctx.arc(px(lm.x), px(lm.z), lm.r * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 196, 80, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 196, 80, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Bushes (tulips are pink)
    for (const bush of this.map.bushes) {
      ctx.beginPath();
      ctx.arc(px(bush.x), px(bush.z), bush.r * s, 0, Math.PI * 2);
      ctx.fillStyle = bush.tulip ? 'rgba(255, 90, 160, 0.45)' : 'rgba(40, 120, 70, 0.5)';
      ctx.fill();
    }

    // Obstacles
    for (const ob of this.map.obstacles) {
      let fill = STYLE_FILL[ob.style] ?? '#2a3340';
      if (ob.style === 'tower' || ob.style === 'wall') {
        const brand = ob.type === 'box' && ob.brand ? CHARACTER_BY_ID[ob.brand] : null;
        fill = brand ? (ob.style === 'tower' ? brand.primary : hexAlpha(brand.primary, 0.75)) : '#3a4452';
      } else if (ob.style === 'container' && ob.color) {
        fill = ob.color;
      }
      ctx.fillStyle = fill;
      if (ob.type === 'box') {
        ctx.fillRect(px(ob.x - ob.hw), px(ob.z - ob.hd), ob.hw * 2 * s, ob.hd * 2 * s);
      } else {
        ctx.beginPath();
        ctx.arc(px(ob.x), px(ob.z), ob.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Map border
    ctx.strokeStyle = 'rgba(124, 255, 212, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }
}

/** Mapping from world meters to canvas pixels for one draw call. */
export interface MapTransform {
  scale: number; // canvas px per meter
  ox: number; // canvas px of world x = 0
  oz: number; // canvas px of world z = 0
}

export function drawZone(ctx: CanvasRenderingContext2D, zone: ZoneSnap, t: MapTransform, w: number, h: number): void {
  const cx = t.ox + zone.cx * t.scale;
  const cz = t.oz + zone.cz * t.scale;
  const r = Math.max(0, zone.r * t.scale);
  // Storm: everything outside the current circle.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cz, r, 0, Math.PI * 2, true);
  ctx.fillStyle = MAP_COLORS.storm;
  ctx.fill('evenodd');
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cz, r, 0, Math.PI * 2);
  ctx.strokeStyle = MAP_COLORS.zone;
  ctx.lineWidth = 2;
  ctx.shadowColor = MAP_COLORS.zone;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (zone.phase >= 0 && (zone.nr < zone.r - 0.5 || zone.ncx !== zone.cx || zone.ncz !== zone.cz)) {
    ctx.beginPath();
    ctx.arc(t.ox + zone.ncx * t.scale, t.oz + zone.ncz * t.scale, Math.max(0, zone.nr * t.scale), 0, Math.PI * 2);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = MAP_COLORS.nextZone;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Arrow (triangle) pointing along `angle` — used for "you" markers. */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.65);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.7, -size * 0.65);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#041012';
  ctx.stroke();
  ctx.restore();
}

export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.stroke();
}

/** Airdrop marker: pulsing gold diamond. */
export function drawAirdrop(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now / 180);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, size * (1.4 + pulse * 0.8), 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(MAP_COLORS.airdrop, 0.6 - pulse * 0.4);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = MAP_COLORS.airdrop;
  ctx.shadowColor = MAP_COLORS.airdrop;
  ctx.shadowBlur = 10;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

export interface FullMapOptions {
  labels: boolean; // landmark names
  players: boolean; // draw player dots (teammates / self / revealed enemies)
  deployTarget: { x: number; z: number } | null;
}

/** Whole-map view (deploy picker + big map). Canvas is square; `size` in CSS px (ctx already DPR-scaled). */
export function drawFullMap(
  ctx: CanvasRenderingContext2D,
  base: MapBase,
  view: FrameView,
  size: number,
  opts: FullMapOptions,
): MapTransform {
  const half = base.half;
  const t: MapTransform = { scale: size / (half * 2), ox: size / 2, oz: size / 2 };
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base.canvas, 0, 0, size, size);
  if (view.zone) drawZone(ctx, view.zone, t, size, size);

  // HQ badges
  const badgeSize = Math.max(14, size * 0.045);
  for (const hq of base.map.hqs) {
    const x = t.ox + hq.x * t.scale;
    const z = t.oz + hq.z * t.scale;
    ctx.shadowColor = CHARACTER_BY_ID[hq.brand].primary;
    ctx.shadowBlur = 12;
    drawBadge(ctx, hq.brand, x - badgeSize / 2, z - badgeSize / 2, badgeSize);
    ctx.shadowBlur = 0;
  }

  if (opts.labels) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontPx = Math.max(9, Math.round(size * 0.018));
    for (const lm of base.map.landmarks) {
      const isHq = lm.id.startsWith('hq-');
      const x = t.ox + lm.x * t.scale;
      const z = t.oz + lm.z * t.scale + (isHq ? badgeSize * 0.5 + fontPx * 0.8 : 0);
      ctx.font = `${isHq ? 600 : 700} ${isHq ? fontPx - 1 : fontPx}px "Space Grotesk", system-ui, sans-serif`;
      const label = isHq ? lm.name.replace(' HQ', '') : lm.name.toUpperCase();
      // Landmarks on the inner ring sit close together: break two-word+ names onto two lines.
      const lines = !isHq && label.length > 9 && label.includes(' ') ? splitLabel(label) : [label];
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3, 6, 10, 0.85)';
      ctx.fillStyle = isHq ? 'rgba(232, 241, 242, 0.75)' : '#FFE3A3';
      lines.forEach((line, i) => {
        const y = z + (i - (lines.length - 1) / 2) * fontPx * 1.05;
        ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
      });
    }
  }

  // Airdrops (falling ents + landed unopened airdrop chests)
  for (const ent of view.ents) {
    if (ent.k === 'airdrop') drawAirdrop(ctx, t.ox + ent.x * t.scale, t.oz + ent.z * t.scale, 7, view.now);
  }
  for (const chest of view.chests) {
    if (chest.airdrop && !chest.open) drawAirdrop(ctx, t.ox + chest.x * t.scale, t.oz + chest.z * t.scale, 7, view.now);
  }

  if (opts.players) drawPlayers(ctx, view, t, 4, 8);

  if (opts.deployTarget) {
    const x = t.ox + opts.deployTarget.x * t.scale;
    const z = t.oz + opts.deployTarget.z * t.scale;
    drawDropMarker(ctx, x, z, view.now);
  }
  return t;
}

export function drawDropMarker(ctx: CanvasRenderingContext2D, x: number, z: number, now: number): void {
  const pulse = (now / 900) % 1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, z, 6 + pulse * 18, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha('#7CFFD4', 1 - pulse);
  ctx.lineWidth = 2;
  ctx.stroke();
  // pin
  ctx.translate(x, z);
  ctx.shadowColor = '#7CFFD4';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#7CFFD4';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-9, -12, -9, -24, 0, -24);
  ctx.bezierCurveTo(9, -24, 9, -12, 0, 0);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#04120e';
  ctx.beginPath();
  ctx.arc(0, -16, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Teammates (green), self (arrow), revealed enemies (red). */
export function drawPlayers(
  ctx: CanvasRenderingContext2D,
  view: FrameView,
  t: MapTransform,
  dotRadius: number,
  arrowSize: number,
): void {
  for (const p of view.players) {
    if (!p.alive || p.isSelf) continue;
    const x = t.ox + p.x * t.scale;
    const z = t.oz + p.z * t.scale;
    if (p.isTeammate) drawDot(ctx, x, z, dotRadius, MAP_COLORS.teammate);
    else if (p.st & ST.REVEALED) drawDot(ctx, x, z, dotRadius, MAP_COLORS.enemy);
    else if (p.id === view.focusId) drawDot(ctx, x, z, dotRadius, '#FFFFFF');
  }
  const self = view.players.find((p) => p.isSelf && p.alive);
  if (self) drawArrow(ctx, t.ox + self.x * t.scale, t.oz + self.z * t.scale, self.aim, arrowSize, MAP_COLORS.self);
}

/** Split a label at the space closest to its middle ("GENESIS PLAZA" → ["GENESIS", "PLAZA"]). */
function splitLabel(label: string): [string, string] {
  const mid = label.length / 2;
  let best = label.indexOf(' ');
  for (let i = best; i !== -1; i = label.indexOf(' ', i + 1)) {
    if (Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  return [label.slice(0, best), label.slice(best + 1)];
}
