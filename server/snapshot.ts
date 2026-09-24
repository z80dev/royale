// Per-client snapshot serialization. Shared parts are stringified once per tick; only the receiver-specific
// bits (REVEALED flags for the receiver's team, self state, spectate suggestion) differ per client.

import { ST, type EntSnap, type PlayerSnap, type SelfSnap } from '../shared/protocol';
import { FIRING_FLAG_TIME } from './combat';
import { r2 } from './config';
import { findInteractTarget } from './loot';
import type { Match } from './match';
import type { Player } from './types';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function statusFlags(match: Match, p: Player): number {
  let st = 0;
  if (p.move.dashT > 0) st |= ST.DASH;
  if (p.reloadT > 0) st |= ST.RELOAD;
  if (p.channel) st |= ST.CHANNEL;
  if (p.dmgBuffT > 0) st |= ST.DMG_BUFF;
  if (p.rushT > 0) st |= ST.RUSH;
  if (p.slowT > 0) st |= ST.SLOWED;
  if (p.invulnT > 0 || (match.graceT > 0 && match.phase === 'playing')) st |= ST.INVULN;
  if (p.leap) st |= ST.LEAP;
  if (p.sinceShot < FIRING_FLAG_TIME) st |= ST.FIRING;
  if (match.phase === 'deploy' && p.y > 0) st |= ST.DEPLOYING;
  if (p.zoneHurt) st |= ST.IN_ZONE_DMG;
  if (p.laserEyes) st |= ST.LASER_EYES;
  return st;
}

function playerSnap(p: Player, st: number): PlayerSnap {
  const slot = p.slots[p.active];
  return {
    id: p.id,
    x: r2(p.move.x),
    z: r2(p.move.z),
    y: r2(p.y),
    aim: r3(p.aim),
    hp: p.alive ? Math.ceil(p.hp) : 0,
    ar: Math.ceil(p.ar),
    alive: p.alive,
    w: slot ? slot.w : null,
    st,
  };
}

function selfSnap(match: Match, p: Player): SelfSnap {
  const target = findInteractTarget(match, p);
  return {
    ack: p.lastAck,
    x: r3(p.move.x),
    z: r3(p.move.z),
    dashT: r3(p.move.dashT),
    dashCd: r3(p.move.dashCd),
    dashDx: r3(p.move.dashDx),
    dashDz: r3(p.move.dashDz),
    speedMul: match.speedMul(p),
    slots: [p.slots[0] ? { ...p.slots[0] } : null, p.slots[1] ? { ...p.slots[1] } : null],
    active: p.active,
    ammo: { ...p.ammo },
    cons: { ...p.cons },
    reload: r2(Math.max(0, p.reloadT)),
    reloadTotal: r2(p.reloadTotal),
    channel: p.channel ? { c: p.channel.c, t: r2(Math.max(0, p.channel.t)), total: p.channel.total } : null,
    abilityCd: r2(p.abilityCd),
    buffT: r2(Math.max(p.dmgBuffT, p.rushT, p.invulnT)),
    kills: p.kills,
    damage: Math.round(p.damage),
    score: Math.round(p.score),
    nearLoot: target?.kind === 'loot' ? target.item.id : null,
    nearChest: target?.kind === 'chest' ? target.chest.id : null,
  };
}

export interface SnapViewer {
  /** The viewer's player in this match (null = spectator who joined mid-match). */
  playerId: string | null;
  /** Spectate target chosen by cycling (A/D), if any. */
  specTarget: string | null;
}

/** Builds the per-tick shared JSON once, then cheap per-viewer strings. */
export class SnapshotBuilder {
  private head = '';
  private tail = '';
  private playersDefault = '';
  private readonly playersByTeam = new Map<number, string>();
  private flags: number[] = [];
  private revealTeams = new Set<number>();

  constructor(private readonly match: Match) {}

  /** Call once per tick after match.step(). */
  prepare(): void {
    const m = this.match;
    this.flags = m.players.map((p) => statusFlags(m, p));
    this.playersDefault = JSON.stringify(m.players.map((p, i) => playerSnap(p, this.flags[i]!)));
    this.playersByTeam.clear();
    this.revealTeams.clear();
    for (const p of m.players) {
      if (!p.alive) continue;
      for (const [team, until] of p.revealedTo) {
        if (until > m.time) this.revealTeams.add(team);
        else p.revealedTo.delete(team);
      }
    }
    const ents: EntSnap[] = m.ents.map((e) => {
      const snap: EntSnap = {
        id: e.id,
        k: e.k,
        x: r2(e.x),
        z: r2(e.z),
        y: r2(e.y),
        owner: e.owner,
        team: e.team,
        ttl: r2(Math.max(0, e.ttl)),
      };
      if (e.k === 'turret' || e.k === 'grenade') snap.aim = r3(e.aim);
      return snap;
    });
    const zone = m.zone;
    const zoneSnap = {
      ...zone,
      cx: r2(zone.cx),
      cz: r2(zone.cz),
      r: r2(zone.r),
      ncx: r2(zone.ncx),
      ncz: r2(zone.ncz),
      nr: r2(zone.nr),
      t: r2(zone.t),
    };
    const phaseT = m.phase === 'playing' ? 0 : r2(m.phaseT);
    this.head =
      `{"t":"snap","tick":${m.tick},"time":${Date.now()},"phase":"${m.phase}","phaseT":${phaseT},` +
      `"matchTime":${r2(m.time)},"players":`;
    this.tail =
      `,"ents":${JSON.stringify(ents)},"zone":${JSON.stringify(zoneSnap)},` +
      `"aliveCount":${m.aliveCount()},"teamsAlive":${m.teamsAlive()},"ev":${JSON.stringify(m.events)}`;
  }

  private playersFor(team: number): string {
    if (!this.revealTeams.has(team)) return this.playersDefault;
    let json = this.playersByTeam.get(team);
    if (json !== undefined) return json;
    const m = this.match;
    json = JSON.stringify(
      m.players.map((p, i) => {
        const revealed = p.team !== team && (p.revealedTo.get(team) ?? 0) > m.time;
        return playerSnap(p, revealed ? this.flags[i]! | ST.REVEALED : this.flags[i]!);
      }),
    );
    this.playersByTeam.set(team, json);
    return json;
  }

  forViewer(viewer: SnapViewer): string {
    const m = this.match;
    const me = viewer.playerId ? m.playerById(viewer.playerId) : undefined;
    const self = me && me.alive ? JSON.stringify(selfSnap(m, me)) : 'null';
    const spec = me?.alive ? null : this.spectateSuggestion(me ?? null, viewer.specTarget);
    return (
      this.head +
      this.playersFor(me ? me.team : -1) +
      this.tail +
      `,"self":${self},"spectating":${spec === null ? 'null' : JSON.stringify(spec)}}`
    );
  }

  /** Chosen target → killer → living teammate → anyone alive. */
  spectateSuggestion(me: Player | null, chosen: string | null): string | null {
    const m = this.match;
    const alive = (id: string | null | undefined) => {
      const p = id ? m.playerById(id) : undefined;
      return p && p.alive ? p.id : null;
    };
    const picked = alive(chosen);
    if (picked) return picked;
    if (me) {
      const killer = alive(me.killedBy);
      if (killer) return killer;
      const mate = m.players.find((p) => p.alive && p.team === me.team);
      if (mate) return mate.id;
    }
    const anyone = m.players.find((p) => p.alive);
    return anyone ? anyone.id : null;
  }
}
