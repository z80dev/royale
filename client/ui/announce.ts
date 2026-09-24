// Center-screen announcements (stacked, animated), kill toasts, the full-screen RUGGED glitch, bottom toasts.

import type { UiContext } from './context';
import { h } from './dom';

export type AnnounceStyle = 'default' | 'zone' | 'airdrop' | 'streak' | 'genesis' | 'wipe' | 'danger';

const BANNER_MS = 3400;
const KILL_TOAST_MS = 2600;
const TOAST_MS = 2600;
const MAX_BANNERS = 2;

interface Timed {
  el: HTMLElement;
  until: number;
}

export class Announcer {
  readonly el: HTMLElement;
  private readonly banners: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly rug: HTMLElement;
  private readonly live: Timed[] = [];
  private rugUntil = 0;

  constructor(private readonly ctx: UiContext) {
    this.banners = h('div.banners');
    this.kills = h('div.kill-toasts');
    this.toasts = h('div.toasts');
    this.rug = h(
      'div.rugged.hidden',
      null,
      h('div.rug-noise'),
      h('div.rug-title', { 'data-text': 'RUGGED' }, 'RUGGED'),
      h('div.rug-sub', { text: 'that Treasury was a honeypot · −30 HP' }),
    );
    this.el = h('div.announcer', null, this.banners, this.kills, this.toasts, this.rug);
  }

  /** Drop match-scoped announcements (banners, kill toasts, RUGGED). Bottom toasts are not match-scoped
   * ("lobby not found", "invite link copied") and survive screen changes; they expire on their own. */
  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const item = this.live[i];
      if (item.el.parentElement === this.toasts) continue;
      item.el.remove();
      this.live.splice(i, 1);
    }
    this.rugUntil = 0;
    this.rug.classList.add('hidden');
  }

  /** Queue a headline: newest on top, at most MAX_BANNERS visible; the oldest collapses out. */
  banner(text: string, sub = '', color = '', style: AnnounceStyle = 'default', sound = true): void {
    const live = [...this.banners.querySelectorAll<HTMLElement>('.banner:not(.out)')];
    if (live.some((b) => b.firstElementChild?.textContent === text)) return; // same headline already up
    const textEl = h('div.banner-text', { 'data-text': text }, text);
    const el = h(
      `div.banner.banner--${style}`,
      color ? { style: `--accent:${color}` } : null,
      textEl,
      sub ? h('div.banner-sub', { text: sub }) : null,
    );
    this.banners.prepend(el);
    this.track(el, BANNER_MS);
    for (const old of live.slice(MAX_BANNERS - 1)) this.expire(old);
    this.fitBanner(textEl);
    if (sound) this.ctx.deps.audio.play('notify', { vol: 0.8 });
  }

  /** Headlines are single-line: shrink the font until it fits the queue width minus the banner padding. */
  private fitBanner(textEl: HTMLElement): void {
    const banner = textEl.parentElement!;
    const padding =
      parseFloat(getComputedStyle(banner).paddingLeft) + parseFloat(getComputedStyle(banner).paddingRight);
    const available = this.banners.clientWidth - padding;
    const natural = textEl.scrollWidth;
    if (available <= 0 || natural <= available) return;
    const size = parseFloat(getComputedStyle(textEl).fontSize);
    textEl.style.fontSize = `${Math.max(14, Math.floor((size * available) / natural))}px`;
  }

  /** Start the collapse-out of a tracked element now. */
  private expire(el: HTMLElement): void {
    const item = this.live.find((entry) => entry.el === el);
    if (item) item.until = Math.min(item.until, performance.now());
    el.classList.add('out');
  }

  killToast(amount: string, text: string, color: string): void {
    const el = h(
      'div.kill-toast',
      { style: `--accent:${color}` },
      h('span.kt-amount', { text: amount }),
      h('span.kt-text', { text }),
    );
    this.kills.prepend(el);
    while (this.kills.childElementCount > 3) this.kills.lastElementChild?.remove();
    this.track(el, KILL_TOAST_MS);
  }

  toast(text: string, tone: 'info' | 'good' | 'bad' | 'gold' = 'info'): void {
    const el = h(`div.toast.toast--${tone}`, { text });
    this.toasts.append(el);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    this.track(el, TOAST_MS);
  }

  get rugPlaying(): boolean {
    return this.rugUntil > performance.now();
  }

  rugged(): void {
    // The server also broadcasts a 'RUGGED' banner; the opener gets the full-screen version instead.
    for (const banner of this.banners.querySelectorAll<HTMLElement>('.banner')) {
      if (banner.firstElementChild?.textContent === 'RUGGED') banner.remove();
    }
    this.rugUntil = performance.now() + 2600;
    this.rug.classList.remove('hidden', 'play');
    void this.rug.offsetWidth;
    this.rug.classList.add('play');
  }

  /** Loot pickup line in the item's rarity color. */
  pickup(label: string, color: string): void {
    const el = h('div.toast.toast--pickup', { style: `--accent:${color}` }, h('span.toast-plus', { text: '+' }), label);
    this.toasts.append(el);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    this.track(el, TOAST_MS);
  }

  private track(el: HTMLElement, ms: number): void {
    this.live.push({ el, until: performance.now() + ms });
  }

  update(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const item = this.live[i];
      if (now > item.until + 450) {
        item.el.remove();
        this.live.splice(i, 1);
      } else if (now > item.until && !item.el.classList.contains('out')) {
        item.el.classList.add('out');
      }
    }
    if (this.rugUntil && now > this.rugUntil) {
      this.rugUntil = 0;
      this.rug.classList.add('hidden');
    }
  }
}
