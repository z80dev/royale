// Weapons, projectiles, damage and explosions.

import { PLAYER_RADIUS, SCORE, TICK_DT, WEAPONS, type WeaponDef, type WeaponId } from '../shared/constants';
import { raycast, rayCircle, hasLineOfSight } from '../shared/physics';
import type { KillCause } from '../shared/protocol';
import { r2 } from './config';
import type { Match } from './match';
import type { Ent, Player, Projectile } from './types';

/** Hit radius used for bullets vs players (slightly generous so shots feel fair). */
export const HIT_RADIUS = PLAYER_RADIUS + 0.15;
/** Players above this altitude (deploying, mid-leap) can't be hit. */
export const UNHITTABLE_ALTITUDE = 1.5;
export const FIRING_FLAG_TIME = 0.15;
const RUSH_FIRE_RATE = 1.35;
const MUZZLE_OFFSET = 0.8;

export function isHittable(p: Player): boolean {
  return p.alive && p.y <= UNHITTABLE_ALTITUDE;
}

// ───────────────────────────── Damage ─────────────────────────────

/**
 * Deal damage (armor absorbs first). Emits the `hit` event and hands off to
 * match.killPlayer on death. Returns the damage actually dealt.
 */
export function applyDamage(
  match: Match,
  victim: Player,
  amount: number,
  attacker: Player | null,
  cause: KillCause,
  weapon: WeaponId | null,
  projectileId: number,
  hitX: number,
  hitZ: number,
): number {
  if (match.phase !== 'playing' || match.graceT > 0 || !victim.alive || amount <= 0) return 0;
  if (victim.invulnT > 0) return 0;
  const dmg = Math.max(1, Math.round(amount));
  let absorbed = 0;
  if (victim.ar > 0) {
    absorbed = Math.min(victim.ar, dmg);
    victim.ar -= absorbed;
  }
  const toHp = Math.min(victim.hp, dmg - absorbed);
  victim.hp -= dmg - absorbed;
  const dealt = absorbed + toHp;
  victim.lastHurtAt = match.time;
  victim.lastHurtBy = attacker ? attacker.id : null;
  if (attacker && attacker.team !== victim.team) {
    attacker.damage += dealt;
    attacker.score += dealt * SCORE.damage;
  }
  const kill = victim.hp <= 0;
  match.emit({
    e: 'hit',
    id: projectileId,
    x: r2(hitX),
    z: r2(hitZ),
    target: victim.id,
    dmg,
    armor: absorbed > 0,
    by: attacker ? attacker.id : null,
    kind: cause,
    kill,
  });
  if (kill) match.killPlayer(victim, attacker, cause, weapon);
  return dealt;
}

/**
 * Area damage with linear falloff (100% at the center → 40% at the edge). Requires line of sight from the
 * blast center so walls protect. `team` members are spared (0 = hurts everyone, e.g. rug chests).
 */
export function explode(
  match: Match,
  x: number,
  z: number,
  radius: number,
  damage: number,
  attacker: Player | null,
  team: number,
  cause: KillCause,
  weapon: WeaponId | null,
  skipId: string | null = null,
): void {
  match.emit({ e: 'boom', x: r2(x), z: r2(z), r: radius, by: attacker ? attacker.id : null });
  for (const p of match.players) {
    if (!isHittable(p) || p.id === skipId) continue;
    if (team !== 0 && p.team === team) continue;
    const d = Math.hypot(p.move.x - x, p.move.z - z);
    if (d > radius + PLAYER_RADIUS) continue;
    if (!hasLineOfSight(match.map, x, z, p.move.x, p.move.z)) continue;
    const falloff = 1 - 0.6 * Math.min(1, d / radius);
    applyDamage(match, p, damage * falloff, attacker, cause, weapon, 0, p.move.x, p.move.z);
  }
}

// ───────────────────────────── Reload ─────────────────────────────

export function startReload(match: Match, p: Player): void {
  const slot = p.slots[p.active];
  if (!slot || p.reloadT > 0) return;
  const def = WEAPONS[slot.w];
  if (slot.mag >= def.mag || p.ammo[def.ammo] <= 0) return;
  p.reloadT = def.reloadTime;
  p.reloadTotal = def.reloadTime;
  p.channel = null;
  match.emit({ e: 'reload', by: p.id });
}

export function cancelReload(p: Player): void {
  p.reloadT = 0;
  p.reloadTotal = 0;
}

export function tickReload(p: Player, dt: number): void {
  if (p.reloadT <= 0) return;
  p.reloadT -= dt;
  if (p.reloadT > 0) return;
  cancelReload(p);
  const slot = p.slots[p.active];
  if (!slot) return;
  const def = WEAPONS[slot.w];
  const loaded = Math.min(def.mag - slot.mag, p.ammo[def.ammo]);
  slot.mag += loaded;
  p.ammo[def.ammo] -= loaded;
}

// ───────────────────────────── Firing ─────────────────────────────

/** A press that can't fire right away (cooldown, reload) stays valid this long, then is dropped. */
const PRESS_BUFFER = 0.12;

/**
 * Advance the trigger for one tick: spin-up, fire cadence, auto-reload. Automatic weapons fire while held (or on
 * a fresh press); semi-automatic weapons fire exactly once per press edge.
 */
export function tickTrigger(match: Match, p: Player, dt: number): void {
  p.sinceShot += dt;
  if (p.firePress) {
    p.pressAge += dt;
    if (p.pressAge > PRESS_BUFFER + dt) p.firePress = false;
  }
  const slot = p.slots[p.active];
  const def = slot ? WEAPONS[slot.w] : null;
  const wants = !!def && (def.auto ? p.fireHeld || p.firePress : p.firePress);
  const canFire = !!slot && !!def && wants && p.reloadT <= 0 && p.alive && match.combatLive;
  if (def?.spinUp) {
    p.spin = canFire && slot!.mag > 0 ? Math.min(1, p.spin + dt / def.spinUp) : Math.max(0, p.spin - dt / def.spinUp);
  }
  p.fireCd -= dt;
  if (!canFire) {
    if (p.fireCd < 0) p.fireCd = 0;
    return;
  }
  if (slot!.mag <= 0) {
    if (p.fireCd < 0) p.fireCd = 0;
    p.firePress = false;
    startReload(match, p);
    return;
  }
  const rate = (p.rushT > 0 ? RUSH_FIRE_RATE : 1) * (def!.spinUp ? 0.3 + 0.7 * p.spin : 1);
  const interval = def!.fireInterval / rate;
  const maxShots = def!.auto ? 3 : 1;
  let shots = 0;
  while (p.fireCd <= 0 && slot!.mag > 0 && shots < maxShots) {
    // The shot a press produces goes where the player aimed when pressing.
    fireWeapon(match, p, def!, shots === 0 && p.firePress ? p.pressAim : p.aim);
    slot!.mag--;
    p.fireCd += interval;
    shots++;
  }
  if (shots > 0) {
    p.firePress = false;
    p.channel = null;
    p.sinceShot = 0;
  }
  if (slot!.mag <= 0) startReload(match, p);
}

function fireWeapon(match: Match, p: Player, def: WeaponDef, aim: number): void {
  const moving = p.moveAmount > 0.1 || p.move.dashT > 0;
  const spread = def.spread * (moving ? def.moveSpreadMul : 1);
  const damage = def.damage * (p.dmgBuffT > 0 ? p.dmgBuffMul : 1);
  for (let i = 0; i < def.pellets; i++) {
    const angle = aim + (Math.random() * 2 - 1) * spread;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    if (def.pierce) fireBeam(match, p, def, dx, dz, damage);
    else launchProjectile(match, p.move.x, p.move.z, dx, dz, def, damage, p.id, p.team, 0);
  }
}

/** Create a projectile at the muzzle (or an immediate impact if the muzzle is inside a wall). */
export function launchProjectile(
  match: Match,
  x: number,
  z: number,
  dx: number,
  dz: number,
  def: WeaponDef,
  damage: number,
  owner: string | null,
  team: number,
  turret: number,
  range = def.range,
): void {
  const id = match.nextId();
  const muzzle = raycast(match.map, x, z, dx, dz, MUZZLE_OFFSET);
  const shield = domeBlock(match.ents, team, x, z, dx, dz, muzzle.t);
  if (shield) {
    muzzle.t = shield.t;
    muzzle.nx = shield.nx;
    muzzle.nz = shield.nz;
  }
  const sx = x + dx * muzzle.t;
  const sz = z + dz * muzzle.t;
  match.emit({
    e: 'shot',
    id,
    by: owner ?? '',
    w: def.id,
    x: r2(sx),
    z: r2(sz),
    dx: Math.round(dx * 1000) / 1000,
    dz: Math.round(dz * 1000) / 1000,
    ...(turret ? { turret } : {}),
  });
  const proj: Projectile = {
    id,
    x: sx,
    z: sz,
    dx,
    dz,
    speed: def.projectileSpeed,
    range,
    traveled: muzzle.t,
    damage,
    owner,
    team,
    w: def.id,
    turret,
  };
  if (muzzle.ob || shield) {
    finishProjectile(match, proj, sx, sz, muzzle.nx, muzzle.nz);
    return;
  }
  match.projectiles.push(proj);
}

/** Laser Eyes: instant beam that pierces every enemy until a wall or an enemy dome. */
function fireBeam(match: Match, p: Player, def: WeaponDef, dx: number, dz: number, damage: number): void {
  const id = match.nextId();
  const x = p.move.x;
  const z = p.move.z;
  const wall = raycast(match.map, x, z, dx, dz, def.range);
  let len = wall.t;
  let nx = wall.nx;
  let nz = wall.nz;
  let blocked = !!wall.ob;
  const dome = domeBlock(match.ents, p.team, x, z, dx, dz, len);
  if (dome) {
    len = dome.t;
    nx = dome.nx;
    nz = dome.nz;
    blocked = true;
  }
  match.emit({ e: 'shot', id, by: p.id, w: def.id, x: r2(x), z: r2(z), dx: r2(dx), dz: r2(dz), len: r2(len) });
  for (const target of match.players) {
    if (target === p || target.team === p.team || !isHittable(target)) continue;
    const t = rayCircle(x, z, dx, dz, target.move.x, target.move.z, HIT_RADIUS);
    if (t < 0 || t > len) continue;
    applyDamage(match, target, damage, p, 'weapon', def.id, id, x + dx * t, z + dz * t);
  }
  if (blocked) match.emit({ e: 'impact', id, x: r2(x + dx * len), z: r2(z + dz * len), nx, nz });
}

interface DomeHit {
  t: number;
  nx: number;
  nz: number;
}

/** First crossing of an enemy dome boundary along the segment, or null. */
function domeBlock(
  ents: readonly Ent[],
  team: number,
  x: number,
  z: number,
  dx: number,
  dz: number,
  maxT: number,
): DomeHit | null {
  let best: DomeHit | null = null;
  for (const ent of ents) {
    if (ent.k !== 'dome' || ent.team === team) continue;
    const ox = x - ent.x;
    const oz = z - ent.z;
    const c = ox * ox + oz * oz - ent.radius * ent.radius;
    const b = ox * dx + oz * dz;
    const disc = b * b - c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    // outside → entry point; inside → exit point
    const t = c > 0 ? -b - sq : -b + sq;
    if (t < 0 || t > maxT || (best && t >= best.t)) continue;
    const hx = x + dx * t - ent.x;
    const hz = z + dz * t - ent.z;
    const l = Math.hypot(hx, hz) || 1;
    best = { t, nx: r2(hx / l), nz: r2(hz / l) };
  }
  return best;
}

/** Shotgun pellets lose damage past 35% of range, down to 40% at max range. */
function falloffMul(proj: Projectile): number {
  if (proj.w !== 'shotgun') return 1;
  const f = proj.traveled / proj.range;
  return f <= 0.35 ? 1 : 1 - 0.6 * Math.min(1, (f - 0.35) / 0.65);
}

/** Rockets explode wherever they stop; bullets emit an impact. */
function finishProjectile(match: Match, proj: Projectile, x: number, z: number, nx: number, nz: number): void {
  match.emit({ e: 'impact', id: proj.id, x: r2(x), z: r2(z), nx, nz });
  const def = WEAPONS[proj.w];
  if (def.explosionRadius) {
    const owner = proj.owner ? (match.playerById(proj.owner) ?? null) : null;
    const ex = x + nx * 0.3;
    const ez = z + nz * 0.3;
    explode(match, ex, ez, def.explosionRadius, proj.damage, owner, proj.team, 'explosion', proj.w);
  }
}

/** Sweep every projectile for one tick against walls, enemy domes and players. */
export function stepProjectiles(match: Match): void {
  const list = match.projectiles;
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const proj = list[i]!;
    if (!sweepProjectile(match, proj)) list[write++] = proj;
  }
  list.length = write;
}

/** Returns true when the projectile is done. */
function sweepProjectile(match: Match, proj: Projectile): boolean {
  const seg = Math.min(proj.speed * TICK_DT, proj.range - proj.traveled);
  const { x, z, dx, dz } = proj;
  const wall = raycast(match.map, x, z, dx, dz, seg);
  let stopT = wall.t;
  let nx = wall.nx;
  let nz = wall.nz;
  let stopped = !!wall.ob;
  const dome = domeBlock(match.ents, proj.team, x, z, dx, dz, stopT);
  if (dome) {
    stopT = dome.t;
    nx = dome.nx;
    nz = dome.nz;
    stopped = true;
  }
  let victim: Player | null = null;
  for (const p of match.players) {
    if (p.team === proj.team || p.id === proj.owner || !isHittable(p)) continue;
    const t = rayCircle(x, z, dx, dz, p.move.x, p.move.z, HIT_RADIUS);
    if (t < 0 || t > stopT) continue;
    stopT = t;
    victim = p;
  }
  proj.traveled += stopT;
  const hx = x + dx * stopT;
  const hz = z + dz * stopT;
  if (victim) {
    const def = WEAPONS[proj.w];
    const owner = proj.owner ? (match.playerById(proj.owner) ?? null) : null;
    let dealt: number;
    if (def.explosionRadius) {
      // direct rocket hit: full damage to the victim, splash to everyone else around
      dealt = applyDamage(match, victim, proj.damage, owner, 'explosion', proj.w, proj.id, hx, hz);
      explode(match, hx, hz, def.explosionRadius, proj.damage, owner, proj.team, 'explosion', proj.w, victim.id);
    } else {
      const dmg = proj.damage * falloffMul(proj);
      dealt = applyDamage(match, victim, dmg, owner, proj.turret ? 'turret' : 'weapon', proj.w, proj.id, hx, hz);
    }
    // Damage rejected (e.g. Vault Mode): no `hit` went out, so terminate the client tracer explicitly.
    if (dealt === 0) match.emit({ e: 'impact', id: proj.id, x: r2(hx), z: r2(hz), nx: 0, nz: 0 });
    return true;
  }
  if (stopped) {
    finishProjectile(match, proj, hx, hz, nx, nz);
    return true;
  }
  proj.x = hx;
  proj.z = hz;
  if (proj.traveled >= proj.range - 1e-6) {
    finishProjectile(match, proj, hx, hz, 0, 0);
    return true;
  }
  return false;
}

