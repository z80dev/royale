// Character abilities (Q) and the world entities they spawn (pools, turrets, domes, grenades) + airdrops.

import {
  AIRDROP_FALL_TIME,
  CHARACTER_BY_ID,
  DEPLOY_ALTITUDE,
  MAX_ARMOR,
  MAX_HP,
  PLAYER_RADIUS,
  WEAPONS,
  type AbilityDef,
} from '../shared/constants';
import { bushAt, findFreeSpot, hasLineOfSight, raycast } from '../shared/physics';
import { applyDamage, explode, isHittable, launchProjectile } from './combat';
import { r2 } from './config';
import { landAirdrop } from './loot';
import type { Match } from './match';
import type { Ent, Player } from './types';

interface Point {
  x: number;
  z: number;
}

const POOL_MAX_RANGE = 8;
const GRENADE_FLIGHT = 0.9;
const GRENADE_APEX = 4.5;
const LEAP_APEX = 5;
const TURRET_FIRE_INTERVAL = 0.32;
const TURRET_SPREAD = 0.05;
/** Bush concealment: players inside a bush are invisible beyond this range unless firing / revealed. */
export const BUSH_REVEAL_RANGE = 5;

function makeEnt(match: Match, k: Ent['k'], owner: Player | null, x: number, z: number, ttl: number): Ent {
  const ent: Ent = {
    id: match.nextId(),
    k,
    x,
    z,
    y: 0,
    owner: owner ? owner.id : null,
    team: owner ? owner.team : 0,
    ttl,
    total: ttl,
    aim: owner ? owner.aim : 0,
    radius: 0,
    power: 0,
    range: 0,
    fireCd: 0,
    healed: new Map(),
    fromX: x,
    fromZ: z,
  };
  match.ents.push(ent);
  return ent;
}

/** Clamp the aim point to `maxRange` from the player (default: aim direction × range if the point is junk). */
function aimPoint(p: Player, x: number | undefined, z: number | undefined, maxRange: number): Point {
  let tx = x ?? Number.NaN;
  let tz = z ?? Number.NaN;
  if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
    tx = p.move.x + Math.cos(p.aim) * maxRange;
    tz = p.move.z + Math.sin(p.aim) * maxRange;
  }
  const dx = tx - p.move.x;
  const dz = tz - p.move.z;
  const d = Math.hypot(dx, dz);
  if (d > maxRange) {
    tx = p.move.x + (dx / d) * maxRange;
    tz = p.move.z + (dz / d) * maxRange;
  }
  return { x: tx, z: tz };
}

/** Walk from the player toward (tx,tz), stopping short of the first wall. */
function wallClamped(match: Match, p: Player, tx: number, tz: number, margin: number): { x: number; z: number } {
  const dx = tx - p.move.x;
  const dz = tz - p.move.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return { x: p.move.x, z: p.move.z };
  const ux = dx / d;
  const uz = dz / d;
  const hit = raycast(match.map, p.move.x, p.move.z, ux, uz, d);
  const reach = hit.ob ? Math.max(0, hit.t - margin) : d;
  return { x: p.move.x + ux * reach, z: p.move.z + uz * reach };
}

function slowEnemiesNear(match: Match, caster: Player, x: number, z: number, def: AbilityDef): void {
  const radius = def.radius ?? 4;
  for (const other of match.players) {
    if (!other.alive || other.team === caster.team) continue;
    if (Math.hypot(other.move.x - x, other.move.z - z) > radius + PLAYER_RADIUS) continue;
    other.slowT = def.duration ?? 2;
    other.slowMul = def.power ?? 0.5;
  }
}

/** Q: returns true when the ability fired (cooldown started). */
export function useAbility(match: Match, p: Player, ax: number | undefined, az: number | undefined): boolean {
  if (!p.alive || match.phase !== 'playing' || !match.combatLive || p.abilityCd > 0 || p.leap || p.y > 0) {
    return false;
  }
  const def = CHARACTER_BY_ID[p.character].ability;
  const from = { x: p.move.x, z: p.move.z };
  let to = { x: p.move.x, z: p.move.z };
  switch (def.kind) {
    case 'blink': {
      const target = aimPoint(p, ax, az, def.range ?? 11);
      const clamped = wallClamped(match, p, target.x, target.z, PLAYER_RADIUS + 0.05);
      to = findFreeSpot(match.map, clamped.x, clamped.z);
      p.move.x = to.x;
      p.move.z = to.z;
      p.move.dashT = 0;
      slowEnemiesNear(match, p, from.x, from.z, def);
      slowEnemiesNear(match, p, to.x, to.z, def);
      break;
    }
    case 'healPool': {
      const target = aimPoint(p, ax, az, POOL_MAX_RANGE);
      to = wallClamped(match, p, target.x, target.z, 0.3);
      const pool = makeEnt(match, 'pool', p, to.x, to.z, def.duration ?? 5);
      pool.radius = def.radius ?? 4;
      pool.power = def.power ?? 14;
      break;
    }
    case 'reveal': {
      const range = def.range ?? 45;
      const until = match.time + (def.duration ?? 6);
      for (const other of match.players) {
        if (!other.alive || other.team === p.team) continue;
        if (Math.hypot(other.move.x - p.move.x, other.move.z - p.move.z) > range) continue;
        other.revealedTo.set(p.team, until);
      }
      break;
    }
    case 'dmgBuff':
      p.dmgBuffT = def.duration ?? 6;
      p.dmgBuffMul = def.power ?? 1.45;
      break;
    case 'leap': {
      const target = aimPoint(p, ax, az, def.range ?? 16);
      to = findFreeSpot(match.map, target.x, target.z);
      p.leap = { fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z, t: 0, total: def.duration ?? 0.7 };
      p.move.dashT = 0;
      p.channel = null;
      break;
    }
    case 'rush': {
      const radius = def.radius ?? 10;
      for (const ally of match.players) {
        if (!ally.alive || ally.team !== p.team) continue;
        if (ally !== p && Math.hypot(ally.move.x - p.move.x, ally.move.z - p.move.z) > radius) continue;
        ally.rushT = def.duration ?? 5;
        ally.rushMul = def.power ?? 1.45;
      }
      break;
    }
    case 'grenade': {
      const target = aimPoint(p, ax, az, def.range ?? 18);
      to = findFreeSpot(match.map, target.x, target.z, 0.3);
      const nade = makeEnt(match, 'grenade', p, from.x, from.z, GRENADE_FLIGHT);
      nade.fromX = from.x;
      nade.fromZ = from.z;
      nade.aim = Math.atan2(to.z - from.z, to.x - from.x);
      nade.range = Math.hypot(to.x - from.x, to.z - from.z);
      nade.radius = def.radius ?? 4.5;
      nade.power = def.power ?? 65;
      nade.y = 1;
      break;
    }
    case 'turret': {
      const ahead = wallClamped(match, p, p.move.x + Math.cos(p.aim) * 1.6, p.move.z + Math.sin(p.aim) * 1.6, 0.6);
      to = findFreeSpot(match.map, ahead.x, ahead.z, 0.5);
      const turret = makeEnt(match, 'turret', p, to.x, to.z, def.duration ?? 9);
      turret.range = def.range ?? 22;
      turret.power = def.power ?? 9;
      turret.fireCd = 0.5;
      break;
    }
    case 'dome': {
      const dome = makeEnt(match, 'dome', p, from.x, from.z, def.duration ?? 5);
      dome.radius = def.radius ?? 4;
      break;
    }
    case 'armorUp': {
      const before = p.ar;
      p.ar = Math.min(MAX_ARMOR, p.ar + (def.power ?? 60));
      p.invulnT = def.duration ?? 1.2;
      match.emit({ e: 'heal', by: p.id, hp: 0, armor: Math.round(p.ar - before) });
      break;
    }
  }
  p.abilityCd = def.cooldown;
  p.channel = null;
  match.emit({ e: 'ability', by: p.id, kind: def.kind, x: r2(from.x), z: r2(from.z), tx: r2(to.x), tz: r2(to.z) });
  return true;
}

/** Advance a Jump leap: position lerp + y arc, shockwave on landing. */
export function tickLeap(match: Match, p: Player, dt: number): void {
  const leap = p.leap;
  if (!leap) return;
  leap.t = Math.min(leap.total, leap.t + dt);
  const f = leap.t / leap.total;
  p.move.x = leap.fromX + (leap.toX - leap.fromX) * f;
  p.move.z = leap.fromZ + (leap.toZ - leap.fromZ) * f;
  p.y = 4 * LEAP_APEX * f * (1 - f);
  if (f < 1) return;
  p.leap = null;
  p.y = 0;
  p.move.x = leap.toX;
  p.move.z = leap.toZ;
  match.emit({ e: 'land', by: p.id });
  const def = CHARACTER_BY_ID[p.character].ability;
  const radius = def.radius ?? 4;
  match.emit({ e: 'boom', x: r2(p.move.x), z: r2(p.move.z), r: radius, by: p.id });
  for (const target of match.players) {
    if (target.team === p.team || !isHittable(target)) continue;
    if (Math.hypot(target.move.x - p.move.x, target.move.z - p.move.z) > radius) continue;
    applyDamage(match, target, def.power ?? 30, p, 'ability', null, 0, target.move.x, target.move.z);
  }
}

// ───────────────────────────── Entities ─────────────────────────────

/** Can an observer at (x,z) on `team` see `target`? LOS + bush concealment (unless firing / revealed). */
export function visibleFrom(match: Match, x: number, z: number, team: number, target: Player): boolean {
  if (!hasLineOfSight(match.map, x, z, target.move.x, target.move.z)) return false;
  const d = Math.hypot(target.move.x - x, target.move.z - z);
  if (d <= BUSH_REVEAL_RANGE || target.sinceShot < 0.4) return true;
  if ((target.revealedTo.get(team) ?? 0) > match.time) return true;
  return !bushAt(match.map, target.move.x, target.move.z);
}

function tickTurret(match: Match, ent: Ent, dt: number): void {
  ent.fireCd -= dt;
  let best: Player | null = null;
  let bestD = ent.range;
  for (const p of match.players) {
    if (!isHittable(p) || p.team === ent.team) continue;
    const d = Math.hypot(p.move.x - ent.x, p.move.z - ent.z);
    if (d > bestD || !visibleFrom(match, ent.x, ent.z, ent.team, p)) continue;
    best = p;
    bestD = d;
  }
  if (!best) return;
  ent.aim = Math.atan2(best.move.z - ent.z, best.move.x - ent.x);
  if (ent.fireCd > 0) return;
  ent.fireCd = TURRET_FIRE_INTERVAL;
  const angle = ent.aim + (Math.random() * 2 - 1) * TURRET_SPREAD;
  const def = WEAPONS.smg;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  launchProjectile(match, ent.x, ent.z, dx, dz, def, ent.power, ent.owner, ent.team, ent.id, ent.range + 4);
}

function tickPool(match: Match, ent: Ent, dt: number): void {
  for (const p of match.players) {
    if (!p.alive || p.team !== ent.team || p.hp >= MAX_HP) continue;
    if (Math.hypot(p.move.x - ent.x, p.move.z - ent.z) > ent.radius + PLAYER_RADIUS * 0.5) continue;
    const before = p.hp;
    p.hp = Math.min(MAX_HP, p.hp + ent.power * dt);
    ent.healed.set(p.id, (ent.healed.get(p.id) ?? 0) + p.hp - before);
  }
  ent.fireCd -= dt;
  if (ent.fireCd > 0) return;
  ent.fireCd = 1;
  flushPoolHeals(match, ent);
}

/** Heal notices carry the HP restored since the previous notice (accumulated per player). */
function flushPoolHeals(match: Match, ent: Ent): void {
  for (const [id, restored] of ent.healed) {
    const hp = Math.round(restored);
    if (hp <= 0) continue;
    ent.healed.set(id, restored - hp);
    match.emit({ e: 'heal', by: id, hp, armor: 0 });
  }
}

function tickGrenade(match: Match, ent: Ent): boolean {
  const f = 1 - Math.max(0, ent.ttl) / ent.total;
  ent.x = ent.fromX + Math.cos(ent.aim) * ent.range * f;
  ent.z = ent.fromZ + Math.sin(ent.aim) * ent.range * f;
  ent.y = 1 + 4 * GRENADE_APEX * f * (1 - f) - f;
  if (ent.ttl > 0) return false;
  const owner = ent.owner ? (match.playerById(ent.owner) ?? null) : null;
  explode(match, ent.x, ent.z, ent.radius, ent.power, owner, ent.team, 'explosion', null);
  return true;
}

function tickAirdrop(match: Match, ent: Ent): boolean {
  ent.y = DEPLOY_ALTITUDE * Math.max(0, ent.ttl) / ent.total;
  if (ent.ttl > 0) return false;
  landAirdrop(match, ent.x, ent.z);
  match.emit({ e: 'boom', x: r2(ent.x), z: r2(ent.z), r: 2, by: null });
  return true;
}

export function tickEnts(match: Match, dt: number): void {
  let write = 0;
  const list = match.ents;
  for (let i = 0; i < list.length; i++) {
    const ent = list[i]!;
    ent.ttl -= dt;
    let done = false;
    switch (ent.k) {
      case 'turret':
        if (ent.ttl > 0) tickTurret(match, ent, dt);
        done = ent.ttl <= 0;
        break;
      case 'pool':
        if (ent.ttl > 0) tickPool(match, ent, dt);
        done = ent.ttl <= 0;
        if (done) flushPoolHeals(match, ent);
        break;
      case 'dome':
        done = ent.ttl <= 0;
        break;
      case 'grenade':
        done = tickGrenade(match, ent);
        break;
      case 'airdrop':
        done = tickAirdrop(match, ent);
        break;
    }
    if (!done) list[write++] = ent;
  }
  list.length = write;
}

/** Spawn a falling airdrop crate above (x,z). Fall time scales with the match time scale. */
export function spawnAirdrop(match: Match, x: number, z: number, timeScale: number): Ent {
  const spot = findFreeSpot(match.map, x, z, 1.2);
  const ent = makeEnt(match, 'airdrop', null, spot.x, spot.z, AIRDROP_FALL_TIME * timeScale);
  ent.y = DEPLOY_ALTITUDE;
  match.emit({ e: 'airdrop', id: ent.id, x: r2(spot.x), z: r2(spot.z) });
  return ent;
}
