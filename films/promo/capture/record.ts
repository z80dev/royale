// Records one full LAUNCHPAD ROYALE round (lobby → countdown → deploy → match → results) with the real server code,
// simulated faster than real time on a virtual clock. Every "human" is a fake socket; once the match starts they are
// handed to the server AI, so the whole lobby is bots (skill 2 = Whale) and the round plays itself.
//
// Output (NDJSON, one line per message the host socket received):
//   {"t":<virtual ms since start>,"m":<ServerMsg>,"s":{<playerId>:<SelfSnap>,…}}   ("s" only on snapshots)
// "s" carries the private self state of EVERY living player, so the replay can make any player "you".
//
// Usage: bun films/promo/capture/record.ts <out.ndjson> [--team 1] [--fill 24] [--skill 2] [--scale 1] [--seed-tag x]

import { appendFileSync, writeFileSync } from 'node:fs';
import { TICK_RATE, type CharacterId } from '../../../shared/constants';
import { Room, type Conn } from '../../../server/room';

const args = process.argv.slice(2);
const out = args[0];
if (!out) throw new Error('usage: record.ts <out.ndjson> [--team n] [--fill n] [--skill 0|1|2] [--scale s]');
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const teamSize = flag('team', 1);
const fillTo = flag('fill', 24);
const botSkill = flag('skill', 2) as 0 | 1 | 2;
const timeScale = flag('scale', 1);

// Virtual clock: the server reads Date.now() for snapshot timestamps, lobby broadcasts and chat scheduling.
const DATE0 = Date.parse('2026-09-24T20:00:00Z');
let vms = 0;
Date.now = () => DATE0 + Math.round(vms);

const TICK_MS = 1000 / TICK_RATE;
const room = new Room('DEGENS', 'private', timeScale);
/** Unchecked view of Room internals the harness drives (private in TS, plain fields at runtime). */
const internals = room as unknown as {
  match: {
    phase: string;
    over: boolean;
    players: { id: string; alive: boolean }[];
    handOffToAi(id: string): void;
    announce(...args: unknown[]): void;
    humansAlive(): number;
  } | null;
  snaps: { forViewer(v: { playerId: string | null; specTarget: string | null }): string } | null;
};

writeFileSync(out, '');
let buffer: string[] = [];
const flush = (): void => {
  if (buffer.length) appendFileSync(out, buffer.join(''));
  buffer = [];
};

const HUMANS: { name: string; character: CharacterId }[] = [
  { name: 'doppler.lol', character: 'doppler' },
  { name: 'gm_anon', character: 'uniswap' },
  { name: 'ser_liquid', character: 'zora' },
  { name: 'moonboi', character: 'pump' },
  { name: 'based_ben', character: 'clanker' },
  { name: 'fomo_fiona', character: 'fomo' },
  { name: 'long_larry', character: 'long' },
  { name: 'jumpman', character: 'jump' },
  { name: 'ponsfam', character: 'pons' },
  { name: 'bankr_bot', character: 'bankr' },
];

const conns: Conn[] = [];
// Host socket = the recorder: its stream is what the replay feeds the client.
let hostSnaps = 0;
const hostSocket = {
  send(data: string): void {
    const t = vms.toFixed(1);
    if (data.startsWith('{"t":"snap"') && internals.match && internals.snaps) {
      const selves: string[] = [];
      for (const p of internals.match.players) {
        if (!p.alive) continue;
        const view = internals.snaps.forViewer({ playerId: p.id, specTarget: null });
        const start = view.lastIndexOf(',"self":') + 8;
        const end = view.lastIndexOf(',"spectating":');
        selves.push(`"${p.id}":${view.slice(start, end)}`);
      }
      buffer.push(`{"t":${t},"m":${data},"s":{${selves.join(',')}}}\n`);
      hostSnaps++;
    } else {
      buffer.push(`{"t":${t},"m":${data}}\n`);
    }
  },
  ping(): void {},
  close(): void {},
};
const muteSocket = { send(): void {}, ping(): void {}, close(): void {} };

const say = (conn: Conn, msg: object): void => room.message(conn, JSON.stringify(msg));

// Scripted lobby: humans trickle in, pick brands, the host sets Whale bots + fill, everyone readies up.
type Step = { at: number; run: () => void };
const script: Step[] = [];
HUMANS.forEach((h, i) => {
  script.push({
    at: 300 + i * 450,
    run: () => {
      const conn = room.connect(i === 0 ? hostSocket : muteSocket);
      conns[i] = conn;
      say(conn, { t: 'join', name: h.name, character: h.character, sid: `rec-${i}` });
      if (i === 0) say(conn, { t: 'settings', teamSize, fillTo, botSkill });
    },
  });
});
HUMANS.forEach((_, i) => {
  script.push({ at: 5200 + i * 380, run: () => say(conns[i]!, { t: 'lobbySet', ready: true }) });
});
script.sort((a, b) => a.at - b.at);

let handedOff = false;
let endedAt = -1;
const LIMIT_MS = 20 * 60 * 1000;
while (vms < LIMIT_MS) {
  while (script.length && script[0]!.at <= vms) script.shift()!.run();
  room.tick();
  const match = internals.match;
  if (match && !handedOff) {
    // Silent hand-off (no "Clanker AI took the wheel" banners), and keep the zone at its normal pace: the server
    // fast-forwards it ×3 once no un-automated human is alive, which would be every tick here.
    const announce = match.announce;
    match.announce = () => {};
    for (const c of conns) match.handOffToAi(c.id);
    match.announce = announce;
    match.humansAlive = () => 1;
    handedOff = true;
  }
  if (match?.phase === 'ended' && endedAt < 0) endedAt = vms;
  if (endedAt >= 0 && !match) {
    // back in the lobby: keep 3 s of the lobby return, then stop
    if (vms - endedAt > 17_000) break;
  }
  vms += TICK_MS;
  if (buffer.length > 200) flush();
}
flush();
console.log(`recorded ${(vms / 1000).toFixed(1)} s virtual, ${hostSnaps} snapshots → ${out}`);
