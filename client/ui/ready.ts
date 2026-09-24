// Ready check: the lobby's hero action. Once any human is ready the server runs an auto-launch timer
// (`lobby.readyTimer` s, 0 = none); everyone ready launches immediately. Ready flags reset every match, and
// spectators of a running match can pre-ready for the next one.

import { CHARACTER_BY_ID } from '../../shared/constants';
import type { LobbyMsg, UiContext } from './context';
import { badge, h, setStyle, setText, toggle } from './dom';

/** Ring length when the timer's full duration is unknown (server READY_TIMEOUT). */
const TIMER_FALLBACK_S = 45;
const URGENT_S = 10;
const MAX_PIPS = 12;
const RING_R = 30;
const RING_LEN = 2 * Math.PI * RING_R;

type ReadyState = 'idle' | 'timer' | 'launching' | 'live';

export class ReadyCheck {
  readonly el: HTMLElement;
  private readonly ringFill: SVGCircleElement;
  private readonly ringNum: HTMLElement;
  private readonly ringUnit: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly buttonLabel: HTMLElement;
  private readonly buttonSub: HTMLElement;
  private ready = false;
  private state: ReadyState = 'idle';
  private deadline = 0; // performance.now() ms when the auto-launch fires (0 = no timer)
  private total = TIMER_FALLBACK_S;
  private pipsKey = '';

  constructor(private readonly ctx: UiContext) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 72 72');
    svg.setAttribute('class', 'rc-ring-svg');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ringFill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [track, this.ringFill]) {
      c.setAttribute('cx', '36');
      c.setAttribute('cy', '36');
      c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'rc-ring-track');
    this.ringFill.setAttribute('class', 'rc-ring-fill');
    this.ringFill.style.strokeDasharray = String(RING_LEN);
    svg.append(track, this.ringFill);
    this.ringNum = h('span.rc-ring-num');
    this.ringUnit = h('span.rc-ring-unit');

    this.title = h('div.rc-title');
    this.sub = h('div.rc-sub');
    this.pips = h('div.rc-pips');
    this.buttonLabel = h('span.rc-btn-label');
    this.buttonSub = h('span.rc-btn-sub');
    this.button = h('button.btn.rc-btn', null, this.buttonLabel, this.buttonSub);
    this.button.addEventListener('click', () => {
      ctx.click();
      this.toggle();
    });

    this.el = h(
      'div.ready-check',
      null,
      h(
        'div.rc-top',
        null,
        h('div.rc-ring', null, svg, h('div.rc-ring-text', null, this.ringNum, this.ringUnit)),
        h('div.rc-status', null, this.title, this.sub, this.pips),
      ),
      this.button,
    );
    this.render();
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Flip the local player's ready flag (button, F hotkey, spectator banner). No-op while launching. */
  toggle(): void {
    if (this.state === 'launching') return;
    this.ready = !this.ready;
    if (this.ready) this.ctx.deps.audio.play('notify', { vol: 0.5 });
    this.ctx.deps.send({ t: 'lobbySet', ready: this.ready });
    this.render();
  }

  apply(msg: LobbyMsg): void {
    const me = msg.players.find((p) => p.id === this.ctx.welcomeId);
    if (me) this.ready = me.ready;
    const live = msg.matchInProgress && msg.phase !== 'lobby' && msg.phase !== 'countdown';
    if (msg.phase === 'countdown') this.state = 'launching';
    else if (live) this.state = 'live';
    else if (msg.readyTimer > 0) this.state = 'timer';
    else this.state = 'idle';

    if (this.state === 'timer') {
      const deadline = performance.now() + msg.readyTimer * 1000;
      // A fresh run (or a drift > 1s): re-anchor. Messages arrive ~1/s with the ceil'd remaining seconds.
      if (!this.deadline) this.total = Math.max(1, msg.readyTimer);
      if (!this.deadline || Math.abs(deadline - this.deadline) > 1000) this.deadline = deadline;
    } else {
      this.deadline = 0;
    }
    this.renderPips(msg);
    this.render();
  }

  private renderPips(msg: LobbyMsg): void {
    const key = msg.players.map((p) => `${p.id}:${p.character}:${p.ready ? 1 : 0}`).join('|');
    if (key === this.pipsKey) return;
    this.pipsKey = key;
    const sorted = [...msg.players].sort((a, b) => Number(b.ready) - Number(a.ready));
    const pips = sorted.slice(0, MAX_PIPS).map((p) =>
      h(
        `div.rc-pip${p.ready ? '.on' : ''}${p.id === this.ctx.welcomeId ? '.me' : ''}`,
        {
          title: `${p.name} — ${p.ready ? 'ready' : 'not ready'}`,
          style: `--brand:${CHARACTER_BY_ID[p.character]?.primary ?? '#fff'}`,
        },
        badge(p.character, 'rc-pip-badge'),
        p.ready ? h('span.rc-pip-check', { text: '✓' }) : null,
      ),
    );
    if (sorted.length > MAX_PIPS) pips.push(h('div.rc-pip-more', { text: `+${sorted.length - MAX_PIPS}` }));
    this.pips.replaceChildren(...pips);
  }

  private render(): void {
    const lobby = this.ctx.lobby;
    const players = lobby?.players ?? [];
    const total = players.length;
    const readyCount = players.filter((p) => (p.id === this.ctx.welcomeId ? this.ready : p.ready)).length;
    const allReady = total > 0 && readyCount === total;

    toggle(this.el, 'is-ready', this.ready);
    toggle(this.el, 'state-live', this.state === 'live');
    toggle(this.el, 'state-launching', this.state === 'launching' || (this.state !== 'live' && allReady));
    this.button.disabled = this.state === 'launching';

    if (this.state === 'launching' || (this.state !== 'live' && allReady)) {
      setText(this.title, 'ALL READY — LAUNCHING');
      setText(this.sub, this.state === 'launching' ? 'strap in. deploy in a few seconds.' : 'every degen is in. LFG.');
      setText(this.buttonLabel, 'LAUNCHING…');
      setText(this.buttonSub, 'wagmi');
      return;
    }
    setText(this.title, `${readyCount}/${total} degen${total === 1 ? '' : 's'} ready`);
    if (this.state === 'live') {
      setText(this.sub, 'match live — ready up for the next game');
    } else if (this.state !== 'timer') {
      setText(this.sub, `first ready starts the ${TIMER_FALLBACK_S}s auto-launch clock`);
    }
    setText(this.buttonLabel, this.ready ? 'READY ✓' : 'READY UP');
    setText(this.buttonSub, this.ready ? 'click to cancel' : 'F');
  }

  /** Per-frame: the auto-launch ring. */
  update(now: number): void {
    const players = this.ctx.lobby?.players ?? [];
    const allReady = players.length > 0 && players.every((p) => (p.id === this.ctx.welcomeId ? this.ready : p.ready));
    if (this.state === 'launching' || (this.state !== 'live' && allReady)) {
      this.setRing(1, 'GO', 'launch', false);
      return;
    }
    if (this.state === 'timer' && this.deadline) {
      const left = Math.max(0, (this.deadline - now) / 1000);
      const secs = Math.ceil(left);
      this.setRing(left / this.total, String(secs), 'sec', secs <= URGENT_S);
      setText(this.sub, `auto-launch in ${secs}s · all ready = instant`);
      return;
    }
    this.setRing(0, this.state === 'live' ? 'LIVE' : '—', this.state === 'live' ? 'next game' : 'no clock', false);
  }

  private setRing(fraction: number, num: string, unit: string, urgent: boolean): void {
    this.ringFill.style.strokeDashoffset = (RING_LEN * (1 - Math.max(0, Math.min(1, fraction)))).toFixed(1);
    setText(this.ringNum, num);
    setText(this.ringUnit, unit);
    toggle(this.el, 'urgent', urgent);
    setStyle(this.el, '--rc-progress', fraction.toFixed(3));
  }
}
