// The single global room: connections, lobby, host controls, chat, match lifecycle and snapshot fan-out.

import {
  BOT_NAMES,
  CHARACTERS,
  MAX_PLAYERS,
  PHASE_TIMES,
  TICK_DT,
  type CharacterId,
} from '../shared/constants';
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type LobbyPlayer,
  type LobbySettings,
  type Phase,
  type RoomErrorReason,
  type RoomSummary,
  type RoomVisibility,
  type ServerMsg,
  type SessionEntry,
} from '../shared/protocol';
import { brandColor, clamp, pick, randInt, READY_TIMEOUT, READY_WARNING, RECONNECT_GRACE, shuffle } from './config';
import { Match, type MatchEntrant } from './match';
import { SnapshotBuilder } from './snapshot';
import { parseClientMsg, sanitizeName } from './validate';

/** The subset of Bun's ServerWebSocket the room needs (keeps the room testable without Bun.serve). */
export interface Socket {
  send(data: string): unknown;
  ping?(): unknown;
  close?(): unknown;
}

/**
 * One live socket. `id` is the seat (client id) the socket currently drives; it changes when a reconnecting
 * socket resumes an older seat via its session id, so the transport must always route through this object.
 */
export interface Conn {
  id: string;
  ws: Socket;
}

interface Client {
  id: string;
  /** Live connection, null while the seat is held for a disconnected player. */
  conn: Conn | null;
  /** Date.now() when the connection dropped (0 = connected). */
  disconnectedAt: number;
  sid: string | null;
  joined: boolean;
  joinOrder: number;
  name: string;
  character: CharacterId;
  team: number;
  ready: boolean;
  ping: number;
  pingSentAt: number;
  laserEyes: boolean;
  chatTimes: number[];
  specTarget: string | null;
}

interface PendingChat {
  due: number;
  msg: Extract<ServerMsg, { t: 'chat' }>;
}

const SYSTEM_COLOR = '#FFB627';
const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_IN_WINDOW = 5;
const LOBBY_BROADCAST_MS = 1000;
const PING_INTERVAL_MS = 2000;
const BOARD_SIZE = 30;
const GM_REPLIES = ['gm', 'gm ser', 'gm fren', 'GM', 'gm gm', 'gm ☀️', 'gm, wagmi', 'gm (not financial advice)'];
const HELP_TEXT =
  'WASD move · mouse aim · LMB fire · Space/Shift dash · R reload · E loot/chests · Q ability · 1/2 slots · ' +
  '3 stablecoin · 4 cold wallet · X drop · Tab scoreboard · M map · 5-0 emotes · ' +
  'chat: gm, /wen, /lasereyes, /help';

export class Room {
  private readonly clients = new Map<string, Client>();
  private hostId: string | null = null;
  private lobbyPhase: 'lobby' | 'countdown' = 'lobby';
  private countdownT = 0;
  /** Seconds until the ready-check auto-launch (0 = no timer running). */
  private readyT = 0;
  private readonly settings: LobbySettings;
  private readonly board = new Map<string, SessionEntry>();
  /** Session id (per browser tab) → seat id, for resuming after a dropped connection. */
  private readonly sids = new Map<string, string>();
  private match: Match | null = null;
  private snaps: SnapshotBuilder | null = null;
  private pendingChats: PendingChat[] = [];
  private pendingEnd: Extract<ServerMsg, { t: 'end' }> | null = null;
  /** The current match's `end` message, kept for clients joining during the results screen. */
  private endMessage: Extract<ServerMsg, { t: 'end' }> | null = null;
  private lobbyDirty = true;
  private lastLobbyAt = 0;
  private lastPingAt = 0;
  private clientSeq = 1;
  private botSeq = 1;
  private joinSeq = 1;
  // tick timing stats for the current match
  private tickMsTotal = 0;
  private tickMsMax = 0;
  private tickCount = 0;

  /** Date.now() since which the room has had no sockets and no held seats (0 = occupied). */
  private emptySince: number;

  constructor(
    /** Invite code (6 chars, see rooms.ts). */
    readonly code: string,
    visibility: RoomVisibility,
    private readonly timeScale: number,
  ) {
    this.settings = { teamSize: 1, fillTo: 16, botSkill: 1, visibility };
    this.emptySince = Date.now();
  }

  // ───────────────────────────── Connections ─────────────────────────────

  connect(ws: Socket): Conn {
    const id = `p${this.clientSeq++}`;
    const conn: Conn = { id, ws };
    const client: Client = {
      id,
      conn,
      disconnectedAt: 0,
      sid: null,
      joined: false,
      joinOrder: 0,
      name: `anon-${randInt(0x10000).toString(16).toUpperCase().padStart(4, '0')}`,
      character: 'doppler',
      team: 0,
      ready: false,
      ping: 0,
      pingSentAt: 0,
      laserEyes: false,
      chatTimes: [],
      specTarget: null,
    };
    this.clients.set(id, client);
    this.send(client, { t: 'welcome', id, version: PROTOCOL_VERSION, room: this.code });
    this.send(client, this.lobbyMessage());
    return conn;
  }

  /** Socket closed. Joined seats are held for the reconnect grace window (a bot drives their player meanwhile). */
  disconnect(conn: Conn): void {
    const client = this.clients.get(conn.id);
    // A socket that was already replaced by a reconnect no longer owns the seat.
    if (!client || client.conn !== conn) return;
    client.conn = null;
    if (!client.joined) {
      this.clients.delete(client.id);
      return;
    }
    client.disconnectedAt = Date.now();
    client.pingSentAt = 0;
    this.systemChat(`${client.name} disconnected — seat held for ${Math.round(this.reconnectGraceMs() / 1000)}s`);
    this.match?.handOffToAi(client.id);
    this.updateReadyCheck();
    this.lobbyDirty = true;
  }

  private reconnectGraceMs(): number {
    return RECONNECT_GRACE * this.timeScale * 1000;
  }

  /** Drop seats whose owner stayed away longer than the grace window. */
  private expireSeats(now: number): void {
    for (const client of [...this.clients.values()]) {
      if (client.conn || now - client.disconnectedAt <= this.reconnectGraceMs()) continue;
      this.removeSeat(client);
    }
  }

  /** Free a seat for good (grace expired or `leave`): host transfer, ready re-check, empty match → lobby. */
  private removeSeat(client: Client): void {
    this.clients.delete(client.id);
    if (client.sid && this.sids.get(client.sid) === client.id) this.sids.delete(client.sid);
    if (!client.joined) return;
    this.systemChat(`${client.name} left`);
    this.match?.handOffToAi(client.id);
    if (this.hostId === client.id) this.pickHost();
    if (this.match && this.joinedClients().length === 0) this.returnToLobby();
    this.updateReadyCheck();
    this.lobbyDirty = true;
  }

  /** `leave`: the seat is freed immediately (no reconnect hold) and the socket closed. */
  private handleLeave(client: Client): void {
    const ws = client.conn?.ws;
    client.conn = null;
    this.removeSeat(client);
    try {
      ws?.close?.();
    } catch {
      // already closing
    }
  }

  /** Close every socket (room torn down). Clients get a system chat line + `roomError` first. */
  shutdown(text: string): void {
    for (const client of this.clients.values()) {
      const ws = client.conn?.ws;
      if (!ws) continue;
      this.systemChat(text, client);
      this.send(client, { t: 'roomError', reason: 'not_found' });
      client.conn = null;
      try {
        ws.close?.();
      } catch {
        // already closing
      }
    }
    this.clients.clear();
    this.match = null;
    this.snaps = null;
  }

  /** Sockets currently attached (joined or not) — the per-room connection cap counts these. */
  socketCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.conn) n++;
    return n;
  }

  /** True once the room has had no sockets and no held seats for `ttlMs`. */
  idleFor(now: number, ttlMs: number): boolean {
    if (this.clients.size > 0) {
      this.emptySince = 0;
      return false;
    }
    if (this.emptySince === 0) this.emptySince = now;
    return now - this.emptySince >= ttlMs;
  }

  get visibility(): RoomVisibility {
    return this.settings.visibility;
  }

  summary(): RoomSummary {
    const host = this.hostId ? this.clients.get(this.hostId) : undefined;
    return {
      code: this.code,
      host: host?.conn ? host.name : '',
      humans: this.joinedClients().length,
      fillTo: this.settings.fillTo,
      teamSize: this.settings.teamSize,
      botSkill: this.settings.botSkill,
      phase: this.phase(),
      alive: this.match ? this.match.aliveCount() : 0,
    };
  }

  pong(conn: Conn): void {
    const client = this.clients.get(conn.id);
    if (!client || client.conn !== conn || !client.pingSentAt) return;
    client.ping = Math.round(performance.now() - client.pingSentAt);
    client.pingSentAt = 0;
  }

  message(conn: Conn, raw: string | Buffer): void {
    const client = this.clients.get(conn.id);
    if (!client || client.conn !== conn) return;
    const msg = parseClientMsg(raw);
    if (!msg) return;
    if (msg.t === 'ping') {
      this.send(client, { t: 'pong', c: msg.c });
      return;
    }
    if (msg.t === 'join') {
      this.handleJoin(client, msg);
      return;
    }
    if (msg.t === 'leave') {
      this.handleLeave(client);
      return;
    }
    if (!client.joined) return;
    switch (msg.t) {
      case 'lobbySet':
        this.handleLobbySet(client, msg);
        break;
      case 'settings':
        this.handleSettings(client, msg);
        break;
      case 'start':
        this.handleStart(client);
        break;
      case 'in':
      case 'act': {
        const p = this.playerOf(client);
        if (p && p.alive && !p.ai) this.match!.submit(p, msg);
        break;
      }
      case 'deploy': {
        const p = this.playerOf(client);
        if (p) this.match!.deploy(p, msg.x, msg.z);
        break;
      }
      case 'spectate':
        this.cycleSpectate(client, msg.dir);
        break;
      case 'emote': {
        const p = this.playerOf(client);
        if (p) this.match!.emote(p, msg.i);
        break;
      }
      case 'chat':
        this.handleChat(client, msg.text);
        break;
    }
  }

  private playerOf(client: Client) {
    return this.match?.playerById(client.id);
  }

  private joinedClients(): Client[] {
    return [...this.clients.values()].filter((c) => c.joined).sort((a, b) => a.joinOrder - b.joinOrder);
  }

  /** Joined humans with a live socket (they count for ready checks and enter the next match). */
  private connectedClients(): Client[] {
    return this.joinedClients().filter((c) => c.conn !== null);
  }

  private pickHost(): void {
    const next = this.connectedClients()[0] ?? this.joinedClients()[0];
    this.hostId = next ? next.id : null;
    if (next) this.systemChat(`${next.name} is now the host`);
  }

  /** Refuse a socket (room full): `roomError`, then close. */
  private reject(client: Client, reason: RoomErrorReason): void {
    this.send(client, { t: 'roomError', reason });
    const ws = client.conn?.ws;
    this.clients.delete(client.id);
    client.conn = null;
    try {
      ws?.close?.();
    } catch {
      // already closing
    }
  }

  // ───────────────────────────── Lobby ─────────────────────────────

  private handleJoin(client: Client, msg: Extract<ClientMsg, { t: 'join' }>): void {
    if (msg.sid && !client.joined) {
      const seatId = this.sids.get(msg.sid);
      const seat = seatId ? this.clients.get(seatId) : undefined;
      if (seat && seat !== client && seat.joined) {
        this.reattach(client, seat);
        return;
      }
    }
    if (!client.joined && this.joinedClients().length >= MAX_PLAYERS) {
      this.reject(client, 'full');
      return;
    }
    if (msg.sid && !client.joined) {
      this.sids.set(msg.sid, client.id);
      client.sid = msg.sid;
    }
    if (msg.name) client.name = this.uniqueName(msg.name, client.id);
    client.character = this.assignCharacter(client, msg.character);
    if (!client.joined) {
      client.joined = true;
      client.joinOrder = this.joinSeq++;
      if (!this.hostId) this.hostId = client.id;
      this.systemChat(`${client.name} joined — gm`);
      if (this.match) {
        this.send(client, this.match.matchMessage(this.playerOf(client) ? client.id : null));
        // Joined during the results screen after `end` went out: show them the results too.
        if (this.match.phase === 'ended' && this.endMessage && !this.pendingEnd) this.send(client, this.endMessage);
        else this.systemChat(`${client.name} is spectating — joins next round`);
      }
    }
    this.lobbyDirty = true;
  }

  /**
   * A fresh socket presented the session id of an existing seat: move the socket onto that seat so the player
   * keeps the same id, name, character, team, ready flag, host status and in-match player.
   */
  private reattach(fresh: Client, seat: Client): void {
    const conn = fresh.conn!;
    this.clients.delete(fresh.id);
    const previous = seat.conn;
    seat.conn = conn;
    seat.disconnectedAt = 0;
    seat.pingSentAt = 0;
    conn.id = seat.id;
    // The older socket (still open, e.g. a half-dead tunnel) no longer owns the seat.
    if (previous) {
      try {
        previous.ws.close?.();
      } catch {
        // already closing
      }
    }
    this.send(seat, { t: 'welcome', id: seat.id, version: PROTOCOL_VERSION, room: this.code });
    this.systemChat(`${seat.name} reconnected`);
    const match = this.match;
    if (match) {
      const player = match.playerById(seat.id);
      if (player) match.reclaimFromAi(seat.id);
      this.send(seat, match.matchMessage(player ? seat.id : null));
      if (match.phase === 'ended' && this.endMessage && !this.pendingEnd) this.send(seat, this.endMessage);
      if (player?.alive) match.announce(`${seat.name} reconnected`, 'back at the keyboard', '#7CFF4F');
    }
    this.updateReadyCheck();
    this.lobbyDirty = true;
  }

  private handleLobbySet(client: Client, msg: Extract<ClientMsg, { t: 'lobbySet' }>): void {
    if (msg.name) client.name = this.uniqueName(msg.name, client.id);
    if (msg.character && msg.character !== client.character) {
      client.character = this.assignCharacter(client, msg.character, true);
    }
    if (msg.team !== undefined) client.team = clamp(msg.team, 0, this.maxTeams());
    if (msg.ready !== undefined && msg.ready !== client.ready) {
      client.ready = msg.ready;
      if (msg.ready) {
        const humans = this.connectedClients();
        const ready = humans.filter((c) => c.ready).length;
        this.systemChat(`${client.name} is ready (${ready}/${humans.length})`);
      }
      this.updateReadyCheck();
    }
    this.lobbyDirty = true;
  }

  private handleSettings(client: Client, msg: Extract<ClientMsg, { t: 'settings' }>): void {
    if (client.id !== this.hostId) return;
    if (msg.visibility !== undefined && msg.visibility !== this.settings.visibility) {
      this.settings.visibility = msg.visibility;
      this.systemChat(msg.visibility === 'public' ? 'room is now public — listed in the lobby browser' :
        'room is now private — invite link only');
      this.lobbyDirty = true;
    }
    if (this.match) return;
    if (msg.teamSize !== undefined) this.settings.teamSize = msg.teamSize;
    if (msg.fillTo !== undefined) this.settings.fillTo = clamp(msg.fillTo, 1, MAX_PLAYERS);
    if (msg.botSkill !== undefined) this.settings.botSkill = msg.botSkill;
    const maxTeams = this.maxTeams();
    for (const c of this.clients.values()) if (c.team > maxTeams) c.team = 0;
    this.lobbyDirty = true;
  }

  private handleStart(client: Client): void {
    if (client.id !== this.hostId || this.match || this.lobbyPhase !== 'lobby') return;
    this.beginCountdown(`${client.name} force-started the match — LFG`);
  }

  /**
   * Ready check (lobby only): all humans ready → launch now; any ready → start the auto-launch timer;
   * nobody ready → cancel it. Players readied while spectating a match count as soon as the lobby returns.
   */
  private updateReadyCheck(): void {
    if (this.match || this.lobbyPhase !== 'lobby') return;
    const humans = this.connectedClients();
    const ready = humans.filter((c) => c.ready).length;
    if (humans.length > 0 && ready === humans.length) {
      this.beginCountdown('all degens ready — launching');
    } else if (ready > 0 && this.readyT <= 0) {
      this.readyT = READY_TIMEOUT * this.timeScale;
      this.systemChat(`auto-launch in ${Math.ceil(this.readyT)}s — ready up`);
    } else if (ready === 0 && this.readyT > 0) {
      this.readyT = 0;
      this.systemChat('nobody is ready — auto-launch cancelled');
    }
    this.lobbyDirty = true;
  }

  /** Lobby → 5s countdown. Everyone connected when it ends plays; ready flags reset for the next ready check. */
  private beginCountdown(reason: string): void {
    this.readyT = 0;
    this.lobbyPhase = 'countdown';
    this.countdownT = PHASE_TIMES.countdown * this.timeScale;
    for (const c of this.clients.values()) c.ready = false;
    this.systemChat(reason);
    this.lobbyDirty = true;
  }

  private maxTeams(): number {
    return Math.ceil(MAX_PLAYERS / this.settings.teamSize);
  }

  private uniqueName(name: string, selfId: string): string {
    const clean = sanitizeName(name) || `anon-${randInt(0x10000).toString(16).toUpperCase()}`;
    const taken = new Set([...this.clients.values()].filter((c) => c.joined && c.id !== selfId).map((c) => c.name));
    if (!taken.has(clean)) return clean;
    for (let n = 2; ; n++) {
      const candidate = `${clean.slice(0, 16 - String(n).length)}${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Characters are unique while ≤ 10 humans: the request is honored if free, otherwise the current pick
   * (or a random free one) is kept. With every brand taken, duplicates are allowed.
   */
  private assignCharacter(client: Client, requested?: CharacterId, explicitChange = false): CharacterId {
    const taken = new Set<CharacterId>();
    for (const c of this.clients.values()) if (c.joined && c.id !== client.id) taken.add(c.character);
    const allTaken = taken.size >= CHARACTERS.length;
    if (requested && (!taken.has(requested) || allTaken)) return requested;
    if (explicitChange && !taken.has(client.character)) return client.character;
    if (client.joined && !taken.has(client.character)) return client.character;
    const free = CHARACTERS.filter((c) => !taken.has(c.id));
    if (free.length > 0) return pick(free).id;
    return requested ?? pick(CHARACTERS).id;
  }

  private phase(): Phase {
    return this.match ? this.match.phase : this.lobbyPhase;
  }

  private lobbyMessage(): Extract<ServerMsg, { t: 'lobby' }> {
    const players: LobbyPlayer[] = this.joinedClients().map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      team: c.team,
      ready: c.ready,
      host: c.id === this.hostId,
      ping: c.ping,
    }));
    return {
      t: 'lobby',
      phase: this.phase(),
      countdown: this.lobbyPhase === 'countdown' ? Math.max(0, Math.round(this.countdownT * 10) / 10) : 0,
      readyTimer: this.readyT > 0 && !this.match ? Math.ceil(this.readyT) : 0,
      players,
      settings: { ...this.settings },
      board: this.boardTop(),
      matchInProgress: this.match !== null,
    };
  }

  private boardTop(): SessionEntry[] {
    return [...this.board.values()].sort((a, b) => b.score - a.score || b.wins - a.wins).slice(0, BOARD_SIZE);
  }

  // ───────────────────────────── Chat ─────────────────────────────

  private systemChat(text: string, only?: Client): void {
    const msg: ServerMsg = { t: 'chat', from: 'sys', name: 'SYSTEM', text, color: SYSTEM_COLOR };
    if (only) this.send(only, msg);
    else this.broadcast(msg);
  }

  private handleChat(client: Client, text: string): void {
    const now = Date.now();
    client.chatTimes = client.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (client.chatTimes.length >= CHAT_MAX_IN_WINDOW) {
      this.systemChat('slow down ser — chat is rate limited', client);
      return;
    }
    client.chatTimes.push(now);
    const lower = text.toLowerCase();
    if (lower.startsWith('/')) {
      this.handleCommand(client, lower.split(' ')[0]!);
      return;
    }
    this.broadcast({ t: 'chat', from: client.id, name: client.name, text, color: brandColor(client.character) });
    if (/^gm\b/.test(lower)) this.scheduleGmReplies(now);
  }

  private handleCommand(client: Client, command: string): void {
    switch (command) {
      case '/wen':
        this.systemChat('soon™');
        break;
      case '/lasereyes': {
        client.laserEyes = !client.laserEyes;
        const p = this.playerOf(client);
        if (p) p.laserEyes = client.laserEyes;
        this.systemChat(
          client.laserEyes
            ? `${client.name} activated LASER EYES — 100k or bust`
            : `${client.name} turned off laser eyes. bearish.`,
        );
        break;
      }
      case '/help':
        this.systemChat(HELP_TEXT, client);
        break;
      default:
        this.systemChat(`unknown command ${command} — try /help`, client);
    }
  }

  private scheduleGmReplies(now: number): void {
    const count = 1 + randInt(3);
    const bots = this.match ? shuffle(this.match.players.filter((p) => p.bot)) : [];
    for (let i = 0; i < count; i++) {
      const bot = bots[i];
      const character = bot ? bot.character : pick(CHARACTERS).id;
      const name = bot ? bot.name : pick(BOT_NAMES);
      this.pendingChats.push({
        due: now + 500 + Math.random() * 1500,
        msg: { t: 'chat', from: bot ? bot.id : 'bot', name, text: pick(GM_REPLIES), color: brandColor(character) },
      });
    }
  }

  // ───────────────────────────── Spectating ─────────────────────────────

  private cycleSpectate(client: Client, dir: 1 | -1): void {
    const match = this.match;
    if (!match || !this.snaps) return;
    const me = this.playerOf(client);
    if (me?.alive) return;
    const alive = match.players.filter((p) => p.alive);
    if (alive.length === 0) return;
    const current = this.snaps.spectateSuggestion(me ?? null, client.specTarget);
    const index = alive.findIndex((p) => p.id === current);
    const next = alive[(index + dir + alive.length) % alive.length]!;
    client.specTarget = next.id;
  }

  // ───────────────────────────── Match lifecycle ─────────────────────────────

  private startMatch(): void {
    const humans = this.connectedClients();
    if (humans.length === 0) {
      this.lobbyPhase = 'lobby';
      return;
    }
    const entrants = this.buildEntrants(humans);
    this.match = new Match({
      entrants,
      teamSize: this.settings.teamSize,
      skill: this.settings.botSkill,
      timeScale: this.timeScale,
      onEnd: (match) => this.onMatchEnd(match),
    });
    this.snaps = new SnapshotBuilder(this.match);
    this.lobbyPhase = 'lobby';
    this.tickMsTotal = 0;
    this.tickMsMax = 0;
    this.tickCount = 0;
    for (const c of humans) c.specTarget = null;
    for (const c of this.clients.values()) {
      if (c.joined) this.send(c, this.match.matchMessage(this.playerOf(c) ? c.id : null));
    }
    const teams = new Set(entrants.map((e) => e.team)).size;
    console.log(
      `[room ${this.code}] match started: ${humans.length} human(s), ${entrants.length - humans.length} bot(s), ` +
        `${teams} teams, ` +
        `seed ${this.match.seed}`,
    );
    this.lobbyDirty = true;
  }

  /** Explicit team picks are honored (up to teamSize), auto humans grouped in join order, bots fill to fillTo. */
  private buildEntrants(humans: Client[]): MatchEntrant[] {
    const size = this.settings.teamSize;
    const explicit = new Map<number, MatchEntrant[]>();
    const autoHumans: Client[] = [];
    const toEntrant = (c: Client): MatchEntrant => ({
      id: c.id,
      name: c.name,
      character: c.character,
      team: 0,
      bot: false,
      clientId: c.id,
      laserEyes: c.laserEyes,
    });
    for (const c of humans) {
      const group = size > 1 && c.team > 0 ? (explicit.get(c.team) ?? []) : null;
      if (group && group.length < size) {
        group.push(toEntrant(c));
        explicit.set(c.team, group);
      } else autoHumans.push(c);
    }
    const groups: MatchEntrant[][] = [...explicit.keys()].sort((a, b) => a - b).map((k) => explicit.get(k)!);
    let current: MatchEntrant[] | null = null;
    for (const c of autoHumans) {
      if (!current || current.length >= size) {
        current = [];
        groups.push(current);
      }
      current.push(toEntrant(c));
    }

    const total = clamp(Math.max(this.settings.fillTo, humans.length), 1, MAX_PLAYERS);
    const botsToAdd = total - humans.length;
    const makeBot = this.botFactory(humans);
    let added = 0;
    const topUpRoom = groups.reduce((sum, g) => sum + (size - g.length), 0);
    // Bots join human squads unless that would leave nobody to fight.
    if (groups.length >= 2 || botsToAdd - topUpRoom >= 1) {
      for (const g of groups) {
        while (g.length < size && added < botsToAdd) {
          g.push(makeBot());
          added++;
        }
      }
    }
    while (added < botsToAdd) {
      const g: MatchEntrant[] = [];
      groups.push(g);
      while (g.length < size && added < botsToAdd) {
        g.push(makeBot());
        added++;
      }
    }
    groups.forEach((g, i) => {
      for (const e of g) e.team = i + 1;
    });
    return groups.flat();
  }

  private botFactory(humans: Client[]): () => MatchEntrant {
    const usedNames = new Set(humans.map((h) => h.name));
    const names = shuffle(BOT_NAMES.filter((n) => !usedNames.has(n)));
    const charUse = new Map<CharacterId, number>();
    for (const c of CHARACTERS) charUse.set(c.id, 0);
    for (const h of humans) charUse.set(h.character, (charUse.get(h.character) ?? 0) + 1);
    let nameIndex = 0;
    return () => {
      let name = names[nameIndex % Math.max(1, names.length)] ?? 'Bot';
      if (nameIndex >= names.length) name = `${name.slice(0, 13)}${Math.floor(nameIndex / names.length) + 1}`;
      nameIndex++;
      const minUse = Math.min(...charUse.values());
      const character = pick(CHARACTERS.filter((c) => charUse.get(c.id) === minUse)).id;
      charUse.set(character, minUse + 1);
      return {
        id: `b${this.botSeq++}`,
        name,
        character,
        team: 0,
        bot: true,
        clientId: null,
        laserEyes: Math.random() < 0.05,
      };
    };
  }

  private onMatchEnd(match: Match): void {
    for (const r of match.results) {
      const entry = this.board.get(r.name) ?? {
        name: r.name,
        character: r.character,
        bot: r.bot,
        matches: 0,
        wins: 0,
        kills: 0,
        score: 0,
      };
      entry.character = r.character;
      entry.bot = r.bot;
      entry.matches++;
      if (r.place === 1) entry.wins++;
      entry.kills += r.kills;
      entry.score += r.score;
      this.board.set(r.name, entry);
    }
    this.endMessage = { t: 'end', winnerTeam: match.winnerTeam, results: match.results, board: this.boardTop() };
    this.pendingEnd = this.endMessage;
    this.lobbyDirty = true;
  }

  private logMatchEnd(match: Match): void {
    const avg = this.tickCount ? this.tickMsTotal / this.tickCount : 0;
    console.log(
      `[room ${this.code}] match ended: winner team ${match.winnerTeam} after ${match.time.toFixed(1)}s · ` +
        `tick avg ${avg.toFixed(3)}ms max ${this.tickMsMax.toFixed(3)}ms over ${this.tickCount} ticks`,
    );
  }

  private returnToLobby(): void {
    this.match = null;
    this.snaps = null;
    this.pendingEnd = null;
    this.endMessage = null;
    this.lobbyPhase = 'lobby';
    // Ready flags survive: players who readied while spectating start the next ready check right away.
    for (const c of this.clients.values()) c.specTarget = null;
    this.updateReadyCheck();
    this.lobbyDirty = true;
  }

  // ───────────────────────────── Tick ─────────────────────────────

  tick(): void {
    const now = Date.now();
    this.expireSeats(now);
    if (this.pendingChats.length > 0) {
      const due = this.pendingChats.filter((p) => p.due <= now);
      if (due.length > 0) {
        this.pendingChats = this.pendingChats.filter((p) => p.due > now);
        for (const p of due) this.broadcast(p.msg);
      }
    }
    if (this.readyT > 0 && !this.match && this.lobbyPhase === 'lobby') {
      const before = Math.ceil(this.readyT);
      this.readyT -= TICK_DT;
      const after = Math.ceil(this.readyT);
      if (after !== before) this.lobbyDirty = true;
      if (before > READY_WARNING * this.timeScale && after <= READY_WARNING * this.timeScale && this.readyT > 0) {
        this.systemChat(`${Math.ceil(this.readyT)}s to launch`);
      }
      if (this.readyT <= 0) this.beginCountdown('ready timer expired');
    }
    if (this.lobbyPhase === 'countdown' && !this.match) {
      const before = Math.ceil(this.countdownT);
      this.countdownT -= TICK_DT;
      if (Math.ceil(this.countdownT) !== before) this.lobbyDirty = true;
      if (this.countdownT <= 0) this.startMatch();
    }
    const match = this.match;
    if (match && this.snaps) {
      const started = performance.now();
      const phaseBefore = match.phase;
      match.step();
      this.snaps.prepare();
      for (const c of this.clients.values()) {
        if (!c.joined || !c.conn) continue;
        const playerId = match.playerById(c.id) ? c.id : null;
        this.sendRaw(c, this.snaps.forViewer({ playerId, specTarget: c.specTarget }));
      }
      match.flushEvents();
      const cost = performance.now() - started;
      this.tickMsTotal += cost;
      this.tickCount++;
      if (cost > this.tickMsMax) this.tickMsMax = cost;
      if (match.phase !== phaseBefore) this.lobbyDirty = true;
      // `end` goes out after the snapshot carrying the final kill events of that tick.
      if (this.pendingEnd) {
        this.broadcast(this.pendingEnd);
        this.pendingEnd = null;
        this.logMatchEnd(match);
      }
      if (match.over) this.returnToLobby();
    }
    if (this.lobbyDirty || now - this.lastLobbyAt >= LOBBY_BROADCAST_MS) {
      this.lobbyDirty = false;
      this.lastLobbyAt = now;
      this.broadcast(this.lobbyMessage());
    }
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      for (const c of this.clients.values()) {
        const ws = c.conn?.ws;
        if (!ws?.ping) continue;
        c.pingSentAt = performance.now();
        ws.ping();
      }
    }
  }

  // ───────────────────────────── Sending ─────────────────────────────

  private send(client: Client, msg: ServerMsg): void {
    this.sendRaw(client, JSON.stringify(msg));
  }

  private sendRaw(client: Client, data: string): void {
    try {
      client.conn?.ws.send(data);
    } catch {
      // socket closing; the close handler cleans up
    }
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) this.sendRaw(c, data);
  }
}
