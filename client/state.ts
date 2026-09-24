import { INTERP_DELAY_MS, TICK_DT, WEAPONS } from '../shared/constants';
import type { GameMap } from '../shared/map';
import { bushAt, stepMove, type MoveInput, type MoveState } from '../shared/physics';
import {
  ST,
  type ChestSnap,
  type EntSnap,
  type GameEvent,
  type LootItem,
  type PlayerSnap,
  type RosterEntry,
  type SelfSnap,
  type ServerMsg,
  type ZoneSnap,
} from '../shared/protocol';
import type { ViewPlayer, ViewProjectile } from './view';

type Snapshot = Extract<ServerMsg, { t: 'snap' }>;
type Match = Extract<ServerMsg, { t: 'match' }>;

interface BufferedSnapshot {
  msg: Snapshot;
  players: Map<string, PlayerSnap>;
  ents: Map<number, EntSnap>;
}

export interface PredictedInput extends MoveInput {
  seq: number;
}

interface Flight extends ViewProjectile {
  lifetime: number;
}

export interface WorldFrame {
  players: ViewPlayer[];
  projectiles: ViewProjectile[];
  ents: EntSnap[];
  focus: { x: number; y: number; z: number };
  focusId: string | null;
  selfPlayer: ViewPlayer | null;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number): number =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class GameState {
  map: GameMap | null = null;
  readonly roster = new Map<string, RosterEntry>();
  readonly loot = new Map<number, LootItem>();
  readonly chests = new Map<number, ChestSnap>();
  readonly projectiles = new Map<number, Flight>();
  readonly emotes = new Map<string, { text: string; at: number }>();
  lootList: LootItem[] = [];
  chestList: ChestSnap[] = [];

  phase: Snapshot['phase'] = 'lobby';
  phaseT = 0;
  matchTime = 0;
  zone: ZoneSnap | null = null;
  self: SelfSnap | null = null;
  selfId: string | null = null;
  myTeam = 0;
  spectating: string | null = null;
  aliveCount = 0;
  teamsAlive = 0;
  teamSize = 1;
  death: { killer: string | null; cause: string; place: number | null } | null = null;

  prediction: MoveState | null = null;
  /** Input sequence: monotonic for the page lifetime (never reset per match) so resumed sessions stay accepted. */
  seq = 0;
  readonly pending: PredictedInput[] = [];
  correctionX = 0;
  correctionZ = 0;
  localAim: number | null = null;

  private snapshots: BufferedSnapshot[] = [];
  private serverOffset = 0;
  private teamPlace: number | null = null;
  private hasOffset = false;
  private lastTick = -1;
  private lastPredictedX = 0;
  private lastPredictedZ = 0;
  private predictedVx = 0;
  private predictedVz = 0;

  resetLobby(map: GameMap): void {
    this.map = map;
    this.roster.clear();
    this.loot.clear();
    this.chests.clear();
    this.projectiles.clear();
    this.emotes.clear();
    this.lootList = [];
    this.chestList = [];
    this.snapshots.length = 0;
    this.pending.length = 0;
    this.hasOffset = false;
    this.lastTick = -1;
    this.prediction = null;
    this.localAim = null;
    this.self = null;
    this.selfId = null;
    this.myTeam = 0;
    this.teamSize = 1;
    this.spectating = null;
    this.zone = null;
    this.death = null;
    this.teamPlace = null;
    this.aliveCount = 0;
    this.teamsAlive = 0;
    this.matchTime = 0;
    this.phase = 'lobby';
    this.phaseT = 0;
    this.correctionX = this.correctionZ = 0;
  }

  /**
   * Match setup. `resumed` = the same match re-sent after a socket reconnect (as spectator or player): keep the
   * running phase until the next snapshot instead of flashing the deploy camera.
   */
  startMatch(msg: Match, map: GameMap, resumed: boolean): void {
    const phase = resumed ? this.phase : 'deploy';
    this.resetLobby(map);
    for (const entry of msg.roster) this.roster.set(entry.id, entry);
    for (const item of msg.loot) this.loot.set(item.id, item);
    for (const chest of msg.chests) this.chests.set(chest.id, chest);
    this.lootList = [...this.loot.values()];
    this.chestList = [...this.chests.values()];
    this.selfId = msg.you;
    this.myTeam = msg.you ? this.roster.get(msg.you)?.team ?? 0 : 0;
    this.teamSize = msg.teamSize;
    this.phase = phase;
  }

  receive(msg: Snapshot, now = Date.now()): boolean {
    if (msg.tick <= this.lastTick) return false;
    this.lastTick = msg.tick;

    // Both server and client use Unix milliseconds; smoothing absorbs variable network latency.
    const measuredOffset = msg.time - now;
    if (!this.hasOffset) {
      this.serverOffset = measuredOffset;
      this.hasOffset = true;
    } else {
      this.serverOffset += (measuredOffset - this.serverOffset) * 0.08;
    }
    this.snapshots.push({
      msg,
      players: new Map(msg.players.map((player) => [player.id, player])),
      ents: new Map(msg.ents.map((ent) => [ent.id, ent])),
    });
    if (this.snapshots.length > 12) this.snapshots.shift();

    this.phase = msg.phase;
    this.phaseT = msg.phaseT;
    this.matchTime = msg.matchTime;
    this.zone = msg.zone;
    this.self = msg.self;
    this.spectating = msg.spectating;
    this.aliveCount = msg.aliveCount;
    this.teamsAlive = msg.teamsAlive;
    for (const event of msg.ev) this.applyEvent(event);

    const player = msg.players.find((entry) => entry.id === this.selfId);
    const predictable = !!player?.alive && !(player.st & (ST.LEAP | ST.DEPLOYING));
    if (msg.self && msg.phase === 'playing' && predictable) {
      this.reconcile(msg.self);
    } else {
      this.prediction = null;
      this.pending.length = 0;
      this.correctionX = this.correctionZ = 0;
    }
    return true;
  }

  applyEvent(event: GameEvent, now = performance.now()): void {
    switch (event.e) {
      case 'lootAdd':
        this.loot.set(event.item.id, event.item);
        this.lootList = [...this.loot.values()];
        break;
      case 'lootDel':
        this.loot.delete(event.id);
        this.lootList = [...this.loot.values()];
        break;
      case 'chestAdd':
        this.chests.set(event.chest.id, event.chest);
        this.chestList = [...this.chests.values()];
        break;
      case 'chest': {
        const chest = this.chests.get(event.id);
        if (chest) {
          this.chests.set(event.id, { ...chest, open: true });
          this.chestList = [...this.chests.values()];
        }
        break;
      }
      case 'emote': this.emotes.set(event.by, { text: event.text, at: now }); break;
      case 'shot': {
        const weapon = WEAPONS[event.w];
        this.projectiles.set(event.id, {
          id: event.id, by: event.by, w: event.w, x: event.x, z: event.z,
          ox: event.x, oz: event.z, dx: event.dx, dz: event.dz, age: 0,
          len: event.len,
          lifetime: event.len !== undefined ? 0.25 : weapon.range / weapon.projectileSpeed,
        });
        break;
      }
      case 'hit':
      case 'impact': {
        const flight = this.projectiles.get(event.id);
        if (flight && flight.len === undefined) this.projectiles.delete(event.id);
        break;
      }
      case 'kill':
        if (event.victim === this.selfId) {
          this.death = { killer: event.killer, cause: event.cause, place: this.teamPlace };
        }
        break;
      case 'teamOut':
        if (event.team === this.myTeam) {
          this.teamPlace = event.place;
          if (this.death) this.death.place = event.place;
        }
        break;
    }
  }

  /** Server state followed by unacknowledged fixed steps, using the latest authoritative speed multiplier. */
  reconcile(self: SelfSnap): void {
    if (!this.map) return;
    const previousX = (this.prediction?.x ?? self.x) + this.correctionX;
    const previousZ = (this.prediction?.z ?? self.z) + this.correctionZ;
    const next: MoveState = {
      x: self.x, z: self.z, dashT: self.dashT, dashCd: self.dashCd,
      dashDx: self.dashDx, dashDz: self.dashDz,
    };
    while (this.pending.length && this.pending[0]!.seq <= self.ack) this.pending.shift();
    for (const input of this.pending) stepMove(this.map, next, input, self.speedMul, TICK_DT);
    const errorX = previousX - next.x;
    const errorZ = previousZ - next.z;
    if (Math.hypot(errorX, errorZ) > 3) {
      this.correctionX = this.correctionZ = 0;
    } else {
      this.correctionX = errorX;
      this.correctionZ = errorZ;
    }
    this.prediction = next;
    this.lastPredictedX = next.x;
    this.lastPredictedZ = next.z;
  }

  stepPrediction(input: PredictedInput): void {
    if (!this.map || !this.self || !this.prediction || this.phase !== 'playing') return;
    this.pending.push(input);
    // A failed or paused connection must not retain an unbounded replay history.
    if (this.pending.length > 90) this.pending.shift();
    stepMove(this.map, this.prediction, input, this.self.speedMul, TICK_DT);
    this.predictedVx = (this.prediction.x - this.lastPredictedX) / TICK_DT;
    this.predictedVz = (this.prediction.z - this.lastPredictedZ) / TICK_DT;
    this.lastPredictedX = this.prediction.x;
    this.lastPredictedZ = this.prediction.z;
  }

  frame(now: number, dt: number): WorldFrame {
    const serverTime = Date.now() + this.serverOffset - INTERP_DELAY_MS;
    while (this.snapshots.length > 2 && this.snapshots[1]!.msg.time <= serverTime) this.snapshots.shift();
    const first = this.snapshots[0];
    const second = this.snapshots[1] ?? first;
    const a = first?.msg.time ?? serverTime;
    const b = second?.msg.time ?? a;
    const alpha = a === b ? 1 : Math.max(0, Math.min(1, (serverTime - a) / (b - a)));
    const current = second ?? first;

    // Decay the visual-only error, never the authoritative predicted movement state.
    const decay = Math.exp(-dt / 0.1);
    this.correctionX *= decay;
    this.correctionZ *= decay;

    const players: ViewPlayer[] = [];
    let selfPlayer: ViewPlayer | null = null;
    let focusPlayer: ViewPlayer | null = null;
    const localServerPlayer = this.selfId ? current?.players.get(this.selfId) : undefined;
    const referenceX = this.prediction?.x ?? localServerPlayer?.x ?? 0;
    const referenceZ = this.prediction?.z ?? localServerPlayer?.z ?? 0;
    if (current && first) {
      const leading = second && second !== first ? second : first;
      for (const [id, next] of leading.players) {
        const previous = first.players.get(id);
        if (!previous && first !== leading && alpha < 1) continue;
        const playerBefore = previous ?? next;
        const roster = this.roster.get(id);
        if (!roster) continue;
        const isSelf = id === this.selfId;
        const isTeammate = !isSelf && this.myTeam !== 0 && roster.team === this.myTeam;
        const predictable = isSelf && this.phase === 'playing' && this.prediction && next.alive
          && !(next.st & (ST.LEAP | ST.DEPLOYING));
        const x = predictable ? this.prediction!.x + this.correctionX : lerp(playerBefore.x, next.x, alpha);
        const z = predictable ? this.prediction!.z + this.correctionZ : lerp(playerBefore.z, next.z, alpha);
        const y = lerp(playerBefore.y, next.y, alpha);
        const elapsed = (leading.msg.time - first.msg.time) / 1000;
        const vx = predictable ? this.predictedVx : elapsed > 0 ? (next.x - playerBefore.x) / elapsed : 0;
        const vz = predictable ? this.predictedVz : elapsed > 0 ? (next.z - playerBefore.z) / elapsed : 0;
        const emote = this.emotes.get(id);
        const concealed = !isSelf && !isTeammate && !!this.map && bushAt(this.map, x, z)
          && Math.hypot(x - referenceX, z - referenceZ) > 5 && !(next.st & (ST.REVEALED | ST.FIRING));
        const result: ViewPlayer = {
          ...next, x, y, z, aim: predictable && this.localAim !== null
            ? this.localAim : lerpAngle(playerBefore.aim, next.aim, alpha),
          name: roster.name, character: roster.character, team: roster.team, bot: roster.bot,
          isSelf, isTeammate, vx, vz, concealed,
          emote: emote && now - emote.at < 2500 ? { text: emote.text, age: (now - emote.at) / 1000 } : null,
        };
        players.push(result);
        if (isSelf) selfPlayer = result;
        if (id === (this.self && next.alive ? this.selfId : this.spectating)) focusPlayer = result;
      }
      // Players removed from the newer snapshot persist only until the interpolation reaches it.
      if (leading !== first && alpha < 1) {
        for (const [id, previous] of first.players) {
          if (leading.players.has(id) || !this.roster.has(id)) continue;
          const roster = this.roster.get(id)!;
          players.push({
            ...previous, ...roster, isSelf: id === this.selfId,
            isTeammate: id !== this.selfId && this.myTeam !== 0 && roster.team === this.myTeam,
            vx: 0, vz: 0, concealed: false, emote: null,
          });
        }
      }
    }
    if (!focusPlayer && this.spectating) focusPlayer = players.find((player) => player.id === this.spectating) ?? null;
    if (!focusPlayer) focusPlayer = selfPlayer ?? players.find((player) => player.alive) ?? null;

    const ents: EntSnap[] = [];
    if (current && first) {
      const leading = second && second !== first ? second : first;
      for (const [id, next] of leading.ents) {
        const prev = first.ents.get(id);
        if (!prev && leading !== first && alpha < 1) continue;
        const before = prev ?? next;
        ents.push({
          ...next, x: lerp(before.x, next.x, alpha), z: lerp(before.z, next.z, alpha),
          y: lerp(before.y, next.y, alpha), ttl: lerp(before.ttl, next.ttl, alpha),
          aim: before.aim !== undefined && next.aim !== undefined
            ? lerpAngle(before.aim, next.aim, alpha) : next.aim,
        });
      }
      if (leading !== first && alpha < 1) {
        for (const [id, ent] of first.ents) if (!leading.ents.has(id)) ents.push(ent);
      }
    }

    const projectiles: ViewProjectile[] = [];
    for (const [id, flight] of this.projectiles) {
      flight.age += dt;
      if (flight.age >= flight.lifetime) {
        this.projectiles.delete(id);
        continue;
      }
      if (flight.len === undefined) {
        const distance = flight.age * WEAPONS[flight.w].projectileSpeed;
        flight.x = flight.ox + flight.dx * distance;
        flight.z = flight.oz + flight.dz * distance;
      }
      projectiles.push(flight);
    }
    for (const [id, emote] of this.emotes) if (now - emote.at >= 2500) this.emotes.delete(id);
    return {
      players, projectiles, ents, selfPlayer,
      focusId: focusPlayer?.id ?? null,
      focus: focusPlayer
        ? { x: focusPlayer.x, y: focusPlayer.y, z: focusPlayer.z }
        : { x: 0, y: 0, z: 0 },
    };
  }
}
