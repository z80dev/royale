// Strict parsing of untrusted client messages. Anything malformed returns null and is ignored.

import { CHARACTER_BY_ID, MAX_TEAM_SIZE, MAX_PLAYERS, type CharacterId } from '../shared/constants';
import { EMOTES, type ClientMsg } from '../shared/protocol';

export const MAX_MESSAGE_BYTES = 2048;
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 140;
const MAX_SEQ = 2 ** 31;
const MAX_COORD = 1000;
const ACTS = new Set(['reload', 'interact', 'slot', 'swap', 'stable', 'medkit', 'ability', 'drop', 'cancel']);
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isCharacterId(v: unknown): v is CharacterId {
  return typeof v === 'string' && Object.hasOwn(CHARACTER_BY_ID, v);
}

/** Strip control chars / zero-width junk, collapse whitespace, trim, cap length. */
export function sanitizeText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .slice(0, max * 4)
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function sanitizeName(v: unknown): string {
  return sanitizeText(v, MAX_NAME_LENGTH).replace(/[<>]/g, '');
}

/** Normalize an angle to (−π, π]. */
function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

const clampNum = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function parseClientMsg(raw: string | Buffer): ClientMsg | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (text.length > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || typeof data.t !== 'string') return null;
  switch (data.t) {
    case 'in': {
      const { seq, mx, mz, aim } = data;
      if (!finite(seq) || !finite(mx) || !finite(mz) || !finite(aim)) return null;
      if (seq < 0 || seq > MAX_SEQ) return null;
      return {
        t: 'in',
        seq: Math.floor(seq),
        mx: clampNum(mx, -1, 1),
        mz: clampNum(mz, -1, 1),
        aim: wrapAngle(aim),
        fire: data.fire === true,
        dash: data.dash === true,
      };
    }
    case 'act': {
      if (typeof data.a !== 'string' || !ACTS.has(data.a)) return null;
      const msg: Extract<ClientMsg, { t: 'act' }> = { t: 'act', a: data.a as Extract<ClientMsg, { t: 'act' }>['a'] };
      if (data.v === 0 || data.v === 1) msg.v = data.v;
      if (finite(data.x) && finite(data.z)) {
        msg.x = clampNum(data.x, -MAX_COORD, MAX_COORD);
        msg.z = clampNum(data.z, -MAX_COORD, MAX_COORD);
      }
      return msg;
    }
    case 'join': {
      const msg: Extract<ClientMsg, { t: 'join' }> = { t: 'join', name: sanitizeName(data.name) };
      if (isCharacterId(data.character)) msg.character = data.character;
      if (typeof data.sid === 'string' && SESSION_ID.test(data.sid)) msg.sid = data.sid;
      return msg;
    }
    case 'lobbySet': {
      const msg: Extract<ClientMsg, { t: 'lobbySet' }> = { t: 'lobbySet' };
      if (typeof data.name === 'string') msg.name = sanitizeName(data.name);
      if (isCharacterId(data.character)) msg.character = data.character;
      if (finite(data.team)) msg.team = clampNum(Math.floor(data.team), 0, MAX_PLAYERS);
      if (typeof data.ready === 'boolean') msg.ready = data.ready;
      return msg;
    }
    case 'settings': {
      const msg: Extract<ClientMsg, { t: 'settings' }> = { t: 'settings' };
      if (finite(data.teamSize)) msg.teamSize = clampNum(Math.floor(data.teamSize), 1, MAX_TEAM_SIZE);
      if (finite(data.fillTo)) msg.fillTo = clampNum(Math.floor(data.fillTo), 1, MAX_PLAYERS);
      if (data.botSkill === 0 || data.botSkill === 1 || data.botSkill === 2) msg.botSkill = data.botSkill;
      return msg;
    }
    case 'start':
      return { t: 'start' };
    case 'deploy':
      if (!finite(data.x) || !finite(data.z)) return null;
      return { t: 'deploy', x: clampNum(data.x, -MAX_COORD, MAX_COORD), z: clampNum(data.z, -MAX_COORD, MAX_COORD) };
    case 'spectate':
      return data.dir === 1 || data.dir === -1 ? { t: 'spectate', dir: data.dir } : null;
    case 'emote':
      if (!finite(data.i) || !Number.isInteger(data.i) || data.i < 0 || data.i >= EMOTES.length) return null;
      return { t: 'emote', i: data.i };
    case 'chat': {
      const text = sanitizeText(data.text, MAX_CHAT_LENGTH);
      return text ? { t: 'chat', text } : null;
    }
    case 'ping':
      return finite(data.c) ? { t: 'ping', c: data.c } : null;
    default:
      return null;
  }
}
