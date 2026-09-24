// Server-internal state types shared by the match simulation, combat, abilities, loot and bot AI modules.

import type { AmmoType, CharacterId, ConsumableId, WeaponId } from '../shared/constants';
import type { GameMap } from '../shared/map';
import type { MoveState } from '../shared/physics';
import type { ChestSnap, ClientMsg, EntKind, LootItem, Phase, ZoneSnap } from '../shared/protocol';

export type InputCmd = Extract<ClientMsg, { t: 'in' }>;
export type ActCmd = Extract<ClientMsg, { t: 'act' }>;
/** Everything that goes through a player's per-tick command queue (humans AND bots). */
export type QueuedCmd = InputCmd | ActCmd;

export interface WeaponSlot {
  w: WeaponId;
  mag: number;
}

export interface LeapState {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number; // elapsed
  total: number;
}

export interface Player {
  id: string;
  name: string;
  character: CharacterId;
  team: number; // 1-based
  /** Roster identity: spawned as a bot (true) or a human (false). Never changes during a match. */
  bot: boolean;
  /** Driven by the bot AI this tick (bots + rage-quit humans). */
  ai: boolean;
  /** Connection id of the controlling human (null for bots / after disconnect). */
  clientId: string | null;

  alive: boolean;
  move: MoveState;
  y: number; // altitude (deploy drop / leap arc)
  aim: number;
  /** Last input's desired move vector magnitude (0..1) — widens spread while moving. */
  moveAmount: number;
  hp: number;
  ar: number;

  slots: [WeaponSlot | null, WeaponSlot | null];
  active: 0 | 1;
  ammo: Record<AmmoType, number>;
  cons: { stable: number; medkit: number };

  reloadT: number; // seconds remaining (0 = not reloading)
  reloadTotal: number;
  channel: { c: ConsumableId; t: number; total: number } | null; // t = seconds remaining

  abilityCd: number;
  dmgBuffT: number;
  dmgBuffMul: number;
  rushT: number;
  rushMul: number;
  slowT: number;
  slowMul: number;
  invulnT: number;
  leap: LeapState | null;
  /** team → match time until which this player is revealed to that team (Pons radar). */
  revealedTo: Map<number, number>;

  fireHeld: boolean;
  /** Unconsumed trigger press edge (kept even if a later input in the same tick releases the button). */
  firePress: boolean;
  /** Aim at the moment of that press, used for the shot it produces. */
  pressAim: number;
  /** Seconds since `firePress` was set; stale presses expire (see PRESS_BUFFER in combat.ts). */
  pressAge: number;
  /** `fire` value of the previous applied input (for press-edge detection). */
  lastFireInput: boolean;
  fireCd: number; // seconds until the next shot may fire
  spin: number; // minigun spin-up 0..1
  sinceShot: number; // seconds since last shot (ST.FIRING while < 0.15)
  zoneHurt: boolean; // outside the zone during the last damage pulse

  queue: QueuedCmd[];
  lastAck: number;
  /** Seconds of movement simulation this player may still run (real-time budget with bounded catch-up). */
  moveCredit: number;

  deployX: number; // chosen landing target
  deployZ: number;

  kills: number;
  damage: number;
  score: number;
  streak: number;
  place: number; // team placement once the team is out (0 = still in)
  deathTime: number; // match time of death (-1 = alive)
  killedBy: string | null;
  /** Match time of the last damage taken, and who dealt it (bots use this to dodge / retaliate). */
  lastHurtAt: number;
  lastHurtBy: string | null;
  laserEyes: boolean;
}

export interface Chest extends ChestSnap {
  rug: boolean;
}

export interface Ent {
  id: number;
  k: EntKind;
  x: number;
  z: number;
  y: number;
  owner: string | null;
  team: number;
  ttl: number;
  total: number; // initial ttl
  aim: number;
  radius: number;
  power: number;
  range: number;
  fireCd: number; // turret: s until next shot; pool: s until next heal event
  /** Pool: HP restored per player since the last heal notice. */
  healed: Map<string, number>;
  fromX: number; // grenade launch point
  fromZ: number;
}

export interface Projectile {
  id: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  range: number;
  traveled: number;
  damage: number;
  owner: string | null;
  team: number;
  w: WeaponId;
  turret: number; // ent id when fired by a turret (0 = player)
}

export type ZoneState = ZoneSnap;

export type SkillLevel = 0 | 1 | 2;

/**
 * Read-mostly view of the running match for bot AI. Bots MUST act only through `submit` / `deploy` /
 * `emote` (the exact same paths human messages take), so every game rule applies to them identically.
 */
export interface BotWorld {
  readonly map: GameMap;
  readonly phase: Phase;
  /** Seconds since 'playing' began (0 during deploy). */
  readonly time: number;
  /** Seconds left in the current timed phase (deploy countdown), 0 while playing. */
  readonly phaseT: number;
  /** Seconds left of the post-landing grace (everyone invulnerable, weapons + abilities locked). */
  readonly graceT: number;
  readonly skill: SkillLevel;
  readonly players: readonly Player[];
  readonly loot: ReadonlyMap<number, LootItem>;
  readonly chests: ReadonlyMap<number, Chest>;
  readonly ents: readonly Ent[];
  readonly zone: ZoneState;
  /** Monotonic tick counter. */
  readonly tick: number;
  playerById(id: string): Player | undefined;
  /**
   * Can `viewer` see `target` right now? Line of sight through obstacles, and bush concealment
   * (a target standing in a bush further than 5m is hidden unless firing or revealed to viewer's team).
   */
  canSee(viewer: Player, target: Player): boolean;
  /** Queue a command exactly as if it arrived from a client socket. */
  submit(p: Player, cmd: QueuedCmd): void;
  /** Choose / change landing target during deploy (same as the 'deploy' client message). */
  deploy(p: Player, x: number, z: number): void;
  /** Emote by EMOTES index (same as the 'emote' client message). */
  emote(p: Player, index: number): void;
}
