// Loot tables, spawning, pickups (auto + interact), chests (incl. rug + airdrop crates) and death drops.

import {
  AMMO_MAX,
  AMMO_NAMES,
  AMMO_PICKUP,
  AUTO_PICKUP_RADIUS,
  CONSUMABLES,
  MAX_ARMOR,
  PICKUP_RADIUS,
  PLAYER_RADIUS,
  WEAPONS,
  type AmmoType,
  type ConsumableId,
  type Rarity,
  type WeaponId,
} from '../shared/constants';
import { findFreeSpot, resolveCircle } from '../shared/physics';
import type { LootItem } from '../shared/protocol';
import { applyDamage, cancelReload } from './combat';
import type { Match } from './match';
import type { Chest, Player } from './types';

/** A loot item before it gets an id + position. */
export type LootDraft =
  | { k: 'weapon'; w: WeaponId; mag: number }
  | { k: 'ammo'; a: AmmoType; n: number }
  | { k: 'cons'; c: ConsumableId; n: number };

type Weighted<T> = readonly (readonly [T, number])[];

function weightedPick<T>(table: Weighted<T>): T {
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = Math.random() * total;
  for (const [value, w] of table) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return table[table.length - 1]![0];
}

const weaponDraft = (w: WeaponId): LootDraft => ({ k: 'weapon', w, mag: WEAPONS[w].mag });
const consDraft = (c: ConsumableId): LootDraft => ({ k: 'cons', c, n: 1 });
const ammoDraft = (a: AmmoType, packs = 1): LootDraft => ({ k: 'ammo', a, n: AMMO_PICKUP[a] * packs });

const LEGENDARIES: readonly WeaponId[] = ['laser', 'minigun'];

const TIER_WEAPONS: readonly Weighted<WeaponId>[] = [
  [['pistol', 45], ['smg', 30], ['shotgun', 25]],
  [['smg', 30], ['shotgun', 28], ['ar', 32], ['sniper', 10]],
  [['ar', 45], ['sniper', 30], ['rocket', 25]],
];

type TierRoll = 'weapon' | 'ammo' | ConsumableId;
const TIER_KINDS: readonly Weighted<TierRoll>[] = [
  [['weapon', 40], ['ammo', 25], ['stable', 20], ['armorS', 15]],
  [['weapon', 45], ['ammo', 15], ['armorS', 15], ['stable', 17], ['medkit', 8]],
  [['weapon', 50], ['ammo', 12], ['armorL', 20], ['medkit', 18]],
];
const TIER_AMMO: readonly Weighted<AmmoType>[] = [
  [['light', 1]],
  [['light', 4], ['shells', 3], ['heavy', 3]],
  [['heavy', 6], ['shells', 2], ['rocket', 2]],
];

function rollTierWeapon(tier: 0 | 1 | 2): WeaponId {
  if (tier === 2 && Math.random() < 0.02) return LEGENDARIES[Math.floor(Math.random() * LEGENDARIES.length)]!;
  return weightedPick(TIER_WEAPONS[tier]!);
}

/** Roll the drafts for one map loot spawn. Weapons always come with a pack of their ammo. */
export function rollSpawn(tier: 0 | 1 | 2): LootDraft[] {
  const kind = weightedPick(TIER_KINDS[tier]!);
  if (kind === 'weapon') {
    const w = rollTierWeapon(tier);
    return [weaponDraft(w), ammoDraft(WEAPONS[w].ammo)];
  }
  if (kind === 'ammo') return [ammoDraft(weightedPick(TIER_AMMO[tier]!))];
  return [consDraft(kind)];
}

/** 3 items from a regular treasury chest: a solid weapon, its ammo, and a heal/armor. */
function rollChest(): LootDraft[] {
  const w = rollTierWeapon(Math.random() < 0.5 ? 2 : 1);
  const extra = weightedPick<ConsumableId>([['armorS', 3], ['armorL', 2], ['medkit', 2], ['stable', 3]]);
  return [weaponDraft(w), ammoDraft(WEAPONS[w].ammo, 2), consDraft(extra)];
}

/** Airdrop crate: legendary + Hardware Wallet + Cold Wallet + ammo. */
function rollAirdrop(): LootDraft[] {
  const w = LEGENDARIES[Math.floor(Math.random() * LEGENDARIES.length)]!;
  return [weaponDraft(w), ammoDraft(WEAPONS[w].ammo, 3), consDraft('armorL'), consDraft('medkit')];
}

export function lootLabel(item: LootDraft): { label: string; rarity: Rarity } {
  if (item.k === 'weapon') return { label: WEAPONS[item.w].name, rarity: WEAPONS[item.w].rarity };
  if (item.k === 'ammo') return { label: `${item.n} ${AMMO_NAMES[item.a]}`, rarity: 0 };
  const def = CONSUMABLES[item.c];
  return { label: item.n > 1 ? `${item.n}× ${def.name}` : def.name, rarity: def.rarity };
}

/** Place a loot item near (x,z) on a free spot. `announce` = emit lootAdd (false during match setup). */
export function spawnLoot(match: Match, draft: LootDraft, x: number, z: number, announce = true): LootItem {
  const spot = findFreeSpot(match.map, x, z, 0.35);
  const item = { ...draft, id: match.nextId(), x: spot.x, z: spot.z } as LootItem;
  match.loot.set(item.id, item);
  if (announce) match.emit({ e: 'lootAdd', item });
  return item;
}

/** Scatter several drafts in a ring around (x,z). */
export function scatterLoot(match: Match, drafts: LootDraft[], x: number, z: number, radius: number): void {
  const offset = Math.random() * Math.PI * 2;
  drafts.forEach((draft, i) => {
    const a = offset + (i / Math.max(1, drafts.length)) * Math.PI * 2;
    const r = drafts.length === 1 ? 0.3 : radius;
    spawnLoot(match, draft, x + Math.cos(a) * r, z + Math.sin(a) * r);
  });
}

/** Initial map loot + chests. Called once at match creation (no events; clients get the `match` message). */
export function populateWorld(match: Match, rugChance: number): void {
  for (const spawn of match.map.lootSpawns) {
    const drafts = rollSpawn(spawn.tier);
    drafts.forEach((draft, i) => spawnLoot(match, draft, spawn.x + i * 0.9, spawn.z + i * 0.3, false));
  }
  for (const spot of match.map.chestSpawns) {
    const free = findFreeSpot(match.map, spot.x, spot.z, 0.6);
    const chest: Chest = { id: match.nextId(), x: free.x, z: free.z, open: false, airdrop: false, rug: false };
    chest.rug = Math.random() < rugChance;
    match.chests.set(chest.id, chest);
  }
}

// ───────────────────────────── Pickups ─────────────────────────────

function removeLoot(match: Match, id: number, by: string | null): void {
  match.loot.delete(id);
  match.emit({ e: 'lootDel', id, by });
}

function emitPickup(match: Match, p: Player, draft: LootDraft): void {
  const { label, rarity } = lootLabel(draft);
  match.emit({ e: 'pickup', by: p.id, label, rarity });
}

/** Ammo, heals and armor are collected by walking over them (when there's room). */
export function autoPickup(match: Match, p: Player): void {
  const r2 = AUTO_PICKUP_RADIUS * AUTO_PICKUP_RADIUS;
  for (const item of match.loot.values()) {
    if (item.k === 'weapon') continue;
    const dx = item.x - p.move.x;
    const dz = item.z - p.move.z;
    if (dx * dx + dz * dz > r2) continue;
    if (item.k === 'ammo') {
      const room = AMMO_MAX[item.a] - p.ammo[item.a];
      if (room <= 0) continue;
      const taken = Math.min(room, item.n);
      p.ammo[item.a] += taken;
      removeLoot(match, item.id, p.id);
      emitPickup(match, p, { k: 'ammo', a: item.a, n: taken });
      if (taken < item.n) spawnLoot(match, { k: 'ammo', a: item.a, n: item.n - taken }, item.x, item.z);
      continue;
    }
    const def = CONSUMABLES[item.c];
    if (def.armor) {
      if (p.ar >= MAX_ARMOR) continue;
      const before = p.ar;
      p.ar = Math.min(MAX_ARMOR, p.ar + def.armor * item.n);
      removeLoot(match, item.id, p.id);
      emitPickup(match, p, { k: 'cons', c: item.c, n: item.n });
      match.emit({ e: 'heal', by: p.id, hp: 0, armor: Math.round(p.ar - before) });
      continue;
    }
    const key = item.c === 'medkit' ? 'medkit' : 'stable';
    const room = def.maxCarry - p.cons[key];
    if (room <= 0) continue;
    const taken = Math.min(room, item.n);
    p.cons[key] += taken;
    removeLoot(match, item.id, p.id);
    emitPickup(match, p, { k: 'cons', c: item.c, n: taken });
    if (taken < item.n) spawnLoot(match, { k: 'cons', c: item.c, n: item.n - taken }, item.x, item.z);
  }
}

export type InteractTarget = { kind: 'loot'; item: LootItem } | { kind: 'chest'; chest: Chest } | null;

/** What E would act on: the nearest weapon on the ground or unopened chest within PICKUP_RADIUS. */
export function findInteractTarget(match: Match, p: Player): InteractTarget {
  let best: InteractTarget = null;
  let bestD = PICKUP_RADIUS * PICKUP_RADIUS;
  for (const item of match.loot.values()) {
    if (item.k !== 'weapon') continue;
    const d = (item.x - p.move.x) ** 2 + (item.z - p.move.z) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'loot', item };
    }
  }
  for (const chest of match.chests.values()) {
    if (chest.open) continue;
    const d = (chest.x - p.move.x) ** 2 + (chest.z - p.move.z) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'chest', chest };
    }
  }
  return best;
}

/** Extra reach for the target the client was prompted for (its predicted position runs ahead of ours). */
const HINT_SLACK = 1.5;

export function interact(match: Match, p: Player, hint: { loot?: number; chest?: number } = {}): void {
  const reach2 = (PICKUP_RADIUS + HINT_SLACK) ** 2;
  const hinted = hint.loot !== undefined ? match.loot.get(hint.loot) : undefined;
  if (hinted?.k === 'weapon' && (hinted.x - p.move.x) ** 2 + (hinted.z - p.move.z) ** 2 <= reach2) {
    pickupWeapon(match, p, hinted);
    return;
  }
  const hintedChest = hint.chest !== undefined ? match.chests.get(hint.chest) : undefined;
  if (hintedChest && !hintedChest.open && (hintedChest.x - p.move.x) ** 2 + (hintedChest.z - p.move.z) ** 2 <= reach2) {
    openChest(match, p, hintedChest);
    return;
  }
  const target = findInteractTarget(match, p);
  if (!target) return;
  if (target.kind === 'chest') openChest(match, p, target.chest);
  else if (target.item.k === 'weapon') pickupWeapon(match, p, target.item);
}

function pickupWeapon(match: Match, p: Player, item: Extract<LootItem, { k: 'weapon' }>): void {
  removeLoot(match, item.id, p.id);
  const incoming = { w: item.w, mag: item.mag };
  let slot: 0 | 1;
  if (!p.slots[p.active]) slot = p.active;
  else if (!p.slots[p.active === 0 ? 1 : 0]) slot = p.active === 0 ? 1 : 0;
  else {
    slot = p.active;
    const old = p.slots[slot]!;
    spawnLoot(match, { k: 'weapon', w: old.w, mag: old.mag }, p.move.x, p.move.z);
  }
  p.slots[slot] = incoming;
  p.active = slot;
  cancelReload(p);
  p.channel = null;
  p.spin = 0;
  emitPickup(match, p, { k: 'weapon', w: item.w, mag: item.mag });
}

const RUG_RADIUS = 3.5;
const RUG_DAMAGE = 30;
const RUG_KNOCKBACK = 3.2;

function openChest(match: Match, p: Player, chest: Chest): void {
  chest.open = true;
  match.emit({ e: 'chest', id: chest.id, by: p.id, rug: chest.rug });
  if (chest.rug) {
    match.emit({ e: 'boom', x: chest.x, z: chest.z, r: RUG_RADIUS, by: null });
    match.announce('RUGGED', `${p.name} opened a rug chest. Devs did something.`, '#FF3B3B');
    for (const other of match.players) {
      if (!other.alive || other.y > 1.5) continue;
      const dx = other.move.x - chest.x;
      const dz = other.move.z - chest.z;
      const d = Math.hypot(dx, dz);
      if (d > RUG_RADIUS + PLAYER_RADIUS) continue;
      const away = other.aim + Math.PI;
      knockback(match, other, d > 0.01 ? dx / d : Math.cos(away), d > 0.01 ? dz / d : Math.sin(away));
      applyDamage(match, other, RUG_DAMAGE, null, 'rug', null, 0, other.move.x, other.move.z);
    }
    return;
  }
  scatterLoot(match, chest.airdrop ? rollAirdrop() : rollChest(), chest.x, chest.z, 1.5);
}

/** Shove a player ~RUG_KNOCKBACK m along (nx,nz), respecting walls. */
function knockback(match: Match, p: Player, nx: number, nz: number): void {
  const steps = Math.ceil(RUG_KNOCKBACK / 0.3);
  const pos = { x: p.move.x, z: p.move.z };
  for (let i = 0; i < steps; i++) {
    pos.x += (nx * RUG_KNOCKBACK) / steps;
    pos.z += (nz * RUG_KNOCKBACK) / steps;
    resolveCircle(match.map, pos, PLAYER_RADIUS);
  }
  p.move.x = pos.x;
  p.move.z = pos.z;
}

/** A landed airdrop crate becomes a special chest. */
export function landAirdrop(match: Match, x: number, z: number): void {
  const spot = findFreeSpot(match.map, x, z, 0.6);
  const chest: Chest = { id: match.nextId(), x: spot.x, z: spot.z, open: false, airdrop: true, rug: false };
  match.chests.set(chest.id, chest);
  match.emit({ e: 'chestAdd', chest: { id: chest.id, x: chest.x, z: chest.z, open: false, airdrop: true } });
}

// ───────────────────────────── Drops ─────────────────────────────

/** X key: drop the active weapon at your feet. */
export function dropActiveWeapon(match: Match, p: Player): void {
  const slot = p.slots[p.active];
  if (!slot) return;
  p.slots[p.active] = null;
  cancelReload(p);
  p.spin = 0;
  const dropX = p.move.x + Math.cos(p.aim) * 1.2;
  const dropZ = p.move.z + Math.sin(p.aim) * 1.2;
  spawnLoot(match, { k: 'weapon', w: slot.w, mag: slot.mag }, dropX, dropZ);
  const other = p.active === 0 ? 1 : 0;
  if (p.slots[other]) p.active = other;
}

/** Everything a dead player carried spills around the body. */
export function dropInventory(match: Match, p: Player): void {
  const drafts: LootDraft[] = [];
  for (const slot of p.slots) if (slot) drafts.push({ k: 'weapon', w: slot.w, mag: slot.mag });
  for (const a of Object.keys(p.ammo) as AmmoType[]) {
    if (p.ammo[a] > 0) drafts.push({ k: 'ammo', a, n: p.ammo[a] });
  }
  if (p.cons.stable > 0) drafts.push({ k: 'cons', c: 'stable', n: p.cons.stable });
  if (p.cons.medkit > 0) drafts.push({ k: 'cons', c: 'medkit', n: p.cons.medkit });
  p.slots = [null, null];
  p.cons = { stable: 0, medkit: 0 };
  for (const a of Object.keys(p.ammo) as AmmoType[]) p.ammo[a] = 0;
  scatterLoot(match, drafts, p.move.x, p.move.z, 1.4);
}
