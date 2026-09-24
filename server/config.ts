// Server-side runtime knobs (env) and small shared helpers.

import { CHARACTER_BY_ID, type CharacterId } from '../shared/constants';

export const PORT = Math.max(1, Math.min(65535, Math.floor(Number(process.env.PORT) || 3000)));
export const HOST = process.env.HOST || '0.0.0.0';

/**
 * LR_FAST=1 compresses the whole match for testing: phase timers, zone waits/shrinks and airdrop times are
 * scaled by 0.2. LR_FAST=<number> uses that number as the scale directly (e.g. LR_FAST=0.5).
 */
function parseTimeScale(raw: string | undefined): number {
  if (!raw) return 1;
  if (raw === '1' || raw === 'true') return 0.2;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0.01 && n <= 1 ? n : 1;
}
export const TIME_SCALE = parseTimeScale(process.env.LR_FAST);

/** Ready check: once any human is ready, the match auto-launches after this many seconds (× time scale)… */
export const READY_TIMEOUT = 45;
/** …with a "launching soon" reminder at this many seconds left. */
export const READY_WARNING = 10;
/** Seconds a disconnected human's seat (lobby spot / in-match player) is held for a reconnect (× time scale). */
export const RECONNECT_GRACE = 90;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const randInt = (n: number): number => Math.floor(Math.random() * n);

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

export const brandColor = (id: CharacterId): string => CHARACTER_BY_ID[id]?.primary ?? '#FFFFFF';

/** Round to 2 decimals for compact JSON. */
export const r2 = (v: number): number => Math.round(v * 100) / 100;
