// Deploy phase: top-down map picker. Click → {t:'deploy', x, z}. Collapsible so the 3D world stays clickable.

import type { FrameView } from '../view';
import type { UiContext } from './context';
import { fitCanvas, h, setText, toggle } from './dom';
import { drawFullMap, type MapBase, type MapTransform } from './mapdraw';

export class DeployPicker {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly gfx: CanvasRenderingContext2D;
  private readonly timer: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private base: MapBase | null = null;
  private transform: MapTransform | null = null;
  private chosen: { x: number; z: number } | null = null;
  private collapsed = false;
  private sizePx = 0;

  constructor(private readonly ctx: UiContext) {
    this.canvas = h('canvas.deploy-canvas');
    this.gfx = this.canvas.getContext('2d')!;
    this.timer = h('span.deploy-timer');
    this.hover = h('div.deploy-hover.hidden');
    this.collapseBtn = h('button.icon-btn.deploy-collapse', { title: 'Hide map (click the 3D world instead)' });
    this.collapseBtn.addEventListener('click', () => {
      ctx.click();
      this.setCollapsed(!this.collapsed);
    });
    this.el = h(
      'div.deploy.glass.interactive.hidden',
      null,
      h(
        'div.deploy-head',
        null,
        h(
          'div.deploy-title',
          null,
          h('span', { text: 'CHOOSE YOUR DROP' }),
          h('span.deploy-sep', { text: '—' }),
          this.timer,
        ),
        this.collapseBtn,
      ),
      h('div.deploy-sub', { text: 'click the map to set your landing zone · everyone touches down together' }),
      h('div.deploy-map', null, this.canvas, this.hover),
    );
    this.canvas.addEventListener('pointerdown', (e) => this.pick(e));
    this.canvas.addEventListener('pointermove', (e) => this.hoverAt(e));
    this.canvas.addEventListener('pointerleave', () => toggle(this.hover, 'hidden', true));
    this.setCollapsed(false);
  }

  setMap(base: MapBase): void {
    this.base = base;
    this.chosen = null;
    this.setCollapsed(false);
  }

  /** Open with the map visible (the minimap is redundant then). */
  get expanded(): boolean {
    return !this.collapsed && !this.el.classList.contains('hidden');
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    toggle(this.el, 'collapsed', collapsed);
    this.collapseBtn.textContent = collapsed ? '▾ map' : '▴';
  }

  /** Pointer position in the canvas' local CSS px (the UI layer is zoomed; client coords are visual px). */
  private localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const zoom = this.sizePx > 0 ? rect.width / this.sizePx : 1;
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  private worldAt(e: PointerEvent): { x: number; z: number } | null {
    if (!this.transform || !this.base) return null;
    const local = this.localPoint(e);
    const x = (local.x - this.transform.ox) / this.transform.scale;
    const z = (local.y - this.transform.oz) / this.transform.scale;
    const limit = this.base.half - 3;
    return { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)) };
  }

  private pick(e: PointerEvent): void {
    const target = this.worldAt(e);
    if (!target) return;
    this.chosen = target;
    this.ctx.deps.audio.unlock();
    this.ctx.deps.audio.play('click');
    this.ctx.deps.send({ t: 'deploy', x: target.x, z: target.z });
  }

  private hoverAt(e: PointerEvent): void {
    const target = this.worldAt(e);
    if (!target || !this.base) return;
    let best: { name: string; d: number } | null = null;
    for (const lm of this.base.map.landmarks) {
      const d = Math.hypot(lm.x - target.x, lm.z - target.z);
      if (d < lm.r + 6 && (!best || d < best.d)) best = { name: lm.name, d };
    }
    const local = this.localPoint(e);
    this.hover.style.transform = `translate(${local.x + 14}px, ${local.y + 14}px)`;
    this.hover.textContent = best ? `${best.name}` : `${target.x.toFixed(0)}, ${target.z.toFixed(0)}`;
    toggle(this.hover, 'hidden', false);
  }

  update(view: FrameView, visible: boolean): void {
    toggle(this.el, 'hidden', !visible);
    if (!visible || !this.base) return;
    setText(this.timer, `${Math.max(0, Math.ceil(view.phaseT))}s`);
    toggle(this.timer, 'urgent', view.phaseT <= 3);
    if (this.collapsed) return;

    const box = this.canvas.parentElement!;
    const size = Math.floor(Math.min(box.clientWidth, box.clientHeight));
    if (size <= 0) return;
    if (size !== this.sizePx) {
      this.sizePx = size;
      this.canvas.style.width = this.canvas.style.height = `${size}px`;
    }
    const dpr = fitCanvas(this.canvas, size, size);
    this.gfx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.transform = drawFullMap(this.gfx, this.base, view, size, {
      labels: true,
      players: true,
      deployTarget: view.deployTarget ?? this.chosen,
    });
  }
}
