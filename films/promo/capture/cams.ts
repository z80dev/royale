// Clip type and camera helpers shared by the shot lists (shots.ts, cinema-*.ts).

import type { CamSpec } from './prelude';

export interface Clip {
  name: string;
  /** Recording name in capture/recordings (without .ndjson). */
  rec: string;
  /** Recording time (s) of the first captured frame. */
  start: number;
  dur: number;
  /** Source frames per second (60 by default; 120/240 for true slow motion). */
  fps?: number;
  ui: boolean;
  description: string;
  /** Player id the client plays as (HUD, death screen, results); null = seatless spectator; default p1 (host). */
  you?: string | null;
  /** Spectate/follow schedule while "you" is dead or null: [recording s, player id]. */
  focus?: [number, string][];
  cam?: CamSpec;
  /** Capture-only depth of field. Aperture/maxblur are BokehPass shader values; focus is metres or the subject. */
  dof?: { aperture: number; maxblur?: number; focus?: 'subject' | number };
  noShake?: boolean;
  /** Capture via composited page screenshots even without UI (the raw WebGL readback path stalls on `city`). */
  screenshot?: boolean;
  /** Stop feeding recorded messages after this recording time (s) — holds the lobby for long flyovers. */
  feedUntil?: number;
  preroll?: number;
  /** false = switch to the clip camera on the first captured frame instead of during the pre-roll. */
  camPreroll?: boolean;
  css?: string;
  /** Lobby brand-select montage: from recording s, the host switches brand every `every` s through `brands`. */
  brandCycle?: { from: number; every: number; brands: string[] };
  moments?: { t: number; what: string }[];
  autoMoments?: boolean;
  /** Auto-moment filter: only events within this many metres of the subject (default 40). */
  momentRadius?: number;
  /** Auto-moment subject point (x, z) instead of the focus player. */
  subjectPoint?: [number, number];
}

export type Vec = [number, number, number];

/** Close cinematic follow on the focus player. */
export const close = (yaw = 90, extra: Partial<Extract<CamSpec, { mode: 'follow' }>> = {}): CamSpec => ({
  mode: 'follow',
  dist: 19,
  pitch: 36,
  yaw,
  yawSpeed: 5,
  fov: 42,
  rate: 4,
  lookY: 1.2,
  ...extra,
});
/** Street-level chase, locked close behind the focus player. */
export const chase = (yaw = 90, extra: Partial<Extract<CamSpec, { mode: 'follow' }>> = {}): CamSpec => ({
  mode: 'follow',
  dist: 9,
  pitch: 10,
  yaw,
  fov: 32,
  lookY: 1.6,
  rate: 5,
  ...extra,
});
/** Game-like steep follow, ~40% tighter than the in-game framing. */
export const tight = (yaw = 90, extra: Partial<Extract<CamSpec, { mode: 'follow' }>> = {}): CamSpec => ({
  mode: 'follow',
  dist: 24,
  pitch: 56,
  yaw,
  yawSpeed: 3,
  fov: 40,
  rate: 4,
  lookY: 1,
  ...extra,
});
/** Medium follow, a bit higher, for fights that spread out. */
export const medium = (yaw = 90, extra: Partial<Extract<CamSpec, { mode: 'follow' }>> = {}): CamSpec => ({
  mode: 'follow',
  dist: 30,
  pitch: 46,
  yaw,
  yawSpeed: 4,
  fov: 42,
  rate: 3.5,
  lookY: 1,
  ...extra,
});
export const orbit = (center: Vec, radius: number, height: number, yaw: number, yawSpeed: number, extra: Partial<Extract<CamSpec, { mode: 'orbit' }>> = {}): CamSpec => ({
  mode: 'orbit',
  center,
  radius,
  height,
  yaw,
  yawSpeed,
  fov: 40,
  ...extra,
});
export const path = (keys: [number, Vec, Vec, number?][], extra: Partial<Extract<CamSpec, { mode: 'path' }>> = {}): CamSpec => ({
  mode: 'path',
  keys: keys.map(([t, pos, look, fov]) => (fov === undefined ? { t, pos, look } : { t, pos, look, fov })),
  ...extra,
});
/** Planted (or dollying) camera that pans to keep the focus player in frame. */
export const track = (keys: [number, Vec, number?][], extra: Partial<Extract<CamSpec, { mode: 'track' }>> = {}): CamSpec => ({
  mode: 'track',
  keys: keys.map(([t, pos, fov]) => (fov === undefined ? { t, pos } : { t, pos, fov })),
  ...extra,
});

/** Lobby backdrop (empty neon city, no players): recorded lobby held still. */
export const LOBBY = { rec: 'r1', start: 4, feedUntil: 8, ui: false, noShake: true } as const;
