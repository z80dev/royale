// Title / lobby screen: animated logo, name, character select, team, ready, host settings, players,
// session leaderboard, chat slot, tips ticker, "Connect Wallet" joke, countdown overlay.

import { CHARACTER_BY_ID, CHARACTERS, MAX_PLAYERS, SCORE, type CharacterId } from '../../shared/constants';
import type { LobbyPlayer, SessionEntry } from '../../shared/protocol';
import type { LobbyMsg, UiContext } from './context';
import { ReadyCheck } from './ready';
import {
  badge,
  BOT_SKILL_LABELS,
  formatPnl,
  h,
  setBadge,
  setText,
  storageGet,
  storageSet,
  TEAM_SIZE_LABELS,
  toggle,
} from './dom';

export const TIPS = [
  'not your keys, not your coins.',
  'bushes hide you. tulip bushes hide you with style (1637 edition).',
  'the zone is a bear market: it only gets smaller.',
  'Treasury chests pop 3 items. ~12% are rugs. DYOR.',
  'airdrops land inside the next zone. legendary loot. contested af.',
  'armor absorbs damage first. Hardware Wallet = +75. write your seed phrase down.',
  'Cold Wallet heals to full, but channels for 3.5s. find cover, ser.',
  'dash through fire with Space. 2.2s cooldown. momentum is everything.',
  'Q fires your brand ability at the mouse. read the card.',
  'hold E near a weapon to swap it into your active slot.',
  'reloading at 1 bullet is how you get sandwiched.',
  'Money Printer needs a moment to spin up. then: brrrrr.',
  'Laser Eyes pierces through bodies. line them up.',
  'type "gm" in chat. someone will answer.',
  'the Satoshi statue is at Genesis Plaza. pay respects.',
  'Mt. Gox Crater: 850,000 BTC went in. none came out.',
  'Laszlo paid 10,000 BTC for two pizzas. the shop still stands.',
  'FTX ruins: funds are safu. (they were not.)',
  'deaths are unrealized losses. you can still spectate.',
  'have fun staying poor. or win and get the lambo dinner.',
  'gas is temporary. skill issue is forever.',
  'this is not financial advice. it is a battle royale.',
];

const BOT_SKILL_HINTS = ['they panic-sell', 'mid-curve aim', 'no mercy, ser'];

class CharacterCard {
  readonly el: HTMLButtonElement;
  private readonly taken: HTMLElement;

  constructor(
    readonly id: CharacterId,
    onPick: (id: CharacterId) => void,
    ctx: UiContext,
  ) {
    const def = CHARACTER_BY_ID[id];
    this.taken = h('div.char-taken');
    this.el = h(
      'button.char-card',
      { style: `--brand:${def.primary};--brand2:${def.secondary}`, title: `${def.name} — ${def.ability.name}` },
      h('div.char-glow'),
      badge(id, 'char-badge'),
      h('div.char-name', { text: def.name }),
      h('div.char-tag', { text: def.tagline }),
      this.taken,
    );
    this.el.addEventListener('click', () => {
      ctx.click();
      onPick(id);
    });
  }

  update(selected: boolean, takers: string[]): void {
    toggle(this.el, 'selected', selected);
    toggle(this.el, 'is-taken', takers.length > 0);
    setText(this.taken, takers.join(', '));
  }
}

export class LobbyScreen {
  readonly el: HTMLElement;
  readonly chatSlot: HTMLElement;
  readonly cornerSlot: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly cards: CharacterCard[] = [];
  private readonly detail: HTMLElement;
  private readonly detailBadge: HTMLElement;
  private readonly detailName: HTMLElement;
  private readonly detailSite: HTMLElement;
  private readonly detailTag: HTMLElement;
  private readonly detailBlurb: HTMLElement;
  private readonly abilityName: HTMLElement;
  private readonly abilityDesc: HTMLElement;
  private readonly abilityMeta: HTMLElement;
  private readonly teamRow: HTMLElement;
  private readonly teamHint: HTMLElement;
  readonly readyCheck: ReadyCheck;
  private readonly hostPanel: HTMLElement;
  private readonly hostBadge: HTMLElement;
  private readonly teamSizeRow: HTMLElement;
  private readonly fillSlider: HTMLInputElement;
  private readonly fillValue: HTMLElement;
  private readonly skillRow: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly hostNote: HTMLElement;
  private readonly playerList: HTMLElement;
  private readonly playerCount: HTMLElement;
  private readonly board: HTMLElement;
  private readonly tipEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly watchBtn: HTMLButtonElement;
  /** Installed by Ui: switch from the lobby to the live spectator view. */
  onWatchLive: () => void = () => {};
  private readonly countdown: CountdownOverlay;

  private character: CharacterId;
  private team = 0;
  private isHost = false;
  private nameTimer = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);
  private tipTimer = 0;
  private fillDragging = false;
  private boardKey = '';

  constructor(private readonly ctx: UiContext) {
    const storedChar = storageGet('lr.char') as CharacterId | null;
    this.character = storedChar && CHARACTER_BY_ID[storedChar] ? storedChar : 'doppler';

    // ── Hero
    const logo = h(
      'div.logo',
      null,
      h('div.logo-kicker', { text: '◆ season 0 · genesis block ◆' }),
      h('h1.logo-title', { 'data-text': 'LAUNCHPAD' }, 'LAUNCHPAD'),
      h('h1.logo-title.logo-title--royale', { 'data-text': 'ROYALE' }, 'ROYALE'),
      h(
        'div.logo-sub',
        null,
        'a ',
        h('img.doppler-mark', { src: 'logos/doppler-mark.svg', alt: 'doppler', draggable: 'false' }),
        h('span.doppler-fallback', { text: 'doppler.lol' }),
        ' production · not financial advice',
      ),
    );
    const mark = logo.querySelector<HTMLImageElement>('.doppler-mark')!;
    mark.addEventListener('error', () => mark.remove(), { once: true });
    mark.addEventListener('load', () => logo.querySelector('.doppler-fallback')?.remove(), { once: true });

    const walletBtn = h('button.wallet-btn', null, h('span.wallet-dot'), 'Connect Wallet');
    walletBtn.addEventListener('click', () => {
      ctx.click();
      ctx.toast('lol no. this is a game, ser', 'gold');
      walletBtn.classList.remove('nope');
      void walletBtn.offsetWidth;
      walletBtn.classList.add('nope');
    });
    this.cornerSlot = h('div.lobby-corner', null, walletBtn);

    // ── Character select
    const grid = h('div.char-grid');
    for (const def of CHARACTERS) {
      const card = new CharacterCard(def.id, (id) => this.pickCharacter(id), ctx);
      this.cards.push(card);
      grid.append(card.el);
    }
    this.detailBadge = badge(this.character, 'detail-badge');
    this.detailName = h('div.detail-name');
    this.detailSite = h('div.detail-site');
    this.detailTag = h('div.detail-tag');
    this.detailBlurb = h('p.detail-blurb');
    this.abilityName = h('div.ability-name');
    this.abilityDesc = h('div.ability-desc');
    this.abilityMeta = h('div.ability-meta');
    this.detail = h(
      'div.char-detail',
      null,
      h('div.detail-art', null, h('div.detail-ring'), this.detailBadge),
      h(
        'div.detail-body',
        null,
        h('div.detail-head', null, this.detailName, this.detailSite),
        this.detailTag,
        this.detailBlurb,
        h(
          'div.ability-card',
          null,
          h('kbd.ability-key', { text: 'Q' }),
          h('div.ability-text', null, this.abilityName, this.abilityDesc),
          this.abilityMeta,
        ),
      ),
    );

    // ── Name
    this.nameInput = h('input.name-input', {
      type: 'text',
      maxlength: 16,
      placeholder: 'anon degen',
      autocomplete: 'off',
      spellcheck: 'false',
      value: storageGet('lr.name') ?? '',
    });
    this.nameInput.addEventListener('input', () => {
      window.clearTimeout(this.nameTimer);
      this.nameTimer = window.setTimeout(() => this.commitName(), 350);
    });
    this.nameInput.addEventListener('change', () => this.commitName());
    this.nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') {
        this.commitName();
        this.nameInput.blur();
      }
    });

    const leftCol = h(
      'section.lobby-col.lobby-left',
      null,
      h(
        'div.panel.glass.pick-panel',
        null,
        h(
          'div.panel-head',
          null,
          h('h3', { text: 'Choose your launchpad' }),
          h('span.panel-note', { text: '10 brands · 1 bag' }),
        ),
        grid,
        this.detail,
      ),
      fieldManual(),
    );

    // ── Profile / team / ready
    this.teamRow = h('div.seg.team-seg');
    this.teamHint = h('div.hint');
    this.readyCheck = new ReadyCheck(ctx);

    const profile = h(
      'div.panel.glass.profile-panel',
      null,
      h('div.panel-head', null, h('h3', { text: 'Your degen' })),
      h('label.field', null, h('span.field-label', { text: 'Callsign' }), this.nameInput),
      h('div.field', null, h('span.field-label', { text: 'Team' }), this.teamRow, this.teamHint),
      this.readyCheck.el,
    );

    // ── Host settings
    this.teamSizeRow = h('div.seg.size-seg');
    TEAM_SIZE_LABELS.forEach((label, i) => {
      const btn = h('button.seg-btn', { 'data-v': i + 1, title: `${i + 1} per team` }, label);
      btn.addEventListener('click', () => {
        if (!this.isHost) return;
        ctx.click();
        ctx.deps.send({ t: 'settings', teamSize: i + 1 });
      });
      this.teamSizeRow.append(btn);
    });
    this.fillValue = h('span.fill-value');
    this.fillSlider = h('input.range', { type: 'range', min: 2, max: MAX_PLAYERS, step: 1, value: 16 });
    this.fillSlider.addEventListener('input', () => {
      this.fillDragging = true;
      setText(this.fillValue, `${this.fillSlider.value} players`);
    });
    this.fillSlider.addEventListener('change', () => {
      this.fillDragging = false;
      if (!this.isHost) return;
      ctx.click();
      ctx.deps.send({ t: 'settings', fillTo: Number(this.fillSlider.value) });
    });
    this.skillRow = h('div.seg.skill-seg');
    BOT_SKILL_LABELS.forEach((label, i) => {
      const btn = h('button.seg-btn', { 'data-v': i, title: BOT_SKILL_HINTS[i] }, label);
      btn.addEventListener('click', () => {
        if (!this.isHost) return;
        ctx.click();
        ctx.deps.send({ t: 'settings', botSkill: i as 0 | 1 | 2 });
      });
      this.skillRow.append(btn);
    });
    // The ready check launches matches; the host can still skip it.
    this.startBtn = h('button.btn.btn-force', { title: 'Launch now, ready or not' }, 'FORCE START');
    this.startBtn.addEventListener('click', () => {
      if (!this.isHost) return;
      ctx.deps.audio.unlock();
      ctx.deps.audio.play('go', { vol: 0.6 });
      ctx.deps.send({ t: 'start' });
    });
    this.hostNote = h('div.host-note');
    this.hostBadge = h('span.panel-note');
    this.hostPanel = h(
      'div.panel.glass.host-panel',
      null,
      h('div.panel-head', null, h('h3', { text: 'Match settings' }), this.hostBadge),
      h('div.field', null, h('span.field-label', { text: 'Team size' }), this.teamSizeRow),
      h('div.field', null, h('span.field-label', null, 'Fill with bots to ', this.fillValue), this.fillSlider),
      h('div.field', null, h('span.field-label', { text: 'Bot skill' }), this.skillRow),
      this.startBtn,
      this.hostNote,
    );

    // ── Players + leaderboard
    this.playerCount = h('span.panel-note');
    this.playerList = h('div.player-list');
    this.board = h('div.board-list');
    this.chatSlot = h('div.chat-slot');
    const rightCol = h(
      'section.lobby-col.lobby-right',
      null,
      h('div.lobby-right-top', null, profile, this.hostPanel),
      h(
        'div.lobby-right-mid',
        null,
        h(
          'div.panel.glass.players-panel',
          null,
          h('div.panel-head', null, h('h3', { text: 'In the lobby' }), this.playerCount),
          this.playerList,
        ),
        h(
          'div.panel.glass.board-panel',
          null,
          h(
            'div.panel-head',
            null,
            h('h3', { text: 'All-time degens' }),
            h('span.panel-note', { text: 'session PnL' }),
          ),
          this.board,
        ),
      ),
      h('div.panel.glass.chat-panel', null, h('div.panel-head', null, h('h3', { text: 'Trollbox' })), this.chatSlot),
    );

    this.tipEl = h('span.tip-text', { text: TIPS[this.tipIndex] });
    const ticker = h('div.tips', null, h('span.tip-label', { text: 'ALPHA' }), this.tipEl);
    this.bannerText = h('span.lobby-banner-text');
    this.watchBtn = h('button.btn.btn-primary.watch-btn', { text: 'WATCH ▸' });
    this.watchBtn.addEventListener('click', () => {
      ctx.click();
      this.onWatchLive();
    });
    this.banner = h('div.lobby-banner.hidden', null, h('span.live-dot'), this.bannerText, this.watchBtn);
    this.countdown = new CountdownOverlay(ctx);

    this.el = h(
      'div.screen.lobby',
      null,
      h('div.lobby-bg'),
      h('header.lobby-header', null, logo, this.cornerSlot),
      this.banner,
      h('main.lobby-main', null, leftCol, rightCol),
      ticker,
    );

    this.renderDetail();
    this.renderTeams(null);
    for (const card of this.cards) card.update(card.id === this.character, []);
  }

  get countdownEl(): HTMLElement {
    return this.countdown.el;
  }

  private commitName(): void {
    window.clearTimeout(this.nameTimer);
    this.nameTimer = 0;
    const name = this.nameInput.value.trim().slice(0, 16);
    storageSet('lr.name', name);
    const me = this.me();
    if (me && me.name === name) return;
    if (name) this.ctx.deps.send({ t: 'lobbySet', name });
  }

  private pickCharacter(id: CharacterId): void {
    this.character = id;
    storageSet('lr.char', id);
    this.ctx.deps.send({ t: 'lobbySet', character: id });
    this.renderDetail();
    this.renderCards(this.ctx.lobby);
  }

  private pickTeam(team: number): void {
    this.team = team;
    this.ctx.deps.send({ t: 'lobbySet', team });
    this.renderTeams(this.ctx.lobby);
  }

  private me(): LobbyPlayer | null {
    const lobby = this.ctx.lobby;
    if (!lobby || !this.ctx.welcomeId) return null;
    return lobby.players.find((p) => p.id === this.ctx.welcomeId) ?? null;
  }

  /** New lobby state from the server. */
  apply(msg: LobbyMsg): void {
    const me = this.me();
    if (me) {
      this.character = me.character;
      this.team = me.team;
      this.isHost = me.host;
      if (document.activeElement !== this.nameInput && !this.nameTimer && me.name !== this.nameInput.value) {
        this.nameInput.value = me.name;
      }
    }
    this.renderDetail();
    this.renderCards(msg);
    this.renderTeams(msg);
    this.readyCheck.apply(msg);
    this.renderHost(msg);
    this.renderPlayers(msg);
    this.renderBoard(msg.board);
    this.countdown.apply(msg);
  }

  /** "Live match" strip while a match runs (you're spectating it); `alive` = degens still standing. */
  renderLiveBanner(alive: number): void {
    const msg = this.ctx.lobby;
    const inProgress = !!msg && msg.matchInProgress && msg.phase !== 'lobby' && msg.phase !== 'countdown';
    toggle(this.banner, 'hidden', !inProgress);
    if (!inProgress) return;
    const watchable = this.ctx.match !== null;
    setText(
      this.bannerText,
      `match in progress${watchable && alive > 0 ? ` — ${alive} alive` : ''} · you're in the next game`,
    );
    toggle(this.watchBtn, 'hidden', !watchable);
  }

  private renderDetail(): void {
    const def = CHARACTER_BY_ID[this.character];
    this.detail.style.setProperty('--brand', def.primary);
    this.detail.style.setProperty('--brand2', def.secondary);
    setBadge(this.detailBadge, def.id);
    setText(this.detailName, def.name);
    setText(this.detailSite, def.site);
    setText(this.detailTag, `“${def.tagline}”`);
    setText(this.detailBlurb, def.blurb);
    setText(this.abilityName, def.ability.name);
    setText(this.abilityDesc, def.ability.desc);
    setText(this.abilityMeta, `${def.ability.cooldown}s CD`);
    this.el.style.setProperty('--sel', def.primary);
    this.el.style.setProperty('--sel2', def.secondary);
  }

  private renderCards(msg: LobbyMsg | null): void {
    for (const card of this.cards) {
      const takers = (msg?.players ?? [])
        .filter((p) => p.character === card.id && p.id !== this.ctx.welcomeId)
        .map((p) => p.name);
      card.update(card.id === this.character, takers);
    }
  }

  private renderTeams(msg: LobbyMsg | null): void {
    const teamSize = msg?.settings.teamSize ?? 1;
    const players = msg?.players ?? [];
    this.teamRow.replaceChildren();
    if (teamSize <= 1) {
      toggle(this.teamRow, 'hidden', true);
      setText(this.teamHint, 'Solo — every degen for themselves.');
      return;
    }
    toggle(this.teamRow, 'hidden', false);
    const total = Math.max(msg?.settings.fillTo ?? 2, players.length);
    const teamCount = Math.min(16, Math.max(2, Math.ceil(total / teamSize)));
    const addButton = (team: number, label: string) => {
      const count = players.filter((p) => p.team === team).length;
      const btn = h(
        `button.seg-btn${this.team === team ? '.active' : ''}`,
        { title: team === 0 ? 'Auto-assign' : `Team ${team}` },
        label,
        team > 0 && count > 0 ? h('span.seg-count', { text: String(count) }) : null,
      );
      btn.addEventListener('click', () => {
        this.ctx.click();
        this.pickTeam(team);
      });
      this.teamRow.append(btn);
    };
    addButton(0, 'Auto');
    for (let team = 1; team <= teamCount; team++) addButton(team, `T${team}`);
    setText(this.teamHint, `${TEAM_SIZE_LABELS[teamSize - 1]} · no friendly fire · bots fill empty seats`);
  }

  private renderHost(msg: LobbyMsg): void {
    const s = msg.settings;
    toggle(this.hostPanel, 'readonly', !this.isHost);
    setText(this.hostBadge, this.isHost ? '♛ you are host' : `host: ${msg.players.find((p) => p.host)?.name ?? '—'}`);
    for (const btn of this.teamSizeRow.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      toggle(btn, 'active', Number(btn.dataset.v) === s.teamSize);
      btn.disabled = !this.isHost;
    }
    for (const btn of this.skillRow.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      toggle(btn, 'active', Number(btn.dataset.v) === s.botSkill);
      btn.disabled = !this.isHost;
    }
    this.fillSlider.disabled = !this.isHost;
    if (!this.fillDragging) {
      this.fillSlider.value = String(s.fillTo);
      setText(this.fillValue, `${s.fillTo} players`);
    }
    const counting = msg.phase === 'countdown';
    const busy = msg.matchInProgress && msg.phase !== 'lobby';
    toggle(this.startBtn, 'hidden', !this.isHost);
    this.startBtn.disabled = counting || busy;
    setText(this.startBtn, counting ? 'LAUNCHING…' : busy ? 'MATCH LIVE' : 'FORCE START');
    setText(
      this.hostNote,
      this.isHost ? 'or let the ready check launch it' : 'host owns settings · ready check launches',
    );
  }

  private renderPlayers(msg: LobbyMsg): void {
    setText(
      this.playerCount,
      `${msg.players.length} human${msg.players.length === 1 ? '' : 's'} · bots fill to ${msg.settings.fillTo}`,
    );
    const rows = msg.players.map((p) => {
      const pingClass = p.ping < 60 ? 'good' : p.ping < 130 ? 'ok' : 'bad';
      const brand = CHARACTER_BY_ID[p.character]?.name ?? '';
      return h(
        `div.player-row${p.id === this.ctx.welcomeId ? '.me' : ''}${p.ready ? '.ready' : ''}`,
        { style: `--brand:${CHARACTER_BY_ID[p.character]?.primary ?? '#fff'}` },
        badge(p.character, 'row-badge'),
        h(
          'div.player-main',
          null,
          h('span.player-name', null, p.host ? h('span.crown', { text: '♛', title: 'Host' }) : null, p.name),
          h('span.player-sub', {
            text: msg.settings.teamSize > 1 ? `${brand} · ${p.team ? `Team ${p.team}` : 'Auto'}` : brand,
          }),
        ),
        h(`span.ping.${pingClass}`, { text: `${Math.round(p.ping)}ms` }),
        h('span.ready-tag', { text: p.ready ? 'READY ✓' : 'not ready' }),
      );
    });
    const bots = Math.max(0, msg.settings.fillTo - msg.players.length);
    if (bots > 0) {
      rows.push(
        h(
          'div.player-row.bots',
          null,
          h('div.bot-chip', { text: '🤖' }),
          h(
            'div.player-main',
            null,
            h('span.player-name', { text: `+${bots} bot${bots === 1 ? '' : 's'}` }),
            h('span.player-sub', {
              text: `${BOT_SKILL_LABELS[msg.settings.botSkill]} · ${BOT_SKILL_HINTS[msg.settings.botSkill]}`,
            }),
          ),
        ),
      );
    }
    this.playerList.replaceChildren(...rows);
  }

  private renderBoard(board: SessionEntry[]): void {
    const key = JSON.stringify(board);
    if (key === this.boardKey) return;
    this.boardKey = key;
    if (board.length === 0) {
      this.board.replaceChildren(h('div.empty', { text: 'no bags yet. first match writes history.' }));
      return;
    }
    this.board.replaceChildren(...renderBoardRows(board, 8));
  }

  update(dt: number, now: number): void {
    this.readyCheck.update(now);
    this.tipTimer += dt;
    if (this.tipTimer > 7) {
      this.tipTimer = 0;
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.tipEl.classList.remove('tip-in');
      void this.tipEl.offsetWidth;
      this.tipEl.textContent = TIPS[this.tipIndex];
      this.tipEl.classList.add('tip-in');
    }
    this.countdown.update(now);
  }

  /** "LFG" flash when the drop begins (deploy phase starts). */
  lfg(): void {
    this.countdown.lfg();
  }
}

const MANUAL_KEYS: [string, string][] = [
  ['WASD / ↑↓←→', 'move'],
  ['LMB', 'fire'],
  ['Space', 'dash'],
  ['Q', 'ability'],
  ['E', 'loot · chests'],
  ['3 / 4', 'heal'],
  ['R', 'reload'],
  ['M', 'map'],
];

const MANUAL_RULES: [string, string][] = [
  ['Drop', 'pick a landing spot on the map. everyone touches down together.'],
  ['Loot', 'weapons need E. ammo, heals and armor auto-pickup. Treasuries pop 3 items (or rug you).'],
  ['Survive', 'the Liquidation Zone shrinks. gas rises. last team standing takes the bags.'],
  ['PnL', `$${SCORE.kill} per kill · $${SCORE.damage} per damage · up to $${SCORE.placement[0]} for placement.`],
];

/** Static "how to play" card under the character select. */
function fieldManual(): HTMLElement {
  const keys = h('div.manual-keys');
  for (const [key, action] of MANUAL_KEYS) keys.append(h('span.manual-key', null, h('kbd', { text: key }), action));
  const rules = h('div.manual-rules');
  MANUAL_RULES.forEach(([title, text], i) =>
    rules.append(
      h(
        'div.manual-rule',
        null,
        h('span.manual-step', { text: `0${i + 1}` }),
        h('div', null, h('div.manual-title', { text: title }), h('div.manual-text', { text })),
      ),
    ),
  );
  return h(
    'div.panel.glass.manual-panel',
    null,
    h(
      'div.panel-head',
      null,
      h('h3', { text: 'Field manual' }),
      h('span.panel-note', { text: 'not financial advice' }),
    ),
    rules,
    keys,
  );
}

/** Session leaderboard rows (shared with the results screen). */
export function renderBoardRows(board: SessionEntry[], limit: number): HTMLElement[] {
  return board.slice(0, limit).map((entry, i) =>
    h(
      `div.board-row${i < 3 ? `.top${i + 1}` : ''}`,
      null,
      h('span.board-rank', { text: String(i + 1) }),
      badge(entry.character, 'row-badge'),
      h('span.board-name', null, entry.name, entry.bot ? h('span.bot-tag', { text: 'BOT' }) : null),
      h('span.board-stat', { title: 'Wins', text: `${entry.wins}W` }),
      h('span.board-stat', { title: 'Kills', text: `${entry.kills}K` }),
      h(`span.board-pnl${entry.score < 0 ? '.neg' : ''}${Math.round(entry.score) === 420 ? '.blaze' : ''}`, {
        text: formatPnl(entry.score),
      }),
    ),
  );
}

/** Full-screen 5…1 → LFG. Driven by lobby countdown seconds; plays a tick per number. */
class CountdownOverlay {
  readonly el: HTMLElement;
  private readonly num: HTMLElement;
  private readonly sub: HTMLElement;
  private deadline = 0; // performance.now() ms when countdown reaches 0
  private shown = -1;
  private lfgUntil = 0;

  constructor(private readonly ctx: UiContext) {
    this.num = h('div.cd-num');
    this.sub = h('div.cd-sub', { text: 'launching in' });
    this.el = h('div.countdown.hidden', null, h('div.cd-rings'), this.sub, this.num);
  }

  apply(msg: LobbyMsg): void {
    if (msg.phase === 'countdown' && msg.countdown > 0) {
      const deadline = performance.now() + msg.countdown * 1000;
      if (!this.deadline || Math.abs(deadline - this.deadline) > 250) this.deadline = deadline;
    } else if (msg.phase === 'lobby') {
      this.deadline = 0;
      this.shown = -1;
    }
  }

  lfg(): void {
    if (this.lfgUntil > performance.now()) return;
    this.deadline = 0;
    this.lfgUntil = performance.now() + 1300;
    this.shown = 0;
    this.setNumber('LFG', 'wagmi');
    this.el.classList.add('lfg');
    this.ctx.deps.audio.play('go');
  }

  private setNumber(text: string, sub: string): void {
    this.num.textContent = text;
    this.sub.textContent = sub;
    this.num.classList.remove('pop');
    void this.num.offsetWidth;
    this.num.classList.add('pop');
  }

  update(now: number): void {
    if (this.lfgUntil > now) {
      toggle(this.el, 'hidden', false);
      return;
    }
    if (this.lfgUntil) {
      this.lfgUntil = 0;
      this.el.classList.remove('lfg');
    }
    if (!this.deadline) {
      toggle(this.el, 'hidden', true);
      return;
    }
    const left = Math.ceil((this.deadline - now) / 1000);
    if (left <= 0) {
      // Deploy phase will call lfg(); keep the last number up until then.
      return;
    }
    toggle(this.el, 'hidden', false);
    if (left !== this.shown) {
      this.shown = left;
      this.setNumber(String(left), 'launching in');
      this.ctx.deps.audio.play('countdown');
    }
  }
}
