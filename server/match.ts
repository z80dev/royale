// One battle-royale match: deploy → playing → ended. Owns all world state and the 30 Hz simulation step.

import {
  AIRDROP_TIMES,
  CONSUMABLES,
  DEPLOY_ALTITUDE,
  DEPLOY_STEER_SPEED,
  KILL_VERBS,
  MAP_HALF,
  MAX_HP,
  PHASE_TIMES,
  SCORE,
  STARTING_AMMO,
  TICK_DT,
  WEAPONS,
  type CharacterId,
  type WeaponId,
} from '../shared/constants';
import { generateMap, type GameMap } from '../shared/map';
import { findFreeSpot, stepMove } from '../shared/physics';
import {
  EMOTES,
  type GameEvent,
  type KillCause,
  type LootItem,
  type ResultEntry,
  type RosterEntry,
  type ServerMsg,
} from '../shared/protocol';
import { spawnAirdrop, tickEnts, tickLeap, useAbility, visibleFrom } from './abilities';
import { BotBrain, prepareBots } from './bots/brain';
import { applyDamage, cancelReload, startReload, stepProjectiles, tickReload, tickTrigger } from './combat';
import { clamp, pick } from './config';
import { autoPickup, dropActiveWeapon, dropInventory, interact, populateWorld } from './loot';
import type { ActCmd, BotWorld, Chest, Ent, Player, Projectile, QueuedCmd, SkillLevel } from './types';
import { Zone } from './zone';

export interface MatchEntrant {
  id: string;
  name: string;
  character: CharacterId;
  team: number;
  bot: boolean;
  clientId: string | null;
  laserEyes: boolean;
}

export interface MatchOptions {
  entrants: MatchEntrant[];
  teamSize: number;
  skill: SkillLevel;
  timeScale: number;
  onEnd: (match: Match) => void;
}

export type MatchPhase = 'deploy' | 'playing' | 'ended';

const RUG_CHANCE = 0.12;
const MAX_INPUTS_PER_TICK = 3;
const MAX_ACTS_PER_TICK = 6;
const MAX_QUEUED_INPUTS = 8;
const MAX_QUEUE_LENGTH = 32;
/** Movement catch-up credit cap: delayed input bursts may catch up at most this much simulated time. */
const MAX_MOVE_CREDIT = 6 * TICK_DT;
/** Without input for this many ticks, a human's trigger + movement intent is released. */
const INPUT_STALE_TICKS = 15;
const SWAP_DELAY = 0.2;
const EMOTE_COOLDOWN = 1.2;
const ZONE_FAST_FORWARD = 3;
/** After landing everyone is invulnerable and can't shoot / use abilities for this long ("market opens in 3…"). */
export const LANDING_GRACE = 3;

const STREAK_CALLOUTS: Record<number, [string, string]> = {
  2: ['DOUBLE SPEND!', '#3FA9FF'],
  3: ['TRIPLE TOP!', '#B65CFF'],
  5: ['WHALE ALERT!', '#00F0FF'],
  7: ['MARKET MAKER', '#FFB627'],
  10: ['SATOSHI MODE', '#FF2BD6'],
};

const EXTRA_KILL_VERBS: Partial<Record<KillCause, readonly string[]>> = {
  ability: ['shockwaved', 'sent it on', 'body-slammed', 'dunked on'],
  turret: ['clanked', 'auto-deployed on', 'botted'],
};

function killVerb(cause: KillCause): string {
  const table = (KILL_VERBS as Record<string, readonly string[] | undefined>)[cause] ?? EXTRA_KILL_VERBS[cause];
  return pick(table ?? KILL_VERBS.weapon);
}

function newPlayer(e: MatchEntrant, x: number, z: number): Player {
  return {
    id: e.id,
    name: e.name,
    character: e.character,
    team: e.team,
    bot: e.bot,
    ai: e.bot,
    clientId: e.clientId,
    alive: true,
    move: { x, z, dashT: 0, dashCd: 0, dashDx: 0, dashDz: 0 },
    y: DEPLOY_ALTITUDE,
    aim: 0,
    moveAmount: 0,
    hp: MAX_HP,
    ar: 0,
    slots: [{ w: 'pistol', mag: WEAPONS.pistol.mag }, null],
    active: 0,
    ammo: { ...STARTING_AMMO },
    cons: { stable: 0, medkit: 0 },
    reloadT: 0,
    reloadTotal: 0,
    channel: null,
    abilityCd: 0,
    dmgBuffT: 0,
    dmgBuffMul: 1,
    rushT: 0,
    rushMul: 1,
    slowT: 0,
    slowMul: 1,
    invulnT: 0,
    leap: null,
    revealedTo: new Map(),
    fireHeld: false,
    firePress: false,
    pressAim: 0,
    pressAge: 0,
    lastFireInput: false,
    fireCd: 0,
    spin: 0,
    sinceShot: 99,
    zoneHurt: false,
    queue: [],
    lastAck: 0,
    moveCredit: 2 * TICK_DT,
    deployX: x,
    deployZ: z,
    kills: 0,
    damage: 0,
    score: 0,
    streak: 0,
    place: 0,
    deathTime: -1,
    killedBy: null,
    lastHurtAt: -99,
    lastHurtBy: null,
    laserEyes: e.laserEyes,
  };
}

export class Match implements BotWorld {
  readonly map: GameMap;
  readonly seed: number;
  readonly skill: SkillLevel;
  readonly teamSize: number;
  readonly timeScale: number;
  phase: MatchPhase = 'deploy';
  phaseT: number;
  time = 0;
  /** Seconds left of the post-landing grace period. */
  graceT = 0;
  tick = 0;
  readonly players: Player[] = [];
  readonly loot = new Map<number, LootItem>();
  readonly chests = new Map<number, Chest>();
  readonly ents: Ent[] = [];
  readonly projectiles: Projectile[] = [];
  /** Events emitted since the last snapshot broadcast (cleared by the room via flushEvents). */
  readonly events: GameEvent[] = [];
  readonly zoneCtl: Zone;
  winnerTeam = 0;
  results: ResultEntry[] = [];
  /** Set once the post-match results timer has elapsed. */
  over = false;

  private readonly byId = new Map<string, Player>();
  private readonly brains = new Map<string, BotBrain>();
  private readonly lastInputTick = new Map<string, number>();
  private readonly lastEmoteAt = new Map<string, number>();
  private readonly onEnd: (match: Match) => void;
  private readonly deployTotal: number;
  private idSeq = 1;
  private firstBlood = false;
  private airdropIndex = 0;
  private zonePulseT = 1;
  private fastForward = false;

  constructor(opts: MatchOptions) {
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.map = generateMap(this.seed);
    this.skill = opts.skill;
    this.teamSize = opts.teamSize;
    this.timeScale = opts.timeScale;
    this.onEnd = opts.onEnd;
    this.deployTotal = PHASE_TIMES.deploy * opts.timeScale;
    this.phaseT = this.deployTotal;
    this.zoneCtl = new Zone(this.map, opts.timeScale, (ev) => this.emit(ev));

    // Everyone launches together from a random point near the map edge ("the bus").
    const launchAngle = Math.random() * Math.PI * 2;
    const launchX = Math.cos(launchAngle) * (MAP_HALF - 12);
    const launchZ = Math.sin(launchAngle) * (MAP_HALF - 12);
    for (const entrant of opts.entrants) {
      const jitterA = Math.random() * Math.PI * 2;
      const jitterR = Math.random() * 5;
      const p = newPlayer(entrant, launchX + Math.cos(jitterA) * jitterR, launchZ + Math.sin(jitterA) * jitterR);
      p.aim = Math.atan2(-launchZ, -launchX);
      const landmark = pick(this.map.landmarks);
      this.setDeployTarget(p, landmark.x + (Math.random() - 0.5) * 6, landmark.z + (Math.random() - 0.5) * 6);
      this.players.push(p);
      this.byId.set(p.id, p);
    }
    populateWorld(this, RUG_CHANCE);
    prepareBots(this);
    for (const p of this.players) if (p.ai) this.brains.set(p.id, new BotBrain(this, p));
  }

  // ───────────────────────────── BotWorld / shared helpers ─────────────────────────────

  get zone() {
    return this.zoneCtl.state;
  }

  /** Weapons and abilities work (not while still in the sky or during the landing grace). */
  get combatLive(): boolean {
    return this.phase !== 'deploy' && this.graceT <= 0;
  }

  nextId(): number {
    return this.idSeq++;
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  announce(text: string, sub?: string, color?: string): void {
    const ev: GameEvent = { e: 'announce', text };
    if (sub) ev.sub = sub;
    if (color) ev.color = color;
    this.events.push(ev);
  }

  flushEvents(): void {
    this.events.length = 0;
  }

  playerById(id: string): Player | undefined {
    return this.byId.get(id);
  }

  canSee(viewer: Player, target: Player): boolean {
    if (!target.alive) return false;
    return visibleFrom(this, viewer.move.x, viewer.move.z, viewer.team, target);
  }

  submit(p: Player, cmd: QueuedCmd): void {
    if (cmd.t !== 'in') {
      // Acts are cheap, but never let a spamming client grow the queue without bound.
      if (p.queue.length < MAX_QUEUE_LENGTH) p.queue.push(cmd);
      return;
    }
    p.queue.push(cmd);
    let inputs = 0;
    for (const queued of p.queue) if (queued.t === 'in') inputs++;
    if (inputs <= MAX_QUEUED_INPUTS) return;
    // Drop the oldest movement inputs (acts are kept) so a lagging client can't build up a backlog.
    let drop = inputs - MAX_QUEUED_INPUTS;
    for (let i = 0; i < p.queue.length && drop > 0; i++) {
      const queued = p.queue[i]!;
      if (queued.t !== 'in') continue;
      p.lastAck = Math.max(p.lastAck, queued.seq);
      p.queue.splice(i--, 1);
      drop--;
    }
  }

  deploy(p: Player, x: number, z: number): void {
    if (this.phase !== 'deploy' || !p.alive) return;
    this.setDeployTarget(p, x, z);
  }

  emote(p: Player, index: number): void {
    const text = EMOTES[index];
    if (text === undefined) return;
    const last = this.lastEmoteAt.get(p.id) ?? -99;
    const now = this.tick * TICK_DT;
    if (now - last < EMOTE_COOLDOWN) return;
    this.lastEmoteAt.set(p.id, now);
    this.emit({ e: 'emote', by: p.id, text });
  }

  private setDeployTarget(p: Player, x: number, z: number): void {
    const lim = MAP_HALF - 2;
    p.deployX = clamp(x, -lim, lim);
    p.deployZ = clamp(z, -lim, lim);
  }

  /** A human disconnected mid-match: the bot AI drives their player until they reconnect (or forever). */
  handOffToAi(playerId: string): void {
    const p = this.byId.get(playerId);
    if (!p || p.ai) return;
    p.ai = true;
    p.clientId = null;
    p.queue.length = 0;
    p.fireHeld = false;
    p.moveAmount = 0;
    if (!p.alive || this.phase === 'ended') return;
    this.brains.set(p.id, new BotBrain(this, p));
    this.announce(`${p.name} disconnected — Clanker AI took the wheel`, undefined, '#8A63D2');
  }

  /**
   * The human reconnected: stop the bot and hand control back. Input sequencing restarts (the client's counter
   * may continue or restart at 1 after a page reload), so any seq > 0 is accepted again.
   */
  reclaimFromAi(playerId: string): void {
    const p = this.byId.get(playerId);
    if (!p || p.bot) return;
    p.ai = false;
    p.clientId = playerId;
    this.brains.delete(p.id);
    p.queue.length = 0;
    p.lastAck = 0;
    p.fireHeld = false;
    p.firePress = false;
    p.lastFireInput = false;
    p.moveAmount = 0;
    p.moveCredit = 2 * TICK_DT;
    this.lastInputTick.set(p.id, this.tick);
  }

  /** Living players still controlled by a connected human. */
  humansAlive(): number {
    let n = 0;
    for (const p of this.players) if (p.alive && !p.ai) n++;
    return n;
  }

  teamsAlive(): number {
    const teams = new Set<number>();
    for (const p of this.players) if (p.alive) teams.add(p.team);
    return teams.size;
  }

  aliveCount(): number {
    let n = 0;
    for (const p of this.players) if (p.alive) n++;
    return n;
  }

  roster(): RosterEntry[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, character: p.character, team: p.team, bot: p.bot }));
  }

  matchMessage(you: string | null): Extract<ServerMsg, { t: 'match' }> {
    const chests = [...this.chests.values()].map(({ id, x, z, open, airdrop }) => ({ id, x, z, open, airdrop }));
    return {
      t: 'match',
      seed: this.seed,
      roster: this.roster(),
      loot: [...this.loot.values()],
      chests,
      you,
      teamSize: this.teamSize,
    };
  }

  // ───────────────────────────── Simulation ─────────────────────────────

  step(): void {
    this.tick++;
    const dt = TICK_DT;
    if (this.phase === 'deploy') {
      this.stepDeploy(dt);
      return;
    }
    if (this.phase === 'playing') {
      this.time += dt;
      if (this.graceT > 0) {
        this.graceT = Math.max(0, this.graceT - dt);
        if (this.graceT === 0) this.announce('MARKET OPEN — LFG', 'weapons hot. good luck, ser', '#7CFF4F');
      }
    }
    for (const p of this.players) if (p.alive) this.stepPlayer(p, dt);
    stepProjectiles(this);
    tickEnts(this, dt);
    if (this.phase === 'playing') {
      this.stepZone(dt);
      this.stepAirdrops();
    } else {
      this.phaseT = Math.max(0, this.phaseT - dt);
      if (this.phaseT <= 0) this.over = true;
    }
  }

  private stepDeploy(dt: number): void {
    this.phaseT = Math.max(0, this.phaseT - dt);
    const steer = (DEPLOY_STEER_SPEED / this.timeScale) * dt;
    const altitude = (DEPLOY_ALTITUDE * this.phaseT) / this.deployTotal;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.ai) this.brains.get(p.id)?.think();
      this.drainQueue(p);
      const dx = p.deployX - p.move.x;
      const dz = p.deployZ - p.move.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const stepLen = Math.min(d, steer);
        p.move.x += (dx / d) * stepLen;
        p.move.z += (dz / d) * stepLen;
      }
      p.y = altitude;
    }
    if (this.phaseT > 0) return;
    for (const p of this.players) {
      const spot = findFreeSpot(this.map, p.move.x, p.move.z);
      p.move.x = spot.x;
      p.move.z = spot.z;
      p.y = 0;
      this.emit({ e: 'land', by: p.id });
    }
    this.phase = 'playing';
    this.time = 0;
    this.zoneCtl.start();
    this.graceT = LANDING_GRACE;
    this.announce(
      `MARKET OPENS IN ${LANDING_GRACE}s`,
      'WASD / arrows move · mouse aim + click shoot · Space dash · E loot · Q ability',
      '#FFB627',
    );
    if (this.teamsAlive() <= 1) this.finish(this.lastTeamStanding());
  }

  private stepPlayer(p: Player, dt: number): void {
    p.abilityCd = Math.max(0, p.abilityCd - dt);
    p.dmgBuffT = Math.max(0, p.dmgBuffT - dt);
    p.rushT = Math.max(0, p.rushT - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    if (p.ai && this.phase === 'playing') this.brains.get(p.id)?.think();
    else if (!p.ai && this.tick - (this.lastInputTick.get(p.id) ?? 0) > INPUT_STALE_TICKS) {
      p.fireHeld = false;
      p.lastFireInput = false;
      p.moveAmount = 0;
    }
    this.drainQueue(p);
    if (!p.alive) return;
    tickLeap(this, p, dt);
    if (!p.alive) return;
    tickReload(p, dt);
    this.tickChannel(p, dt);
    tickTrigger(this, p, dt);
    if (p.alive && !p.leap) autoPickup(this, p);
  }

  /** Speed multiplier fed to stepMove (mirrored to the client in SelfSnap.speedMul). */
  speedMul(p: Player): number {
    let mul = 1;
    if (p.rushT > 0) mul *= p.rushMul;
    if (p.slowT > 0) mul *= p.slowMul;
    if (p.channel) mul *= 0.5;
    const slot = p.slots[p.active];
    if (slot?.w === 'sniper' || slot?.w === 'rocket') mul *= 0.9;
    if (slot?.w === 'minigun' && p.fireHeld) mul *= 0.75;
    return mul;
  }

  /**
   * Apply queued commands in order. Each movement input costs one TICK_DT of the player's real-time credit
   * (+TICK_DT per server tick, capped at MAX_MOVE_CREDIT); inputs beyond the credit wait in the queue, so a
   * client flooding inputs can't simulate faster than real time while jittered packets still catch up.
   */
  private drainQueue(p: Player): void {
    p.moveCredit = Math.min(MAX_MOVE_CREDIT, p.moveCredit + TICK_DT);
    let inputs = 0;
    let acts = 0;
    while (p.queue.length > 0 && inputs < MAX_INPUTS_PER_TICK && acts < MAX_ACTS_PER_TICK) {
      const cmd = p.queue[0]!;
      if (cmd.t === 'in') {
        if (cmd.seq <= p.lastAck) {
          p.queue.shift();
          continue;
        }
        if (p.moveCredit < TICK_DT - 1e-6) break;
        p.queue.shift();
        inputs++;
        p.moveCredit -= TICK_DT;
        p.lastAck = cmd.seq;
        this.lastInputTick.set(p.id, this.tick);
        this.applyInput(p, cmd);
      } else {
        p.queue.shift();
        acts++;
        this.applyAct(p, cmd);
      }
      if (!p.alive) {
        p.queue.length = 0;
        return;
      }
    }
  }

  private applyInput(p: Player, cmd: Extract<QueuedCmd, { t: 'in' }>): void {
    p.aim = cmd.aim;
    // Remember a press edge even if a later input drained in this same tick releases the button.
    if (cmd.fire && !p.lastFireInput) {
      p.firePress = true;
      p.pressAim = cmd.aim;
      p.pressAge = 0;
    }
    p.lastFireInput = cmd.fire;
    p.fireHeld = cmd.fire;
    p.moveAmount = Math.min(1, Math.hypot(cmd.mx, cmd.mz));
    if (this.phase === 'deploy' || p.leap) return;
    const wasDashing = p.move.dashT > 0;
    stepMove(this.map, p.move, { mx: cmd.mx, mz: cmd.mz, dash: cmd.dash }, this.speedMul(p), TICK_DT);
    if (!wasDashing && p.move.dashT > 0) this.emit({ e: 'dash', by: p.id });
  }

  private applyAct(p: Player, act: ActCmd): void {
    if (this.phase === 'deploy' || !p.alive) return;
    switch (act.a) {
      case 'reload':
        startReload(this, p);
        break;
      case 'interact':
        if (!p.leap) interact(this, p);
        break;
      case 'slot':
        if (act.v === 0 || act.v === 1) this.switchSlot(p, act.v);
        break;
      case 'swap':
        this.switchSlot(p, p.active === 0 ? 1 : 0);
        break;
      case 'stable':
      case 'medkit':
        this.startChannel(p, act.a);
        break;
      case 'ability':
        useAbility(this, p, act.x, act.z);
        break;
      case 'drop':
        dropActiveWeapon(this, p);
        break;
      case 'cancel':
        p.channel = null;
        cancelReload(p);
        break;
    }
  }

  private switchSlot(p: Player, slot: 0 | 1): void {
    if (slot === p.active || !p.slots[slot]) return;
    p.active = slot;
    cancelReload(p);
    p.channel = null;
    p.spin = 0;
    p.fireCd = Math.max(p.fireCd, SWAP_DELAY);
  }

  private startChannel(p: Player, c: 'stable' | 'medkit'): void {
    if (p.channel || p.cons[c] <= 0 || p.hp >= MAX_HP) return;
    const total = CONSUMABLES[c].channel;
    cancelReload(p);
    p.channel = { c, t: total, total };
  }

  private tickChannel(p: Player, dt: number): void {
    const ch = p.channel;
    if (!ch) return;
    ch.t -= dt;
    if (ch.t > 0) return;
    p.channel = null;
    const key = ch.c === 'medkit' ? 'medkit' : 'stable';
    if (p.cons[key] <= 0) return;
    p.cons[key]--;
    const before = p.hp;
    p.hp = Math.min(MAX_HP, p.hp + (CONSUMABLES[ch.c].heal ?? 0));
    this.emit({ e: 'heal', by: p.id, hp: Math.round(p.hp - before), armor: 0 });
  }

  private stepZone(dt: number): void {
    if (!this.fastForward && this.humansAlive() === 0 && this.players.some((p) => !p.bot)) {
      this.fastForward = true;
      this.announce('humans got rekt — fast-forwarding the bear market', 'zone ×3', '#FF6B2B');
    }
    this.zoneCtl.update(dt * (this.fastForward ? ZONE_FAST_FORWARD : 1));
    const zone = this.zoneCtl;
    for (const p of this.players) p.zoneHurt = p.alive && p.y <= 0 && zone.outside(p.move.x, p.move.z);
    this.zonePulseT -= dt;
    if (this.zonePulseT > 0) return;
    this.zonePulseT += 1;
    const dps = zone.state.dps;
    for (const p of this.players) {
      if (!p.zoneHurt || !p.alive) continue;
      applyDamage(this, p, dps, null, 'zone', null, 0, p.move.x, p.move.z);
    }
  }

  private stepAirdrops(): void {
    const at = AIRDROP_TIMES[this.airdropIndex];
    if (at === undefined || this.time < at * this.timeScale) return;
    this.airdropIndex++;
    const z = this.zoneCtl.state;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * Math.max(0, z.nr * 0.7);
    const lim = MAP_HALF - 6;
    const x = clamp(z.ncx + Math.cos(a) * d, -lim, lim);
    const zz = clamp(z.ncz + Math.sin(a) * d, -lim, lim);
    spawnAirdrop(this, x, zz, this.timeScale);
    this.announce('AIRDROP INCOMING', 'Legendary loot inbound — Laser Eyes / Money Printer', '#FFB627');
  }

  // ───────────────────────────── Deaths, placement, victory ─────────────────────────────

  killPlayer(victim: Player, killer: Player | null, cause: KillCause, weapon: WeaponId | null): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deathTime = this.time;
    victim.killedBy = killer && killer !== victim ? killer.id : null;
    victim.channel = null;
    victim.leap = null;
    victim.y = 0;
    victim.fireHeld = false;
    victim.streak = 0;
    victim.queue.length = 0;
    cancelReload(victim);
    dropInventory(this, victim);
    this.brains.delete(victim.id);
    this.emit({
      e: 'kill',
      killer: killer && killer !== victim ? killer.id : null,
      victim: victim.id,
      w: weapon,
      cause,
      verb: killVerb(cause),
    });
    if (killer && killer !== victim && killer.team !== victim.team) this.creditKill(killer, victim);
    this.checkTeamOut(victim.team);
  }

  private creditKill(killer: Player, victim: Player): void {
    killer.kills++;
    killer.streak++;
    killer.score += SCORE.kill;
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.announce('GENESIS BLOCK — first blood', `${killer.name} mined the first kill on ${victim.name}`, '#FFB627');
    }
    const callout = STREAK_CALLOUTS[killer.streak];
    if (callout) this.announce(callout[0], `${killer.name} · ${killer.streak} kill streak`, callout[1]);
  }

  private checkTeamOut(team: number): void {
    if (this.phase !== 'playing') return;
    if (this.players.some((p) => p.team === team && p.alive)) return;
    const place = this.teamsAlive() + 1;
    this.setTeamPlace(team, place);
    this.emit({ e: 'teamOut', team, place });
    if (place <= 2) this.finish(place === 1 ? team : this.lastTeamStanding());
  }

  private lastTeamStanding(): number {
    for (const p of this.players) if (p.alive) return p.team;
    return 0;
  }

  private setTeamPlace(team: number, place: number): void {
    const bonus = SCORE.placement[place - 1] ?? 0;
    for (const p of this.players) {
      if (p.team !== team || p.place) continue;
      p.place = place;
      p.score += bonus;
    }
  }

  private finish(winnerTeam: number): void {
    if (this.phase === 'ended') return;
    if (winnerTeam) this.setTeamPlace(winnerTeam, 1);
    this.winnerTeam = winnerTeam;
    this.phase = 'ended';
    this.phaseT = PHASE_TIMES.ended * this.timeScale;
    const winners = this.players.filter((p) => p.team === winnerTeam);
    const names = winners.map((p) => p.name).join(', ');
    if (this.teamSize <= 1) this.announce('WINNER WINNER LAMBO DINNER', `${names} takes the whole bag`, '#FFB627');
    else this.announce('WAGMI', `Team ${winnerTeam} (${names}) — winner winner lambo dinner`, '#FFB627');
    for (const p of winners) {
      if (p.bot && p.alive && Math.random() < 0.7) this.emote(p, Math.random() < 0.5 ? 6 : 2);
    }
    this.results = this.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        team: p.team,
        bot: p.bot,
        kills: p.kills,
        damage: Math.round(p.damage),
        place: p.place || 1,
        score: Math.round(p.score),
      }))
      .sort((a, b) => a.place - b.place || b.score - a.score);
    this.onEnd(this);
  }
}
