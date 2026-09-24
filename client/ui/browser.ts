// Lobby browser (no room in the URL): hero, live list of public lobbies (polled every ~3s and diffed in place,
// so rows never flicker), create a lobby (public / private), or join by 6-character invite code.

import type { RoomList, RoomSummary, RoomVisibility } from '../../shared/protocol';
import type { UiContext } from './context';
import { BOT_SKILL_LABELS, h, setText, TEAM_SIZE_LABELS, toggle } from './dom';
import { dopplerCredit, heroLogo, walletButton } from './hero';

const POLL_MS = 3000;
/** Room code alphabet: [A-Z2-9] without look-alikes (O/0, I/1). */
const CODE_CHARS = /[^A-HJ-NP-Z2-9]/g;
const CODE_LENGTH = 6;

interface RoomRow {
  el: HTMLElement;
  host: HTMLElement;
  code: HTMLElement;
  seatsFill: HTMLElement;
  seats: HTMLElement;
  mode: HTMLElement;
  status: HTMLElement;
  join: HTMLButtonElement;
}

/** Waiting lobbies first (most humans on top), live matches after. */
function roomOrder(a: RoomSummary, b: RoomSummary): number {
  const liveA = a.phase !== 'lobby' && a.phase !== 'countdown';
  const liveB = b.phase !== 'lobby' && b.phase !== 'countdown';
  return Number(liveA) - Number(liveB) || b.humans - a.humans || a.code.localeCompare(b.code);
}

export class LobbyBrowser {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly codeJoin: HTMLButtonElement;
  private readonly visButtons: HTMLButtonElement[] = [];
  private readonly visHint: HTMLElement;
  private readonly rows = new Map<string, RoomRow>();
  private visibility: RoomVisibility = 'public';
  private open = false;
  private pollTimer = 0;
  private abort: AbortController | null = null;
  private lastOk = 0;
  private failed = false;
  private busy = false; // a join/create is in flight: ignore double clicks until the room answers

  constructor(private readonly ctx: UiContext) {
    this.list = h('div.rb-list');
    this.empty = h(
      'div.rb-empty.hidden',
      null,
      h('div.rb-empty-title', { text: 'no public lobbies — start one' }),
      h('div.rb-empty-sub', { text: 'create a lobby, copy the invite link, drop it in the group chat. wagmi.' }),
    );
    this.status = h('span.rb-status');
    this.count = h('span.panel-note');

    // Create
    const visSeg = h('div.seg.rb-vis');
    for (const [value, label, hint] of [
      ['public', '● Public', 'listed here — anyone can join'],
      ['private', '🔒 Private', 'invite link only'],
    ] as const) {
      const btn = h('button.seg-btn', { 'data-v': value, title: hint }, label);
      btn.addEventListener('click', () => {
        ctx.click();
        this.visibility = value;
        this.renderVisibility();
      });
      this.visButtons.push(btn);
      visSeg.append(btn);
    }
    this.visHint = h('div.hint.rb-vis-hint');
    const createBtn = h(
      'button.btn.rb-create',
      null,
      h('span', { text: 'CREATE LOBBY' }),
      h('span.btn-sub', { text: 'you host' }),
    );
    createBtn.addEventListener('click', () => {
      if (this.busy) return;
      ctx.click();
      this.busy = true;
      ctx.deps.rooms.create(this.visibility);
    });

    // Join by code
    this.codeInput = h('input.rb-code-input', {
      type: 'text',
      maxlength: CODE_LENGTH,
      placeholder: 'XY7K2P',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Lobby code',
    });
    this.codeJoin = h('button.btn.btn-primary.rb-code-join', { text: 'JOIN' });
    this.codeInput.addEventListener('input', () => {
      const clean = this.codeInput.value.toUpperCase().replace(CODE_CHARS, '').slice(0, CODE_LENGTH);
      if (clean !== this.codeInput.value) this.codeInput.value = clean;
      this.codeJoin.disabled = clean.length !== CODE_LENGTH;
    });
    this.codeInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.joinCode();
    });
    this.codeJoin.disabled = true;
    this.codeJoin.addEventListener('click', () => this.joinCode());

    const side = h(
      'section.rb-side',
      null,
      h(
        'div.panel.glass.rb-create-panel',
        null,
        h('div.panel-head', null, h('h3', { text: 'Start a lobby' })),
        h('div.field', null, h('span.field-label', { text: 'Visibility' }), visSeg, this.visHint),
        createBtn,
      ),
      h(
        'div.panel.glass.rb-code-panel',
        null,
        h('div.panel-head', null, h('h3', { text: 'Have a code?' })),
        h('div.rb-code-row', null, this.codeInput, this.codeJoin),
        h('div.hint', { text: 'invite links look like …/royale/#XY7K2P — the code is the part after #' }),
      ),
    );
    const listPanel = h(
      'section.panel.glass.rb-list-panel',
      null,
      h('div.panel-head', null, h('h3', { text: 'Public lobbies' }), this.count),
      h(
        'div.rb-row.rb-head',
        null,
        h('span', { text: 'Lobby' }),
        h('span', { text: 'Degens' }),
        h('span', { text: 'Mode' }),
        h('span', { text: 'Status' }),
        h('span'),
      ),
      this.list,
      this.empty,
      h('div.rb-foot', null, h('span.live-dot.rb-poll-dot'), this.status),
    );

    this.el = h(
      'div.screen.browser.hidden',
      null,
      h('div.lobby-bg'),
      h('header.lobby-header', null, heroLogo(dopplerCredit()), h('div.lobby-corner', null, walletButton(ctx))),
      h('main.rb-main', null, listPanel, side),
    );
    this.renderVisibility();
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.busy = false;
    if (this.open) return;
    this.open = true;
    toggle(this.el, 'hidden', false);
    void this.poll();
  }

  hide(): void {
    this.open = false;
    this.busy = false;
    toggle(this.el, 'hidden', true);
    window.clearTimeout(this.pollTimer);
    this.abort?.abort();
    this.abort = null;
  }

  /** A join/create failed (room error): allow another attempt. */
  unlock(): void {
    this.busy = false;
  }

  private joinCode(): void {
    const code = this.codeInput.value;
    if (code.length !== CODE_LENGTH || this.busy) return;
    this.ctx.click();
    this.busy = true;
    this.ctx.deps.rooms.join(code);
  }

  private renderVisibility(): void {
    for (const btn of this.visButtons) toggle(btn, 'active', btn.dataset.v === this.visibility);
    setText(
      this.visHint,
      this.visibility === 'public'
        ? 'listed below for anyone to join'
        : 'hidden from this list — only people with your invite link get in',
    );
  }

  private async poll(): Promise<void> {
    if (!this.open) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    try {
      const response = await fetch(this.ctx.deps.rooms.roomsUrl(), { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RoomList;
      if (!this.open || abort.signal.aborted) return;
      this.render(data.rooms ?? []);
      this.lastOk = performance.now();
      this.failed = false;
    } catch {
      if (abort.signal.aborted) return;
      this.failed = true;
    }
    this.renderStatus();
    if (this.open) this.pollTimer = window.setTimeout(() => void this.poll(), POLL_MS);
  }

  private renderStatus(): void {
    toggle(this.status, 'bad', this.failed);
    setText(this.status, this.failed ? "can't reach the server — retrying…" : 'live · refreshes every 3s');
  }

  /** Diff the list in place: update existing rows, add new ones, drop vanished ones, reorder only if needed. */
  private render(rooms: RoomSummary[]): void {
    const sorted = [...rooms].sort(roomOrder);
    const seen = new Set<string>();
    for (const room of sorted) {
      seen.add(room.code);
      let row = this.rows.get(room.code);
      if (!row) {
        row = this.makeRow(room.code);
        this.rows.set(room.code, row);
      }
      this.updateRow(row, room);
    }
    for (const [code, row] of this.rows) {
      if (seen.has(code)) continue;
      row.el.remove();
      this.rows.delete(code);
    }
    // Reorder with minimal DOM moves: only touch nodes that are out of place.
    sorted.forEach((room, i) => {
      const el = this.rows.get(room.code)!.el;
      if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] ?? null);
    });
    toggle(this.empty, 'hidden', sorted.length > 0);
    const live = sorted.filter((r) => r.phase !== 'lobby' && r.phase !== 'countdown').length;
    setText(this.count, `${sorted.length} open${live ? ` · ${live} live` : ''}`);
  }

  private makeRow(code: string): RoomRow {
    const host = h('span.rb-host');
    const codeEl = h('span.rb-code', { text: code });
    const seatsFill = h('span.rb-seats-fill');
    const seats = h('span.rb-seats-text');
    const mode = h('span.rb-mode');
    const status = h('span.rb-state');
    const join = h('button.btn.rb-join');
    join.addEventListener('click', () => {
      if (this.busy) return;
      this.ctx.click();
      this.busy = true;
      this.ctx.deps.rooms.join(code);
    });
    const el = h(
      'div.rb-row.rb-room',
      null,
      h('div.rb-room-name', null, host, codeEl),
      h('div.rb-seats', null, h('span.rb-seats-bar', null, seatsFill), seats),
      mode,
      status,
      join,
    );
    return { el, host, code: codeEl, seatsFill, seats, mode, status, join };
  }

  private updateRow(row: RoomRow, room: RoomSummary): void {
    const live = room.phase === 'deploy' || room.phase === 'playing' || room.phase === 'ended';
    setText(row.host, room.host ? `${room.host}'s lobby` : 'abandoned lobby');
    setText(row.seats, `${room.humans} human${room.humans === 1 ? '' : 's'} · ${room.fillTo} slots`);
    row.seatsFill.style.transform = `scaleX(${Math.min(1, room.humans / Math.max(1, room.fillTo)).toFixed(3)})`;
    const mode = TEAM_SIZE_LABELS[Math.max(0, Math.min(TEAM_SIZE_LABELS.length - 1, room.teamSize - 1))];
    setText(row.mode, `${mode} · ${BOT_SKILL_LABELS[room.botSkill] ?? 'Degen'} bots`);
    let statusText = 'waiting for degens';
    if (room.phase === 'countdown') statusText = 'launching…';
    else if (room.phase === 'ended') statusText = 'LIVE · results';
    else if (live) statusText = `LIVE · ${room.alive} alive`;
    setText(row.status, statusText);
    toggle(row.el, 'live', live);
    toggle(row.el, 'launching', room.phase === 'countdown');
    setText(row.join, live ? 'WATCH' : 'JOIN');
    row.join.title = live ? 'Spectate now, play the next game' : 'Join this lobby';
  }

  /** Per frame: dim the live dot if the list hasn't refreshed for a while (slow server / background tab). */
  update(now: number): void {
    toggle(this.status, 'stale', !this.failed && this.lastOk > 0 && now - this.lastOk > POLL_MS * 3);
  }
}
