// Where the game server lives. Resolution order:
// 1. `?server=wss://…/ws` query param (testing against another backend)
// 2. LR_SERVER_URL baked in at build time (`bun run build:pages` → the public Cloudflare front door)
// 3. same origin (`bun run start` serves the client from the game server itself)

import type { RoomVisibility } from '../shared/protocol';

declare const LR_SERVER_URL: string | undefined;

export function serverUrl(): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  if (typeof LR_SERVER_URL === 'string' && LR_SERVER_URL) return LR_SERVER_URL;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** Which room a socket targets: an existing room code, or a new room to create. */
export type RoomTarget = { room: string } | { create: RoomVisibility };

/** WebSocket URL for joining / creating a room (keeps any query already on the server URL). */
export function socketUrl(target: RoomTarget): string {
  const url = new URL(serverUrl());
  if ('room' in target) url.searchParams.set('room', target.room);
  else url.searchParams.set('create', target.create);
  return url.toString();
}

/** HTTP URL of the public room list (GET → RoomList), derived from the socket URL: wss→https, ws→http, /ws→/rooms. */
export function roomsUrl(): string {
  const url = new URL(serverUrl());
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/ws\/?$/, '') + '/rooms';
  url.search = '';
  return url.toString();
}

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

/** Room code from the URL hash (`#CODE`, case-insensitive), or null when the hash is not a room code. */
export function roomFromHash(): string | null {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/** Replace the URL hash without a reload or a history entry (null clears it). The URL is the invite link. */
export function setRoomHash(code: string | null): void {
  const url = new URL(location.href);
  url.hash = code ? code : '';
  history.replaceState(history.state, '', code ? url.toString() : url.toString().replace(/#$/, ''));
}
