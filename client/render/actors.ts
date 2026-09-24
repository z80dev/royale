// Dynamic actors: characters, held weapons, projectiles, loot, chests, ability entities, deploy beacon and all
// event VFX. RenderWorld owns the scene/camera/post-processing and drives this through setMap/update/onEvent.

import * as THREE from 'three';
import type { CharacterId } from '../../shared/constants';
import type { GameMap } from '../../shared/map';
import type { GameEvent } from '../../shared/protocol';
import type { FrameView } from '../view';
import { Afterimages, CharacterRig, type RigServices } from './actors/characters';
import { EntRenderer } from './actors/ents';
import { EventFx } from './actors/events';
import { Fx } from './actors/fx';
import { ChestRenderer, LootRenderer } from './actors/items';
import { ProjectileRenderer } from './actors/projectiles';

export interface ActorsHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Camera shake 0..1; with x/z the host attenuates it by distance from the camera focus. */
  shake(amount: number, x?: number, z?: number): void;
}

/** Idle rigs kept per character for reuse when players join/respawn. */
const SPARE_RIGS_PER_CHARACTER = 3;

export class Actors {
  private readonly root = new THREE.Group();
  private readonly fx = new Fx();
  private readonly afterimages = new Afterimages();
  private readonly loot = new LootRenderer();
  private readonly chests = new ChestRenderer();
  private readonly ents = new EntRenderer();
  private readonly projectiles = new ProjectileRenderer();
  private readonly events: EventFx;
  private readonly rigs = new Map<string, CharacterRig>();
  private readonly spareRigs = new Map<CharacterId, CharacterRig[]>();
  private readonly present = new Set<string>();
  private readonly services: RigServices;
  private time = 0;

  constructor(host: ActorsHost) {
    this.root.name = 'actors';
    this.root.add(
      this.loot.group,
      this.chests.group,
      this.ents.group,
      this.projectiles.group,
      this.afterimages.group,
      this.fx.group,
    );
    host.scene.add(this.root);
    this.services = {
      fx: this.fx,
      afterimages: this.afterimages,
      shake: (amount, x, z) => host.shake(amount, x, z),
    };
    this.events = new EventFx({
      fx: this.fx,
      afterimages: this.afterimages,
      chests: this.chests,
      ents: this.ents,
      rig: (id) => this.rigs.get(id),
      shake: (amount, x, z) => host.shake(amount, x, z),
      time: () => this.time,
    });
  }

  /** New world / match: drop every transient actor and effect. */
  setMap(_map: GameMap): void {
    for (const [id, rig] of this.rigs) this.releaseRig(id, rig);
    this.fx.clear();
    this.afterimages.clear();
    this.loot.clear();
    this.chests.clear();
    this.ents.clear();
    this.projectiles.clear();
    this.events.clear();
  }

  update(view: FrameView, dt: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.time += step;
    const time = this.time;
    this.events.setFocus(view.focus.x, view.focus.z);
    this.fx.begin(time);

    this.present.clear();
    for (const p of view.players) {
      this.present.add(p.id);
      let rig = this.rigs.get(p.id);
      if (rig && rig.character !== p.character) {
        this.releaseRig(p.id, rig);
        rig = undefined;
      }
      if (!rig) {
        rig = this.acquireRig(p.character);
        rig.reset(p);
        this.rigs.set(p.id, rig);
      }
      rig.update(p, step, time);
    }
    for (const [id, rig] of this.rigs) if (!this.present.has(id)) this.releaseRig(id, rig);

    this.projectiles.update(view, this.fx);
    this.loot.update(view, this.fx, time);
    this.chests.update(view, this.fx, time, step);
    this.ents.update(view, this.fx, time, step);
    this.afterimages.update(step);
    this.fx.end(step, time);
  }

  onEvent(ev: GameEvent, view: FrameView): void {
    this.events.handle(ev, view);
  }

  muzzleFlash(playerId: string): void {
    this.events.localMuzzle(playerId);
  }

  private acquireRig(character: CharacterId): CharacterRig {
    const rig = this.spareRigs.get(character)?.pop() ?? new CharacterRig(character, this.services);
    this.root.add(rig.root);
    return rig;
  }

  private releaseRig(id: string, rig: CharacterRig): void {
    this.rigs.delete(id);
    rig.hide();
    let spares = this.spareRigs.get(rig.character);
    if (!spares) {
      spares = [];
      this.spareRigs.set(rig.character, spares);
    }
    if (spares.length < SPARE_RIGS_PER_CHARACTER) {
      rig.root.removeFromParent();
      spares.push(rig);
    } else rig.dispose();
  }
}
