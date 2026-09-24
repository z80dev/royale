// Settings gear (top-right): master volume, FPS/ping readout toggle, controls cheat-sheet.

import { EMOTES } from '../../shared/protocol';
import type { UiContext } from './context';
import { h, setText, storageGet, storageSet, toggle } from './dom';

const CONTROLS: [string, string][] = [
  ['WASD', 'Move'],
  ['Mouse', 'Aim'],
  ['LMB', 'Fire'],
  ['Space / Shift', 'Dash'],
  ['R', 'Reload'],
  ['E', 'Pick up · open chest'],
  ['1 / 2 · Wheel', 'Switch weapon'],
  ['Q', 'Brand ability (aimed)'],
  ['3', 'Stablecoin (+25 HP)'],
  ['4', 'Cold Wallet (full heal)'],
  ['X', 'Drop weapon'],
  ['Tab', 'Scoreboard'],
  ['M', 'Big map'],
  ['Enter', 'Chat'],
  ['5 – 0', 'Emotes'],
  ['← / →', 'Cycle spectate'],
];

const GEAR_PATH = [
  'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21',
  'a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1',
  'a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8',
  'l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1',
  'a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9',
  'a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
].join('');
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">' +
  `<circle cx="12" cy="12" r="3.2"/><path d="${GEAR_PATH}"/></svg>`;

export class Settings {
  readonly gear: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly stats: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly pingEl: HTMLElement;
  private showStats: boolean;
  private volume: number;

  constructor(ctx: UiContext) {
    const storedVolume = Number(storageGet('lr.vol') ?? '0.7');
    this.volume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 0.7;
    this.showStats = storageGet('lr.stats') !== '0';
    ctx.deps.audio.setVolume(this.volume);

    this.gear = h('button.gear-btn.interactive', { title: 'Settings', 'aria-label': 'Settings' });
    this.gear.innerHTML = GEAR_SVG;
    this.gear.addEventListener('click', () => {
      ctx.click();
      this.toggle();
    });

    const volumeValue = h('span.set-value', { text: `${Math.round(this.volume * 100)}%` });
    const slider = h('input.range', { type: 'range', min: 0, max: 100, value: Math.round(this.volume * 100) });
    slider.addEventListener('input', () => {
      this.volume = Number(slider.value) / 100;
      volumeValue.textContent = `${slider.value}%`;
      ctx.deps.audio.setVolume(this.volume);
      storageSet('lr.vol', String(this.volume));
    });
    slider.addEventListener('change', () => ctx.click());

    const statsToggle = h('button.switch', { 'aria-pressed': String(this.showStats) }, h('span.switch-knob'));
    statsToggle.addEventListener('click', () => {
      ctx.click();
      this.showStats = !this.showStats;
      statsToggle.setAttribute('aria-pressed', String(this.showStats));
      storageSet('lr.stats', this.showStats ? '1' : '0');
    });

    const closeBtn = h('button.icon-btn', { text: '✕', title: 'Close' });
    closeBtn.addEventListener('click', () => {
      ctx.click();
      this.close();
    });

    const controls = h('div.controls-grid');
    for (const [key, action] of CONTROLS) controls.append(h('kbd', { text: key }), h('span', { text: action }));
    const emotes = h('div.emote-list');
    EMOTES.slice(0, 6).forEach((text, i) =>
      emotes.append(h('span', null, h('kbd', { text: String((i + 5) % 10) }), text)),
    );

    this.panel = h(
      'div.settings-panel.glass.interactive',
      null,
      h('div.panel-head', null, h('h3', { text: 'Settings' }), closeBtn),
      h('label.set-row', null, h('span', { text: 'Master volume' }), slider, volumeValue),
      h('div.set-row', null, h('span', { text: 'Show FPS / ping' }), statsToggle),
      h('h4', { text: 'Controls' }),
      controls,
      h('h4', { text: 'Emotes' }),
      emotes,
      h('p.set-foot', { text: 'Konami code works. Obviously. ↑↑↓↓←→←→BA' }),
    );

    this.fpsEl = h('span.stat-fps');
    this.pingEl = h('span.stat-ping');
    this.stats = h('div.net-stats', null, this.fpsEl, this.pingEl);
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('open');
  }

  toggle(): void {
    toggle(this.panel, 'open', !this.isOpen);
  }

  close(): void {
    this.panel.classList.remove('open');
  }

  update(fps: number, ping: number): void {
    toggle(this.stats, 'hidden', !this.showStats);
    if (!this.showStats) return;
    setText(this.fpsEl, `${Math.round(fps)} FPS`);
    setText(this.pingEl, `${Math.round(ping)} ms`);
    toggle(this.pingEl, 'bad', ping > 120);
    toggle(this.fpsEl, 'bad', fps < 45);
  }
}
