// GameEvent → VFX. Every effect is composed from the pooled primitives in ./fx (no per-event allocations
// beyond pooled slot reuse).

import * as THREE from 'three';
import {
  CHARACTERS,
  WEAPONS,
  type AbilityKind,
  type CharacterDef,
  type WeaponId,
} from '../../../shared/constants';
import type { GameEvent } from '../../../shared/protocol';
import type { FrameView } from '../../view';
import type { CharacterRig, Afterimages } from './characters';
import { brandGlowColor, brandTrim, clamp, col, FX_COLORS, rarityColor, TAU } from './common';
import type { EntRenderer } from './ents';
import type { Fx } from './fx';
import { ShellStyle } from './fx/batches';
import { DebrisKind } from './fx/debris';
import { P } from './fx/presets';
import { lootRarity, type ChestRenderer } from './items';
import { SHOT_Y } from './projectiles';

export interface EventHost {
  fx: Fx;
  afterimages: Afterimages;
  chests: ChestRenderer;
  ents: EntRenderer;
  rig(playerId: string): CharacterRig | undefined;
  shake(amount: number, x: number, z: number): void;
  time(): number;
}

/** Character that owns each ability kind (abilities are unique per brand). */
const ABILITY_OWNER = Object.fromEntries(CHARACTERS.map((c) => [c.ability.kind, c])) as Record<
  AbilityKind,
  CharacterDef
>;

/** Server 'shot' echoes of locally-predicted muzzle flashes arriving within this window are skipped. */
const LOCAL_ECHO_WINDOW_MS = 400;
/** Shots from one player this close together are one volley (shotgun pellets) → one flash. */
const VOLLEY_MS = 12;
const MUZZLE_LIGHT_RANGE = 38;
const KILL_WORDS = ['NGMI', 'REKT', 'NGMI', '-100%', 'GG NO RE', 'REKT'] as const;

const tmpVec = new THREE.Vector3();
const fireCore = FX_COLORS.fireCore;
const pumpCore = col('#d9ffe6');

export class EventFx {
  private readonly host: EventHost;
  /** Locally predicted flashes not yet matched by a server 'shot' (per player). */
  private readonly localPending = new Map<string, { count: number; at: number }>();
  /** Time of the last server-shot flash per player (volley dedupe). */
  private readonly lastShotFx = new Map<string, number>();
  private focusX = 0;
  private focusZ = 0;

  constructor(host: EventHost) {
    this.host = host;
  }

  clear(): void {
    this.localPending.clear();
    this.lastShotFx.clear();
  }

  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
  }

  /** Immediate local-fire feedback (called before the server confirms the shot). */
  localMuzzle(playerId: string): void {
    const rig = this.host.rig(playerId);
    if (!rig || !rig.alive || !rig.weaponId) return;
    const now = performance.now();
    let pending = this.localPending.get(playerId);
    if (!pending) {
      pending = { count: 0, at: now };
      this.localPending.set(playerId, pending);
    }
    pending.count = (now - pending.at < LOCAL_ECHO_WINDOW_MS ? pending.count : 0) + 1;
    pending.at = now;
    rig.kick(WEAPONS[rig.weaponId].kick);
    rig.muzzleWorld(tmpVec);
    this.muzzleFx(tmpVec.x, tmpVec.y, tmpVec.z, Math.cos(rig.aim), Math.sin(rig.aim), rig.weaponId);
  }

  handle(ev: GameEvent, view: FrameView): void {
    const { fx } = this.host;
    switch (ev.e) {
      case 'shot':
        this.onShot(ev);
        break;
      case 'hit':
        this.onHit(ev, view);
        break;
      case 'impact': {
        const proj = view.projectiles.find((p) => p.id === ev.id);
        const color = proj ? col(WEAPONS[proj.w].color) : FX_COLORS.fireCore;
        if (ev.nx !== 0 || ev.nz !== 0) {
          fx.burst(P.spark, ev.x, SHOT_Y, ev.z, color, 10, ev.nx, 0.35, ev.nz);
          fx.burst(P.spark, ev.x, SHOT_Y, ev.z, FX_COLORS.fireCore, 4, ev.nx, 0.6, ev.nz, 0.8);
          fx.burst(P.flash, ev.x + ev.nx * 0.05, SHOT_Y, ev.z + ev.nz * 0.05, color, 1, 0, 0, 0, 0.5);
          fx.burst(P.puff, ev.x + ev.nx * 0.2, SHOT_Y, ev.z + ev.nz * 0.2, FX_COLORS.dust, 2, ev.nx, 0.2, ev.nz, 0.8);
        } else {
          fx.burst(P.ember, ev.x, SHOT_Y, ev.z, color, 3, 0, 0, 0, 0.6);
        }
        break;
      }
      case 'boom':
        this.explosion(ev.x, ev.z, ev.r, ev.by);
        break;
      case 'kill':
        this.onKill(ev, view);
        break;
      case 'lootAdd': {
        const rc = rarityColor(lootRarity(ev.item));
        fx.burst(P.sparkle, ev.item.x, 0.8, ev.item.z, rc, 6, 0, 0, 0, 0.8);
        fx.ring(ev.item.x, 0.08, ev.item.z, 0.2, 1.1, 0.4, rc, 2.6, 0.2);
        break;
      }
      case 'pickup': {
        const rig = this.host.rig(ev.by);
        if (!rig) break;
        const rc = rarityColor(ev.rarity);
        fx.burst(P.sparkle, rig.x, rig.y + 0.9, rig.z, rc, 8 + ev.rarity * 6);
        fx.ring(rig.x, 0.08, rig.z, 0.3, 1.6 + ev.rarity * 0.3, 0.45, rc, 3, 0.18);
        fx.beam(rig.x, 0.05, rig.z, rig.x, 2.5 + ev.rarity * 1.2, rig.z, 0.5, rc, 0.45, 2.4, 0.8, 0.4, 0.1);
        if (ev.rarity >= 3) {
          fx.burst(P.coinGlint, rig.x, 1.2, rig.z, rc, 6);
          fx.lights.flash(rig.x, 2, rig.z, rc, 30, 0.35, 12, 1);
        }
        break;
      }
      case 'chest':
        this.onChest(ev.id, ev.rug, view);
        break;
      case 'chestAdd':
        if (ev.chest.airdrop) {
          const { x, z } = ev.chest;
          fx.burst(P.dust, x, 0.3, z, FX_COLORS.dust, 36, 0, 0, 0, 1.6);
          fx.ring(x, 0.08, z, 0.5, 6, 0.7, FX_COLORS.white, 2, 0.08);
          fx.ring(x, 0.08, z, 0.5, 4, 1.1, rarityColor(4), 3, 0.15, 1, 0, 0, 0.5);
          fx.debris.burst(DebrisKind.Chunk, x, 0.3, z, 12, FX_COLORS.dust, 8, 7, 1.4, 0.9);
          fx.burst(P.sparkle, x, 1.2, z, rarityColor(4), 24, 0, 0, 0, 1.5);
          this.host.shake(0.55, x, z);
        }
        break;
      case 'ability':
        this.onAbility(ev);
        break;
      case 'reload': {
        const rig = this.host.rig(ev.by);
        if (!rig || !rig.alive) break;
        // Spent magazine clatters to the floor.
        fx.debris.one(DebrisKind.Chunk, rig.x, 1.0, rig.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1.4,
          FX_COLORS.smokeDark, 0.5);
        break;
      }
      case 'heal': {
        const rig = this.host.rig(ev.by);
        if (!rig) break;
        if (ev.hp > 0) {
          fx.burst(P.plus, rig.x, rig.y + 0.8, rig.z, FX_COLORS.heal, 12);
          const heal = FX_COLORS.heal;
          fx.shell(rig.x, rig.y + 1, rig.z, 0.6, 1.6, 0.45, ShellStyle.Glow, heal, heal, 1.3, 0.6, 0.15);
        }
        if (ev.armor > 0) {
          fx.burst(P.shard, rig.x, rig.y + 1.1, rig.z, FX_COLORS.armor, 12, 0, 0, 0, 0.8);
          const armor = FX_COLORS.armor;
          fx.shell(rig.x, rig.y + 1, rig.z, 0.8, 1.5, 0.35, ShellStyle.Glow, armor, armor, 1.3, 0.6, 0.1);
        }
        const ringColor = ev.armor > 0 && ev.hp <= 0 ? FX_COLORS.armor : FX_COLORS.heal;
        fx.ring(rig.x, 0.08, rig.z, 0.4, 2, 0.6, ringColor, 2.6, 0.15);
        break;
      }
      case 'dash': {
        const rig = this.host.rig(ev.by);
        if (!rig) break;
        fx.burst(P.dust, rig.x, 0.2, rig.z, FX_COLORS.dust, 8, 0, 0, 0, 0.6);
        fx.burst(P.spark, rig.x, 0.6, rig.z, rig.secondary, 10, -Math.cos(rig.aim), 0.2, -Math.sin(rig.aim), 0.8);
        fx.ring(rig.x, 0.08, rig.z, 0.3, 1.8, 0.35, rig.secondary, 2.6, 0.15);
        break;
      }
      case 'land': {
        const rig = this.host.rig(ev.by);
        if (!rig) break;
        fx.burst(P.dust, rig.x, 0.2, rig.z, FX_COLORS.dust, 22, 0, 0, 0, 1.1);
        fx.ring(rig.x, 0.08, rig.z, 0.4, 3.2, 0.6, FX_COLORS.white, 1.8, 0.1);
        fx.ring(rig.x, 0.08, rig.z, 0.2, 2.2, 0.5, rig.secondary, 2.6, 0.2);
        this.host.shake(0.25, rig.x, rig.z);
        break;
      }
      case 'airdrop': {
        const red = FX_COLORS.danger;
        fx.burst(P.flash, ev.x, 0.5, ev.z, red, 2, 0, 0, 0, 2.5);
        fx.burst(P.ember, ev.x, 0.3, ev.z, red, 40, 0, 1, 0, 1.6);
        fx.ring(ev.x, 0.08, ev.z, 0.5, 7, 1.2, red, 3, 0.06);
        fx.beam(ev.x, 0.05, ev.z, ev.x, 70, ev.z, 1.4, red, 1.6, 3, 1, 0.8, 0.4);
        fx.lights.flash(ev.x, 3, ev.z, red, 60, 1, 30, 2);
        break;
      }
      case 'emote': {
        const rig = this.host.rig(ev.by);
        if (!rig || !rig.alive) break;
        fx.burst(P.confetti, rig.x, rig.y + 2.4, rig.z, rig.glow, 14);
        fx.burst(P.confetti, rig.x, rig.y + 2.4, rig.z, rig.secondary, 14);
        fx.burst(P.ringPop, rig.x, rig.y + 2.5, rig.z, rig.secondary, 1, 0, 0, 0, 1.2);
        fx.burst(P.sparkle, rig.x, rig.y + 2.3, rig.z, FX_COLORS.white, 6);
        break;
      }
      case 'lootDel':
      case 'teamOut':
      case 'zone':
      case 'announce':
        break;
    }
  }

  private onShot(ev: Extract<GameEvent, { e: 'shot' }>): void {
    if (ev.turret !== undefined) {
      if (this.host.ents.turretFired(ev.turret, tmpVec)) {
        this.muzzleFx(tmpVec.x, tmpVec.y, tmpVec.z, ev.dx, ev.dz, ev.w);
      }
      return;
    }
    const now = performance.now();
    if (now - (this.lastShotFx.get(ev.by) ?? -Infinity) < VOLLEY_MS) return;
    this.lastShotFx.set(ev.by, now);
    const pending = this.localPending.get(ev.by);
    if (pending && pending.count > 0 && now - pending.at < LOCAL_ECHO_WINDOW_MS) {
      pending.count--;
      return;
    }
    const rig = this.host.rig(ev.by);
    if (rig && rig.alive) {
      rig.kick(WEAPONS[ev.w].kick);
      rig.muzzleWorld(tmpVec);
      // Trust the rig's muzzle unless the snapshot origin is far from it (teleports / late joins).
      if (Math.hypot(tmpVec.x - ev.x, tmpVec.z - ev.z) > 2.5) tmpVec.set(ev.x, SHOT_Y, ev.z);
    } else tmpVec.set(ev.x, SHOT_Y, ev.z);
    this.muzzleFx(tmpVec.x, tmpVec.y, tmpVec.z, ev.dx, ev.dz, ev.w);
  }

  private muzzleFx(x: number, y: number, z: number, dx: number, dz: number, w: WeaponId): void {
    const { fx } = this.host;
    const color = col(WEAPONS[w].color);
    const big = w === 'shotgun' || w === 'sniper' || w === 'rocket' || w === 'laser';
    fx.burst(P.flash, x, y, z, color, 1, 0, 0, 0, big ? 1.5 : 0.9);
    fx.burst(P.flash, x + dx * 0.25, y, z + dz * 0.25, FX_COLORS.white, 1, 0, 0, 0, big ? 0.9 : 0.5);
    fx.burst(P.spark, x, y, z, color, big ? 10 : 4, dx, 0.05, dz, big ? 1.1 : 0.7);
    if (w === 'shotgun' || w === 'rocket' || w === 'sniper') {
      fx.burst(P.puff, x + dx * 0.4, y, z + dz * 0.4, FX_COLORS.dust, 3, dx, 0.3, dz);
    }
    if (w === 'rocket') {
      // Back-blast out of the tube's rear.
      fx.burst(P.smoke, x - dx * 1.2, y, z - dz * 1.2, FX_COLORS.smoke, 5, -dx, 0.2, -dz, 0.7);
      fx.burst(P.fire, x - dx * 1.1, y, z - dz * 1.1, FX_COLORS.fire, 4, -dx, 0, -dz, 0.5);
    } else if (w === 'laser') {
      fx.ring(x, y, z, 0.1, 0.9, 0.25, color, 3, 0.25);
    } else {
      // Brass casing ejected to the right of the barrel.
      fx.debris.one(DebrisKind.Casing, x - dx * 0.5, y, z - dz * 0.5, -dz * 3 + dx * -0.5, 2.5 + Math.random(),
        dx * 3 + dz * -0.5, 1.2, FX_COLORS.brass, w === 'shotgun' ? 1.8 : 1);
    }
    const ddx = x - this.focusX;
    const ddz = z - this.focusZ;
    if (ddx * ddx + ddz * ddz < MUZZLE_LIGHT_RANGE * MUZZLE_LIGHT_RANGE) {
      this.host.fx.lights.flash(x + dx * 0.4, y + 0.2, z + dz * 0.4, color, big ? 40 : 22, 0.07, 9, 1);
    }
  }

  private onHit(ev: Extract<GameEvent, { e: 'hit' }>, view: FrameView): void {
    const { fx } = this.host;
    const target = this.host.rig(ev.target);
    target?.hit(ev.armor);
    if (ev.kind === 'explosion' || ev.kind === 'zone') return;
    // Direction the damage travelled (projectile heading, else shooter → target).
    let dx = 0;
    let dz = 0;
    const proj = ev.id ? view.projectiles.find((p) => p.id === ev.id) : undefined;
    if (proj) {
      dx = proj.dx;
      dz = proj.dz;
    } else if (ev.by) {
      const shooter = this.host.rig(ev.by);
      if (shooter) {
        const l = Math.hypot(ev.x - shooter.x, ev.z - shooter.z) || 1;
        dx = (ev.x - shooter.x) / l;
        dz = (ev.z - shooter.z) / l;
      }
    }
    const y = (target?.y ?? 0) + 1.15;
    const k = clamp(ev.dmg / 18, 0.6, 2.2);
    if (ev.armor) {
      fx.burst(P.shard, ev.x, y, ev.z, FX_COLORS.armor, Math.round(8 * k), dx, 0.4, dz);
      fx.burst(P.spark, ev.x, y, ev.z, FX_COLORS.white, Math.round(5 * k), dx, 0.3, dz);
      fx.burst(P.flash, ev.x, y, ev.z, FX_COLORS.armor, 1, 0, 0, 0, 0.5 * k);
    } else {
      fx.burst(P.spark, ev.x, y, ev.z, FX_COLORS.blood, Math.round(9 * k), dx, 0.3, dz);
      if (target) fx.burst(P.shard, ev.x, y, ev.z, target.glow, Math.round(5 * k), dx, 0.5, dz, 0.8);
      fx.burst(P.glow, ev.x, y, ev.z, FX_COLORS.blood, 1, 0, 0, 0, 0.3 * k);
    }
    if (ev.dmg >= 60) {
      // Headshot-grade hits (sniper / laser / rocket) get an extra crack.
      fx.ring(ev.x, y, ev.z, 0.2, 1.8, 0.3, ev.armor ? FX_COLORS.armor : FX_COLORS.blood, 3, 0.15);
      fx.burst(P.bigSpark, ev.x, y, ev.z, FX_COLORS.fireCore, 12, dx, 0.3, dz, 0.7);
    }
  }

  explosion(x: number, z: number, r: number, by: string | null): void {
    const { fx } = this.host;
    const pump = this.host.ents.takeGrenadeBoom(by, x, z);
    const hot = pump ? brandGlowColor(ABILITY_OWNER.grenade.id) : FX_COLORS.fire;
    const core = pump ? pumpCore : fireCore;
    const s = r / 5;
    fx.shell(x, 0.6, z, r * 0.2, r * 0.75, 0.65, ShellStyle.Fire, core, hot, 1.25, 0.95, 0, 2, 1.2);
    fx.shell(x, 0.4, z, r * 0.3, r * 1.1, 0.16, ShellStyle.Glow, hot, core, 1.3, 0.5, 0.25);
    fx.ring(x, 0.1, z, r * 0.3, r * 1.6, 0.55, core, 1.7, 0.08);
    fx.ring(x, 0.09, z, r * 0.4, r * 1.05, 1.1, hot, 2.4, 0.4, 0.9, 0, 0, 0.6);
    fx.burst(P.fire, x, 0.8, z, hot, Math.round(18 * s), 0, 0, 0, s);
    fx.burst(P.fire, x, 1.0, z, core, Math.round(6 * s), 0, 0, 0, s * 0.8);
    fx.burst(P.bigSpark, x, 0.8, z, hot, Math.round(30 * s), 0, 0, 0, s);
    fx.burst(P.ember, x, 1, z, hot, Math.round(26 * s), 0, 0, 0, s);
    fx.burst(P.smoke, x, 1.2, z, FX_COLORS.smoke, Math.round(16 * s), 0, 0, 0, s);
    fx.burst(P.smoke, x, 0.6, z, FX_COLORS.smokeDark, Math.round(8 * s), 0, 0, 0, s * 1.2);
    fx.burst(P.dust, x, 0.3, z, FX_COLORS.dust, Math.round(16 * s), 0, 0, 0, s * 1.3);
    fx.debris.burst(DebrisKind.Chunk, x, 0.6, z, Math.round(12 * s), FX_COLORS.smokeDark, 11 * s, 9, 1.8, 1);
    fx.debris.burst(DebrisKind.Chunk, x, 0.6, z, Math.round(5 * s), hot, 9 * s, 10, 1.2, 0.7, 2.5);
    fx.lights.flash(x, 2.5, z, hot, 70 * s, 0.45, 26, 2);
    this.host.shake(clamp(0.35 + s * 0.45, 0, 1), x, z);
  }

  private onKill(ev: Extract<GameEvent, { e: 'kill' }>, view: FrameView): void {
    const { fx } = this.host;
    const rig = this.host.rig(ev.victim);
    if (!rig) return;
    const { x, z } = rig;
    const y = rig.y;
    if (rig.seen) this.host.afterimages.spawn(rig.ghostParts, rig.secondary, 1.7, 0.9, 1.5, 0.55);
    fx.debris.burst(DebrisKind.Coin, x, y + 1.2, z, 16, rig.primary, 6, 9, 3.2, 1.1, 1);
    fx.debris.burst(DebrisKind.Coin, x, y + 1.2, z, 10, FX_COLORS.gold, 6, 10, 3.2, 1.1, 1);
    fx.burst(P.coinGlint, x, y + 1.2, z, FX_COLORS.gold, 8);
    fx.burst(P.sparkle, x, y + 1, z, rig.secondary, 22);
    fx.burst(P.spark, x, y + 1, z, rig.glow, 20, 0, 0, 0, 1.2);
    fx.shell(x, y + 1, z, 0.4, 2, 0.4, ShellStyle.Glow, rig.secondary, rig.glow, 1.4, 0.6, 0.15);
    fx.ring(x, 0.08, z, 0.4, 3.4, 0.7, rig.glow, 2.8, 0.14);
    fx.lights.flash(x, 2, z, rig.secondary, 35, 0.4, 14, 1);

    let word: string;
    if (ev.cause === 'rug') word = 'RUGGED';
    else if (ev.cause === 'zone') word = 'LIQUIDATED';
    else if (ev.cause === 'turret') word = 'CLANKED';
    else if (ev.cause === 'explosion') word = 'REKT';
    else word = KILL_WORDS[Math.floor(Math.random() * KILL_WORDS.length)]!;
    const selfId = view.selfId;
    const selfKilled = ev.killer !== null && ev.killer === selfId;
    const color = ev.victim === selfId ? FX_COLORS.danger : selfKilled ? FX_COLORS.gold : rig.secondary;
    fx.text.pop(word, x, y + 2.6, z, color, ev.victim === selfId || ev.killer === selfId ? 1.1 : 0.8);
    rig.killed = true;
    rig.hide();
  }

  private onChest(id: number, rug: boolean, view: FrameView): void {
    const { fx, chests } = this.host;
    chests.opened(id, rug);
    const c = chests.find(view, id);
    if (!c) return;
    const { x, z } = c;
    if (rug) {
      const green = FX_COLORS.rugGreen;
      const red = FX_COLORS.rugRed;
      fx.burst(P.candle, x, 0.8, z, green, 12, 0, 0, 0, 1.1);
      fx.burst(P.candle, x, 2.5, z, red, 8, 0, -1, 0, 1.1);
      fx.burst(P.shard, x, 1, z, red, 18, 0, 0, 0, 1.3);
      fx.shell(x, 0.7, z, 0.6, 3.6, 0.7, ShellStyle.Fire, green, red, 1.1, 0.9, 0, 2, 1.2);
      fx.shell(x, 0.5, z, 0.8, 5, 0.2, ShellStyle.Glow, red, red, 1.4, 0.6, 0.25);
      fx.ring(x, 0.1, z, 0.5, 7, 0.7, red, 2.2, 0.08);
      fx.ring(x, 0.09, z, 0.5, 4.5, 1.2, green, 2.4, 0.3, 0.8, 0, 0, 0.5);
      fx.burst(P.fire, x, 0.8, z, red, 12, 0, 0, 0, 1.1);
      fx.burst(P.bigSpark, x, 0.8, z, green, 20);
      fx.burst(P.smoke, x, 1, z, FX_COLORS.smokeDark, 14, 0, 0, 0, 1.1);
      fx.debris.burst(DebrisKind.Coin, x, 1, z, 22, green, 9, 11, 2.6, 1, 1.2);
      fx.lights.flash(x, 2.5, z, red, 60, 0.6, 26, 2);
      fx.text.pop('RUG PULLED', x, 3.2, z, red, 1.4, 2.4, 2.2);
      this.host.shake(0.85, x, z);
      return;
    }
    const gold = c.airdrop ? rarityColor(4) : FX_COLORS.gold;
    const s = c.airdrop ? 1.4 : 1;
    fx.burst(P.sparkle, x, 1, z, gold, Math.round(30 * s), 0, 0, 0, s);
    fx.burst(P.coinGlint, x, 1, z, gold, Math.round(10 * s));
    fx.burst(P.bigSpark, x, 0.9, z, FX_COLORS.fireCore, Math.round(18 * s), 0, 1, 0, 0.6);
    fx.debris.burst(DebrisKind.Coin, x, 1, z, Math.round(18 * s), gold, 4, 9, 2.8, 1, 1.2);
    fx.shell(x, 0.8, z, 0.4, 2.4 * s, 0.4, ShellStyle.Glow, gold, FX_COLORS.white, 1.4, 0.7, 0.2);
    fx.ring(x, 0.08, z, 0.5, 3.5 * s, 0.7, gold, 3, 0.15);
    fx.beam(x, 0.3, z, x, 9 * s, z, 0.9, gold, 1.2, 3, 1, 0.8, 0.2);
    fx.lights.flash(x, 2, z, gold, 60 * s, 0.5, 18, 2);
  }

  private onAbility(ev: Extract<GameEvent, { e: 'ability' }>): void {
    const { fx } = this.host;
    const owner = ABILITY_OWNER[ev.kind];
    const primary = brandGlowColor(owner.id);
    const secondary = brandTrim(owner.id);
    const a = owner.ability;
    const rig = this.host.rig(ev.by);
    switch (ev.kind) {
      case 'blink': {
        const r = a.radius ?? 4.5;
        if (rig?.seen) this.host.afterimages.spawn(rig.ghostParts, secondary, 0.6, 1, 0, 0.6);
        for (const [px, pz] of [
          [ev.x, ev.z],
          [ev.tx, ev.tz],
        ] as const) {
          fx.ring(px, 0.1, pz, 0.3, r, 0.55, secondary, 3, 0.1, 1, 12, 0.6);
          fx.ring(px, 0.1, pz, 0.2, r * 0.75, 0.7, primary, 3, 0.2);
          fx.ring(px, 1.1, pz, 0.2, r * 0.6, 0.45, FX_COLORS.white, 2.4, 0.08);
          fx.shell(px, 1, pz, 0.3, 1.6, 0.3, ShellStyle.Glow, secondary, primary, 1.4, 0.7, 0.2);
          fx.burst(P.spark, px, 1, pz, secondary, 18, 0, 0, 0, 1.1);
        }
        fx.beam(ev.x, 1.1, ev.z, ev.tx, 1.1, ev.tz, 0.35, secondary, 0.7, 3, 1, 1, 0.3);
        fx.beam(ev.x, 1.1, ev.z, ev.tx, 1.1, ev.tz, 0.5, FX_COLORS.white, 0.15, 3, 1, 1.5, 0.1);
        this.host.shake(0.2, ev.tx, ev.tz);
        break;
      }
      case 'healPool':
        fx.burst(P.bubble, ev.tx, 0.3, ev.tz, secondary, 26, 0, 0, 0, 2);
        fx.burst(P.spark, ev.tx, 0.4, ev.tz, primary, 24, 0, 1, 0, 1.1);
        fx.burst(P.plus, ev.tx, 0.6, ev.tz, FX_COLORS.heal, 10, 0, 0, 0, 1.5);
        fx.ring(ev.tx, 0.1, ev.tz, 0.3, a.radius ?? 4, 0.5, primary, 3, 0.2);
        fx.beam(ev.x, 1.3, ev.z, ev.tx, 0.2, ev.tz, 0.3, secondary, 0.3, 2.5, 0.9, 0.5, 0.1);
        break;
      case 'reveal': {
        const range = a.range ?? 45;
        fx.ring(ev.x, 0.12, ev.z, 1, range, 1.2, secondary, 3, 0.025, 1);
        fx.ring(ev.x, 0.12, ev.z, 1, range * 0.8, 1.5, primary, 2.4, 0.06, 0.8, 36, 0.4);
        fx.ring(ev.x, 0.12, ev.z, 0.5, range * 0.5, 0.9, FX_COLORS.danger, 2.2, 0.03, 0.6);
        fx.shell(ev.x, 1.2, ev.z, 0.5, 5, 0.9, ShellStyle.Radar, primary, secondary, 1.1, 0.7, 0);
        fx.burst(P.ringPop, ev.x, 2.4, ev.z, secondary, 1, 0, 0, 0, 1.6);
        break;
      }
      case 'dmgBuff':
        fx.burst(P.candle, ev.x, 0.8, ev.z, secondary, 16);
        fx.burst(P.arrow, ev.x, 0.4, ev.z, secondary, 18, 0, 0, 0, 1.2);
        fx.shell(ev.x, 1, ev.z, 0.4, 1.9, 0.45, ShellStyle.Glow, secondary, primary, 1.4, 0.7, 0.15);
        fx.ring(ev.x, 0.1, ev.z, 0.4, 3, 0.55, secondary, 3, 0.15, 1, 8, 0.5);
        break;
      case 'leap':
        fx.burst(P.dust, ev.x, 0.2, ev.z, FX_COLORS.dust, 18, 0, 0, 0, 1.1);
        fx.burst(P.spark, ev.x, 0.3, ev.z, secondary, 20, 0, 1, 0);
        fx.ring(ev.x, 0.1, ev.z, 0.3, 2.8, 0.45, secondary, 3, 0.15);
        const landR = a.radius ?? 4;
        fx.ring(ev.tx, 0.1, ev.tz, landR, landR * 0.3, a.duration ?? 0.7, primary, 2.8, 0.1, 1, 8, 0.8);
        break;
      case 'rush': {
        const r = a.radius ?? 10;
        fx.ring(ev.x, 0.1, ev.z, 0.5, r, 0.5, secondary, 3, 0.04);
        fx.ring(ev.x, 0.1, ev.z, 0.5, r * 0.85, 0.7, primary, 2.6, 0.08, 0.9, 20, 1);
        fx.burst(P.bigSpark, ev.x, 1, ev.z, secondary, 36, 0, 0, 0, 0.9);
        fx.shell(ev.x, 1, ev.z, 0.4, 2, 0.35, ShellStyle.Glow, secondary, primary, 1.4, 0.6, 0.15);
        for (let i = 0; i < 24; i++) {
          const ang = (i / 24) * TAU;
          fx.trail(P.speedLine, ev.x, 0.4 + Math.random() * 1.6, ev.z, i % 2 ? primary : secondary,
            Math.cos(ang) * 22, 0, Math.sin(ang) * 22, 1.2);
        }
        break;
      }
      case 'grenade':
        this.host.ents.grenadeTarget(ev.by, ev.tx, ev.tz, this.host.time());
        fx.burst(P.puff, ev.x, 1.4, ev.z, FX_COLORS.dust, 3);
        fx.burst(P.spark, ev.x, 1.4, ev.z, primary, 8, ev.tx - ev.x, 3, ev.tz - ev.z);
        break;
      case 'turret':
        fx.beam(ev.tx, 24, ev.tz, ev.tx, 0.1, ev.tz, 0.55, primary, 0.5, 2, 0.9, 0.5, 0.2);
        fx.ring(ev.tx, 0.1, ev.tz, 0.3, 3, 0.5, secondary, 3, 0.15);
        fx.ring(ev.tx, 0.1, ev.tz, 0.2, 1.6, 0.8, primary, 2.6, 0.3, 1, 6, 0.8);
        fx.burst(P.bigSpark, ev.tx, 0.5, ev.tz, primary, 18, 0, 1, 0, 0.6);
        fx.burst(P.dust, ev.tx, 0.2, ev.tz, FX_COLORS.dust, 12);
        fx.debris.burst(DebrisKind.Chunk, ev.tx, 0.3, ev.tz, 6, primary, 5, 6, 1.1, 0.6, 1.5);
        fx.lights.flash(ev.tx, 2, ev.tz, primary, 20, 0.4, 14, 1);
        this.host.shake(0.25, ev.tx, ev.tz);
        break;
      case 'dome': {
        const r = a.radius ?? 4;
        fx.shell(ev.tx, 0, ev.tz, 0.5, r * 1.25, 0.5, ShellStyle.Glow, secondary, primary, 1.3, 0.8, 0.15);
        fx.ring(ev.tx, 0.1, ev.tz, 0.5, r * 1.4, 0.6, secondary, 3, 0.08);
        fx.ring(ev.tx, 0.1, ev.tz, 0.5, r, 0.8, primary, 2.6, 0.25, 1, 0, 0, 0.5);
        fx.burst(P.sparkle, ev.tx, 1.5, ev.tz, secondary, 18, 0, 0, 0, 2.2);
        fx.burst(P.sparkle, ev.tx, 1.5, ev.tz, primary, 14, 0, 0, 0, 2.2);
        break;
      }
      case 'armorUp': {
        const px = rig?.x ?? ev.x;
        const pz = rig?.z ?? ev.z;
        fx.shell(px, 1.05, pz, 0.8, 2.4, 0.5, ShellStyle.Vault, FX_COLORS.gold, FX_COLORS.gold, 2.4, 1, 0.3);
        fx.burst(P.coinGlint, px, 1.2, pz, FX_COLORS.gold, 10);
        fx.burst(P.sparkle, px, 1, pz, FX_COLORS.gold, 24);
        fx.burst(P.shard, px, 1.1, pz, FX_COLORS.armor, 14);
        fx.ring(px, 0.1, pz, 0.4, 3, 0.55, FX_COLORS.gold, 3, 0.15, 1, 8, 0.5);
        fx.lights.flash(px, 2, pz, FX_COLORS.gold, 45, 0.5, 14, 1);
        break;
      }
    }
  }
}
