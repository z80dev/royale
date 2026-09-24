// Minimap (top-right, north-up, ~60 m around the camera focus) and the big map toggled with M.

import { ZONE_PHASES } from '../../shared/constants';
import type { FrameView } from '../view';
import { drawBadge, fitCanvas, formatClock, h, setText, toggle } from './dom';
import { drawAirdrop, drawFullMap, drawPlayers, drawZone, MAP_COLORS, MapBase, type MapTransform } from './mapdraw';

const MINIMAP_RADIUS_M = 45;

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly gfx: CanvasRenderingContext2D;
  private readonly location: HTMLElement;
  private base: MapBase | null = null;
  private readonly t: MapTransform = { scale: 1, ox: 0, oz: 0 };

  constructor() {
    this.canvas = h('canvas.minimap-canvas');
    this.gfx = this.canvas.getContext('2d')!;
    this.location = h('span.minimap-loc');
    this.el = h(
      'div.minimap',
      null,
      this.canvas,
      h('span.minimap-n', { text: 'N' }),
      this.location,
      h('span.minimap-key', { text: 'M' }),
    );
  }

  setMap(base: MapBase): void {
    this.base = base;
  }

  update(view: FrameView): void {
    if (!this.base) return;
    const size = this.el.clientWidth || 200;
    const dpr = fitCanvas(this.canvas, size, size);
    const g = this.gfx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.fillStyle = '#05080d';
    g.fillRect(0, 0, size, size);

    const scale = size / (MINIMAP_RADIUS_M * 2);
    const t = this.t;
    t.scale = scale;
    t.ox = size / 2 - view.focus.x * scale;
    t.oz = size / 2 - view.focus.z * scale;
    const half = this.base.half;
    g.drawImage(this.base.canvas, t.ox - half * scale, t.oz - half * scale, half * 2 * scale, half * 2 * scale);
    if (view.zone) drawZone(g, view.zone, t, size, size);

    // HQ badges; the landmark you're standing in is named under the minimap (labels would overlap here).
    for (const hq of this.base.map.hqs) {
      const x = t.ox + hq.x * scale;
      const z = t.oz + hq.z * scale;
      if (x < -12 || z < -12 || x > size + 12 || z > size + 12) continue;
      drawBadge(g, hq.brand, x - 8, z - 8, 16);
    }
    let here = 'Open market';
    let hereDist = Infinity;
    for (const lm of this.base.map.landmarks) {
      const d = Math.hypot(lm.x - view.focus.x, lm.z - view.focus.z);
      if (d < lm.r + 6 && d < hereDist) {
        hereDist = d;
        here = lm.name;
      }
    }
    setText(this.location, here);

    for (const ent of view.ents) {
      if (ent.k === 'airdrop') drawAirdrop(g, t.ox + ent.x * scale, t.oz + ent.z * scale, 6, view.now);
    }
    for (const chest of view.chests) {
      if (chest.airdrop && !chest.open) drawAirdrop(g, t.ox + chest.x * scale, t.oz + chest.z * scale, 6, view.now);
    }

    // Safe-zone guide: dashed line from you to the next circle when you're outside it.
    const self = view.players.find((p) => p.isSelf && p.alive);
    const zone = view.zone;
    if (self && zone && zone.phase >= 0) {
      const dx = zone.ncx - self.x;
      const dz = zone.ncz - self.z;
      const dist = Math.hypot(dx, dz);
      if (dist > zone.nr && dist > 0.001) {
        const edge = dist - zone.nr;
        g.setLineDash([4, 4]);
        g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(t.ox + self.x * scale, t.oz + self.z * scale);
        g.lineTo(t.ox + (self.x + (dx / dist) * edge) * scale, t.oz + (self.z + (dz / dist) * edge) * scale);
        g.stroke();
        g.setLineDash([]);
      }
    }

    drawPlayers(g, view, t, 3.5, 7);

    // Vignette ring
    const ring = g.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size * 0.72);
    ring.addColorStop(0, 'rgba(0,0,0,0)');
    ring.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = ring;
    g.fillRect(0, 0, size, size);
  }
}

export class BigMap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly gfx: CanvasRenderingContext2D;
  private readonly zoneInfo: HTMLElement;
  private base: MapBase | null = null;
  private open = false;

  constructor() {
    this.canvas = h('canvas.bigmap-canvas');
    this.gfx = this.canvas.getContext('2d')!;
    this.zoneInfo = h('span.bigmap-zone');
    this.el = h(
      'div.bigmap.hidden',
      null,
      h(
        'div.bigmap-frame.glass',
        null,
        h(
          'div.bigmap-head',
          null,
          h('span.bigmap-title', { text: 'THE LIQUIDATION MAP' }),
          this.zoneInfo,
          h('span.bigmap-hint', null, h('kbd', { text: 'M' }), ' close'),
        ),
        h('div.bigmap-body', null, this.canvas),
        h(
          'div.bigmap-legend',
          null,
          h('span', null, h('i.lg-dot', { style: `background:${MAP_COLORS.self}` }), 'you'),
          h('span', null, h('i.lg-dot', { style: `background:${MAP_COLORS.teammate}` }), 'team'),
          h('span', null, h('i.lg-dot', { style: `background:${MAP_COLORS.enemy}` }), 'revealed'),
          h('span', null, h('i.lg-dot.lg-diamond', { style: `background:${MAP_COLORS.airdrop}` }), 'airdrop'),
          h('span', null, h('i.lg-ring'), 'next zone'),
        ),
      ),
    );
  }

  setMap(base: MapBase): void {
    this.base = base;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    toggle(this.el, 'hidden', !open);
  }

  update(view: FrameView): void {
    if (!this.open || !this.base) return;
    const body = this.canvas.parentElement!;
    const size = Math.floor(Math.min(body.clientWidth, body.clientHeight));
    if (size <= 0) return;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    const dpr = fitCanvas(this.canvas, size, size);
    this.gfx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFullMap(this.gfx, this.base, view, size, { labels: true, players: true, deployTarget: null });
    const zone = view.zone;
    if (zone && zone.phase >= 0) {
      const def = ZONE_PHASES[Math.min(zone.phase, ZONE_PHASES.length - 1)];
      setText(this.zoneInfo, `${def.name} · ${zone.shrinking ? 'closing' : 'shrinks in'} ${formatClock(zone.t)}`);
    } else {
      setText(this.zoneInfo, 'zone forming…');
    }
  }
}
