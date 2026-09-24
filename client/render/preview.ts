// Renderer lab (public/preview.html → /dist/preview.js). Drives the real Renderer with a fake FrameView:
// lobby flyover, a live skirmish (players, projectiles, loot, chests, ents, shrinking zone) and landmark tours.
//
// URL params: ?mode=lobby|play|deploy|spectate|ended  ?at=<landmark id|x,z>  ?quality=0|1|2  ?seed=N  ?leak=N
//             ?zr=<fixed zone radius>  ?zone=0 (no zone)  ?hud=0
// Keys: 1-5 camera modes · WASD move · mouse aim · click fire · Z zone pulse · B shake · N next landmark ·
//       M rebuild map (leak check) · H hide HUD
// window.__preview exposes { renderer, view, setMode, goto, remap, stats } for automation.

import { CHARACTERS, WEAPONS, type WeaponId } from '../../shared/constants';
import { generateMap, type GameMap } from '../../shared/map';
import { ST, type ChestSnap, type EntSnap, type GameEvent, type LootItem, type ZoneSnap } from '../../shared/protocol';
import type { CameraMode, FrameView, ViewPlayer, ViewProjectile } from '../view';
import { Renderer } from './index';

const params = new URLSearchParams(location.search);
const container = document.getElementById('game')!;
const hud = document.getElementById('hud')!;
const renderer = new Renderer(container);
let seed = Number(params.get('seed') ?? 840000);
let map: GameMap = generateMap(seed);
renderer.setMap(map);

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const MODES: CameraMode[] = ['lobby', 'play', 'deploy', 'spectate', 'ended'];

function spot(): { x: number; z: number } {
  const at = params.get('at');
  if (at) {
    const lm = map.landmarks.find((l) => l.id === at);
    if (lm) return { x: lm.x, z: lm.z + lm.r + 4 };
    const [x, z] = at.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) return { x: x!, z: z! };
  }
  return { x: 6, z: 20 };
}

const start = spot();
const self = { x: start.x, z: start.z };

function makePlayer(i: number): ViewPlayer {
  const c = CHARACTERS[i % CHARACTERS.length]!;
  const a = (i / 10) * Math.PI * 2;
  return {
    id: i === 0 ? 'me' : `b${i}`,
    name: i === 0 ? 'you' : `${c.name}Bot`,
    character: c.id,
    team: i === 0 || i === 1 ? 1 : 2 + (i % 4),
    bot: i !== 0,
    isSelf: i === 0,
    isTeammate: i === 1,
    vx: 0,
    vz: 0,
    concealed: i === 6,
    emote: i === 2 ? { text: 'gm', age: 0 } : null,
    x: self.x + Math.cos(a) * 9,
    z: self.z + Math.sin(a) * 9,
    y: 0,
    aim: 0,
    hp: 40 + ((i * 17) % 60),
    ar: (i * 23) % 100,
    alive: i !== 9,
    w: WEAPON_IDS[i % WEAPON_IDS.length]!,
    st: i === 3 ? ST.DMG_BUFF : i === 4 ? ST.INVULN : i === 5 ? ST.LASER_EYES | ST.RUSH : 0,
  };
}

const players: ViewPlayer[] = Array.from({ length: 10 }, (_, i) => makePlayer(i));
const projectiles: ViewProjectile[] = [];
let nextProjectile = 1;

function scatterLoot(): LootItem[] {
  const out: LootItem[] = [];
  let id = 1;
  WEAPON_IDS.forEach((w, i) => {
    const a = (i / WEAPON_IDS.length) * Math.PI * 2;
    out.push({
      id: id++,
      x: self.x + Math.cos(a) * 5,
      z: self.z - 6 + Math.sin(a) * 3,
      k: 'weapon',
      w,
      mag: WEAPONS[w].mag,
    });
  });
  out.push({ id: id++, x: self.x - 3, z: self.z + 3, k: 'ammo', a: 'light', n: 45 });
  out.push({ id: id++, x: self.x - 1.5, z: self.z + 3.5, k: 'ammo', a: 'heavy', n: 30 });
  out.push({ id: id++, x: self.x + 1.5, z: self.z + 3.5, k: 'cons', c: 'stable', n: 2 });
  out.push({ id: id++, x: self.x + 3, z: self.z + 3, k: 'cons', c: 'medkit', n: 1 });
  out.push({ id: id++, x: self.x + 4.5, z: self.z + 2.5, k: 'cons', c: 'armorL', n: 1 });
  return out;
}

let loot = scatterLoot();
let chests: ChestSnap[] = [
  { id: 1, x: self.x - 7, z: self.z - 2, open: false, airdrop: false },
  { id: 2, x: self.x + 8, z: self.z - 1, open: true, airdrop: false },
  { id: 3, x: self.x - 2, z: self.z - 12, open: false, airdrop: true },
];

function makeEnts(t: number): EntSnap[] {
  const fall = 70 - ((t * 7) % 70);
  return [
    { id: 1, k: 'pool', x: self.x - 8, z: self.z + 6, y: 0, owner: 'b1', team: 1, ttl: 4 },
    { id: 2, k: 'turret', x: self.x + 10, z: self.z + 6, y: 0, owner: 'b7', team: 3, ttl: 12, aim: t * 1.3 },
    { id: 3, k: 'dome', x: self.x + 12, z: self.z - 8, y: 0, owner: 'b8', team: 2, ttl: 5 },
    {
      id: 4,
      k: 'grenade',
      x: self.x + Math.sin(t) * 6,
      z: self.z - 4,
      y: 1.5 + Math.abs(Math.sin(t * 2)) * 4,
      owner: 'b6',
      team: 2,
      ttl: 1,
    },
    { id: 5, k: 'airdrop', x: self.x + 4, z: self.z - 14, y: fall, owner: null, team: 0, ttl: fall / 7 },
  ];
}

const zone: ZoneSnap = { cx: 10, cz: 0, r: 150, ncx: 5, ncz: 10, nr: 70, phase: 1, shrinking: true, t: 20, dps: 5 };

const view: FrameView = {
  now: performance.now(),
  phase: 'playing',
  phaseT: 0,
  map,
  players,
  selfId: 'me',
  myTeam: 1,
  focusId: 'me',
  focus: { x: self.x, y: 0, z: self.z },
  aimWorld: null,
  projectiles,
  loot,
  chests,
  ents: [],
  zone,
  deployTarget: null,
  highlightLoot: 1,
  highlightChest: 1,
  cameraMode: (MODES.includes(params.get('mode') as CameraMode) ? params.get('mode') : 'play') as CameraMode,
};

// ───────────────────────────── input ─────────────────────────────

const keys = new Set<string>();
let mouseX = innerWidth / 2;
let mouseY = innerHeight / 2;
let firing = false;
let hudVisible = params.get('hud') !== '0';
let tourIndex = 0;
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < MODES.length) setMode(MODES[idx]!);
  if (e.key === 'z')
    renderer.onEvent({ e: 'zone', phase: 2, shrinking: true, msg: 'Liquidation zone shrinking' }, view);
  if (e.key === 'b') renderer.shake(0.8);
  if (e.key === 'm') remap(seed + 1);
  if (e.key === 'h') hudVisible = !hudVisible;
  if (e.key === 'n') {
    const lm = map.landmarks[tourIndex++ % map.landmarks.length]!;
    goto(lm.x, lm.z + lm.r + 4);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});
window.addEventListener('mousedown', () => (firing = true));
window.addEventListener('mouseup', () => (firing = false));

function setMode(mode: CameraMode): void {
  view.cameraMode = mode;
  view.phase = mode === 'lobby' ? 'lobby' : mode === 'deploy' ? 'deploy' : mode === 'ended' ? 'ended' : 'playing';
  if (mode === 'deploy') deployT = 0;
}

function goto(x: number, z: number): void {
  const dx = x - self.x;
  const dz = z - self.z;
  self.x = x;
  self.z = z;
  for (const p of players) {
    p.x += dx;
    p.z += dz;
  }
  loot = scatterLoot();
  view.loot = loot;
  chests = chests.map((c) => ({ ...c, x: c.x + dx, z: c.z + dz }));
  view.chests = chests;
}

function remap(newSeed: number): void {
  seed = newSeed;
  map = generateMap(seed);
  view.map = map;
  renderer.setMap(map);
}

// ───────────────────────────── simulation ─────────────────────────────

let deployT = 0;
let fireCooldown = 0;
let botFire = 0;
let last = performance.now();
let simTime = 0;

function fire(p: ViewPlayer, tx: number, tz: number): void {
  const w = p.w ?? 'pistol';
  const def = WEAPONS[w];
  const base = Math.atan2(tz - p.z, tx - p.x);
  for (let k = 0; k < def.pellets; k++) {
    const a = base + (Math.random() * 2 - 1) * def.spread;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const ox = p.x + dx * 0.9;
    const oz = p.z + dz * 0.9;
    const id = nextProjectile++;
    const len = w === 'laser' ? Math.min(def.range, Math.hypot(tx - p.x, tz - p.z)) : undefined;
    projectiles.push({ id, by: p.id, w, x: ox, z: oz, dx, dz, ox, oz, age: 0, len });
    const ev: GameEvent = { e: 'shot', id, by: p.id, w, x: ox, z: oz, dx, dz, len };
    renderer.onEvent(ev, view);
  }
  if (p.isSelf) {
    renderer.muzzleFlash(p.id);
    renderer.shake(def.kick * 0.1);
  }
  p.st |= ST.FIRING;
}

function step(dt: number): void {
  simTime += dt;
  view.now = performance.now();
  // local player movement
  const me = players[0]!;
  let mx = 0;
  let mz = 0;
  if (keys.has('w')) mz -= 1;
  if (keys.has('s')) mz += 1;
  if (keys.has('a')) mx -= 1;
  if (keys.has('d')) mx += 1;
  const ml = Math.hypot(mx, mz) || 1;
  me.vx = (mx / ml) * 7.2;
  me.vz = (mz / ml) * 7.2;
  self.x += me.vx * dt;
  self.z += me.vz * dt;
  me.x = self.x;
  me.z = self.z;
  me.y = 0;
  const aim = renderer.pickGround(mouseX, mouseY);
  view.aimWorld = aim;
  me.aim = Math.atan2(aim.z - me.z, aim.x - me.x);
  fireCooldown -= dt;
  if (firing && fireCooldown <= 0 && view.cameraMode === 'play') {
    fire(me, aim.x, aim.z);
    fireCooldown = WEAPONS[me.w ?? 'pistol'].fireInterval;
  }

  // bots circle-strafe around the player and trade fire
  players.forEach((p, i) => {
    if (i === 0) return;
    p.st &= ~ST.FIRING;
    if (!p.alive) return;
    const a = simTime * (0.25 + i * 0.03) + (i / 10) * Math.PI * 2;
    const r = 8 + (i % 3) * 3;
    const nx = self.x + Math.cos(a) * r;
    const nz = self.z + Math.sin(a) * r;
    p.vx = (nx - p.x) / Math.max(dt, 1e-3);
    p.vz = (nz - p.z) / Math.max(dt, 1e-3);
    p.x = nx;
    p.z = nz;
    const target = players[(i * 3) % players.length]!;
    p.aim = Math.atan2(target.z - p.z, target.x - p.x);
    if (p.emote) p.emote.age = (p.emote.age + dt) % 3;
  });
  botFire -= dt;
  if (botFire <= 0 && view.cameraMode !== 'lobby') {
    botFire = 0.18;
    const shooter = players[1 + Math.floor(Math.random() * 8)]!;
    const target = players[Math.floor(Math.random() * players.length)]!;
    if (shooter.alive && shooter !== target) fire(shooter, target.x, target.z);
  }

  // projectiles fly until range; emit impact events
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i]!;
    const def = WEAPONS[pr.w];
    pr.age += dt;
    const dist = Math.min(def.range, def.projectileSpeed * pr.age);
    pr.x = pr.ox + pr.dx * dist;
    pr.z = pr.oz + pr.dz * dist;
    const done = pr.len !== undefined ? pr.age > 0.25 : dist >= def.range;
    if (done) {
      projectiles.splice(i, 1);
      if (pr.w === 'rocket') renderer.onEvent({ e: 'boom', x: pr.x, z: pr.z, r: 5, by: pr.by }, view);
      else renderer.onEvent({ e: 'impact', id: pr.id, x: pr.x, z: pr.z, nx: 0, nz: 0 }, view);
    }
  }

  // deploy: fall from altitude 70 over 12 s
  if (view.cameraMode === 'deploy') {
    deployT = Math.min(12, deployT + dt);
    me.y = 70 * (1 - deployT / 12);
    me.st |= ST.DEPLOYING;
    view.deployTarget = { x: self.x + 20, z: self.z - 20 };
  } else {
    me.st &= ~ST.DEPLOYING;
    view.deployTarget = null;
  }

  // shrinking zone
  zone.r = params.has('zr') ? Number(params.get('zr')) : 150 - ((simTime * 3) % 90);
  zone.nr = Math.min(zone.nr, zone.r * 0.6);
  view.ents = view.cameraMode === 'lobby' ? [] : makeEnts(simTime);
  view.focus.x = self.x;
  view.focus.y = me.y;
  view.focus.z = self.z;
  view.players = view.cameraMode === 'lobby' ? [] : players;
  view.zone = view.cameraMode === 'lobby' || params.get('zone') === '0' ? null : zone;
}

let paused = false;
/** Freeze the sim loop and render one frame from an arbitrary camera pose (for inspecting the sky etc.). */
function pose(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
  paused = true;
  renderer.frame(view, 0.016);
  const cam = (renderer as unknown as { rig: { camera: import('three').PerspectiveCamera } }).rig.camera;
  cam.position.set(px, py, pz);
  cam.lookAt(tx, ty, tz);
  cam.updateMatrixWorld();
  (renderer as unknown as { post: { render(t: number, dt: number): void } }).post.render(simTime, 0.016);
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  requestAnimationFrame(tick);
  if (paused) return;
  step(dt);
  renderer.frame(view, dt);
  if (hudVisible) {
    const s = renderer.stats;
    hud.textContent =
      `${s.fps.toFixed(0)} fps · q${s.quality} · ${s.calls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ` +
      `${s.geometries} geo · ${s.textures} tex · mode ${view.cameraMode} · seed ${seed}`;
  }
  hud.style.display = hudVisible ? 'block' : 'none';
}
requestAnimationFrame(tick);

// Optional leak check: rebuild the map N times and log memory after each rebuild.
const leak = Number(params.get('leak') ?? 0);
if (leak > 0) {
  const results: string[] = [];
  let n = 0;
  const run = () => {
    remap(seed + 1);
    requestAnimationFrame(() => {
      const s = renderer.stats;
      results.push(`rebuild ${n + 1}: geometries=${s.geometries} textures=${s.textures}`);
      console.info(results[results.length - 1]);
      if (++n < leak) setTimeout(run, 300);
    });
  };
  setTimeout(run, 1500);
}

Object.assign(window, {
  __preview: {
    renderer,
    view,
    setMode,
    goto,
    remap,
    pose,
    resume: () => (paused = false),
    stats: () => renderer.stats,
  },
});
