// Summarizes a recording: phase changes, notable events (kills, abilities, booms, rugs, airdrops, legendaries,
// zone), with virtual time (s) and positions, so clips can be picked on action.
// Usage: bun films/promo/capture/analyze.ts <rec.ndjson> [--all]

import { readFileSync } from 'node:fs';
import type { GameEvent, ServerMsg } from '../../../shared/protocol';

const file = process.argv[2]!;
const all = process.argv.includes('--all');
const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
let phase = '';
const names = new Map<string, string>();
const chars = new Map<string, string>();
const out: string[] = [];
const counts = new Map<string, number>();
for (const line of lines) {
  const { t, m } = JSON.parse(line) as { t: number; m: ServerMsg };
  const ts = (t / 1000).toFixed(2).padStart(7);
  if (m.t === 'match') {
    for (const r of m.roster) {
      names.set(r.id, r.name);
      chars.set(r.id, r.character);
    }
    out.push(`${ts} MATCH seed ${m.seed} players ${m.roster.length} you=${m.you}`);
  } else if (m.t === 'lobby') {
    if (m.phase !== phase) out.push(`${ts} LOBBY phase ${m.phase} countdown ${m.countdown}`);
    phase = m.phase;
  } else if (m.t === 'end') {
    out.push(`${ts} END winnerTeam ${m.winnerTeam} top ${m.results.slice(0, 3).map((r) => `${r.name}(${r.character},${r.kills}k)`).join(' ')}`);
  } else if (m.t === 'snap') {
    if (m.phase !== phase) {
      out.push(`${ts} PHASE ${m.phase} alive ${m.aliveCount}`);
      phase = m.phase;
    }
    for (const e of m.ev as GameEvent[]) {
      counts.set(e.e, (counts.get(e.e) ?? 0) + 1);
      const who = (id: string | null | undefined) => (id ? `${names.get(id) ?? id}[${id}/${chars.get(id) ?? '?'}]` : '-');
      const pos = (id: string) => {
        const p = m.players.find((q) => q.id === id);
        return p ? `@(${p.x.toFixed(0)},${p.z.toFixed(0)})` : '';
      };
      switch (e.e) {
        case 'kill': out.push(`${ts} KILL ${who(e.killer)} ${e.verb} ${who(e.victim)} ${pos(e.victim)} w=${e.w} cause=${e.cause} alive=${m.aliveCount}`); break;
        case 'ability': out.push(`${ts} ABILITY ${e.kind} by ${who(e.by)} @(${e.x.toFixed(0)},${e.z.toFixed(0)})`); break;
        case 'boom': if (all) out.push(`${ts} BOOM r=${e.r} @(${e.x.toFixed(0)},${e.z.toFixed(0)}) by ${who(e.by)}`); break;
        case 'chest': out.push(`${ts} CHEST ${e.rug ? 'RUG' : 'open'} by ${who(e.by)} ${pos(e.by)}`); break;
        case 'airdrop': out.push(`${ts} AIRDROP incoming @(${e.x.toFixed(0)},${e.z.toFixed(0)})`); break;
        case 'pickup': if (e.rarity >= 3 || all) out.push(`${ts} PICKUP ${e.label} r${e.rarity} by ${who(e.by)} ${pos(e.by)}`); break;
        case 'zone': out.push(`${ts} ZONE phase ${e.phase} shrinking=${e.shrinking} ${e.msg} r=${m.zone.r}`); break;
        case 'announce': out.push(`${ts} ANNOUNCE ${e.text} | ${e.sub ?? ''}`); break;
        case 'teamOut': break;
        case 'shot': if (e.w === 'laser' || all) out.push(`${ts} SHOT ${e.w} by ${who(e.by)}`); break;
        default: break;
      }
    }
  }
}
console.log(out.join('\n'));
console.log('event counts', Object.fromEntries(counts));
