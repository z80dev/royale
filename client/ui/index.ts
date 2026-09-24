// GameUi entry: composes every UI module and routes server messages, game events and per-frame state to them.
// Layout: #ui holds one .ui-root; HUD layers are pointer-events:none, only interactive widgets receive clicks.

import { RARITY_COLORS, SCORE, ZONE_PHASES } from '../../shared/constants';
import type { GameMap } from '../../shared/map';
import type { GameEvent, ServerMsg } from '../../shared/protocol';
import type { FrameView, HudState, UiDeps } from '../view';
import { Announcer, type AnnounceStyle } from './announce';
import { Chat } from './chat';
import { UiContext } from './context';
import { Crosshair } from './crosshair';
import { DeathScreen } from './death';
import { DeployPicker } from './deploy';
import { h, setText, toggle, uiScale } from './dom';
import { Hud } from './hud';
import { KillFeed } from './killfeed';
import { LobbyScreen } from './lobby';
import { MapBase } from './mapdraw';
import { BigMap, Minimap } from './minimap';
import { Overlay } from './overlay';
import { ResultsScreen } from './results';
import { Scoreboard } from './scoreboard';
import { Settings } from './settings';

/** Visual style for server 'announce' banners (texts come from server/match.ts, server/zone.ts, server/loot.ts). */
function announceStyle(text: string): AnnounceStyle {
  const upper = text.toUpperCase();
  if (upper.startsWith('GENESIS BLOCK')) return 'genesis';
  if (STREAK_CALLOUTS.has(upper)) return 'streak';
  if (upper.startsWith('AIRDROP')) return 'airdrop';
  if (upper.includes('LIQUIDATION')) return 'zone';
  if (upper === 'RUGGED') return 'danger';
  return 'default';
}

/** Other players' rug chests get the big banner only when they're this close to the camera focus (m). */
const RUG_BANNER_RANGE = 30;

const STREAK_CALLOUTS = new Set(['DOUBLE SPEND!', 'TRIPLE TOP!', 'WHALE ALERT!', 'MARKET MAKER', 'SATOSHI MODE']);

type Screen = 'lobby' | 'match' | 'results';

export class Ui {
  private readonly ctx: UiContext;
  private readonly shell: HTMLElement;
  /** Everything except the overlay canvas + crosshair; zoomed by the global UI scale. */
  private readonly layer: HTMLElement;
  private readonly corner: HTMLElement;
  private readonly lobby: LobbyScreen;
  private readonly chat: Chat;
  private readonly settings: Settings;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly bigMap: BigMap;
  private readonly killFeed: KillFeed;
  private readonly announcer: Announcer;
  private readonly overlay: Overlay;
  private readonly crosshair: Crosshair;
  private readonly deploy: DeployPicker;
  private readonly death: DeathScreen;
  private readonly results: ResultsScreen;
  private readonly scoreboard: Scoreboard;
  private readonly topRight: HTMLElement;
  /** "LIVE MATCH — spectating" pill for players without a seat in the running match (pre-ready + lobby). */
  private readonly specBanner: HTMLElement;
  private readonly specReadyBtn: HTMLButtonElement;

  private screen: Screen = 'lobby';
  private inMatch = false;
  private lastPhase = '';
  private diedThisMatch = false;
  private lastHovered: Element | null = null;
  /** Seatless spectator: watching the live match (true) or hanging out in the lobby (false). */
  private spectatorView = true;

  constructor(
    private readonly root: HTMLElement,
    deps: UiDeps,
  ) {
    this.ctx = new UiContext(deps);
    this.chat = new Chat(this.ctx);
    this.settings = new Settings(this.ctx);
    this.lobby = new LobbyScreen(this.ctx);
    this.hud = new Hud(this.ctx);
    this.minimap = new Minimap();
    this.bigMap = new BigMap();
    this.killFeed = new KillFeed(this.ctx);
    this.announcer = new Announcer(this.ctx);
    this.overlay = new Overlay(this.ctx);
    this.crosshair = new Crosshair(root);
    this.deploy = new DeployPicker(this.ctx);
    this.death = new DeathScreen(this.ctx);
    this.results = new ResultsScreen(this.ctx);
    this.scoreboard = new Scoreboard(this.ctx);
    this.ctx.toast = (text, tone) => this.announcer.toast(text, tone);

    this.topRight = h('div.hud-tr', null, this.minimap.el, this.killFeed.el);
    const toLobby = h('button.btn.btn-ghost.spec-lobby-btn', { text: 'LOBBY', title: 'Chat + pick a brand' });
    toLobby.addEventListener('click', () => {
      this.ctx.click();
      this.spectatorView = false;
    });
    this.specReadyBtn = h('button.btn.spec-ready-btn', { title: 'Pre-ready for the next game (F)' });
    this.specReadyBtn.addEventListener('click', () => {
      this.ctx.click();
      this.lobby.readyCheck.toggle();
    });
    this.specBanner = h(
      'div.spec-banner.glass.hidden',
      null,
      h('span.live-dot'),
      h(
        'div.spec-banner-text',
        null,
        h('strong', { text: 'LIVE MATCH — spectating' }),
        h('span', { text: "you're in the next game · ←/→ switch player" }),
      ),
      this.specReadyBtn,
      toLobby,
    );
    this.lobby.onWatchLive = () => {
      this.spectatorView = true;
    };
    this.corner = h('div.corner', null, this.settings.stats, this.settings.gear);
    this.layer = h(
      'div.ui-scaled',
      null,
      this.hud.el,
      this.topRight,
      this.specBanner,
      this.deploy.el,
      this.bigMap.el,
      this.scoreboard.el,
      this.death.el,
      this.results.el,
      this.lobby.el,
      this.chat.el,
      this.lobby.countdownEl,
      this.announcer.el,
      this.corner,
      this.settings.panel,
    );
    this.shell = h('div.ui-root.screen-lobby', null, this.overlay.el, this.layer, this.crosshair.el);
    this.lobby.chatSlot.append(this.chat.el);
    root.append(this.shell);
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());

    window.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('pointerover', (e) => {
      const target = e.target instanceof Element ? e.target.closest('button:not(:disabled), .char-card') : null;
      if (target && target !== this.lastHovered) this.ctx.hover();
      this.lastHovered = target;
    });
    root.addEventListener('pointerdown', () => deps.audio.unlock(), { passive: true });
    this.setScreen('lobby');
  }

  // ───────────── public API (called by the client core) ─────────────

  onWelcome(id: string): void {
    this.ctx.welcomeId = id;
  }

  onLobby(msg: Extract<ServerMsg, { t: 'lobby' }>): void {
    this.ctx.lobby = msg;
    this.lobby.apply(msg);
    if (msg.phase === 'lobby' || msg.phase === 'countdown') {
      if (this.inMatch || this.results.visible) this.leaveMatch();
    }
  }

  /**
   * New match — or the same match again after a reconnect-resume (server resends `match` for the running game):
   * then keep the HUD, kill feed, kill counts and death screen exactly as they are; only refresh match data.
   */
  onMatch(msg: Extract<ServerMsg, { t: 'match' }>, map: GameMap): void {
    const ctx = this.ctx;
    const resumed = this.inMatch && ctx.match !== null && ctx.match.seed === msg.seed && !this.results.visible;
    ctx.match = msg;
    ctx.map = map;
    ctx.roster = new Map(msg.roster.map((r) => [r.id, r]));
    ctx.myTeam = msg.you ? (ctx.roster.get(msg.you)?.team ?? 0) : 0;
    if (resumed) return;
    const base = new MapBase(map, 5);
    this.minimap.setMap(base);
    this.bigMap.setMap(base);
    this.deploy.setMap(base);
    ctx.kills.clear();
    this.killFeed.clear();
    this.announcer.clear();
    this.overlay.clear();
    this.bigMap.setOpen(false);
    this.scoreboard.setShown(false);
    this.hud.resetMatch();
    this.death.reset();
    this.results.hide();
    this.diedThisMatch = false;
    this.inMatch = true;
    this.spectatorView = true;
  }

  onEnd(msg: Extract<ServerMsg, { t: 'end' }>): void {
    const won = this.results.show(msg, this.ctx.match?.teamSize ?? 1);
    if (won) this.ctx.deps.audio.play('victory');
    else if (!this.diedThisMatch) this.ctx.deps.audio.play('defeat');
    this.bigMap.setOpen(false);
    this.death.dismiss();
    this.scoreboard.setShown(false);
    this.announcer.clear();
  }

  onChat(msg: Extract<ServerMsg, { t: 'chat' }>): void {
    this.chat.add(msg);
  }

  onEvent(ev: GameEvent, view: FrameView, hud: HudState): void {
    const ctx = this.ctx;
    const me = ctx.selfId;
    switch (ev.e) {
      case 'kill': {
        if (ev.killer && ev.killer !== ev.victim) ctx.kills.set(ev.killer, (ctx.kills.get(ev.killer) ?? 0) + 1);
        this.killFeed.add(ev.killer, ev.victim, ev.w, ev.cause, ev.verb, ctx.myTeam);
        // First blood + killstreak callouts come from the server as 'announce' events (for every player).
        if (me && ev.killer === me && ev.victim !== me) {
          const victim = ctx.info(ev.victim);
          this.announcer.killToast(`+$${SCORE.kill}`, `you ${ev.verb} ${victim.name}`, victim.color);
          this.crosshair.flash('kill');
        }
        if (me && ev.victim === me) this.death.noteKill(ev.killer, ev.w, ev.cause, ev.verb);
        break;
      }
      case 'hit': {
        const watching = me ?? view.focusId;
        if (ev.by && ev.by === watching && ev.target !== watching) {
          this.overlay.damage(ev.x, ev.z, ev.dmg, ev.armor, ev.kill);
          if (ev.by === me && !ev.kill) this.crosshair.flash(ev.armor ? 'armor' : 'hit');
        }
        if (me && ev.target === me) this.hud.onHurt(ev.dmg);
        break;
      }
      case 'teamOut':
        if (hud.teamSize > 1 && ev.team !== ctx.myTeam) {
          this.announcer.banner(
            `TEAM ${ev.team} GOT WIPED`,
            `placed #${ev.place} · ${hud.teamsAlive} teams left`,
            '#FF5C7A',
            'wipe',
          );
        }
        break;
      case 'zone':
        // Shrink starts are announced by the server ('announce' LIQUIDATION ZONE SHRINKING); show the wait notice.
        // Phase 0 arrives with the landing ('MARKET OPENS IN 3s' / 'MARKET OPEN — LFG' own the center then);
        // the zone panel top-left already shows its name + timer.
        if (!ev.shrinking && ev.phase > 0) {
          const def = ZONE_PHASES[Math.max(0, Math.min(ev.phase, ZONE_PHASES.length - 1))];
          this.announcer.banner(
            ev.msg || def.name,
            `next circle marked · gas rising to ${def.dps} gwei`,
            '#B65CFF',
            'zone',
          );
        }
        break;
      case 'announce':
        // Rug chests arrive as a server 'RUGGED' announce + a 'chest' event in the same snapshot; the chest
        // event knows who opened it, so it decides how loud to be (see below).
        if (ev.text === 'RUGGED') break;
        this.announcer.banner(ev.text, ev.sub ?? '', ev.color ?? '', announceStyle(ev.text));
        break;
      case 'chest': {
        if (!ev.rug) {
          if (ev.by === me) this.announcer.toast('Treasury unlocked · 3 items popped', 'gold');
          break;
        }
        const opener = ctx.info(ev.by);
        const chest = view.chests.find((c) => c.id === ev.id);
        const near = chest ? Math.hypot(chest.x - view.focus.x, chest.z - view.focus.z) <= RUG_BANNER_RANGE : false;
        const teammate = ctx.myTeam > 0 && opener.team === ctx.myTeam;
        if (ev.by === me) this.announcer.rugged();
        else if (teammate || near) {
          this.announcer.banner(
            'RUGGED',
            `${opener.name} opened a rug chest · devs did something`,
            '#FF3B3B',
            'danger',
          );
        } else this.announcer.toast(`${opener.name} got RUGGED by a Treasury`, 'bad');
        break;
      }
      case 'pickup':
        if (ev.by === me) this.announcer.pickup(ev.label, RARITY_COLORS[ev.rarity] ?? '#fff');
        break;
      case 'heal': {
        const player = view.players.find((p) => p.id === ev.by);
        if (player && (player.isSelf || player.isTeammate || ev.by === view.focusId)) {
          this.overlay.heal(player.x, player.z, ev.hp, ev.armor);
        }
        break;
      }
      default:
        break;
    }
  }

  update(view: FrameView, hud: HudState, dt: number): void {
    const ctx = this.ctx;
    const now = view.now;
    if (hud.roster.size > 0) ctx.roster = hud.roster;
    if (view.myTeam) ctx.myTeam = view.myTeam;
    if (hud.death) this.diedThisMatch = true;

    const phase = view.phase;
    if (this.inMatch && phase === 'deploy' && this.lastPhase !== 'deploy' && ctx.match?.you) this.lobby.lfg();
    this.lastPhase = phase;

    const seatless = this.inMatch && ctx.match?.you === null;
    const watching = this.inMatch && (!seatless || this.spectatorView);
    const screen: Screen = this.results.visible ? 'results' : watching ? 'match' : 'lobby';
    if (screen !== this.screen) this.setScreen(screen);

    this.lobby.update(dt, performance.now());
    this.lobby.renderLiveBanner(hud.aliveCount);
    const specBannerOn = screen === 'match' && seatless && phase !== 'ended';
    toggle(this.specBanner, 'hidden', !specBannerOn);
    if (specBannerOn) {
      const ready = this.lobby.readyCheck.isReady;
      toggle(this.specReadyBtn, 'on', ready);
      setText(this.specReadyBtn, ready ? 'READY ✓' : 'READY UP · F');
    }
    this.announcer.update(now);
    this.settings.update(hud.fps, hud.ping);

    const inMatch = screen === 'match';
    const live = inMatch && (phase === 'playing' || phase === 'deploy');
    this.deploy.update(view, inMatch && phase === 'deploy' && ctx.match?.you !== null);
    this.overlay.update(view, dt, live);
    if (screen === 'lobby') {
      this.crosshair.update(hud, false, dt);
      return;
    }

    const alive = !!hud.self && !!hud.selfPlayer?.alive;
    const teammatesAlive = view.players.filter((p) => p.isTeammate && p.alive).length;
    const totalTeams = new Set([...ctx.roster.values()].map((r) => (hud.teamSize > 1 ? r.team : r.id))).size;
    this.death.update(hud, this.hud.lastSelfSnap, teammatesAlive, totalTeams, inMatch && phase === 'playing');
    // Death screen / scoreboard / big map own the screen center: hide stacked announcements meanwhile.
    toggle(
      this.shell,
      'center-busy',
      this.death.visible || this.scoreboard.visible || this.bigMap.isOpen || this.announcer.rugPlaying,
    );
    const spectating = inMatch && !alive && !this.death.visible;
    if (inMatch) {
      this.hud.update(view, hud, dt, spectating);
      toggle(this.minimap.el, 'hidden', this.deploy.expanded);
      this.minimap.update(view);
      this.bigMap.update(view);
    }
    this.killFeed.update(now);
    this.scoreboard.update(view, hud, now);
    this.results.update(performance.now());

    const aiming =
      inMatch &&
      phase === 'playing' &&
      alive &&
      !this.death.visible &&
      !this.settings.isOpen &&
      !this.chat.isOpen &&
      !this.bigMap.isOpen;
    this.crosshair.update(hud, aiming, dt);
  }

  wantsKeyboard(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.root.contains(active)) return false;
    if (active instanceof HTMLInputElement) return active.type !== 'range' && active.type !== 'button';
    return active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || active.isContentEditable;
  }

  pointerOverUi(e: MouseEvent): boolean {
    if (this.screen !== 'match') return true;
    const target = e.target;
    return target instanceof Node && this.root.contains(target);
  }

  setScoreboard(show: boolean): void {
    this.scoreboard.setShown(show && this.screen === 'match');
  }

  // ───────────── internals ─────────────

  private setScreen(screen: Screen): void {
    this.screen = screen;
    this.shell.classList.remove('screen-lobby', 'screen-match', 'screen-results');
    this.shell.classList.add(`screen-${screen}`);
    toggle(this.lobby.el, 'hidden', screen !== 'lobby');
    toggle(this.hud.el, 'hidden', screen !== 'match');
    toggle(this.topRight, 'hidden', screen !== 'match');
    if (screen === 'lobby') {
      this.chat.setMode('lobby');
      this.lobby.chatSlot.append(this.chat.el);
    } else {
      this.chat.setMode('match');
      this.layer.insertBefore(this.chat.el, this.lobby.countdownEl);
    }
  }

  /**
   * One global UI scale for every screen: 1.0 at 1440×900, clamped to [0.75, 1.5]. Applied as CSS zoom on
   * .ui-scaled, so layout inside it sees a "local" viewport of innerWidth/scale × innerHeight/scale; --lvw/--lvh
   * replace vw/vh there (viewport units are not zoom-aware) and the ui-w…/ui-h… classes replace media queries.
   */
  private applyScale(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(1.5, Math.max(0.75, Math.min(width / 1440, height / 900)));
    const localW = width / scale;
    const localH = height / scale;
    uiScale.value = scale;
    const style = this.shell.style;
    style.setProperty('--ui-scale', scale.toFixed(4));
    style.setProperty('--lvw', `${(localW / 100).toFixed(3)}px`);
    style.setProperty('--lvh', `${(localH / 100).toFixed(3)}px`);
    toggle(this.shell, 'ui-w1360', localW <= 1360);
    toggle(this.shell, 'ui-w1100', localW <= 1100);
    toggle(this.shell, 'ui-w820', localW <= 820);
    toggle(this.shell, 'ui-h960', localH <= 960);
    toggle(this.shell, 'ui-h820', localH <= 820);
  }

  private leaveMatch(): void {
    this.inMatch = false;
    this.spectatorView = true;
    this.ctx.match = null;
    this.ctx.roster = new Map();
    this.ctx.kills.clear();
    this.ctx.myTeam = 0;
    this.results.hide();
    this.death.reset();
    this.bigMap.setOpen(false);
    this.scoreboard.setShown(false);
    this.killFeed.clear();
    this.announcer.clear();
    this.overlay.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.wantsKeyboard()) return;
    if (e.key === 'Escape') {
      if (this.settings.isOpen) this.settings.close();
      else if (this.bigMap.isOpen) this.bigMap.setOpen(false);
      else if (this.chat.isOpen) this.chat.close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.chat.open();
      return;
    }
    // Ready hotkey: lobby, results, or a seatless spectator (in a match F does nothing else; R is reload).
    const seatless = this.inMatch && this.ctx.match?.you === null;
    if (e.code === 'KeyF' && !e.repeat && (this.screen !== 'match' || seatless)) {
      this.lobby.readyCheck.toggle();
      return;
    }
    if (e.code === 'KeyM' && !e.repeat && this.screen === 'match') {
      this.bigMap.setOpen(!this.bigMap.isOpen);
      this.ctx.click();
    }
  };
}
