// Deterministic map generation shared by server (collision/loot) and client (rendering).
// Same seed ⇒ identical GameMap on every machine. Coordinates: x/z ground plane, y up. 1 unit = 1 m.

import { CHARACTERS, MAP_HALF, type CharacterId } from './constants';
import { Rng } from './rng';

export type ObStyle =
  | 'tower' // brand HQ tower (brand set) — logo on all 4 sides
  | 'wall' // compound wall (brand set when part of an HQ)
  | 'barrier' // low concrete cover
  | 'crate'
  | 'container' // shipping container (color set)
  | 'tree'
  | 'rock'
  | 'statue' // Satoshi statue (circle)
  | 'monolith' // genesis block monolith (label = genesis headline)
  | 'pizza' // Laszlo's Pizza shop
  | 'lambo' // golden lambo
  | 'ruin' // FTX ruins wall chunks
  | 'doge' // doge statue (circle)
  | 'rig' // mining rig rack
  | 'letter' // giant HODL letters (label = letter)
  | 'atm' // bitcoin ATM
  | 'rocket' // moon rocket on launchpad (circle)
  | 'gantry' // rocket launch tower
  | 'vault' // Mt. Gox vault
  | 'luna'; // crashed Terra Luna moon (circle)

export interface BoxOb {
  id: number;
  type: 'box';
  x: number;
  z: number;
  hw: number; // half width (x)
  hd: number; // half depth (z)
  h: number; // height
  style: ObStyle;
  brand?: CharacterId;
  label?: string;
  color?: string;
}
export interface CircleOb {
  id: number;
  type: 'circle';
  x: number;
  z: number;
  r: number;
  h: number;
  style: ObStyle;
  label?: string;
  color?: string;
}
export type Obstacle = BoxOb | CircleOb;

export interface Bush { x: number; z: number; r: number; tulip?: boolean }
export interface Road { x1: number; z1: number; x2: number; z2: number; w: number }
export interface Billboard { x: number; z: number; rot: number; text: string; color: string; h: number }
export interface Landmark { id: string; name: string; x: number; z: number; r: number; desc: string }
export interface HQ { brand: CharacterId; x: number; z: number; half: number }
export interface LootSpawn { x: number; z: number; tier: 0 | 1 | 2 }
export interface MapLight { x: number; z: number; y: number; color: string; intensity: number }

export interface GameMap {
  seed: number;
  half: number;
  obstacles: Obstacle[];
  bushes: Bush[];
  roads: Road[];
  billboards: Billboard[];
  landmarks: Landmark[];
  hqs: HQ[];
  lootSpawns: LootSpawn[];
  chestSpawns: { x: number; z: number }[];
  lights: MapLight[];
}

export const GENESIS_HEADLINE = 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks';
export const HQ_RING_RADIUS = 64;
export const HQ_HALF = 10;

const BILLBOARD_TEXTS = [
  'gm', 'WAGMI', 'HODL', 'few understand', 'ser, this is a casino', 'number go up', 'not financial advice',
  'probably nothing', '69,420', 'wen moon?', 'have fun staying poor', 'zoom out', 'funds are safu',
  'this is fine', 'up only', 'buy the dip', 'LFG', 'wagmi (conditions apply)',
];
const NEON = ['#FF2BD6', '#00F0FF', '#FFE600', '#7CFF4F', '#FF6B2B', '#9D5CFF'];

export function generateMap(seed: number): GameMap {
  const rng = new Rng(seed);
  const obstacles: Obstacle[] = [];
  const bushes: Bush[] = [];
  const roads: Road[] = [];
  const billboards: Billboard[] = [];
  const landmarks: Landmark[] = [];
  const hqs: HQ[] = [];
  const lootSpawns: LootSpawn[] = [];
  const chestSpawns: { x: number; z: number }[] = [];
  const lights: MapLight[] = [];
  // Areas no random scatter may enter (landmarks, HQs, plaza).
  const reserved: { x: number; z: number; r: number }[] = [];

  const box = (x: number, z: number, hw: number, hd: number, h: number, style: ObStyle, extra: Partial<BoxOb> = {}) =>
    obstacles.push({ id: obstacles.length, type: 'box', x, z, hw, hd, h, style, ...extra });
  const circle = (x: number, z: number, r: number, h: number, style: ObStyle, extra: Partial<CircleOb> = {}) =>
    obstacles.push({ id: obstacles.length, type: 'circle', x, z, r, h, style, ...extra });

  // ── Genesis Plaza (center)
  landmarks.push({ id: 'genesis', name: 'Genesis Plaza', x: 0, z: 0, r: 14, desc: 'Block 0. Satoshi watches.' });
  reserved.push({ x: 0, z: 0, r: 16 });
  circle(0, 0, 2.2, 7, 'statue', { label: 'Satoshi Nakamoto' });
  box(5.5, 5.5, 1.3, 0.35, 4.2, 'monolith', { label: GENESIS_HEADLINE });
  box(9.5, 0, 0.4, 3, 1.4, 'barrier');
  box(-9.5, 0, 0.4, 3, 1.4, 'barrier');
  box(0, 9.5, 3, 0.4, 1.4, 'barrier');
  box(0, -9.5, 3, 0.4, 1.4, 'barrier');
  box(-6, -6, 0.9, 0.9, 1.4, 'crate');
  box(6.5, -6, 0.9, 0.9, 1.4, 'crate');
  lootSpawns.push({ x: 4, z: -3, tier: 2 }, { x: -4, z: 3, tier: 1 }, { x: -3, z: -5, tier: 1 });
  chestSpawns.push({ x: -5.5, z: 5.5 });
  lights.push({ x: 0, z: 0, y: 12, color: '#FFB627', intensity: 3 });

  // ── Brand HQs on a ring
  CHARACTERS.forEach((c, i) => {
    const a = (i / CHARACTERS.length) * Math.PI * 2 + Math.PI / CHARACTERS.length;
    const hx = Math.round(Math.cos(a) * HQ_RING_RADIUS);
    const hz = Math.round(Math.sin(a) * HQ_RING_RADIUS);
    hqs.push({ brand: c.id, x: hx, z: hz, half: HQ_HALF });
    reserved.push({ x: hx, z: hz, r: HQ_HALF + 3.5 });
    landmarks.push({ id: `hq-${c.id}`, name: `${c.name} HQ`, x: hx, z: hz, r: HQ_HALF, desc: c.tagline });
    box(hx, hz, 3.5, 3.5, rng.range(12, 17), 'tower', { brand: c.id, color: c.primary });
    const H = HQ_HALF;
    const T = 0.35;
    const wallH = 2.4;
    const seg = (H - 2) / 2; // half-length of each wall segment (door gap = 4m)
    const mid = 2 + seg;
    // north/south walls (along x)
    for (const sz of [-1, 1]) {
      box(hx - mid, hz + sz * H, seg, T, wallH, 'wall', { brand: c.id, color: c.primary });
      box(hx + mid, hz + sz * H, seg, T, wallH, 'wall', { brand: c.id, color: c.primary });
    }
    // east/west walls (along z)
    for (const sx of [-1, 1]) {
      box(hx + sx * H, hz - mid, T, seg, wallH, 'wall', { brand: c.id, color: c.primary });
      box(hx + sx * H, hz + mid, T, seg, wallH, 'wall', { brand: c.id, color: c.primary });
    }
    // inner cover crates in two random corners
    const corners: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const cA = rng.int(0, 3);
    const cB = (cA + 2) % 4;
    for (const ci of [cA, cB]) {
      const [cx, cz] = corners[ci]!;
      box(hx + cx * 6.8, hz + cz * 6.8, 0.9, 0.9, 1.4, 'crate');
    }
    for (const ci of [0, 1, 2, 3]) {
      if (ci === cA || ci === cB) continue;
      const [cx, cz] = corners[ci]!;
      lootSpawns.push({ x: hx + cx * 6.5, z: hz + cz * 6.5, tier: 1 });
    }
    lootSpawns.push({ x: hx + 5.5, z: hz, tier: 1 }, { x: hx - 5.5, z: hz, tier: 0 });
    chestSpawns.push({ x: hx, z: hz + 5.5 });
    lights.push({ x: hx, z: hz, y: 18, color: c.primary, intensity: 4 });
  });

  // ── Roads: spokes from plaza to each HQ, plus a ring road
  for (const hq of hqs) {
    const d = Math.hypot(hq.x, hq.z);
    const ux = hq.x / d;
    const uz = hq.z / d;
    roads.push({ x1: ux * 15, z1: uz * 15, x2: hq.x - ux * (HQ_HALF + 1), z2: hq.z - uz * (HQ_HALF + 1), w: 5 });
  }
  const RING = 44;
  const RING_SEGS = 20;
  for (let i = 0; i < RING_SEGS; i++) {
    const a1 = (i / RING_SEGS) * Math.PI * 2;
    const a2 = ((i + 1) / RING_SEGS) * Math.PI * 2;
    roads.push({ x1: Math.cos(a1) * RING, z1: Math.sin(a1) * RING, x2: Math.cos(a2) * RING, z2: Math.sin(a2) * RING, w: 4 });
  }

  // ── Easter-egg landmarks, inner ring (r≈30) and corners
  const inner = (deg: number) => [Math.cos((deg * Math.PI) / 180) * 29, Math.sin((deg * Math.PI) / 180) * 29] as const;

  {
    const [x, z] = inner(0);
    landmarks.push({ id: 'pizza', name: "Laszlo's Pizza", x, z, r: 7, desc: '2 pizzas = 10,000 BTC. Worth it.' });
    reserved.push({ x, z, r: 9 });
    box(x, z, 4.5, 3.5, 4.5, 'pizza', { label: '10,000 BTC' });
    lootSpawns.push({ x: x - 6.5, z: z + 1, tier: 1 }, { x: x + 6.5, z: z - 2, tier: 1 });
    lights.push({ x, z, y: 8, color: '#FF6B2B', intensity: 3 });
  }
  {
    const [x, z] = inner(60);
    landmarks.push({ id: 'lambo', name: 'Wen Lambo', x, z, r: 6, desc: 'Soon™' });
    reserved.push({ x, z, r: 8 });
    box(x, z, 2.3, 1.05, 1.25, 'lambo', { label: 'WEN LAMBO' });
    box(x - 4.5, z + 3, 0.9, 0.9, 1.4, 'crate');
    lootSpawns.push({ x: x + 4, z: z + 3, tier: 2 });
  }
  {
    const [x, z] = inner(120);
    landmarks.push({ id: 'ftx', name: 'FTX Ruins', x, z, r: 8, desc: 'Funds are safu. (They were not.)' });
    reserved.push({ x, z, r: 10 });
    box(x - 4, z, 0.4, 3.2, 3.6, 'ruin', { label: 'FTX' });
    box(x + 1, z - 4.5, 3, 0.4, 2.2, 'ruin');
    box(x + 3.5, z + 3, 1.8, 0.4, 1.6, 'ruin');
    box(x + 0.5, z + 1, 1.1, 1.1, 1.1, 'crate');
    lootSpawns.push({ x: x - 1.5, z: z - 1.5, tier: 2 }, { x: x + 2, z: z + 0.5, tier: 1 });
    chestSpawns.push({ x: x - 2, z: z + 2.5 });
  }
  {
    const [x, z] = inner(180);
    landmarks.push({ id: 'doge', name: 'Doge Park', x, z, r: 6, desc: 'much wow. very park.' });
    reserved.push({ x, z, r: 8 });
    circle(x, z, 2.4, 5.5, 'doge', { label: 'much wow' });
    bushes.push({ x: x + 4, z: z + 3, r: 2 }, { x: x - 3.5, z: z - 4, r: 2.2 });
    lootSpawns.push({ x: x + 4.5, z: z - 2.5, tier: 1 });
  }
  {
    const [x, z] = inner(240);
    landmarks.push({ id: 'mine', name: 'Hashrate Farm', x, z, r: 8, desc: 'Proof of work. Proof of heat.' });
    reserved.push({ x, z, r: 10 });
    for (let r = 0; r < 4; r++) box(x - 4.5 + r * 3, z, 0.5, 3, 2.1, 'rig');
    lootSpawns.push({ x: x - 3, z: z + 4.5, tier: 1 }, { x: x + 3, z: z - 4.5, tier: 1 });
    chestSpawns.push({ x: x + 6, z: z + 3 });
    lights.push({ x, z, y: 6, color: '#7CFF4F', intensity: 2.5 });
  }
  {
    const [x, z] = inner(300);
    landmarks.push({ id: 'hodl', name: 'HODL Square', x, z, r: 8, desc: 'Typo since 2013. Legendary.' });
    reserved.push({ x, z, r: 10 });
    'HODL'.split('').forEach((ch, i) => box(x - 4.5 + i * 3, z, 1.1, 0.5, 3.2, 'letter', { label: ch }));
    box(x - 2, z + 4.5, 0.5, 0.4, 2, 'atm', { label: 'BTC ATM' });
    box(x + 2, z + 4.5, 0.5, 0.4, 2, 'atm', { label: 'BTC ATM' });
    lootSpawns.push({ x, z: z - 3.5, tier: 1 }, { x: x + 5, z: z + 3.5, tier: 1 });
  }
  {
    const x = 80;
    const z = 80;
    landmarks.push({ id: 'launchpad', name: 'The Launchpad', x, z, r: 10, desc: 'T-minus… to the moon.' });
    reserved.push({ x, z, r: 12 });
    circle(x, z, 2.6, 24, 'rocket', { label: 'TO THE MOON' });
    box(x - 5.5, z, 1.2, 1.2, 20, 'gantry');
    box(x + 5, z + 5, 0.9, 0.9, 1.4, 'crate');
    lootSpawns.push({ x: x + 4, z: z - 5, tier: 2 }, { x: x - 4, z: z + 5.5, tier: 2 });
    chestSpawns.push({ x: x + 6, z: z - 1 });
    lights.push({ x, z, y: 26, color: '#FF6B2B', intensity: 5 });
  }
  {
    const x = -80;
    const z = 80;
    landmarks.push({ id: 'gox', name: 'Mt. Gox Crater', x, z, r: 10, desc: '850,000 BTC went in. None came out.' });
    reserved.push({ x, z, r: 12 });
    box(x, z, 2, 1.6, 2.6, 'vault', { label: '850,000 BTC' });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      circle(x + Math.cos(a) * 8, z + Math.sin(a) * 8, rng.range(1, 1.7), rng.range(1.2, 2.4), 'rock');
    }
    lootSpawns.push({ x: x + 3.5, z: z - 3.5, tier: 2 }, { x: x - 3.5, z: z + 3.5, tier: 2 });
    chestSpawns.push({ x: x - 4, z: z - 3 });
  }
  {
    const x = -80;
    const z = -80;
    landmarks.push({ id: 'tulips', name: 'Tulip Mania', x, z, r: 11, desc: 'Amsterdam, 1637. The first rug.' });
    reserved.push({ x, z, r: 12 });
    for (let i = 0; i < 14; i++) {
      bushes.push({ x: x + rng.range(-9, 9), z: z + rng.range(-9, 9), r: rng.range(1.4, 2.4), tulip: true });
    }
    lootSpawns.push({ x: x + 2, z: z + 2, tier: 2 }, { x: x - 4, z: z - 2, tier: 1 });
    chestSpawns.push({ x: x - 1, z: z - 5 });
  }
  {
    const x = 80;
    const z = -80;
    landmarks.push({ id: 'luna', name: 'Luna Crash Site', x, z, r: 10, desc: 'UST depeg, May 2022. Stay stable.' });
    reserved.push({ x, z, r: 12 });
    circle(x, z, 4.8, 7, 'luna', { label: 'LUNA' });
    box(x - 7, z + 4, 1.6, 0.5, 1.5, 'ruin');
    box(x + 6, z + 6, 0.5, 1.6, 1.5, 'ruin');
    lootSpawns.push({ x: x - 6, z: z - 5, tier: 2 }, { x: x + 7, z: z - 2, tier: 1 });
    lights.push({ x, z, y: 10, color: '#FFD84D', intensity: 3 });
  }

  // ── Billboards (holographic floating signs) around the ring road
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const r = 44 + (i % 2 ? 4.5 : -4.5);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    billboards.push({ x, z, rot: -a + Math.PI / 2, text: BILLBOARD_TEXTS[(seed + i) % BILLBOARD_TEXTS.length]!, color: NEON[i % NEON.length]!, h: 7 });
    reserved.push({ x, z, r: 2 });
  }

  // ── Random scatter (trees, rocks, crates, containers, bushes) avoiding roads + reserved areas
  const distToSeg = (px: number, pz: number, r: Road) => {
    const dx = r.x2 - r.x1;
    const dz = r.z2 - r.z1;
    const t = Math.max(0, Math.min(1, ((px - r.x1) * dx + (pz - r.z1) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (r.x1 + dx * t), pz - (r.z1 + dz * t));
  };
  const blocked = (x: number, z: number, rad: number) => {
    if (Math.abs(x) > MAP_HALF - rad - 2 || Math.abs(z) > MAP_HALF - rad - 2) return true;
    for (const q of reserved) if (Math.hypot(x - q.x, z - q.z) < q.r + rad) return true;
    for (const rd of roads) if (distToSeg(x, z, rd) < rd.w / 2 + rad + 0.5) return true;
    for (const o of obstacles) {
      if (o.type === 'circle') {
        if (Math.hypot(x - o.x, z - o.z) < o.r + rad + 2.2) return true;
      } else if (Math.abs(x - o.x) < o.hw + rad + 2.2 && Math.abs(z - o.z) < o.hd + rad + 2.2) return true;
    }
    return false;
  };
  const scatter = (count: number, rad: number, place: (x: number, z: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = rng.range(-MAP_HALF, MAP_HALF);
      const z = rng.range(-MAP_HALF, MAP_HALF);
      if (blocked(x, z, rad)) continue;
      place(x, z);
      placed++;
    }
  };
  const CONTAINER_COLORS = ['#1E6FFF', '#FF3D6E', '#FFB020', '#20C997', '#8B5CF6', '#F97316'];
  scatter(16, 3.2, (x, z) => {
    const along = rng.chance(0.5);
    box(x, z, along ? 3 : 1.2, along ? 1.2 : 3, 2.6, 'container', { color: rng.pick(CONTAINER_COLORS) });
  });
  scatter(70, 1.3, (x, z) => circle(x, z, rng.range(0.9, 1.4), rng.range(5, 8), 'tree'));
  scatter(36, 1.4, (x, z) => circle(x, z, rng.range(0.8, 1.6), rng.range(0.9, 1.8), 'rock'));
  scatter(26, 1, (x, z) => box(x, z, 0.9, 0.9, 1.4, 'crate'));
  scatter(10, 3, (x, z) => {
    const along = rng.chance(0.5);
    box(x, z, along ? 2.8 : 0.4, along ? 0.4 : 2.8, 1.4, 'barrier');
  });
  // bushes don't collide; keep them off reserved zones but allow near roads' edges
  for (let tries = 0, n = 0; n < 45 && tries < 2000; tries++) {
    const x = rng.range(-MAP_HALF + 4, MAP_HALF - 4);
    const z = rng.range(-MAP_HALF + 4, MAP_HALF - 4);
    const r = rng.range(1.6, 2.6);
    if (blocked(x, z, r * 0.5)) continue;
    bushes.push({ x, z, r });
    n++;
  }
  // extra loot + chests out in the wild
  scatter(34, 0.8, (x, z) => lootSpawns.push({ x, z, tier: rng.chance(0.15) ? 1 : 0 }));
  scatter(8, 1, (x, z) => chestSpawns.push({ x, z }));

  return { seed, half: MAP_HALF, obstacles, bushes, roads, billboards, landmarks, hqs, lootSpawns, chestSpawns, lights };
}
