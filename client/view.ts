// Contract between the client core (net/state/prediction/HUD) and the Three.js renderer.
// The core builds a FrameView every animation frame; the renderer draws it and never mutates it.

import type { CharacterId, WeaponId } from '../shared/constants';
import type { GameMap } from '../shared/map';
import type {
  ChestSnap,
  ClientMsg,
  EntSnap,
  LootItem,
  Phase,
  PlayerSnap,
  RoomVisibility,
  RosterEntry,
  SelfSnap,
  ZoneSnap,
} from '../shared/protocol';

export interface ViewPlayer extends PlayerSnap {
  name: string;
  character: CharacterId;
  team: number;
  bot: boolean;
  isSelf: boolean;
  isTeammate: boolean; // same team as the local player (false for self)
  vx: number; // estimated ground velocity (m/s) — drives walk animation + lean
  vz: number;
  concealed: boolean; // enemy hidden in a bush (draw ghosted ~15% opacity, no name tag)
  emote: { text: string; age: number } | null; // age in seconds since emote started (show ~2.5s)
}

export interface ViewProjectile {
  id: number;
  by: string;
  w: WeaponId;
  x: number; // current (client-simulated) position
  z: number;
  dx: number; // unit direction
  dz: number;
  ox: number; // origin
  oz: number;
  age: number; // seconds since fired
  len?: number; // laser beam length (instant beam)
}

export type CameraMode = 'lobby' | 'deploy' | 'play' | 'spectate' | 'ended';

export interface FrameView {
  now: number; // performance.now() ms
  phase: Phase;
  phaseT: number;
  map: GameMap | null;
  players: ViewPlayer[]; // interpolated remotes + predicted local player
  selfId: string | null;
  myTeam: number; // 0 when not in a match
  focusId: string | null; // player the camera follows (self, or spectate target)
  focus: { x: number; y: number; z: number }; // camera target point (ground-ish)
  aimWorld: { x: number; z: number } | null; // local mouse aim point on the ground
  projectiles: ViewProjectile[];
  loot: LootItem[];
  chests: ChestSnap[];
  ents: EntSnap[];
  zone: ZoneSnap | null;
  deployTarget: { x: number; z: number } | null; // local player's chosen landing spot
  highlightLoot: number | null; // loot id the local player can pick up (draw outline/pulse)
  highlightChest: number | null;
  cameraMode: CameraMode;
}

/** Per-frame HUD data the core hands to the UI alongside the FrameView. */
export interface HudState {
  self: SelfSnap | null; // null when dead / spectating / in lobby
  selfPlayer: ViewPlayer | null;
  roster: Map<string, RosterEntry>;
  teamSize: number;
  aliveCount: number;
  teamsAlive: number;
  matchTime: number; // s since 'playing' began
  ping: number; // ms round-trip
  fps: number;
  spectating: string | null; // player id being watched while dead / spectator
  death: { killer: string | null; cause: string; place: number | null } | null; // set once the local player died
}

// ───────────── Audio (implemented in client/audio.ts by the core) ─────────────
export type SfxName =
  | 'shot' // opts.w selects the weapon voice
  | 'hit' // bullet hits a player (flesh)
  | 'hitArmor' // hit absorbed by armor
  | 'hitmarker' // local player landed a hit (UI tick)
  | 'kill' // local player got a kill (confirm sting)
  | 'death' // any player died (positional)
  | 'explosion'
  | 'impact' // bullet hits wall
  | 'pickup'
  | 'pickupRare'
  | 'reload'
  | 'empty'
  | 'dash'
  | 'ability'
  | 'heal'
  | 'chest'
  | 'rug'
  | 'airdrop'
  | 'zoneWarn'
  | 'land'
  | 'emote'
  | 'click'
  | 'hover'
  | 'countdown'
  | 'go'
  | 'victory'
  | 'defeat'
  | 'notify'
  | 'whoosh';

export interface SfxOpts {
  x?: number; // world position → distance attenuation + stereo pan relative to the listener
  z?: number;
  vol?: number; // 0..1 (default 1)
  w?: WeaponId; // for 'shot'
}

export interface AudioApi {
  unlock(): void; // call on first user gesture
  play(name: SfxName, opts?: SfxOpts): void;
  setListener(x: number, z: number): void;
  setMusic(mode: 'lobby' | 'match' | 'off'): void;
  setVolume(master: number): void; // 0..1, persisted by caller
}

/** Lobby-browser actions the UI triggers; the core owns the socket and the `#CODE` URL hash. */
export interface RoomActions {
  join(code: string): void; // connect to an existing room (sets the hash once welcomed)
  create(visibility: RoomVisibility): void; // create a room; you become its host
  leave(): void; // leave the current room for good and return to the browser
  roomsUrl(): string; // GET → RoomList (public rooms)
}

/** What the UI needs from the rest of the client. */
export interface UiDeps {
  send(msg: ClientMsg): void;
  audio: AudioApi;
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean }; // world → CSS px
  map(): GameMap | null; // current match map (deploy picker, minimap)
  rooms: RoomActions;
}
