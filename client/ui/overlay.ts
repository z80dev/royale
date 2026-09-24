// Screen-space overlay canvas drawn every frame from deps.project(): name tags + mini HP/armor bars,
// emote bubbles, floating damage / heal numbers and off-screen teammate arrows.

import { CHARACTER_BY_ID, MAX_ARMOR, MAX_HP } from '../../shared/constants';
import type { FrameView, ViewPlayer } from '../view';
import type { UiContext } from './context';
import { drawBadge, h, uiScale } from './dom';

const EMOTE_SECONDS = 2.5;
const NUMBER_SECONDS = 0.95;
const TAG_HEIGHT = 2.55; // world meters above the feet
const RELATION = {
  teammate: '#3DDC84',
  enemy: '#FF5C7A',
  focus: '#FFFFFF',
};

interface FloatingNumber {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  age: number;
  drift: number;
}

export class Overlay {
  readonly el: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly numbers: FloatingNumber[] = [];
  private readonly pool: FloatingNumber[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly ctx: UiContext) {
    this.el = h('canvas.overlay-canvas');
    this.g = this.el.getContext('2d')!;
  }

  clear(): void {
    this.pool.push(...this.numbers);
    this.numbers.length = 0;
  }

  /** Damage number at a world hit point (armor hits blue, big hits bigger, 69 → "nice"). */
  damage(x: number, z: number, dmg: number, armor: boolean, kill: boolean): void {
    const rounded = Math.round(dmg);
    if (rounded <= 0) return;
    const nice = rounded === 69;
    this.spawn(
      x,
      1.9,
      z,
      nice ? '69 nice' : String(rounded),
      nice ? '#FF7AD9' : kill ? '#FF3B5C' : armor ? '#5CC8FF' : rounded >= 50 ? '#FFD84A' : '#FFFFFF',
      Math.min(34, 15 + rounded * 0.18 + (kill ? 6 : 0) + (nice ? 4 : 0)),
    );
  }

  heal(x: number, z: number, hp: number, armor: number): void {
    if (hp > 0) this.spawn(x, 2.3, z, `+${Math.round(hp)}`, '#3DDC84', 18);
    if (armor > 0) this.spawn(x + 0.4, 2.6, z, `+${Math.round(armor)} armor`, '#5CC8FF', 16);
  }

  private spawn(x: number, y: number, z: number, text: string, color: string, size: number): void {
    const n = this.pool.pop() ?? { x: 0, y: 0, z: 0, text: '', color: '', size: 0, age: 0, drift: 0 };
    n.x = x;
    n.y = y;
    n.z = z;
    n.text = text;
    n.color = color;
    n.size = size;
    n.age = 0;
    n.drift = (Math.random() - 0.5) * 36;
    this.numbers.push(n);
    if (this.numbers.length > 60) this.pool.push(this.numbers.shift()!);
  }

  update(view: FrameView, dt: number, active: boolean): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.width || hgt !== this.height || dpr !== this.dpr) {
      this.width = w;
      this.height = hgt;
      this.dpr = dpr;
      this.el.width = Math.round(w * dpr);
      this.el.height = Math.round(hgt * dpr);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    if (!active) return;
    // The overlay sits outside the zoomed UI layer: scale tags / bubbles / numbers by the UI scale by hand.
    const scale = uiScale.value;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const p of view.players) {
      if (!p.alive) continue;
      const showTag = !p.isSelf && (p.isTeammate || !p.concealed);
      const emoting = p.emote !== null && p.emote.age < EMOTE_SECONDS && (!p.concealed || p.isSelf || p.isTeammate);
      if (!showTag && !emoting) continue;
      const pos = this.ctx.deps.project(p.x, p.y + TAG_HEIGHT, p.z);
      const onScreen = pos.visible && pos.x > -60 && pos.y > -60 && pos.x < w + 60 && pos.y < hgt + 60;
      if (!onScreen) {
        if (p.isTeammate) this.drawOffscreenArrow(view, p, pos.x, pos.y, pos.visible, w, hgt);
        continue;
      }
      g.setTransform(dpr * scale, 0, 0, dpr * scale, pos.x * dpr, pos.y * dpr);
      const top = showTag ? this.drawTag(p, 0, 0, p.id === view.focusId && !p.isSelf) : 0;
      if (emoting && p.emote) this.drawEmote(p.emote.text, p.emote.age, 0, top - 8);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Floating numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      if (n.age >= NUMBER_SECONDS) {
        this.pool.push(n);
        this.numbers.splice(i, 1);
        continue;
      }
      const pos = this.ctx.deps.project(n.x, n.y, n.z);
      if (!pos.visible) continue;
      const t = n.age / NUMBER_SECONDS;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 0.5);
      const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const x = pos.x + n.drift * t * scale;
      const y = pos.y - (18 + 46 * (1 - (1 - t) * (1 - t))) * scale;
      g.globalAlpha = alpha;
      g.font = `800 ${Math.round(n.size * pop * scale)}px "Unbounded", "Space Grotesk", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4 * scale;
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.strokeText(n.text, x, y);
      g.fillStyle = n.color;
      g.fillText(n.text, x, y);
    }
    g.globalAlpha = 1;
  }

  /** Returns the top y of the tag so emotes can stack above it. */
  private drawTag(p: ViewPlayer, x: number, y: number, focused: boolean): number {
    const g = this.g;
    const color = focused ? RELATION.focus : p.isTeammate ? RELATION.teammate : RELATION.enemy;
    const barW = 58;
    const barX = x - barW / 2;
    const hpY = y;
    // HP bar
    g.fillStyle = 'rgba(4, 8, 14, 0.78)';
    g.beginPath();
    g.roundRect(barX - 2, hpY - 2, barW + 4, 9, 3);
    g.fill();
    const hpFrac = Math.max(0, Math.min(1, p.hp / MAX_HP));
    g.fillStyle = `hsl(${Math.round(hpFrac * 130)}, 85%, 55%)`;
    g.fillRect(barX, hpY, barW * hpFrac, 5);
    // Armor bar (thin, above)
    if (p.ar > 0) {
      g.fillStyle = '#4DB8FF';
      g.fillRect(barX, hpY - 3.5, barW * Math.min(1, p.ar / MAX_ARMOR), 2.2);
    }
    // Name row
    const nameY = hpY - 13;
    g.font = '700 12px "Space Grotesk", system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const name = p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name;
    const textW = g.measureText(name).width;
    const chip = 14;
    const total = chip + 5 + textW;
    const left = x - total / 2;
    g.save();
    g.shadowColor = CHARACTER_BY_ID[p.character]?.primary ?? color;
    g.shadowBlur = 6;
    drawBadge(g, p.character, left, nameY - chip / 2, chip);
    g.restore();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    g.strokeText(name, left + chip + 5, nameY);
    g.fillStyle = color;
    g.fillText(name, left + chip + 5, nameY);
    return nameY - chip / 2;
  }

  private drawEmote(text: string, age: number, x: number, bottom: number): void {
    const g = this.g;
    const inT = Math.min(1, age / 0.18);
    const scale = inT < 1 ? 0.4 + inT * 0.75 : 1.15 - Math.min(0.15, (age - 0.18) * 0.8);
    const alpha = age > EMOTE_SECONDS - 0.4 ? (EMOTE_SECONDS - age) / 0.4 : 1;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.translate(x, bottom - 4 * Math.sin(age * 4));
    g.scale(scale, scale);
    g.font = '800 15px "Space Grotesk", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(text).width + 22;
    const hh = 28;
    g.fillStyle = 'rgba(10, 14, 22, 0.9)';
    g.strokeStyle = '#7CFFD4';
    g.lineWidth = 1.5;
    g.shadowColor = '#7CFFD4';
    g.shadowBlur = 12;
    g.beginPath();
    g.roundRect(-w / 2, -hh, w, hh, 10);
    g.fill();
    g.shadowBlur = 0;
    g.stroke();
    // tail
    g.beginPath();
    g.moveTo(-6, -1);
    g.lineTo(0, 7);
    g.lineTo(6, -1);
    g.fillStyle = 'rgba(10, 14, 22, 0.9)';
    g.fill();
    g.fillStyle = '#EFFFFA';
    g.fillText(text, 0, -hh / 2);
    g.restore();
  }

  private drawOffscreenArrow(
    view: FrameView,
    p: ViewPlayer,
    px: number,
    py: number,
    inFront: boolean,
    w: number,
    hgt: number,
  ): void {
    const g = this.g;
    const cx = w / 2;
    const cy = hgt / 2;
    let dx = px - cx;
    let dy = py - cy;
    if (!inFront) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const scale = uiScale.value;
    const margin = 46 * scale;
    const tx = dx !== 0 ? (dx > 0 ? w - margin - cx : margin - cx) / dx : Infinity;
    const ty = dy !== 0 ? (dy > 0 ? hgt - margin - cy : margin - cy) / dy : Infinity;
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    const ax = cx + dx * t;
    const ay = cy + dy * t;
    const angle = Math.atan2(dy, dx);
    g.save();
    g.translate(ax, ay);
    g.scale(scale, scale);
    g.save();
    g.rotate(angle);
    g.fillStyle = RELATION.teammate;
    g.shadowColor = RELATION.teammate;
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(14, 0);
    g.lineTo(-6, 9);
    g.lineTo(-2, 0);
    g.lineTo(-6, -9);
    g.closePath();
    g.fill();
    g.restore();
    const dist = Math.round(Math.hypot(p.x - view.focus.x, p.z - view.focus.z));
    g.font = '700 11px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = `${p.name.slice(0, 10)} ${dist}m`;
    const ly = dy > 0.5 ? -18 : 20;
    g.strokeText(label, 0, ly);
    g.fillStyle = '#D8FFE8';
    g.fillText(label, 0, ly);
    g.restore();
  }
}
