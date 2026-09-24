// LAUNCHPAD ROYALE server entry: static files, `GET /rooms`, WebSocket at /ws (?room=CODE | ?create=…) and the
// single 30 Hz loop that ticks every room.

import { networkInterfaces } from 'node:os';
import { TICK_RATE } from '../shared/constants';
import type { ServerMsg } from '../shared/protocol';
import { HOST, MAX_ROOMS, PORT, TIME_SCALE } from './config';
import { serveStatic } from './http';
import { MAX_MESSAGE_BYTES } from './validate';
import type { Conn, Room } from './room';
import { RoomRegistry } from './rooms';

interface SocketData {
  /** Query string of the upgrade request; routed to a room when the socket opens. */
  query: string;
  room: Room | null;
  /** Room connection handle; its seat id can change when the socket resumes an older session. */
  conn: Conn | null;
}

const registry = new RoomRegistry(TIME_SCALE);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = Bun.serve<SocketData>({
  port: PORT,
  hostname: HOST,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (srv.upgrade(req, { data: { query: url.search, room: null, conn: null } })) return undefined;
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (url.pathname === '/health') return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname === '/rooms') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      return Response.json(registry.publicList(), { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    return serveStatic(url);
  },
  websocket: {
    maxPayloadLength: MAX_MESSAGE_BYTES * 4,
    idleTimeout: 60,
    sendPings: false,
    open(ws) {
      const route = registry.route(new URLSearchParams(ws.data.query));
      if ('error' in route) {
        const msg: ServerMsg = { t: 'roomError', reason: route.error };
        ws.send(JSON.stringify(msg));
        ws.close(1000, route.error);
        return;
      }
      ws.data.room = route.room;
      ws.data.conn = route.room.connect(ws);
    },
    message(ws, raw) {
      if (ws.data.room && ws.data.conn) ws.data.room.message(ws.data.conn, raw);
    },
    pong(ws) {
      if (ws.data.room && ws.data.conn) ws.data.room.pong(ws.data.conn);
    },
    close(ws) {
      if (ws.data.room && ws.data.conn) ws.data.room.disconnect(ws.data.conn);
    },
  },
});

// Drift-compensated fixed-rate loop: schedule against an absolute timeline, resync after long stalls.
// Per-room errors are contained inside registry.tick().
const TICK_MS = 1000 / TICK_RATE;
let nextTickAt = performance.now() + TICK_MS;
function loop(): void {
  const now = performance.now();
  if (now - nextTickAt > 250) nextTickAt = now; // stalled (debugger / sleep): don't fast-forward
  try {
    registry.tick();
  } catch (err) {
    console.error('[tick] error', err);
  }
  nextTickAt += TICK_MS;
  setTimeout(loop, Math.max(0, nextTickAt - performance.now()));
}
setTimeout(loop, TICK_MS);

// LAN URLs only make sense when listening on every interface (not e.g. HOST=127.0.0.1 behind a proxy).
const allInterfaces = HOST === '0.0.0.0' || HOST === '::';
const lanUrls = allInterfaces
  ? Object.values(networkInterfaces())
      .flat()
      .filter((info) => info && info.family === 'IPv4' && !info.internal)
      .map((info) => `http://${info!.address}:${server.port}`)
  : [];

console.log(`
  ▗▖    ▗▄▖ ▗▖ ▗▖▗▖  ▗▖ ▗▄▄▖▗▖ ▗▖▗▄▄▖  ▗▄▖ ▗▄▄▄     ▗▄▄▖  ▗▄▖▗▖  ▗▖ ▗▄▖ ▗▖   ▗▄▄▄▖
  ▐▌   ▐▌ ▐▌▐▌ ▐▌▐▛▚▖▐▌▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌▐▌  █    ▐▌ ▐▌▐▌ ▐▌▝▚▞▘ ▐▌ ▐▌▐▌   ▐▌
  ▐▌   ▐▛▀▜▌▐▌ ▐▌▐▌ ▝▜▌▐▌   ▐▛▀▜▌▐▛▀▘ ▐▛▀▜▌▐▌  █    ▐▛▀▚▖▐▌ ▐▌ ▐▌  ▐▛▀▜▌▐▌   ▐▛▀▀▘
  ▐▙▄▄▖▐▌ ▐▌▝▚▄▞▘▐▌  ▐▌▝▚▄▄▖▐▌ ▐▌▐▌   ▐▌ ▐▌▐▙▄▄▀    ▐▌ ▐▌▝▚▄▞▘ ▐▌  ▐▌ ▐▌▐▙▄▄▖▐▙▄▄▖
`);
const fastNote = TIME_SCALE !== 1 ? ` · LR_FAST time scale ×${TIME_SCALE}` : '';
console.log(`  gm. server live — ${TICK_RATE} Hz tick${fastNote} · up to ${MAX_ROOMS} rooms`);
console.log('  rooms:  /ws?create=public|private · /ws?room=CODE · GET /rooms · GET /health');
console.log(`  local:  http://${allInterfaces ? 'localhost' : HOST}:${server.port}`);
for (const url of lanUrls) console.log(`  LAN:    ${url}`);
console.log('  public: run `bun run tunnel` in another terminal for a cloudflared URL\n');
