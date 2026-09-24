// Custom crosshair that follows the mouse: gap expands with weapon spread (more while moving / firing),
// hitmarker flashes on hits (blue on armor) and a big red X on kills. OS cursor hidden while aiming.

import { WEAPONS } from '../../shared/constants';
import { ST } from '../../shared/protocol';
import type { HudState } from '../view';
import { h, setStyle, toggle, uiScale } from './dom';

export class Crosshair {
  readonly el: HTMLElement;
  private readonly hit: HTMLElement;
  private mouseX = window.innerWidth / 2;
  private mouseY = window.innerHeight / 2;
  private overUi = false;
  private gap = 8;
  private hitT = 0;
  private hitKind: 'hit' | 'armor' | 'kill' = 'hit';

  constructor(uiRoot: HTMLElement) {
    this.hit = h('div.ch-hit', null, h('i'), h('i'), h('i'), h('i'));
    this.el = h(
      'div.crosshair.hidden',
      null,
      h('i.ch-line.ch-t'),
      h('i.ch-line.ch-b'),
      h('i.ch-line.ch-l'),
      h('i.ch-line.ch-r'),
      h('i.ch-dot'),
      this.hit,
    );
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      const target = e.target;
      this.overUi =
        target instanceof Element && uiRoot.contains(target) && !!target.closest('.interactive, button, input');
    });
  }

  flash(kind: 'hit' | 'armor' | 'kill'): void {
    // A kill marker is never downgraded by the trailing hit of the same shot.
    if (this.hitT > 0 && this.hitKind === 'kill' && kind !== 'kill') return;
    this.hitKind = kind;
    this.hitT = kind === 'kill' ? 0.45 : 0.16;
    this.hit.className = `ch-hit ch-hit--${kind}`;
  }

  /** `aiming` = alive in a live match with game focus → show crosshair + hide OS cursor. */
  update(hud: HudState, aiming: boolean, dt: number): void {
    const show = aiming && !this.overUi;
    toggle(this.el, 'hidden', !show);
    toggle(document.body, 'lr-aiming', show);
    if (!show) return;

    const self = hud.self;
    const player = hud.selfPlayer;
    const slot = self ? self.slots[self.active] : null;
    let target = 6;
    if (slot && player) {
      const def = WEAPONS[slot.w];
      const moving = Math.hypot(player.vx, player.vz) > 0.8;
      const firing = (player.st & ST.FIRING) !== 0;
      const spread = def.spread * (moving ? def.moveSpreadMul : 1) * (firing ? 1.25 : 1);
      target = 5 + spread * 220 + (firing ? def.kick * 6 : 0);
    }
    this.gap += (Math.min(60, target) - this.gap) * Math.min(1, dt * 14);
    // Lives outside the zoomed UI layer (it tracks raw mouse px), so apply the UI scale by hand.
    setStyle(this.el, 'transform', `translate3d(${this.mouseX}px, ${this.mouseY}px, 0) scale(${uiScale.value})`);
    setStyle(this.el, '--gap', `${this.gap.toFixed(1)}px`);
    toggle(this.el, 'reloading', !!self && self.reload > 0);

    this.hitT = Math.max(0, this.hitT - dt);
    setStyle(this.hit, 'opacity', this.hitT > 0 ? '1' : '0');
    const scale = this.hitKind === 'kill' ? 1 + (0.45 - this.hitT) * 1.2 : 1 + (0.16 - this.hitT) * 2;
    setStyle(this.hit, 'transform', `translate(-50%, -50%) rotate(45deg) scale(${scale.toFixed(3)})`);
  }
}
