import {
  AMMO_MAX, CHARACTER_BY_ID, CONSUMABLES, PICKUP_RADIUS, PLAYER_SPEED, TICK_DT, WEAPONS,
  type WeaponId,
} from '../../shared/constants';
import { findFreeSpot, hasLineOfSight } from '../../shared/physics';
import { EMOTES, type LootItem } from '../../shared/protocol';
import type { ActCmd, BotWorld, Player, WeaponSlot } from '../types';
import { NavGrid, type Waypoint } from './nav';

interface Plan { x: number; z: number }
interface MatchBots {
  nav: NavGrid;
  landings: Map<number, Plan>;
  /** bot player id → id of the enemy it is currently engaging (for pack-focus limits). */
  targets: Map<string, string>;
}
const matches = new WeakMap<BotWorld, MatchBots>();
const SIGHT_RANGE = [22, 28, 36] as const;
/** Human-like reaction to a newly seen target… */
const REACTION_DELAY = [0.7, 0.45, 0.25] as const;
/** …plus time to settle the crosshair before the first shot. */
const SETTLE_DELAY = [1.2, 0.7, 0.35] as const;
const AIM_ERROR = [0.34, 0.17, 0.07] as const;
/** Percent of half-second windows in which the bot deliberately whiffs (aim pulled well off target). */
const WHIFF_CHANCE = [45, 20, 5] as const;
const WHIFF_OFFSET = 0.32;
const DODGE_CHANCE = [10, 35, 70] as const;
/** Fraction of the target's velocity the bot leads by (Paper Hands aims where you ARE, so strafing works). */
const LEAD = [0.2, 0.6, 1] as const;
/** Burst discipline: fraction of each BURST_WINDOW a bot keeps the trigger down. */
const FIRE_DUTY = [0.5, 0.7, 0.95] as const;
const BURST_WINDOW = 1;
/** Seconds a bot holds fire after its target dashes (it lost track of them). */
const DASH_FLINCH = [0.6, 0.35, 0] as const;
/** A bot picks another target when this many other bots already focus the same human. */
const PACK_LIMIT = [2, 3, Infinity] as const;
/** Below this HP a bot under fire breaks off to heal (Paper Hands stays in and can be finished off). */
const RETREAT_HP = [28, 40, 45] as const;
/**
 * Seconds after landing (includes the server's 3s landing grace) during which bots loot instead of hunting;
 * they only fight back against whoever is shooting them.
 */
const OPENING_LOOT = [33, 21, 11] as const;
/** Bot teams keep their landing spots at least this far apart when the map allows it. */
const LANDING_SPACING = 48;

/** Build the shared grid once after map generation, before any bot thinks. */
export function prepareBots(world: BotWorld): void {
  if (!matches.has(world)) {
    matches.set(world, { nav: new NavGrid(world.map), landings: new Map(), targets: new Map() });
  }
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function weaponValueFor(w: WeaponId, mag: number, player: Player): number {
  const def = WEAPONS[w];
  const available = mag + player.ammo[def.ammo];
  const scarcity = available === 0 ? 22 : available < def.mag * 0.4 ? 11 : 0;
  return def.rarity * 20 + (w === 'shotgun' ? 12 : w === 'ar' ? 8 : 0) - scarcity;
}

function weaponValue(slot: WeaponSlot | null, player: Player): number {
  if (!slot) return -30;
  return weaponValueFor(slot.w, slot.mag, player);
}

/**
 * Landing spot for a bot team: rich loot clusters, spread away from other BOT teams' plans. Bots never read
 * human deploy targets (they are not in `match.landings`), so humans are neither targeted nor avoided.
 */
function landing(world: BotWorld, match: MatchBots, team: number): Plan {
  const planned = match.landings.get(team);
  if (planned) return planned;
  const candidates: Plan[] = [
    ...world.map.landmarks.map((l) => ({ x: l.x, z: l.z })),
    ...world.map.lootSpawns.filter((s) => s.tier > 0),
    ...world.map.chestSpawns,
  ];
  let best = -Infinity;
  let point: Plan = { x: 0, z: 16 };
  for (const [index, site] of candidates.entries()) {
    let richness = 0;
    for (const spawn of world.map.lootSpawns) {
      if (Math.hypot(spawn.x - site.x, spawn.z - site.z) < 13) {
        richness += spawn.tier === 2 ? 3 : spawn.tier === 1 ? 1.2 : 0.4;
      }
    }
    for (const chest of world.map.chestSpawns) {
      if (Math.hypot(chest.x - site.x, chest.z - site.z) < 13) richness += 2.5;
    }
    let crowding = 0;
    for (const other of match.landings.values()) {
      const d = Math.hypot(other.x - site.x, other.z - site.z);
      crowding += Math.max(0, LANDING_SPACING - d) * 1.6;
    }
    const roll = (hash(`${world.map.seed}:${team}:${index}`) % 1000) / 1000;
    const score = Math.min(richness, 12) * 1.5 + roll * 8 - crowding;
    if (score <= best) continue;
    best = score;
    point = site;
  }
  point = findFreeSpot(world.map, point.x, point.z);
  match.landings.set(team, point);
  return point;
}

export class BotBrain {
  private readonly match: MatchBots;
  private readonly phaseOffset: number;
  private seq: number;
  private deployed = false;
  private landingEmote = false;
  private lastKills: number;
  private lastEmote = -30;
  private targetId: string | null = null;
  private seenSince = 0;
  private observedAt = -1;
  private observedX = 0;
  private observedZ = 0;
  private velocityX = 0;
  private velocityZ = 0;
  private threatX = 0;
  private threatZ = 0;
  private threatAt = -20;
  private lastHit = -20;
  private route: Waypoint[] = [];
  private waypoint = 0;
  private goalX = NaN;
  private goalZ = NaN;
  private nextPathAt = 0;
  private lastProgressAt = 0;
  private progressX: number;
  private progressZ: number;
  private unstuckUntil = 0;
  private nudgeX = 0;
  private nudgeZ = 0;
  private lootId = -1;
  private chestId = -1;
  private nextLootScan = 0;
  private cachedLootX = 0;
  private cachedLootZ = 0;
  private moveX = 0;
  private moveZ = 0;
  private nextDodgeAt = 0;
  private lastAbilityAt = -20;
  private acts = 0;
  /** `fire` sent with the previous input (semi-automatic weapons need a fresh press per shot). */
  private lastFire = false;
  /** No firing until this time (flinch after the target dashed). */
  private holdFireUntil = 0;
  private readonly ignoredWeapons = new Map<WeaponId, number>();

  constructor(private readonly world: BotWorld, private readonly player: Player) {
    prepareBots(world); // Also supports a newly AI-driven human joining mid-match.
    this.match = matches.get(world)!;
    this.seq = Math.max(0, player.lastAck);
    this.lastKills = player.kills;
    this.progressX = player.move.x;
    this.progressZ = player.move.z;
    this.phaseOffset = hash(player.id) % 30;
  }

  think(): void {
    const p = this.player;
    const world = this.world;
    this.acts = 0;
    const now = world.time;
    if (world.phase === 'deploy') {
      if (!this.deployed) {
        const base = landing(world, this.match, p.team);
        const members = world.players.filter((ally) => ally.team === p.team);
        const index = members.indexOf(p);
        const angle = (index / Math.max(members.length, 1)) * Math.PI * 2;
        const spot = findFreeSpot(world.map, base.x + Math.cos(angle) * 2.4, base.z + Math.sin(angle) * 2.4);
        world.deploy(p, spot.x, spot.z);
        this.deployed = true;
      }
      world.submit(p, { t: 'in', seq: ++this.seq, mx: 0, mz: 0, aim: p.aim, fire: false, dash: false });
      return;
    }
    if (world.phase !== 'playing') return;
    if (!this.landingEmote) {
      this.landingEmote = true;
      if (hash(p.id + ':gm') % 4 === 0) this.emote('gm', now);
    }
    if (p.kills > this.lastKills) {
      this.lastKills = p.kills;
      this.emote(hash(p.id + ':' + p.kills) % 2 ? 'gg' : 'LFG', now);
    }
    if (now - this.lastEmote > 36 && hash(p.id + ':' + Math.floor(now / 24)) % 650 === 0) {
      this.emote('wen moon?', now);
    }

    const x = p.move.x;
    const z = p.move.z;
    const recentlyHit = p.lastHurtBy !== null && now - p.lastHurtAt < 2;
    // Opening (landing grace + loot window): only fight back against whoever is shooting this bot.
    const opening = world.graceT > 0 || now < OPENING_LOOT[world.skill];
    let visible: Player | null;
    if (!opening) visible = this.visibleEnemy(now, now < 40 && !recentlyHit ? 15 : undefined);
    else if (recentlyHit && world.graceT <= 0) visible = this.visibleEnemy(now, undefined, p.lastHurtBy);
    else visible = this.visibleEnemy(now, 0);
    const distance = visible ? Math.hypot(visible.move.x - x, visible.move.z - z) : Infinity;
    if (p.lastHurtAt > this.lastHit) {
      this.lastHit = p.lastHurtAt;
      if (visible && p.lastHurtBy === visible.id) this.rememberThreat(visible.move.x, visible.move.z, now);
      // If the shooter is concealed, use only a position observed earlier; never inspect their coordinates.
      if (!visible && p.lastHurtBy !== null && p.lastHurtBy === this.targetId && this.observedAt > now - 5) {
        this.rememberThreat(this.observedX, this.observedZ, now);
      }
    }
    const outNow = Math.hypot(x - world.zone.cx, z - world.zone.cz) > world.zone.r - 1.5;
    const nextDistance = Math.hypot(x - world.zone.ncx, z - world.zone.ncz);
    const nextRadius = Math.max(2, world.zone.nr - 5);
    const zoneSoon = world.zone.nr < world.zone.r - 1 && nextDistance > nextRadius &&
      (world.zone.shrinking || world.zone.t < (nextDistance - nextRadius) / PLAYER_SPEED + 9);
    const zoneUrgent = outNow || zoneSoon;

    let goalX = x;
    let goalZ = z;
    let moving = false;
    const combat = !!visible;
    const low = p.hp < RETREAT_HP[world.skill];
    const escape = low && (combat || recentlyHit);
    if (zoneUrgent && (outNow || !combat)) {
      const centerDistance = Math.max(0.001, nextDistance);
      const radius = Math.max(0, nextRadius - (outNow ? 1 : 0));
      const toward = Math.min(centerDistance, Math.max(0, centerDistance - radius));
      goalX = x + (world.zone.ncx - x) * toward / centerDistance;
      goalZ = z + (world.zone.ncz - z) * toward / centerDistance;
      moving = true;
    } else if (escape && (visible || this.threatAt > now - 5)) {
      const tx = visible ? visible.move.x : this.threatX;
      const tz = visible ? visible.move.z : this.threatZ;
      const away = Math.atan2(z - tz, x - tx);
      goalX = x + Math.cos(away) * 10;
      goalZ = z + Math.sin(away) * 10;
      moving = true;
    } else if (combat && visible) {
      const weapon = p.slots[p.active]?.w ?? 'pistol';
      const desired = weapon === 'shotgun' ? 6 : weapon === 'smg' ? 12 : weapon === 'sniper' ? 30 :
        weapon === 'rocket' ? 20 : weapon === 'minigun' ? 17 : 20;
      const dx = (visible.move.x - x) / Math.max(distance, 0.01);
      const dz = (visible.move.z - z) / Math.max(distance, 0.01);
      const strafe = Math.sin(now * (this.world.skill === 0 ? 1.3 : 2) + this.phaseOffset) > 0 ? 1 : -1;
      const radial = distance > desired + 3 ? 0.8 : distance < desired - 3 ? -0.85 : 0;
      goalX = x + (dx * radial - dz * strafe * 0.75) * 5;
      goalZ = z + (dz * radial + dx * strafe * 0.75) * 5;
      moving = true;
    } else if (!p.channel) {
      const intel = p.hp >= 45 && (now >= 40 || recentlyHit) ? this.revealedGoal(x, z, now) : null;
      const pickup = !intel && this.lootGoal(now);
      if (intel) {
        goalX = intel.x;
        goalZ = intel.z;
        moving = true;
      } else if (pickup) {
        goalX = this.cachedLootX;
        goalZ = this.cachedLootZ;
        moving = true;
      } else {
        // Stay within support range of living teammates when there is no useful nearby loot.
        let closest: Player | null = null;
        let closestDistance = Infinity;
        for (const ally of world.players) {
          if (ally === p || !ally.alive || ally.team !== p.team) continue;
          const d = Math.hypot(ally.move.x - x, ally.move.z - z);
          if (d < closestDistance) { closest = ally; closestDistance = d; }
        }
        if (closest && closestDistance > 17) {
          goalX = closest.move.x;
          goalZ = closest.move.z;
          moving = true;
        } else if (nextDistance > Math.max(8, nextRadius * 0.78)) {
          goalX = world.zone.ncx;
          goalZ = world.zone.ncz;
          moving = true;
        }
      }
    }

    let mx = 0;
    let mz = 0;
    if (moving) {
      this.navigate(goalX, goalZ, now);
      mx = this.moveX;
      mz = this.moveZ;
    }
    let aim = moving ? Math.atan2(mz, mx) : p.aim;
    let fire = false;
    const active = p.slots[p.active];
    const otherIndex: 0 | 1 = p.active === 0 ? 1 : 0;
    const other = p.slots[otherIndex];
    // A slot action is applied after this tick's input; never fire a depleted current slot meanwhile.
    const needsSwitch = !p.channel && !!other && (!active ||
      (combat && weaponValue(other, p) > weaponValue(active, p) + 7) ||
      (active.mag === 0 && !p.ammo[WEAPONS[active.w].ammo] && other.mag > 0));
    if (needsSwitch) this.act({ t: 'act', a: 'slot', v: otherIndex });
    if (visible && active) {
      const def = WEAPONS[active.w];
      const travel = Math.min(0.45, distance / def.projectileSpeed) * LEAD[world.skill];
      const predictedX = visible.move.x + this.velocityX * travel;
      const predictedZ = visible.move.z + this.velocityZ * travel;
      if (visible.move.dashT > 0) this.holdFireUntil = now + DASH_FLINCH[world.skill];
      const burstPhase = ((now + this.phaseOffset / 30) % BURST_WINDOW) / BURST_WINDOW;
      const trigger = burstPhase < FIRE_DUTY[world.skill] && now >= this.holdFireUntil;
      const error = AIM_ERROR[world.skill];
      const drift = error * (Math.sin(now * 1.9 + this.phaseOffset) * 0.65 +
        Math.sin(now * 0.72 + this.phaseOffset * 2.3) * 0.35);
      const whiffWindow = hash(`${p.id}:whiff:${Math.floor(now * 2)}`);
      const whiff = whiffWindow % 100 < WHIFF_CHANCE[world.skill] ? (whiffWindow & 256 ? 1 : -1) * WHIFF_OFFSET : 0;
      aim = Math.atan2(predictedZ - z, predictedX - x) + drift + whiff;
      const response = REACTION_DELAY[world.skill] + SETTLE_DELAY[world.skill];
      const safeRocket = active.w !== 'rocket' || distance >= 7;
      fire = trigger && now - this.seenSince >= response && !needsSwitch &&
        (!p.channel || p.hp < 75 || recentlyHit) &&
        p.reloadT <= 0 && active.mag > 0 && distance <= def.range - 1 && safeRocket &&
        hasLineOfSight(world.map, x, z, visible.move.x, visible.move.z) &&
        hasLineOfSight(world.map, x, z, predictedX, predictedZ) &&
        !this.blockedByEnemyDome(x, z, predictedX, predictedZ);
    } else if (recentlyHit && this.threatAt > now - 4) {
      aim = Math.atan2(this.threatZ - z, this.threatX - x);
    }
    let dash = false;
    if (recentlyHit && this.nextDodgeAt <= now && p.move.dashCd <= 0 &&
      (hash(p.id + ':' + Math.floor(now * 4)) % 100) < DODGE_CHANCE[world.skill]) {
      if (visible || this.threatAt > now - 4) {
        const dx = (visible ? visible.move.x : this.threatX) - x;
        const dz = (visible ? visible.move.z : this.threatZ) - z;
        const side = (hash(p.id + ':' + Math.floor(now)) & 1) ? 1 : -1;
        const len = Math.max(0.01, Math.hypot(dx, dz));
        const sidewaysX = -dz * side / len;
        const sidewaysZ = dx * side / len;
        if (this.match.nav.clear(x, z, x + sidewaysX * 3.4, z + sidewaysZ * 3.4)) {
          mx = sidewaysX;
          mz = sidewaysZ;
          dash = true;
        }
      }
      this.nextDodgeAt = now + 2.2;
    }
    if (active?.w === 'sniper' && fire && !zoneUrgent && !dash) { mx = 0; mz = 0; }
    if (this.unstuckUntil > now && p.move.dashCd <= 0 && !p.channel) dash = true;
    // Interact happens after movement. Hold position when the intended target is already
    // nearest, so crossing a dropped gun by a few centimeters cannot change the server's pick.
    if (!combat && !zoneUrgent && !p.channel && p.move.dashT <= 0) {
      const pickup = this.chestId >= 0 ? world.chests.get(this.chestId) : world.loot.get(this.lootId);
      const kind = this.chestId >= 0 ? 'chest' : 'weapon';
      const id = this.chestId >= 0 ? this.chestId : this.lootId;
      if (pickup && Math.hypot(pickup.x - x, pickup.z - z) < PICKUP_RADIUS - 0.35 &&
        this.canInteract(kind, id)) { mx = 0; mz = 0; dash = false; }
    }
    // Semi-automatic weapons fire once per press: release between shots and press when the cooldown is ready.
    if (fire && active && !WEAPONS[active.w].auto && (this.lastFire || p.fireCd > TICK_DT)) fire = false;
    this.lastFire = fire;
    world.submit(p, { t: 'in', seq: ++this.seq, mx, mz, aim, fire, dash });

    if (p.channel && combat && (p.hp < 75 || recentlyHit)) this.act({ t: 'act', a: 'cancel' });
    if (p.abilityCd <= 0 && !p.channel) this.useAbility(visible, distance, recentlyHit, now);
    let healing = false;
    if (!combat && !recentlyHit && !p.channel) {
      if (p.hp < 50 && p.cons.medkit > 0) {
        this.act({ t: 'act', a: 'medkit' });
        healing = true;
      } else if (p.hp <= 75 && p.cons.stable > 0) {
        this.act({ t: 'act', a: 'stable' });
        healing = true;
      }
    }
    // Reload and weapon pickup cancel a channel; never queue either behind a heal.
    if (!healing && !p.channel && !needsSwitch && p.reloadT <= 0 && active &&
      p.ammo[WEAPONS[active.w].ammo] > 0 &&
      (active.mag === 0 || (!combat && active.mag < WEAPONS[active.w].mag * 0.65))) {
      this.act({ t: 'act', a: 'reload' });
    }
    if (!healing && !combat && !zoneUrgent && !p.channel && !needsSwitch) this.interact();
  }

  /** Nearest visible enemy within `range` (0 = none); `onlyId` restricts the choice to one player. */
  private visibleEnemy(now: number, range?: number, onlyId?: string | null): Player | null {
    const p = this.player;
    const reach = range ?? SIGHT_RANGE[this.world.skill];
    if (reach <= 0) {
      this.releaseTarget();
      return null;
    }
    let nearest: Player | null = null;
    let best = reach * reach;
    for (const candidate of this.world.players) {
      if (candidate === p || !candidate.alive || candidate.team === p.team) continue;
      if (onlyId !== undefined && candidate.id !== onlyId) continue;
      // Do not inspect position, altitude, velocity, or distance before the visibility check.
      if (!this.world.canSee(p, candidate) || candidate.y > 1.5) continue;
      const dx = candidate.move.x - p.move.x;
      const dz = candidate.move.z - p.move.z;
      const d = dx * dx + dz * dz;
      if (d > reach * reach) continue;
      let supporting = false;
      for (const ally of this.world.players) {
        if (ally.alive && ally.team === p.team && ally.lastHurtBy === candidate.id &&
          now - ally.lastHurtAt < 3) { supporting = true; break; }
      }
      let priority = d * (supporting ? 0.6 : 1);
      const swarmed = !candidate.bot && candidate.id !== this.targetId &&
        this.packSize(candidate.id) >= PACK_LIMIT[this.world.skill];
      if (swarmed) {
        priority *= 9; // others already swarm this human: prefer someone else unless they're much closer
      }
      if (priority < best) { best = priority; nearest = candidate; }
    }
    if (!nearest) {
      if (now - this.observedAt > 0.3) this.releaseTarget();
      return null;
    }
    if (nearest.id !== this.targetId || now - this.observedAt > 0.35) {
      this.targetId = nearest.id;
      this.match.targets.set(p.id, nearest.id);
      this.seenSince = now;
      this.velocityX = 0;
      this.velocityZ = 0;
      this.observedAt = now;
    } else if (now - this.observedAt > TICK_DT * 0.5) {
      const dt = now - this.observedAt;
      this.velocityX = this.velocityX * 0.7 + Math.max(-9, Math.min(9, (nearest.move.x - this.observedX) / dt)) * 0.3;
      this.velocityZ = this.velocityZ * 0.7 + Math.max(-9, Math.min(9, (nearest.move.z - this.observedZ) / dt)) * 0.3;
      this.observedAt = now;
    }
    this.observedX = nearest.move.x;
    this.observedZ = nearest.move.z;
    this.rememberThreat(this.observedX, this.observedZ, now);
    return nearest;
  }

  private revealedGoal(x: number, z: number, now: number): Plan | null {
    let best = 15;
    let goal: Plan | null = null;
    for (const enemy of this.world.players) {
      if (!enemy.alive || enemy.team === this.player.team ||
        (enemy.revealedTo.get(this.player.team) ?? 0) <= this.world.time) continue;
      if (enemy.y > 1.5) continue;
      const d = Math.hypot(enemy.move.x - x, enemy.move.z - z);
      if (d < best && d > 5) {
        best = d;
        goal = { x: enemy.move.x, z: enemy.move.z };
      }
    }
    // The last observed position is historical intel, not the concealed player's live state.
    if (!goal && this.observedAt > now - 2.5 && this.threatAt > now - 2.5 &&
      Math.hypot(this.observedX - x, this.observedZ - z) > 7 &&
      Math.hypot(this.observedX - x, this.observedZ - z) < 15) {
      goal = { x: this.observedX, z: this.observedZ };
    }
    return goal;
  }

  private releaseTarget(): void {
    this.targetId = null;
    this.match.targets.delete(this.player.id);
  }

  /** Living bots (other than this one) currently engaging `targetId`. */
  private packSize(targetId: string): number {
    let n = 0;
    for (const [botId, target] of this.match.targets) {
      if (target !== targetId || botId === this.player.id) continue;
      if (this.world.playerById(botId)?.alive) n++;
    }
    return n;
  }

  private rememberThreat(x: number, z: number, at: number): void {
    this.threatX = x;
    this.threatZ = z;
    this.threatAt = at;
  }

  private navigate(gx: number, gz: number, now: number): void {
    const x = this.player.move.x;
    const z = this.player.move.z;
    const goalShifted = (gx - this.goalX) ** 2 + (gz - this.goalZ) ** 2 > 25;
    if (goalShifted || now >= this.nextPathAt && (this.waypoint >= this.route.length ||
      (this.route.length && Math.hypot(x - this.goalX, z - this.goalZ) > 2))) {
      this.goalX = gx;
      this.goalZ = gz;
      this.route = this.match.nav.path(x, z, gx, gz);
      this.waypoint = 0;
      this.nextPathAt = now + 1 + this.phaseOffset / 90;
    }
    while (this.waypoint < this.route.length &&
      Math.hypot(this.route[this.waypoint]!.x - x, this.route[this.waypoint]!.z - z) < 1) this.waypoint++;
    if (now - this.lastProgressAt > 0.95) {
      if (Math.hypot(x - this.progressX, z - this.progressZ) < 1 && Math.hypot(gx - x, gz - z) > 2.5) {
        const angle = Math.atan2(gz - z, gx - x) + (this.phaseOffset % 2 ? 1 : -1) * Math.PI / 2;
        this.nudgeX = Math.cos(angle);
        this.nudgeZ = Math.sin(angle);
        this.unstuckUntil = now + 0.35;
        this.nextPathAt = now + 0.4;
        this.route = [];
      }
      this.progressX = x;
      this.progressZ = z;
      this.lastProgressAt = now;
    }
    if (this.unstuckUntil > now) {
      this.moveX = this.nudgeX;
      this.moveZ = this.nudgeZ;
      return;
    }
    const waypoint = this.route[this.waypoint];
    const dx = (waypoint?.x ?? gx) - x;
    const dz = (waypoint?.z ?? gz) - z;
    const length = Math.hypot(dx, dz);
    if (length < 0.1 || (!waypoint && !this.match.nav.clear(x, z, gx, gz))) {
      this.moveX = 0;
      this.moveZ = 0;
      return;
    }
    this.moveX = dx / length;
    this.moveZ = dz / length;
  }

  private lootGoal(now: number): boolean {
    if (now < this.nextLootScan) return this.lootId >= 0 || this.chestId >= 0;
    this.nextLootScan = now + 0.4 + this.phaseOffset / 90;
    const p = this.player;
    const x = p.move.x;
    const z = p.move.z;
    let best = -Infinity;
    this.lootId = -1;
    this.chestId = -1;
    for (const chest of this.world.chests.values()) {
      if (chest.open) continue;
      const distance = Math.hypot(chest.x - x, chest.z - z);
      if (distance > (chest.airdrop ? 65 : 34)) continue;
      const score = (chest.airdrop ? 125 : 48) - distance * (chest.airdrop ? 1.35 : 1.55);
      if (score > best) {
        best = score;
        this.chestId = chest.id;
        this.lootId = -1;
        this.cachedLootX = chest.x;
        this.cachedLootZ = chest.z;
      }
    }
    for (const item of this.world.loot.values()) {
      const distance = Math.hypot(item.x - x, item.z - z);
      if (distance > 32) continue;
      const value = this.lootValue(item);
      const score = value - distance * 1.6;
      if (value <= 0 || score <= best || score <= 0) continue;
      best = score;
      this.lootId = item.id;
      this.chestId = -1;
      this.cachedLootX = item.x;
      this.cachedLootZ = item.z;
    }
    return this.lootId >= 0 || this.chestId >= 0;
  }

  private lootValue(item: LootItem): number {
    const p = this.player;
    if (item.k === 'weapon') {
      if ((this.ignoredWeapons.get(item.w) ?? -1) > this.world.time) return 0;
      const worst = Math.min(weaponValue(p.slots[0], p), weaponValue(p.slots[1], p));
      const value = weaponValueFor(item.w, item.mag, p);
      return value > worst + 5 ? 24 + (value - worst) * 0.7 : 0;
    }
    if (item.k === 'ammo') {
      const carriesRockets = p.slots[0]?.w === 'rocket' || p.slots[1]?.w === 'rocket';
      return p.ammo[item.a] < AMMO_MAX[item.a] && (item.a !== 'rocket' || carriesRockets) ? 21 : 0;
    }
    if (item.c === 'stable') return p.cons.stable < CONSUMABLES.stable.maxCarry ? (p.hp < 75 ? 44 : 20) : 0;
    if (item.c === 'medkit') return p.cons.medkit < CONSUMABLES.medkit.maxCarry ? (p.hp < 60 ? 65 : 31) : 0;
    return p.ar < (item.c === 'armorL' ? 85 : 95) ? 34 + (100 - p.ar) * 0.3 : 0;
  }

  private interact(): void {
    const p = this.player;
    if (p.move.dashT > 0 || this.acts >= 2) return;
    const x = p.move.x;
    const z = p.move.z;
    if (this.chestId >= 0) {
      const chest = this.world.chests.get(this.chestId);
      if (chest && !chest.open && Math.hypot(x - chest.x, z - chest.z) < PICKUP_RADIUS - 0.35 &&
        this.canInteract('chest', chest.id) && this.act({ t: 'act', a: 'interact' })) {
        this.nextLootScan = 0;
      }
      return;
    }
    const item = this.world.loot.get(this.lootId);
    if (!item || item.k !== 'weapon' || Math.hypot(x - item.x, z - item.z) > PICKUP_RADIUS - 0.35 ||
      !this.canInteract('weapon', item.id) || (this.ignoredWeapons.get(item.w) ?? -1) > this.world.time) return;
    const worst: 0 | 1 = weaponValue(p.slots[0], p) <= weaponValue(p.slots[1], p) ? 0 : 1;
    const outgoing = p.slots[0] && p.slots[1] ? p.slots[worst]!.w : null;
    if (p.active !== worst && (this.acts > 0 || !this.act({ t: 'act', a: 'slot', v: worst }))) return;
    if (this.act({ t: 'act', a: 'interact' })) {
      if (outgoing) this.ignoredWeapons.set(outgoing, this.world.time + 10);
      this.nextLootScan = 0;
    }
  }

  /** Mirror findInteractTarget: weapons first, then chests; later items win exact ties. */
  private canInteract(kind: 'weapon' | 'chest', id: number): boolean {
    const x = this.player.move.x;
    const z = this.player.move.z;
    let bestDistance = PICKUP_RADIUS * PICKUP_RADIUS;
    let chosen = -1;
    let chosenKind: 'weapon' | 'chest' = 'weapon';
    for (const item of this.world.loot.values()) {
      if (item.k !== 'weapon') continue;
      const distance = (item.x - x) ** 2 + (item.z - z) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        chosen = item.id;
        chosenKind = 'weapon';
      }
    }
    for (const chest of this.world.chests.values()) {
      if (chest.open) continue;
      const distance = (chest.x - x) ** 2 + (chest.z - z) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        chosen = chest.id;
        chosenKind = 'chest';
      }
    }
    return chosen === id && chosenKind === kind;
  }

  private useAbility(enemy: Player | null, distance: number, underFire: boolean, now: number): void {
    if (now - this.lastAbilityAt < 0.5) return;
    // Paper Hands never opens on a human with turrets / grenades / buffs — only reacts once shot at.
    if (this.world.skill === 0 && enemy && !enemy.bot && !underFire) return;
    const p = this.player;
    const kind = CHARACTER_BY_ID[p.character].ability.kind;
    let targetX = p.move.x;
    let targetZ = p.move.z;
    let use = false;
    switch (kind) {
      case 'blink':
      case 'leap': {
        if ((p.hp < 44 && (enemy || underFire)) || (enemy && distance > 8 && distance < 22 && p.hp > 60)) {
          const range = kind === 'blink' ? 10 : 15;
          const direction = enemy && p.hp > 60 ? 1 : -1;
          const tx = enemy ? enemy.move.x : this.threatX;
          const tz = enemy ? enemy.move.z : this.threatZ;
          const length = Math.max(0.01, Math.hypot(tx - p.move.x, tz - p.move.z));
          targetX += (tx - p.move.x) / length * Math.min(range, Math.max(5, distance - 3)) * direction;
          targetZ += (tz - p.move.z) / length * Math.min(range, Math.max(5, distance - 3)) * direction;
          const safe = findFreeSpot(this.world.map, targetX, targetZ);
          targetX = safe.x;
          targetZ = safe.z;
          use = true;
        }
        break;
      }
      case 'healPool': {
        let patient: Player = p;
        for (const ally of this.world.players) {
          if (ally.alive && ally.team === p.team && ally.hp < patient.hp &&
            Math.hypot(ally.move.x - p.move.x, ally.move.z - p.move.z) < 8) patient = ally;
        }
        if (patient.hp < 70) {
          targetX = patient.move.x;
          targetZ = patient.move.z;
          use = true;
        }
        break;
      }
      case 'reveal': {
        let allyInFight = false;
        if (!enemy) for (const ally of this.world.players) {
          if (ally === p || !ally.alive || ally.team !== p.team || now - ally.lastHurtAt > 3) continue;
          if (Math.hypot(ally.move.x - p.move.x, ally.move.z - p.move.z) < 24) {
            allyInFight = true;
            break;
          }
        }
        use = !!enemy || underFire || allyInFight || this.threatAt > now - 6 || this.world.zone.r < 30;
        break;
      }
      case 'dmgBuff':
      case 'rush':
        use = !!enemy && distance < 28;
        break;
      case 'grenade':
        if (enemy && distance >= 6 && distance <= 18) {
          targetX = enemy.move.x + this.velocityX * 0.7;
          targetZ = enemy.move.z + this.velocityZ * 0.7;
          use = true;
        }
        break;
      case 'turret':
        use = !!enemy && distance <= 22;
        break;
      case 'dome':
        use = p.hp < 60 && (!!enemy || underFire);
        break;
      case 'armorUp':
        use = p.ar < 45 && (!!enemy || underFire);
        break;
    }
    if (use) {
      this.act({ t: 'act', a: 'ability', x: targetX, z: targetZ });
      this.lastAbilityAt = now;
    }
  }

  /** Exactly one input and no more than two actions can be processed in a single tick. */
  private act(cmd: ActCmd): boolean {
    if (this.acts >= 2) return false;
    this.acts++;
    this.world.submit(this.player, cmd);
    return true;
  }

  private blockedByEnemyDome(x: number, z: number, tx: number, tz: number): boolean {
    const dx = tx - x;
    const dz = tz - z;
    const lengthSq = dx * dx + dz * dz;
    for (const ent of this.world.ents) {
      if (ent.k !== 'dome' || ent.team === this.player.team || ent.ttl <= 0) continue;
      const fraction = lengthSq > 0 ? Math.max(0, Math.min(1,
        ((ent.x - x) * dx + (ent.z - z) * dz) / lengthSq)) : 0;
      const nearestX = x + dx * fraction - ent.x;
      const nearestZ = z + dz * fraction - ent.z;
      if (nearestX * nearestX + nearestZ * nearestZ <= ent.radius * ent.radius) return true;
    }
    return false;
  }

  private emote(text: typeof EMOTES[number], now: number): void {
    if (now - this.lastEmote < 20) return;
    this.world.emote(this.player, EMOTES.indexOf(text));
    this.lastEmote = now;
  }
}
