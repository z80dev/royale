import { TICK_DT, WEAPONS } from '../shared/constants';
import { generateMap } from '../shared/map';
import type { ClientMsg, GameEvent, ServerMsg } from '../shared/protocol';
import type { FrameView, HudState, SfxName } from './view';
import { Renderer } from './render';
import { Ui } from './ui';
import { Audio } from './audio';
import { InputController } from './input';
import { Net } from './net';
import { GameState, type WorldFrame } from './state';

console.info(`%c
   ╔══════════════════════════════════╗
   ║    ₿   LAUNCHPAD ROYALE   ₿      ║
   ║   gm dev. few understand.        ║
   ╚══════════════════════════════════╝`, 'color:#69e3b4;font-weight:700');

const gameRoot = document.querySelector<HTMLElement>('#game');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!gameRoot || !uiRoot) throw new Error('Launchpad Royale needs #game and #ui roots');

const renderer = new Renderer(gameRoot);
const audio = new Audio();
const state = new GameState();
const lobbyMap = generateMap(1337);
let currentMap = lobbyMap;
/** Seed of the match world currently built in the renderer (null while showing the lobby backdrop). */
let matchSeed: number | null = null;
state.resetLobby(lobbyMap);
renderer.setMap(lobbyMap);
audio.setMusic('lobby');

let deployTarget: { x: number; z: number } | null = null;
let net: Net;
const send = (msg: ClientMsg): void => {
  if (msg.t === 'lobbySet') {
    try {
      if (msg.name !== undefined) localStorage.setItem('lr.name', msg.name);
      if (msg.character !== undefined) localStorage.setItem('lr.char', msg.character);
    } catch {
      // Local storage is optional; active socket still receives lobby changes.
    }
  }
  if (msg.t === 'deploy') deployTarget = { x: msg.x, z: msg.z };
  net.send(msg);
};
const ui = new Ui(uiRoot, {
  send,
  audio,
  project: (x, y, z) => renderer.project(x, y, z),
  map: () => currentMap,
});

let fps = 60;
let lastFrame = performance.now();
let accumulator = 0;
let shotCooldown = 0;
let heldFireTime = 0;
let wasFiring = false;
let pendingShots = 0;
let latestMag = -1;
let latestWeapon = '';
let latestSlot = -1;
let predictedShotAt = 0;

const input = new InputController({
  send,
  wantsKeyboard: () => ui.wantsKeyboard(),
  pointerOverUi: (event) => ui.pointerOverUi(event),
  setScoreboard: (show) => ui.setScoreboard(show),
  pickGround: (x, y) => renderer.pickGround(x, y),
  phase: () => state.phase,
  isDead: () => state.phase === 'playing' && !state.self,
  unlockAudio: () => audio.unlock(),
});
net = new Net(handleServerMessage);

function viewAt(now: number, world: WorldFrame, includeMouse: boolean): FrameView {
  const cameraMode = state.phase === 'lobby' || state.phase === 'countdown' ? 'lobby'
    : state.phase === 'deploy' ? 'deploy'
      : state.phase === 'ended' ? 'ended'
        : state.self && world.selfPlayer?.alive ? 'play' : 'spectate';
  return {
    now,
    phase: state.phase,
    phaseT: state.phaseT,
    map: currentMap,
    players: world.players,
    selfId: state.selfId,
    myTeam: state.myTeam,
    focusId: world.focusId,
    focus: world.focus,
    aimWorld: includeMouse ? renderer.pickGround(input.mouseX, input.mouseY) : null,
    projectiles: world.projectiles,
    loot: state.lootList,
    chests: state.chestList,
    ents: world.ents,
    zone: state.zone,
    deployTarget,
    highlightLoot: state.self?.nearLoot ?? null,
    highlightChest: state.self?.nearChest ?? null,
    cameraMode,
  };
}

function hudAt(world: WorldFrame): HudState {
  return {
    self: state.self,
    selfPlayer: world.selfPlayer,
    roster: state.roster,
    teamSize: state.teamSize,
    aliveCount: state.aliveCount,
    teamsAlive: state.teamsAlive,
    matchTime: state.matchTime,
    ping: net.ping,
    fps,
    spectating: state.self ? null : state.spectating,
    death: state.death,
  };
}

function playAtActor(name: SfxName, playerId: string, view: FrameView): void {
  const player = view.players.find((entry) => entry.id === playerId);
  audio.play(name, player ? { x: player.x, z: player.z } : undefined);
}

function playEvent(event: GameEvent, view: FrameView): void {
  switch (event.e) {
    case 'shot':
      if (event.by === state.selfId && pendingShots > 0) {
        pendingShots--;
        if (performance.now() - predictedShotAt < 500) break;
      }
      audio.play('shot', { w: event.w, x: event.x, z: event.z });
      break;
    case 'hit':
      if (event.target === state.selfId) {
        renderer.shake(0.28);
        audio.play(event.armor ? 'hitArmor' : 'hit', { x: event.x, z: event.z });
      }
      if (event.by === state.selfId) audio.play('hitmarker');
      break;
    case 'kill':
      playAtActor('death', event.victim, view);
      if (event.killer === state.selfId) audio.play('kill');
      break;
    case 'boom': audio.play('explosion', { x: event.x, z: event.z }); break;
    case 'impact': audio.play('impact', { x: event.x, z: event.z }); break;
    case 'pickup': playAtActor(event.rarity >= 2 ? 'pickupRare' : 'pickup', event.by, view); break;
    case 'chest': {
      const chest = state.chests.get(event.id);
      audio.play(event.rug ? 'rug' : 'chest', chest ? { x: chest.x, z: chest.z } : undefined);
      break;
    }
    case 'airdrop': audio.play('airdrop', { x: event.x, z: event.z }); break;
    case 'zone': if (event.shrinking) audio.play('zoneWarn'); break;
    case 'ability': audio.play('ability', { x: event.x, z: event.z }); break;
    case 'heal': playAtActor('heal', event.by, view); break;
    case 'dash': playAtActor('dash', event.by, view); break;
    case 'reload': playAtActor('reload', event.by, view); break;
    case 'land': playAtActor('land', event.by, view); break;
    case 'emote': playAtActor('emote', event.by, view); break;
  }
}

function handleServerMessage(msg: ServerMsg): void {
  switch (msg.t) {
    case 'welcome':
      ui.onWelcome(msg.id);
      break;
    case 'lobby':
      if (msg.phase === 'lobby' || msg.phase === 'countdown') {
        if (msg.phase === 'lobby' && state.phase !== 'lobby') {
          currentMap = lobbyMap;
          state.resetLobby(lobbyMap);
          matchSeed = null;
          renderer.setMap(lobbyMap);
          deployTarget = null;
        }
        state.phase = msg.phase;
        state.phaseT = msg.countdown;
        audio.setMusic('lobby');
      }
      ui.onLobby(msg);
      break;
    case 'match': {
      // After a socket reconnect mid-round the server re-sends the running match (same seed): keep the built scene.
      const resumed = msg.seed === matchSeed;
      if (!resumed) {
        currentMap = generateMap(msg.seed);
        renderer.setMap(currentMap);
        matchSeed = msg.seed;
      }
      state.startMatch(msg, currentMap, resumed);
      deployTarget = null;
      shotCooldown = heldFireTime = pendingShots = 0;
      wasFiring = false;
      latestMag = -1;
      latestWeapon = '';
      ui.onMatch(msg, currentMap);
      audio.setMusic('match');
      break;
    }
    case 'snap': {
      if (!state.receive(msg)) break;
      const now = performance.now();
      const world = state.frame(now, 0);
      const view = viewAt(now, world, false);
      const hud = hudAt(world);
      for (const event of msg.ev) {
        renderer.onEvent(event, view);
        ui.onEvent(event, view, hud);
        playEvent(event, view);
      }
      break;
    }
    case 'end':
      state.phase = 'ended';
      ui.onEnd(msg);
      audio.setMusic('off');
      break;
    case 'chat': ui.onChat(msg); break;
  }
}

function predictFire(firing: boolean): void {
  const self = state.self;
  const slot = self?.slots[self.active];
  if (!self || !slot) {
    wasFiring = false;
    heldFireTime = 0;
    return;
  }
  const weapon = WEAPONS[slot.w];
  if (latestWeapon !== slot.w || latestSlot !== self.active || slot.mag > latestMag) {
    pendingShots = 0;
    latestWeapon = slot.w;
    latestSlot = self.active;
    shotCooldown = 0;
  }
  latestMag = slot.mag;
  const pressed = firing && !wasFiring;
  wasFiring = firing;
  heldFireTime = firing ? heldFireTime + TICK_DT : 0;
  shotCooldown = Math.max(0, shotCooldown - TICK_DT);
  if (!firing || (!weapon.auto && !pressed) || shotCooldown > 0 || !state.selfId) return;
  if (self.reload > 0 || self.channel || heldFireTime < (weapon.spinUp ?? 0)) return;
  if (slot.mag - pendingShots <= 0) {
    if (pressed) audio.play('empty');
    return;
  }
  pendingShots++;
  predictedShotAt = performance.now();
  shotCooldown = weapon.fireInterval;
  renderer.muzzleFlash(state.selfId);
  audio.play('shot', { w: slot.w });
  renderer.shake(weapon.kick * 0.13);
}

function fixedStep(): void {
  const sampled = input.sample();
  if (net.status !== 'open' || (state.phase !== 'playing' && state.phase !== 'deploy') || !state.self) return;
  const worldPoint = renderer.pickGround(input.mouseX, input.mouseY);
  const x = state.prediction?.x ?? state.self.x;
  const z = state.prediction?.z ?? state.self.z;
  const aim = Math.atan2(worldPoint.z - z, worldPoint.x - x);
  state.localAim = aim;
  const seq = ++state.seq;
  if (state.phase === 'playing' && state.prediction) {
    state.stepPrediction({ seq, mx: sampled.mx, mz: sampled.mz, dash: sampled.dash });
    predictFire(sampled.fire);
  } else {
    wasFiring = false;
    heldFireTime = 0;
  }
  net.send({
    t: 'in', seq, mx: sampled.mx, mz: sampled.mz, aim,
    fire: sampled.fire, dash: sampled.dash,
  });
}

function frame(now: number): void {
  const elapsed = Math.max(0, Math.min(0.05, (now - lastFrame) / 1000));
  const frameDelta = Math.max(0, Math.min(250, now - lastFrame));
  lastFrame = now;
  if (elapsed > 0) fps = fps * 0.9 + Math.min(144, 1 / elapsed) * 0.1;
  if (document.hidden) accumulator = 0;
  else accumulator = Math.min(100, accumulator + frameDelta);
  while (accumulator >= TICK_DT * 1000) {
    fixedStep();
    accumulator -= TICK_DT * 1000;
  }
  const world = state.frame(now, elapsed);
  const view = viewAt(now, world, true);
  audio.setListener(world.focus.x, world.focus.z);
  renderer.frame(view, elapsed);
  ui.update(view, hudAt(world), elapsed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
