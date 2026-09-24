// LAUNCHPAD ROYALE server entry: static files + WebSocket at /ws + the 30 Hz authoritative simulation loop.

import { networkInterfaces } from 'node:os';
import { TICK_RATE } from '../shared/constants';
import { HOST, PORT, TIME_SCALE } from './config';
import { serveStatic } from './http';
import { MAX_MESSAGE_BYTES } from './validate';
import { Room, type Conn } from './room';

interface SocketData {
  /** Room connection handle; its seat id can change when the socket resumes an older session. */
  conn: Conn | null;
}

const room = new Room(TIME_SCALE);

const server = Bun.serve<SocketData>({
  port: PORT,
  hostname: HOST,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (srv.upgrade(req, { data: { conn: null } })) return undefined;
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (url.pathname === '/health') return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    return serveStatic(url);
  },
  websocket: {
    maxPayloadLength: MAX_MESSAGE_BYTES * 4,
    idleTimeout: 60,
    sendPings: false,
    open(ws) {
      ws.data.conn = room.connect(ws);
    },
    message(ws, raw) {
      if (ws.data.conn) room.message(ws.data.conn, raw);
    },
    pong(ws) {
      if (ws.data.conn) room.pong(ws.data.conn);
    },
    close(ws) {
      if (ws.data.conn) room.disconnect(ws.data.conn);
    },
  },
});

// Drift-compensated fixed-rate loop: schedule against an absolute timeline, resync after long stalls.
const TICK_MS = 1000 / TICK_RATE;
let nextTickAt = performance.now() + TICK_MS;
function loop(): void {
  const now = performance.now();
  if (now - nextTickAt > 250) nextTickAt = now; // stalled (debugger / sleep): don't fast-forward
  try {
    room.tick();
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
console.log(`  gm. server live — ${TICK_RATE} Hz tick${fastNote}`);
console.log(`  local:  http://${allInterfaces ? 'localhost' : HOST}:${server.port}`);
for (const url of lanUrls) console.log(`  LAN:    ${url}`);
console.log('  public: run `bun run tunnel` in another terminal for a cloudflared URL\n');
