// Wire protocol (JSON over a single WebSocket at /ws). This file is THE contract between server and client.
// Conventions: positions are meters on the x/z ground plane, y = altitude. Angles are radians where
// direction = (cos(aim), sin(aim)) on (x, z). Durations are seconds. Player ids are short strings ("p3", "b7").

import type {
  AbilityKind,
  AmmoType,
  CharacterId,
  ConsumableId,
  Rarity,
  WeaponId,
} from './constants';

export type Phase = 'lobby' | 'countdown' | 'deploy' | 'playing' | 'ended';

// ───────────────────────────── Loot / world objects ─────────────────────────────

export type LootItem =
  | { id: number; x: number; z: number; k: 'weapon'; w: WeaponId; mag: number }
  | { id: number; x: number; z: number; k: 'ammo'; a: AmmoType; n: number }
  | { id: number; x: number; z: number; k: 'cons'; c: ConsumableId; n: number };

export interface ChestSnap {
  id: number;
  x: number;
  z: number;
  open: boolean;
  airdrop: boolean; // legendary airdrop crate (landed)
}

export type EntKind =
  | 'pool' // Uniswap liquidity pool (radius from ability def)
  | 'turret' // Clanker sentry; `aim` = barrel angle
  | 'dome' // Zora orb shield
  | 'grenade' // Pump & Dump bomb in flight; y = altitude
  | 'airdrop'; // falling supply crate; y = altitude (lands → chestAdd event)

export interface EntSnap {
  id: number;
  k: EntKind;
  x: number;
  z: number;
  y: number;
  owner: string | null;
  team: number;
  ttl: number; // seconds remaining
  aim?: number;
}

// Player status bit flags (PlayerSnap.st)
export const ST = {
  DASH: 1,
  RELOAD: 2,
  CHANNEL: 4, // using a consumable
  DMG_BUFF: 8, // Long Position
  RUSH: 16, // FOMO Rush
  SLOWED: 32, // Doppler sonic boom
  INVULN: 64, // Bankr vault mode
  REVEALED: 128, // revealed to the receiving client's team (Pons radar)
  LEAP: 256, // mid-air (Jump leap)
  FIRING: 512, // fired within the last ~150ms
  DEPLOYING: 1024, // still dropping from the sky (y > 0)
  IN_ZONE_DMG: 2048, // taking storm damage
  LASER_EYES: 4096, // easter egg (Konami code → chat "/lasereyes" toggles): glowing red eyes
} as const;

export interface PlayerSnap {
  id: string;
  x: number;
  z: number;
  y: number; // altitude (deploy drop, leap arc); 0 on ground
  aim: number;
  hp: number;
  ar: number; // armor
  alive: boolean;
  w: WeaponId | null; // weapon in hand (for the 3D model)
  st: number; // ST bit flags
}

export interface SlotSnap {
  w: WeaponId;
  mag: number;
}

/** Private state for the receiving client's own player (null when spectating / dead / not in match). */
export interface SelfSnap {
  ack: number; // last input seq applied by the server
  // authoritative movement state for client-side prediction reconciliation (see shared/physics MoveState)
  x: number;
  z: number;
  dashT: number;
  dashCd: number;
  dashDx: number;
  dashDz: number;
  speedMul: number; // multiplier the server applies in stepMove (buffs/slows/channel)
  slots: [SlotSnap | null, SlotSnap | null];
  active: 0 | 1;
  ammo: Record<AmmoType, number>;
  cons: { stable: number; medkit: number };
  reload: number; // seconds remaining (0 = not reloading)
  reloadTotal: number;
  channel: { c: ConsumableId; t: number; total: number } | null;
  abilityCd: number; // seconds remaining
  buffT: number; // seconds remaining on your active ability buff (dmgBuff/rush/invuln), 0 if none
  kills: number;
  damage: number;
  score: number;
  nearLoot: number | null; // id of the loot item E would pick up (server-computed)
  nearChest: number | null; // id of the chest E would open
}

export interface ZoneSnap {
  cx: number; // current circle
  cz: number;
  r: number;
  ncx: number; // next (target) circle
  ncz: number;
  nr: number;
  phase: number; // index into ZONE_PHASES (−1 before first)
  shrinking: boolean;
  t: number; // seconds until current wait/shrink ends
  dps: number; // current damage per second outside
}

export interface RosterEntry {
  id: string;
  name: string;
  character: CharacterId;
  team: number; // 1-based
  bot: boolean;
}

export interface ResultEntry extends RosterEntry {
  kills: number;
  damage: number;
  place: number; // team placement (1 = winner)
  score: number; // "PnL" in $
}

export interface SessionEntry {
  name: string;
  character: CharacterId;
  bot: boolean;
  matches: number;
  wins: number;
  kills: number;
  score: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  character: CharacterId;
  team: number; // 0 = auto-assign
  ready: boolean;
  host: boolean;
  ping: number; // ms
}

export interface LobbySettings {
  teamSize: number; // 1 = solo … 6
  fillTo: number; // bots fill the match up to this many players total
  botSkill: 0 | 1 | 2; // 0 = paper hands, 1 = degen, 2 = whale
}

// ───────────────────────────── Game events (inside snapshots) ─────────────────────────────

export type KillCause = 'weapon' | 'explosion' | 'zone' | 'ability' | 'rug' | 'turret';

export type GameEvent =
  // A projectile was fired. Clients simulate its flight: pos = (x,z) + (dx,dz)·speed·age using
  // WEAPONS[w].projectileSpeed / range, until a matching 'hit'/'impact' arrives. `len` is set for the
  // laser (instant beam; draw a beam of that length). `turret` = ent id when fired by a Clanker turret.
  | { e: 'shot'; id: number; by: string; w: WeaponId; x: number; z: number; dx: number; dz: number; len?: number; turret?: number }
  // Damage dealt to a player. id = projectile id (0 when not from a projectile). armor = hit absorbed by armor.
  | { e: 'hit'; id: number; x: number; z: number; target: string; dmg: number; armor: boolean; by: string | null; kind: KillCause; kill: boolean }
  // Projectile stopped on a wall (nx,nz = surface normal) or expired (nx = nz = 0).
  | { e: 'impact'; id: number; x: number; z: number; nx: number; nz: number }
  | { e: 'boom'; x: number; z: number; r: number; by: string | null }
  | { e: 'kill'; killer: string | null; victim: string; w: WeaponId | null; cause: KillCause; verb: string }
  | { e: 'teamOut'; team: number; place: number }
  | { e: 'lootAdd'; item: LootItem }
  | { e: 'lootDel'; id: number; by: string | null }
  | { e: 'pickup'; by: string; label: string; rarity: Rarity }
  | { e: 'chest'; id: number; by: string; rug: boolean }
  | { e: 'chestAdd'; chest: ChestSnap }
  | { e: 'ability'; by: string; kind: AbilityKind; x: number; z: number; tx: number; tz: number }
  | { e: 'reload'; by: string }
  | { e: 'heal'; by: string; hp: number; armor: number } // amounts actually restored by this event (deltas)
  | { e: 'dash'; by: string }
  | { e: 'land'; by: string }
  | { e: 'airdrop'; id: number; x: number; z: number } // incoming airdrop announced (ent id)
  | { e: 'zone'; phase: number; shrinking: boolean; msg: string }
  | { e: 'emote'; by: string; text: string }
  | { e: 'announce'; text: string; sub?: string; color?: string };

// ───────────────────────────── Client → Server ─────────────────────────────

export const EMOTES = ['gm', 'LFG', 'WAGMI', 'NGMI', 'ser…', 'wen moon?', 'gg', 'few understand'] as const;

export type ClientMsg =
  // sid: random per-tab session id (sessionStorage). Re-joining with the same sid after a dropped connection
  // resumes the same lobby seat / in-match player instead of creating a new one.
  | { t: 'join'; name: string; character?: CharacterId; sid?: string }
  | { t: 'lobbySet'; name?: string; character?: CharacterId; team?: number; ready?: boolean }
  | { t: 'settings'; teamSize?: number; fillTo?: number; botSkill?: 0 | 1 | 2 } // host only
  | { t: 'start' } // host only: force-start now (skips the ready check)
  // One fixed 1/TICK_RATE movement step. Sent every client tick while in a match.
  | { t: 'in'; seq: number; mx: number; mz: number; aim: number; fire: boolean; dash: boolean }
  | {
      t: 'act';
      a: 'reload' | 'interact' | 'slot' | 'swap' | 'stable' | 'medkit' | 'ability' | 'drop' | 'cancel';
      v?: number; // slot index for 'slot'
      x?: number; // world aim point for 'ability'
      z?: number;
      // 'interact': the loot / chest the client was prompted for (SelfSnap.nearLoot / nearChest). The server honors
      // it with a little extra reach, since the client's view of its own position runs slightly ahead of the server.
      loot?: number;
      chest?: number;
    }
  | { t: 'deploy'; x: number; z: number } // choose / change landing target during deploy phase
  | { t: 'spectate'; dir: 1 | -1 } // cycle spectate target when dead
  | { t: 'emote'; i: number } // index into EMOTES
  | { t: 'chat'; text: string }
  | { t: 'ping'; c: number };

// ───────────────────────────── Server → Client ─────────────────────────────

export type ServerMsg =
  | { t: 'welcome'; id: string; version: number }
  | {
      t: 'lobby';
      phase: Phase;
      countdown: number; // seconds left in the pre-deploy countdown (phase 'countdown')
      // Ready check: once any human is ready, the match auto-launches when the timer hits 0 (or instantly when every
      // human in the lobby is ready). 0 = no timer running.
      readyTimer: number;
      players: LobbyPlayer[];
      settings: LobbySettings;
      board: SessionEntry[];
      matchInProgress: boolean;
    }
  | {
      t: 'match';
      seed: number;
      roster: RosterEntry[];
      loot: LootItem[];
      chests: ChestSnap[];
      you: string | null; // your player id in this match (null = spectator)
      teamSize: number;
    }
  | {
      t: 'snap';
      tick: number;
      time: number; // server ms timestamp (Date.now()) — clients use it for interpolation
      phase: Phase;
      phaseT: number; // seconds left in countdown/deploy/ended (0 in 'playing')
      matchTime: number; // seconds since 'playing' began
      players: PlayerSnap[];
      ents: EntSnap[];
      zone: ZoneSnap;
      self: SelfSnap | null;
      spectating: string | null; // id the server suggests the camera follow when self is dead
      aliveCount: number;
      teamsAlive: number;
      ev: GameEvent[];
    }
  | { t: 'end'; winnerTeam: number; results: ResultEntry[]; board: SessionEntry[] }
  | { t: 'chat'; from: string; name: string; text: string; color: string }
  | { t: 'pong'; c: number };

export const PROTOCOL_VERSION = 1;
