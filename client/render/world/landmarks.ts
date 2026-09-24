// Bespoke easter-egg landmarks built from primitives. Static parts go through the batcher; signs, flickering
// neon and animated bits are standalone meshes. Every landmark faces +z (south) — toward the default camera.

import * as THREE from 'three';
import type { BoxOb, CircleOb, Obstacle } from '../../../shared/map';
import { Rng } from '../../../shared/rng';
import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_SCRIPT,
  hdr,
  multiLineTexture,
  paintedTexture,
  patchWorld,
  signPlane,
  signTexture,
  TPL,
  type BuildCtx,
} from './kit';
import { buildPlume } from './plume';

const GOLD = '#e8b33c';
const BTC_ORANGE = '#f7931a';

export function buildLandmarks(ctx: BuildCtx, obstacles: Obstacle[]): void {
  const rng = new Rng(ctx.map.seed ^ 0x1a2d);
  let letterMats: THREE.Material[] | null = null;
  for (const o of obstacles) {
    switch (o.style) {
      case 'statue':
        if (o.type === 'circle') buildSatoshi(ctx, o);
        break;
      case 'monolith':
        if (o.type === 'box') buildMonolith(ctx, o);
        break;
      case 'pizza':
        if (o.type === 'box') buildPizzaShop(ctx, o);
        break;
      case 'lambo':
        if (o.type === 'box') buildLambo(ctx, o);
        break;
      case 'ruin':
        if (o.type === 'box') buildRuin(ctx, o, rng);
        break;
      case 'doge':
        if (o.type === 'circle') buildDoge(ctx, o);
        break;
      case 'rig':
        if (o.type === 'box') buildRig(ctx, o);
        break;
      case 'letter':
        if (o.type === 'box') buildLetter(ctx, o, (letterMats ??= makeLetterMaterials(ctx)));
        break;
      case 'atm':
        if (o.type === 'box') buildAtm(ctx, o);
        break;
      case 'rocket':
        if (o.type === 'circle') buildRocket(ctx, o);
        break;
      case 'gantry':
        if (o.type === 'box') buildGantry(ctx, o);
        break;
      case 'vault':
        if (o.type === 'box') buildVault(ctx, o);
        break;
      case 'luna':
        if (o.type === 'circle') buildLuna(ctx, o, rng);
        break;
      default:
        break;
    }
  }
  const farm = ctx.map.landmarks.find((l) => l.id === 'mine');
  if (farm) buildFarmSign(ctx, farm.x, farm.z);
  const hodl = ctx.map.landmarks.find((l) => l.id === 'hodl');
  if (hodl) ctx.light(hodl.x, 3, hodl.z + 2, BTC_ORANGE, 2.2, 12);
}

/** Adds a standalone sign facing south at world (x, y, z), optionally tilted back by `tilt` rad. */
function placeSign(ctx: BuildCtx, mesh: THREE.Object3D, x: number, y: number, z: number, tilt = 0, yaw = 0): void {
  mesh.position.set(x, y, z);
  mesh.rotation.set(-tilt, yaw, 0, 'YXZ');
  ctx.root.add(mesh);
}

function neonSign(
  ctx: BuildCtx,
  text: string,
  width: number,
  color: string,
  opts: { font?: string; intensity?: number; texColor?: string; aspect?: number; doubleSide?: boolean } = {},
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const aspect = opts.aspect ?? 4;
  const tex = signTexture(ctx.bag, text, {
    width: 1024,
    height: Math.round(1024 / aspect),
    font: opts.font ?? FONT_DISPLAY,
    color: opts.texColor ?? '#ffffff',
    glow: color,
  });
  return signPlane(ctx.bag, tex, width, width / aspect, color, opts.intensity ?? 2.2, { doubleSide: opts.doubleSide });
}

// ───────────────────────────── Genesis Plaza ─────────────────────────────

function buildSatoshi(ctx: BuildCtx, o: CircleOb): void {
  const p = ctx.batch.at(o.x, o.z);
  // stepped pedestal
  p.cyl('rough', 0, 0.2, 0, o.r + 0.5, 0.4, '#1d1f2c', undefined, 8);
  p.cyl('lit', 0, 1.0, 0, o.r * 0.82, 1.2, '#262939', undefined, 8);
  p.band('glow', 0, 1.58, 0, o.r * 0.83, 0.06, GOLD, { intensity: 2 });
  p.band('glow', 0, 0.37, 0, o.r + 0.51, 0.05, GOLD, { intensity: 1.6 });
  // hooded figure (robe, shoulders, hood, void face, coin held at the chest)
  const b = 1.6;
  p.add('metal', TPL.cone16, 0, b + 1.75, 0, 1.2, 3.5, 1.05, GOLD);
  p.sphere('metal', 0, b + 3.35, 0, 0.95, 0.5, 0.78, GOLD);
  p.sphere('metal', 0, b + 4.05, -0.05, 0.6, 0.72, 0.62, GOLD);
  p.add('metal', TPL.cone16, 0, b + 4.75, -0.2, 0.32, 0.5, 0.32, GOLD, { rx: -0.5 });
  p.sphere('lit', 0, b + 3.95, 0.3, 0.38, 0.48, 0.34, '#030306');
  p.sphere('glow', -0.13, b + 4.0, 0.55, 0.045, 0.03, 0.02, '#ffb627', { intensity: 5 });
  p.sphere('glow', 0.13, b + 4.0, 0.55, 0.045, 0.03, 0.02, '#ffb627', { intensity: 5 });
  // arms reaching forward to the coin
  p.cyl('metal', -0.55, b + 2.75, 0.45, 0.2, 1.1, GOLD, { rx: 1.1, rz: 0.35 });
  p.cyl('metal', 0.55, b + 2.75, 0.45, 0.2, 1.1, GOLD, { rx: 1.1, rz: -0.35 });
  p.cyl('glow', 0, b + 2.65, 1.0, 0.36, 0.06, '#ffb627', { rx: Math.PI / 2, intensity: 2.2 }, 32);
  // plaque
  const plaque = new THREE.Group();
  const name = neonSign(ctx, 'SATOSHI NAKAMOTO', 2.9, '#ffb627', { intensity: 1.8, aspect: 8 });
  name.position.set(0, 1.18, 0);
  const sub = neonSign(ctx, 'BLOCK 0 · 03 JAN 2009', 2.2, '#ffe2a0', { intensity: 1.2, aspect: 10, font: FONT_BODY });
  sub.position.set(0, 0.82, 0);
  plaque.add(name, sub);
  placeSign(ctx, plaque, o.x, 0, o.z + o.r * 0.82 + 0.06);
}

function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function buildMonolith(ctx: BuildCtx, o: BoxOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const w = o.hw * 2;
  const d = o.hd * 2;
  p.box('rough', 0, 0.12, 0, w + 0.8, 0.24, d + 0.8, '#1a1b26');
  p.box('glass', 0, o.h / 2 + 0.24, 0, w, o.h, d, '#040408');
  for (const sx of [-1, 1])
    p.box('glow', sx * (w / 2 + 0.01), o.h / 2 + 0.24, 0, 0.03, o.h, d + 0.02, '#ffb627', { intensity: 2.6 });
  p.frame('glow', o.h + 0.25, w + 0.02, d + 0.02, 0.05, 0.03, '#ffb627', { intensity: 2.4 });
  const lines = ['BLOCK 0', ...wrapWords(o.label ?? 'Chancellor on brink of second bailout for banks', 22)];
  const tex = multiLineTexture(ctx.bag, lines, {
    width: 512,
    height: 820,
    font: '700 {px}px "Space Grotesk", ui-monospace, monospace',
    color: '#ffd98a',
    glow: '#ff9d00',
  });
  for (const side of [1, -1]) {
    const plane = signPlane(ctx.bag, tex, w * 0.86, o.h * 0.86, '#ffffff', 1.05);
    placeSign(ctx, plane, o.x, o.h / 2 + 0.24, o.z + side * (d / 2 + 0.012), 0, side > 0 ? 0 : Math.PI);
  }
  ctx.light(o.x, 2, o.z + 1.2, '#ffb627', 1.2, 6);
}

// ───────────────────────────── Laszlo's Pizza ─────────────────────────────

function pizzaTexture(ctx: BuildCtx): THREE.Texture {
  return paintedTexture(ctx.bag, 512, 512, (g) => {
    const c = 256;
    g.fillStyle = '#c9651f';
    g.fillRect(0, 0, 512, 512);
    const sauce = g.createRadialGradient(c, c, 60, c, c, 250);
    sauce.addColorStop(0, '#ffcf3f');
    sauce.addColorStop(0.8, '#ffb52e');
    sauce.addColorStop(1, '#d9441c');
    g.fillStyle = sauce;
    g.beginPath();
    g.arc(c, c, 236, 0, Math.PI * 2);
    g.fill();
    const rng = new Rng(10000);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,240,160,${rng.range(0.2, 0.5)})`;
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 220);
      g.beginPath();
      g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rng.range(6, 18), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 17; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(30, 200);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      g.fillStyle = '#b3141c';
      g.beginPath();
      g.arc(x, y, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,90,70,0.5)';
      g.beginPath();
      g.arc(x - 6, y - 6, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#3a8a2a';
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(20, 210);
      g.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 12, 6);
    }
  });
}

function buildPizzaShop(ctx: BuildCtx, o: BoxOb): void {
  const { bag } = ctx;
  const p = ctx.batch.at(o.x, o.z);
  const w = o.hw * 2;
  const d = o.hd * 2;
  const h = o.h - 0.4;
  p.box('rough', 0, h / 2, 0, w, h, d, '#5a1f22');
  // brick courses
  for (let y = 0.45; y < h; y += 0.45) p.box('rough', 0, y, 0, w + 0.02, 0.04, d + 0.02, '#3f1418');
  p.box('lit', 0, h + 0.2, 0, w + 0.3, 0.4, d + 0.3, '#e9e1d2');
  p.box('lit', 0, 0.2, 0, w + 0.1, 0.4, d + 0.1, '#e9e1d2');
  // storefront window + door
  p.box('glow', -1.3, 1.45, d / 2 + 0.02, 4.4, 1.7, 0.03, '#ffcf7a', { intensity: 1.3 });
  p.box('glow', 2.6, 1.15, d / 2 + 0.02, 1.2, 2.1, 0.03, '#ffe6b0', { intensity: 1.1 });
  p.box('lit', -1.3, 1.45, d / 2 + 0.05, 0.08, 1.7, 0.03, '#e9e1d2');
  // striped awning
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    const x = -w / 2 + (i + 0.5) * (w / stripes);
    p.box('lit', x, 2.75, d / 2 + 0.55, w / stripes, 0.06, 1.25, i % 2 ? '#f2f2f2' : '#d4202a', { rx: 0.35 });
  }
  // neon signs
  const title = neonSign(ctx, "LASZLO'S PIZZA", w * 0.9, '#ff5a2b', { intensity: 2.4, aspect: 6 });
  placeSign(ctx, title, o.x, 3.6, o.z + d / 2 + 0.04);
  const price = neonSign(ctx, o.label ?? '10,000 BTC', w * 0.34, '#ffe600', { intensity: 2.6, aspect: 3.5 });
  placeSign(ctx, price, o.x - 1.3, 1.45, o.z + d / 2 + 0.06);
  const dateTag = neonSign(ctx, 'EST. 22 MAY 2010', 2.4, '#7cf5ff', { intensity: 1.6, aspect: 8, font: FONT_BODY });
  placeSign(ctx, dateTag, o.x + 2.6, 2.45, o.z + d / 2 + 0.06);

  // giant pizza on the roof, tilted toward the street, with the famous missing slice
  const pizzaTex = pizzaTexture(ctx);
  const R = 3.3;
  const pizzaGeo = bag.track(new THREE.CylinderGeometry(R, R, 0.3, 48, 1, false, Math.PI * 0.25, Math.PI * 1.75));
  const pizzaMat = bag.track(
    new THREE.MeshStandardMaterial({
      map: pizzaTex,
      emissiveMap: pizzaTex,
      emissive: hdr('#ffffff', 0.55),
      roughness: 0.7,
    }),
  );
  patchWorld(pizzaMat, { key: 'pizza' });
  const pizza = new THREE.Group();
  const disc = new THREE.Mesh(pizzaGeo, pizzaMat);
  disc.castShadow = true;
  const crustGeo = bag.track(new THREE.TorusGeometry(R, 0.24, 8, 48, Math.PI * 1.75));
  const crustMat = bag.track(new THREE.MeshStandardMaterial({ color: '#c9772a', roughness: 0.8 }));
  patchWorld(crustMat, { key: 'crust' });
  const crust = new THREE.Mesh(crustGeo, crustMat);
  crust.rotation.x = Math.PI / 2;
  crust.rotation.z = -Math.PI * 0.25 - Math.PI / 2;
  disc.add(crust);
  pizza.add(disc);
  disc.rotation.x = Math.PI / 2 - 0.9;
  pizza.position.set(o.x, h + 3.3, o.z - 0.6);
  ctx.root.add(pizza);
  p.cyl('metal', -1.2, h + 1.2, -0.8, 0.1, 2.4, '#333746', undefined, 8);
  p.cyl('metal', 1.2, h + 1.2, -0.8, 0.1, 2.4, '#333746', undefined, 8);
  // the 10,000 BTC slice floats beside it, spinning
  const sliceGeo = bag.track(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.2, 12, 1, false, 0, Math.PI * 0.25));
  const slice = new THREE.Mesh(sliceGeo, pizzaMat);
  const sliceHolder = new THREE.Group();
  sliceHolder.position.set(o.x + w / 2 + 1.2, h + 3.6, o.z);
  sliceHolder.add(slice);
  const sliceTag = neonSign(ctx, '= 5,000 BTC', 2.2, '#ffe600', { intensity: 2, aspect: 5, doubleSide: true });
  sliceTag.position.set(0, 1.5, 0);
  sliceHolder.add(sliceTag);
  ctx.root.add(sliceHolder);
  ctx.animate((time) => {
    slice.rotation.set(0.6, time * 1.2, 0.3);
    sliceHolder.position.y = h + 3.6 + Math.sin(time * 1.6) * 0.3;
  });
  ctx.light(o.x, 2.2, o.z + d / 2 + 1.6, '#ffae5a', 2.2, 9);
}

// ───────────────────────────── Wen Lambo ─────────────────────────────

function buildLambo(ctx: BuildCtx, o: BoxOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const L = o.hw * 2;
  const W = o.hd * 2;
  // podium
  p.cyl('lit', 0, 0.1, 0, 3.3, 0.2, '#15161f', undefined, 32);
  p.band('glow', 0, 0.17, 0, 3.31, 0.05, GOLD, { intensity: 2.4 });
  // wedge body from an extruded side profile (x = length, y = height)
  const s = new THREE.Shape();
  const hx = L / 2;
  s.moveTo(-hx, 0.32);
  s.lineTo(-hx, 0.78);
  s.lineTo(-hx + 0.35, 0.92);
  s.lineTo(-0.7, 1.02);
  s.lineTo(-0.15, 1.18);
  s.lineTo(0.35, 1.16);
  s.lineTo(1.25, 0.78);
  s.lineTo(hx - 0.05, 0.52);
  s.lineTo(hx, 0.4);
  s.lineTo(hx - 0.1, 0.3);
  s.lineTo(-hx + 0.1, 0.26);
  s.closePath();
  const body = new THREE.ExtrudeGeometry(s, {
    depth: W - 0.2,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  body.translate(0, 0, -(W - 0.2) / 2);
  p.add('metal', body, 0, 0.2, 0, 1, 1, 1, '#d4a032');
  body.dispose();
  // cockpit glass
  const g = new THREE.Shape();
  g.moveTo(-0.7, 1.0);
  g.lineTo(-0.15, 1.16);
  g.lineTo(0.35, 1.14);
  g.lineTo(1.15, 0.8);
  g.lineTo(-0.9, 0.84);
  g.closePath();
  const glass = new THREE.ExtrudeGeometry(g, { depth: W - 0.5, bevelEnabled: false });
  glass.translate(0, 0.04, -(W - 0.5) / 2);
  p.add('glass', glass, 0, 0.2, 0, 1, 1, 1, '#07080f');
  glass.dispose();
  // wheels, headlights, tail lights, underglow
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.cyl('lit', sx * (hx - 0.75), 0.56, sz * (W / 2 - 0.05), 0.36, 0.3, '#0c0c10', { rx: Math.PI / 2 });
      p.cyl('metal', sx * (hx - 0.75), 0.56, sz * (W / 2 + 0.1), 0.22, 0.04, GOLD, { rx: Math.PI / 2 });
    }
  }
  p.box('glow', hx + 0.02, 0.62, 0, 0.04, 0.06, W * 0.8, '#eaffff', { intensity: 4 });
  p.box('glow', -hx - 0.02, 0.9, 0, 0.04, 0.08, W * 0.85, '#ff1030', { intensity: 4 });
  p.box('glow', 0, 0.23, 0, L * 0.85, 0.02, W * 0.75, '#00f0ff', { intensity: 2.2 });
  // signs
  const sign = neonSign(ctx, o.label ?? 'WEN LAMBO', 4.2, '#ffd23f', { intensity: 2.6, aspect: 4.5 });
  placeSign(ctx, sign, o.x, 3.1, o.z + 0.2, 0.25);
  const soon = neonSign(ctx, 'soon™', 1.5, '#ff2bd6', { intensity: 2.4, aspect: 3, font: FONT_SCRIPT });
  placeSign(ctx, soon, o.x + 2.1, 2.35, o.z + 0.3, 0.25);
  ctx.light(o.x, 2.4, o.z + 2.6, '#ffd98a', 1.1, 8);
}

// ───────────────────────────── FTX ruins ─────────────────────────────

function buildRuin(ctx: BuildCtx, o: BoxOb, rng: Rng): void {
  const alongX = o.hw >= o.hd;
  const p = ctx.batch.at(o.x, o.z, alongX ? 0 : Math.PI / 2);
  const len = (alongX ? o.hw : o.hd) * 2;
  const th = (alongX ? o.hd : o.hw) * 2;
  const chunk = 0.6;
  const n = Math.max(2, Math.round(len / chunk));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    const edge = Math.min(i, n - 1 - i) / (n / 2);
    const hh = o.h * (0.35 + 0.65 * Math.min(1, edge * 1.6 + 0.25) * rng.range(0.55, 1));
    p.box(
      'rough',
      x,
      hh / 2,
      0,
      len / n + 0.02,
      hh,
      th * rng.range(0.85, 1.05),
      rng.chance(0.5) ? '#3a3a46' : '#33333f',
    );
    if (rng.chance(0.3))
      p.cyl('metal', x, hh + 0.3, rng.range(-0.1, 0.1), 0.025, 0.6, '#7a4a2c', { rz: rng.range(-0.5, 0.5) }, 8);
  }
  // rubble at the base (low; stays within cover height)
  for (let i = 0; i < 7; i++) {
    const x = rng.range(-len / 2, len / 2);
    const z = rng.range(th / 2, th / 2 + 0.7) * (rng.chance(0.5) ? 1 : -1);
    const sz = rng.range(0.2, 0.45);
    p.add('rough', TPL.ico, x, sz * 0.5, z, sz, sz * 0.7, sz, '#2c2c36', { ry: rng.range(0, 6) });
  }
  if (o.label === 'FTX') buildFtxSign(ctx, o);
  if (alongX && !o.label && len > 4) {
    // graffiti on the long south-facing wall
    const tex = paintedTexture(ctx.bag, 1024, 256, (g) => {
      g.font = 'italic 900 118px "Marker Felt", "Comic Sans MS", cursive';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ff2bd6';
      g.shadowBlur = 18;
      g.fillStyle = '#ff5fe0';
      g.save();
      g.translate(512, 128);
      g.rotate(-0.06);
      g.fillText('funds are safu', 0, 0);
      g.restore();
      g.fillStyle = '#7cff4f';
      g.shadowColor = '#7cff4f';
      g.font = '900 44px "Marker Felt", cursive';
      g.fillText('— SBF, probably', 760, 218);
    });
    const graffiti = signPlane(ctx.bag, tex, len * 0.9, len * 0.9 * 0.25, '#ffffff', 1.25);
    placeSign(ctx, graffiti, o.x, o.h * 0.42, o.z + th / 2 + 0.02);
  }
}

function buildFtxSign(ctx: BuildCtx, o: BoxOb): void {
  // "F" and "X" still hang on the frame (one flickering, one sputtering); the "T" fell off and lies in the rubble.
  const group = new THREE.Group();
  const f = neonSign(ctx, 'F', 2.1, '#20e0c8', { intensity: 2.6, aspect: 1, doubleSide: true });
  f.position.set(-1.2, 0, 0);
  const x = neonSign(ctx, 'X', 2.1, '#20e0c8', { intensity: 2.6, aspect: 1, doubleSide: true });
  x.position.set(1.25, -0.35, 0);
  x.rotation.z = -0.25;
  group.add(f, x);
  const frame = ctx.batch.at(o.x, o.z);
  frame.box('metal', 0, o.h + 2.25, 0, 4.2, 0.1, 0.1, '#444a5a', { rz: 0.06 });
  frame.cyl('metal', -1.8, o.h + 1.1, 0, 0.06, 2.3, '#444a5a', undefined, 8);
  frame.cyl('metal', 1.6, o.h + 1.3, 0, 0.06, 1.9, '#444a5a', { rz: 0.3 }, 8);
  placeSign(ctx, group, o.x, o.h + 1.2, o.z, 0.45);
  const fallen = neonSign(ctx, 'T', 1.9, '#20e0c8', { intensity: 1.6, aspect: 1, doubleSide: true });
  fallen.position.set(o.x + 1.6, 0.08, o.z + 2.2);
  fallen.rotation.set(-Math.PI / 2 + 0.12, 0, 0.7);
  ctx.root.add(fallen);
  const mats = [f.material, x.material, fallen.material];
  const base = mats.map((m) => m.color.clone());
  ctx.animate((time) => {
    const fOn = Math.sin(time * 37) * Math.sin(time * 13.7) > -0.6 ? 1 : 0.15;
    const xOn = Math.sin(time * 71) > 0.2 || Math.sin(time * 0.9) > 0.5 ? 1 : 0.1;
    const tOn = Math.sin(time * 3.1) > 0.9 && Math.sin(time * 53) > 0 ? 0.9 : 0.06;
    mats[0]!.color.copy(base[0]!).multiplyScalar(fOn);
    mats[1]!.color.copy(base[1]!).multiplyScalar(xOn);
    mats[2]!.color.copy(base[2]!).multiplyScalar(tOn);
  });
  ctx.light(o.x + 0.5, o.h + 1, o.z + 1, '#20e0c8', 1.2, 8);
}

// ───────────────────────────── Doge Park ─────────────────────────────

function buildDoge(ctx: BuildCtx, o: CircleOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const fur = '#d9954a';
  const cream = '#f3dcb2';
  p.cyl('rough', 0, 0.6, 0, o.r, 1.2, '#2a2b3a', undefined, 16);
  p.band('glow', 0, 1.15, 0, o.r + 0.01, 0.06, '#ffcc4d', { intensity: 2.2 });
  const b = 1.2;
  // body (sitting), chest, haunches, legs
  p.sphere('lit', 0, b + 1.25, -0.2, 1.05, 1.3, 1.15, fur);
  p.sphere('lit', 0, b + 1.3, 0.45, 0.72, 0.95, 0.6, cream);
  p.sphere('lit', -0.72, b + 0.55, -0.35, 0.55, 0.55, 0.8, fur);
  p.sphere('lit', 0.72, b + 0.55, -0.35, 0.55, 0.55, 0.8, fur);
  p.cyl('lit', -0.38, b + 0.6, 0.72, 0.2, 1.2, cream);
  p.cyl('lit', 0.38, b + 0.6, 0.72, 0.2, 1.2, cream);
  p.sphere('lit', -0.38, b + 0.08, 0.85, 0.24, 0.12, 0.3, cream);
  p.sphere('lit', 0.38, b + 0.08, 0.85, 0.24, 0.12, 0.3, cream);
  // head: skull, cheeks, snout, nose, eyes, ears (tilted — the iconic side-eye)
  const hy = b + 3.0;
  p.sphere('lit', 0, hy, 0.25, 0.82, 0.74, 0.76, fur);
  p.sphere('lit', 0, hy - 0.22, 0.62, 0.62, 0.42, 0.5, cream);
  p.sphere('lit', 0, hy - 0.12, 1.02, 0.34, 0.26, 0.4, cream);
  p.sphere('lit', 0, hy - 0.02, 1.38, 0.12, 0.09, 0.08, '#111111');
  p.sphere('lit', -0.32, hy + 0.2, 0.86, 0.1, 0.09, 0.06, '#111111');
  p.sphere('lit', 0.32, hy + 0.2, 0.86, 0.1, 0.09, 0.06, '#111111');
  p.sphere('glow', -0.3, hy + 0.23, 0.91, 0.03, 0.03, 0.02, '#ffffff', { intensity: 2 });
  p.sphere('glow', 0.34, hy + 0.23, 0.91, 0.03, 0.03, 0.02, '#ffffff', { intensity: 2 });
  p.add('lit', TPL.cone8, -0.48, hy + 0.72, 0.12, 0.26, 0.6, 0.18, fur, { rz: 0.3 });
  p.add('lit', TPL.cone8, 0.48, hy + 0.72, 0.12, 0.26, 0.6, 0.18, fur, { rz: -0.3 });
  // curled tail
  p.add('lit', TPL.torus, 0, b + 1.3, -1.35, 0.4, 0.4, 3.5, fur, { ry: Math.PI / 2 });
  // floating doge-speak
  const phrases: [string, string, number, number, number][] = [
    [o.label ?? 'much wow', '#ff4fd8', -3.2, 5.2, 1.0],
    ['very park', '#00f0ff', 3.3, 4.2, 0.6],
    ['such statue', '#7cff4f', -3.4, 2.4, 1.6],
    ['so HODL', '#ffe600', 3.0, 6.3, -0.6],
    ['wow', '#ff7a1a', 0.2, 7.1, -0.4],
  ];
  phrases.forEach(([text, color, x, y, z], i) => {
    const sign = neonSign(ctx, text, text.length * 0.42 + 0.6, color, {
      intensity: 2.3,
      aspect: 4,
      font: FONT_SCRIPT,
      doubleSide: true,
    });
    placeSign(ctx, sign, o.x + x, y, o.z + z, 0.3, (i % 2 ? -1 : 1) * 0.12);
    ctx.animate((time) => {
      sign.position.y = y + Math.sin(time * 1.3 + i * 1.7) * 0.25;
    });
  });
  ctx.light(o.x, 4, o.z + 3, '#ffb35a', 1.6, 9);
}

// ───────────────────────────── Hashrate Farm ─────────────────────────────

function buildRig(ctx: BuildCtx, o: BoxOb): void {
  const alongZ = o.hd > o.hw;
  const p = ctx.batch.at(o.x, o.z, alongZ ? Math.PI / 2 : 0);
  const len = (alongZ ? o.hd : o.hw) * 2;
  const th = (alongZ ? o.hw : o.hd) * 2;
  p.box('metal', 0, o.h / 2, 0, len, o.h, th, '#1a1d28');
  for (const x of [-len / 2, 0, len / 2]) p.box('metal', x, o.h / 2, 0, 0.1, o.h + 0.05, th + 0.06, '#2e3345');
  // ASIC slots with blinking status LEDs on both faces + top
  for (let row = 0; row < 4; row++) {
    const y = 0.35 + row * 0.45;
    for (const side of [1, -1]) {
      p.box('lit', 0, y, side * (th / 2 + 0.005), len - 0.3, 0.34, 0.01, '#0e1016');
      for (let x = -len / 2 + 0.3; x < len / 2 - 0.2; x += 0.34) {
        p.box('blink', x, y + 0.08, side * (th / 2 + 0.015), 0.05, 0.05, 0.01, row % 2 ? '#39ff88' : '#00e5ff', {
          intensity: 3.5,
        });
      }
    }
  }
  for (let x = -len / 2 + 0.35; x < len / 2 - 0.2; x += 0.7) {
    p.cyl('lit', x, o.h + 0.02, 0, 0.22, 0.04, '#0b0c12', undefined, 16);
    p.cyl('glow', x, o.h + 0.045, 0, 0.14, 0.01, '#39ff88', { intensity: 1.6 }, 16);
    p.box('blink', x + 0.3, o.h + 0.03, th / 2 - 0.08, 0.05, 0.03, 0.05, '#ff3b5c', { intensity: 3 });
  }
  // cables to the ground
  p.box('lit', len / 2 + 0.2, 0.03, 0, 0.4, 0.05, 0.12, '#101014');
  buildPlume(ctx, {
    x: o.x,
    y: o.h,
    z: o.z,
    count: 30,
    color: '#9fffd0',
    colorEnd: '#304050',
    radius: 0.4,
    spread: 0.8,
    rise: 3.5,
    life: 2.8,
    size: 0.35,
    grow: 3,
    opacity: 0.12,
    additive: true,
  });
}

function buildFarmSign(ctx: BuildCtx, x: number, z: number): void {
  const sign = neonSign(ctx, 'PROOF OF WORK', 6, '#39ff88', { intensity: 1.8, aspect: 7 });
  placeSign(ctx, sign, x, 4.4, z - 4.6, 0.3);
  const rate = neonSign(ctx, '420.69 EH/s · 3 kWh per meme', 5, '#00e5ff', {
    intensity: 1.3,
    aspect: 12,
    font: FONT_BODY,
  });
  placeSign(ctx, rate, x, 3.55, z - 4.55, 0.3);
  const p = ctx.batch.at(x, z - 4.6);
  p.cyl('metal', -2.6, 1.9, 0, 0.06, 3.8, '#2a2e40', undefined, 8);
  p.cyl('metal', 2.6, 1.9, 0, 0.06, 3.8, '#2a2e40', undefined, 8);
}

// ───────────────────────────── HODL letters + ATMs ─────────────────────────────

function letterShape(ch: string, w: number, h: number): THREE.Shape {
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const t = w * 0.28; // stroke
  const s = new THREE.Shape();
  switch (ch) {
    case 'H':
      s.moveTo(x0, y0);
      s.lineTo(x0 + t, y0);
      s.lineTo(x0 + t, -t / 2);
      s.lineTo(x1 - t, -t / 2);
      s.lineTo(x1 - t, y0);
      s.lineTo(x1, y0);
      s.lineTo(x1, y1);
      s.lineTo(x1 - t, y1);
      s.lineTo(x1 - t, t / 2);
      s.lineTo(x0 + t, t / 2);
      s.lineTo(x0 + t, y1);
      s.lineTo(x0, y1);
      break;
    case 'O': {
      const r = w / 2;
      s.moveTo(x0, y0 + r);
      s.absarc(0, y0 + r, r, Math.PI, 0, false);
      s.lineTo(x1, y1 - r);
      s.absarc(0, y1 - r, r, 0, Math.PI, false);
      s.closePath();
      const hole = new THREE.Path();
      const ri = r - t;
      hole.moveTo(-ri, y0 + r);
      hole.absarc(0, y0 + r, ri, Math.PI, 0, false);
      hole.lineTo(ri, y1 - r);
      hole.absarc(0, y1 - r, ri, 0, Math.PI, false);
      hole.closePath();
      s.holes.push(hole);
      break;
    }
    case 'D': {
      const r = w * 0.55;
      s.moveTo(x0, y0);
      s.lineTo(x1 - r, y0);
      s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
      s.lineTo(x1, y1 - r);
      s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
      s.lineTo(x0, y1);
      s.closePath();
      const hole = new THREE.Path();
      const ri = r - t;
      hole.moveTo(x0 + t, y0 + t);
      hole.lineTo(x1 - r, y0 + t);
      hole.absarc(x1 - r, y0 + r, ri, -Math.PI / 2, 0, false);
      hole.lineTo(x1 - t, y1 - r);
      hole.absarc(x1 - r, y1 - r, ri, 0, Math.PI / 2, false);
      hole.lineTo(x0 + t, y1 - t);
      hole.closePath();
      s.holes.push(hole);
      break;
    }
    case 'L':
      s.moveTo(x0, y0);
      s.lineTo(x1, y0);
      s.lineTo(x1, y0 + t);
      s.lineTo(x0 + t, y0 + t);
      s.lineTo(x0 + t, y1);
      s.lineTo(x0, y1);
      break;
    default:
      s.moveTo(x0, y0);
      s.lineTo(x1, y0);
      s.lineTo(x1, y1);
      s.lineTo(x0, y1);
  }
  return s;
}

/** [glowing front face, dark sides] shared by all HODL letters. */
function makeLetterMaterials(ctx: BuildCtx): THREE.Material[] {
  const face = ctx.bag.track(new THREE.MeshBasicMaterial({ color: hdr(BTC_ORANGE, 1.7) }));
  const side = ctx.bag.track(new THREE.MeshStandardMaterial({ color: '#1b1c28', roughness: 0.4, metalness: 0.7 }));
  patchWorld(face, { key: 'letter-face' });
  patchWorld(side, { key: 'letter-side' });
  return [face, side];
}

function buildLetter(ctx: BuildCtx, o: BoxOb, mats: THREE.Material[]): void {
  const { bag } = ctx;
  const w = o.hw * 2;
  const depth = o.hd * 2;
  const geo = bag.track(
    new THREE.ExtrudeGeometry(letterShape(o.label ?? 'H', w, o.h - 0.3), {
      depth,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 1,
      curveSegments: 10,
    }),
  );
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.set(o.x, (o.h - 0.3) / 2 + 0.3, o.z);
  mesh.castShadow = true;
  ctx.root.add(mesh);
  const p = ctx.batch.at(o.x, o.z);
  p.box('lit', 0, 0.15, 0, w + 0.3, 0.3, depth + 0.3, '#15161f');
  p.box('glow', 0, 0.31, depth / 2 + 0.16, w + 0.3, 0.03, 0.03, BTC_ORANGE, { intensity: 2 });
}

function buildAtm(ctx: BuildCtx, o: BoxOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const w = o.hw * 2;
  const d = o.hd * 2;
  p.box('lit', 0, 0.55, 0, w, 1.1, d, BTC_ORANGE);
  p.box('metal', 0, 1.55, 0, w, 0.9, d, '#15161f');
  p.box('lit', 0, 1.93, 0, w + 0.06, 0.14, d + 0.06, BTC_ORANGE);
  p.box('lit', 0, 1.02, d / 2 + 0.1, w * 0.8, 0.06, 0.25, '#222430', { rx: 0.3 });
  p.box('glow', 0, 0.75, d / 2 + 0.005, w * 0.5, 0.05, 0.01, '#39ff88', { intensity: 2.5 });
  const screen = multiLineTexture(ctx.bag, ['₿ BTC ATM', 'BUY HIGH', 'SELL LOW'], {
    width: 256,
    height: 256,
    font: '800 {px}px ui-monospace, "Space Grotesk", monospace',
    color: '#aef7ff',
    background: '#062a3a',
    border: '#3ad0ff',
  });
  const sp = signPlane(ctx.bag, screen, w * 0.78, w * 0.78, '#ffffff', 1.3);
  placeSign(ctx, sp, o.x, 1.55, o.z + d / 2 + 0.01);
  const top = neonSign(ctx, '₿', 0.8, BTC_ORANGE, { intensity: 3, aspect: 1 });
  placeSign(ctx, top, o.x, 2.4, o.z, 0, 0);
  ctx.animate((time) => {
    top.rotation.y = time * 1.5;
  });
  top.material.side = THREE.DoubleSide;
}

// ───────────────────────────── The Launchpad ─────────────────────────────

function buildRocket(ctx: BuildCtx, o: CircleOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const R = o.r * 0.78;
  // launch pad
  p.cyl('rough', 0, 0.25, 0, 7.2, 0.5, '#23242f', undefined, 32);
  p.band('glow', 0, 0.45, 0, 7.21, 0.06, '#ffb020', { intensity: 2.2 });
  p.cyl('lit', 0, 0.62, 0, 3.4, 0.24, '#15161d', undefined, 32);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    p.box('glow', Math.cos(a) * 6.3, 0.52, Math.sin(a) * 6.3, 0.9, 0.02, 0.25, i % 2 ? '#ffb020' : '#1a1a1a', {
      ry: -a,
      intensity: i % 2 ? 2 : 1,
    });
  }
  // body via lathe profile
  const profile = [
    [0, 1.5],
    [R * 0.72, 1.5],
    [R * 0.95, 2.3],
    [R, 3.2],
    [R, o.h * 0.66],
    [R * 0.96, o.h * 0.72],
    [R * 0.78, o.h * 0.82],
    [R * 0.45, o.h * 0.92],
    [R * 0.14, o.h * 0.985],
    [0, o.h],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(profile, 28);
  p.add('lit', lathe, 0, 0, 0, 1, 1, 1, '#e9ebf3');
  lathe.dispose();
  // livery bands, porthole, fins, nozzles
  p.cyl('lit', 0, o.h * 0.6, 0, R + 0.03, 0.9, '#15161f', undefined, 32);
  p.band('glow', 0, o.h * 0.6 + 0.5, 0, R + 0.04, 0.08, '#ff6b2b', { intensity: 2.6 });
  p.cyl('lit', 0, 4.2, 0, R + 0.03, 0.6, '#ff6b2b', undefined, 32);
  p.sphere('glow', 0, o.h * 0.74, R * 0.9, 0.42, 0.42, 0.2, '#7cf5ff', { intensity: 2.4 });
  p.add('metal', TPL.torus, 0, o.h * 0.74, R * 0.92, 0.45, 0.45, 2, '#c9ccd8');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(1.9, -0.6);
    fin.lineTo(1.9, 1.0);
    fin.lineTo(0, 4.6);
    fin.closePath();
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: false }).translate(0, 0, -0.09);
    p.add('lit', fg, Math.cos(a) * (R - 0.1), 1.9, Math.sin(a) * (R - 0.1), 1, 1, 1, '#ff6b2b', { ry: -a });
    fg.dispose();
    p.add('metal', TPL.cone16, Math.cos(a) * R * 0.4, 1.1, Math.sin(a) * R * 0.4, 0.45, 0.8, 0.45, '#3a3d4c', {
      rx: Math.PI,
    });
    p.cyl('glow', Math.cos(a) * R * 0.4, 0.72, Math.sin(a) * R * 0.4, 0.34, 0.04, '#ff8a2b', { intensity: 4 }, 16);
  }
  // vertical "TO THE MOON" livery
  const text = neonSign(ctx, o.label ?? 'TO THE MOON', 9, '#ff6b2b', {
    intensity: 1.6,
    aspect: 7,
    texColor: '#ffffff',
  });
  text.rotation.set(0, 0, Math.PI / 2);
  text.position.set(o.x, o.h * 0.38, o.z + R + 0.05);
  ctx.root.add(text);
  const soon = neonSign(ctx, 'LAUNCH: SOON™', 4, '#ffb020', { intensity: 2.2, aspect: 6 });
  placeSign(ctx, soon, o.x + 3.8, 1.9, o.z + 5.6, 0.3);
  const post = ctx.batch.at(o.x + 3.8, o.z + 5.6);
  post.cyl('metal', 0, 0.8, -0.05, 0.05, 1.6, '#2a2e40', undefined, 8);
  // exhaust steam
  buildPlume(ctx, {
    x: o.x,
    y: 0.4,
    z: o.z,
    count: 140,
    color: '#dfe8ff',
    colorEnd: '#6a6f8a',
    radius: 2.2,
    spread: 7,
    rise: 3.5,
    life: 5,
    size: 1.4,
    grow: 3.2,
    opacity: 0.28,
  });
  buildPlume(ctx, {
    x: o.x,
    y: 0.6,
    z: o.z,
    count: 40,
    color: '#ffb35a',
    colorEnd: '#ff3b2b',
    radius: 1.2,
    spread: 1.2,
    rise: 1.5,
    life: 1.2,
    size: 0.5,
    grow: 2,
    opacity: 0.35,
    additive: true,
  });
  ctx.light(o.x, 1.5, o.z, '#ff8a3b', 2.4, 12);
}

function buildGantry(ctx: BuildCtx, o: BoxOb): void {
  const p = ctx.batch.at(o.x, o.z);
  const w = o.hw * 2;
  const d = o.hd * 2;
  const red = '#a3262c';
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) p.box('metal', (sx * w) / 2, o.h / 2, (sz * d) / 2, 0.18, o.h, 0.18, red);
  const step = 2.5;
  const diag = Math.atan2(step, w);
  const dlen = Math.hypot(w, step);
  for (let y = 0; y < o.h - 0.5; y += step) {
    p.box('metal', 0, y + step, d / 2, w, 0.12, 0.12, red);
    p.box('metal', 0, y + step, -d / 2, w, 0.12, 0.12, red);
    p.box('metal', w / 2, y + step, 0, 0.12, 0.12, d, red);
    p.box('metal', -w / 2, y + step, 0, 0.12, 0.12, d, red);
    p.box('metal', 0, y + step / 2, d / 2, dlen, 0.08, 0.08, red, { rz: diag * (y % 5 ? 1 : -1) });
    p.box('metal', 0, y + step / 2, -d / 2, dlen, 0.08, 0.08, red, { rz: -diag * (y % 5 ? 1 : -1) });
    p.box('metal', w / 2, y + step / 2, 0, 0.08, 0.08, dlen, red, { rx: diag * (y % 5 ? 1 : -1) });
    p.box('metal', -w / 2, y + step / 2, 0, 0.08, 0.08, dlen, red, { rx: -diag * (y % 5 ? 1 : -1) });
  }
  // access arms reaching toward the rocket (+x) + floodlights + aviation beacons
  const rocket = ctx.map.obstacles.find((q) => q.style === 'rocket');
  const reach = rocket
    ? Math.max(1, Math.abs(rocket.x - o.x) - o.hw - (rocket.type === 'circle' ? rocket.r * 0.78 : 1))
    : 2;
  for (const y of [o.h * 0.55, o.h * 0.85]) {
    p.box('metal', o.hw + reach / 2, y, 0, reach, 0.3, 0.9, '#6b6f80');
    p.box('glow', o.hw + reach / 2, y - 0.17, 0.46, reach, 0.04, 0.04, '#ffb020', { intensity: 2.4 });
  }
  p.box('lit', 0, o.h + 0.2, 0, w + 0.6, 0.4, d + 0.6, '#2a2c38');
  p.sphere('blink', 0, o.h + 1.0, 0, 0.3, 0.3, 0.3, '#ff2030', { intensity: 5 });
  p.cyl('metal', 0, o.h + 0.6, 0, 0.05, 0.8, '#6b6f80', undefined, 8);
  for (const y of [5, 10, 15])
    p.sphere('blink', w / 2 + 0.1, y, d / 2 + 0.1, 0.12, 0.12, 0.12, '#ff2030', { intensity: 4 });
  p.box('glow', o.hw + 0.1, 3, 0, 0.1, 0.4, 0.6, '#ffffff', { intensity: 4 });
}

// ───────────────────────────── Mt. Gox crater ─────────────────────────────

function buildVault(ctx: BuildCtx, o: BoxOb): void {
  const { bag } = ctx;
  const lm = ctx.map.landmarks.find((l) => l.id === 'gox');
  const cx = lm?.x ?? o.x;
  const cz = lm?.z ?? o.z;
  // crater: scorched floor decal with molten cracks + raised rim
  const floorTex = paintedTexture(bag, 512, 512, (g) => {
    const grd = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    grd.addColorStop(0, 'rgba(10,8,14,1)');
    grd.addColorStop(0.75, 'rgba(18,14,24,0.95)');
    grd.addColorStop(1, 'rgba(18,14,24,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    const rng = new Rng(850000);
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let x = 256;
      let y = 256;
      let a = (i / 16) * Math.PI * 2 + rng.range(-0.2, 0.2);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        a += rng.range(-0.45, 0.45);
        x += Math.cos(a) * 24;
        y += Math.sin(a) * 24;
        g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(255,120,30,0.95)';
      g.lineWidth = rng.range(2, 5);
      g.shadowColor = '#ff5a00';
      g.shadowBlur = 10;
      g.stroke();
    }
  });
  const floorMat = bag.track(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      emissiveMap: floorTex,
      emissive: hdr('#ff7a2a', 1.1),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  patchWorld(floorMat, { key: 'crater', ground: true });
  const floor = new THREE.Mesh(bag.track(new THREE.CircleGeometry(10.5, 48)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.03, cz);
  floor.receiveShadow = true;
  ctx.root.add(floor);
  const rim = ctx.batch.at(cx, cz);
  rim.add('rough', TPL.torus, 0, 0, 0, 10.2, 10.2, 12, '#2a2632', { rx: Math.PI / 2 });

  const p = ctx.batch.at(o.x, o.z);
  const w = o.hw * 2;
  const d = o.hd * 2;
  p.box('metal', 0, o.h / 2, 0, w, o.h, d, '#596073');
  p.box('metal', 0, o.h + 0.1, 0, w + 0.2, 0.2, d + 0.2, '#454b5c');
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) p.box('metal', x, o.h / 2, d / 2 + 0.05, 0.25, o.h, 0.1, '#3c4150');
  // round vault door + handle wheel + red "withdrawals paused" lamp
  p.cyl('metal', 0, o.h * 0.48, d / 2 + 0.12, 1.05, 0.22, '#8d94a8', { rx: Math.PI / 2 }, 32);
  p.cyl('metal', 0, o.h * 0.48, d / 2 + 0.26, 0.75, 0.08, '#6f7588', { rx: Math.PI / 2 }, 32);
  p.add('metal', TPL.torus, 0, o.h * 0.48, d / 2 + 0.34, 0.45, 0.45, 1.2, '#d0d4e0');
  for (let i = 0; i < 3; i++)
    p.box('metal', 0, o.h * 0.48, d / 2 + 0.34, 0.9, 0.06, 0.06, '#d0d4e0', { rz: (i * Math.PI) / 3 });
  p.sphere('blink', 0.85, o.h * 0.85, d / 2 + 0.1, 0.1, 0.1, 0.06, '#ff2030', { intensity: 5 });
  // spilled gold bars
  const bars: [number, number, number, number][] = [
    [-w / 2 - 0.8, 0.12, 0.6, 0.3],
    [-w / 2 - 0.8, 0.12, 0.15, -0.2],
    [-w / 2 - 0.8, 0.36, 0.38, 0.1],
    [w / 2 + 0.7, 0.12, -0.3, 0.8],
    [w / 2 + 1.1, 0.12, 0.5, 1.9],
  ];
  for (const [x, y, z, r] of bars) p.box('metal', x, y, z, 0.7, 0.22, 0.34, '#ffc53a', { ry: r });
  const sign = neonSign(ctx, o.label ?? '850,000 BTC', 4.4, '#ffc53a', { intensity: 2.6, aspect: 5 });
  placeSign(ctx, sign, o.x, o.h + 1.2, o.z, 0.3);
  const gox = neonSign(ctx, 'MT. GOX · WITHDRAWALS PAUSED', 4.4, '#ff3b5c', {
    intensity: 2,
    aspect: 12,
    font: FONT_BODY,
  });
  placeSign(ctx, gox, o.x, o.h + 0.45, o.z + 0.1, 0.3);
  // coins orbiting above the crater (they are never coming back)
  const coinGeo = bag.track(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 20).rotateX(Math.PI / 2));
  const coinMat = bag.track(
    new THREE.MeshStandardMaterial({ color: '#ffc53a', metalness: 1, roughness: 0.25, emissive: hdr('#ff9d00', 0.4) }),
  );
  patchWorld(coinMat, { key: 'gox-coin' });
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, 8);
  coins.frustumCulled = false;
  ctx.root.add(coins);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  ctx.animate((time) => {
    for (let i = 0; i < 8; i++) {
      const a = time * 0.35 + (i / 8) * Math.PI * 2;
      v.set(cx + Math.cos(a) * 6, 3.4 + Math.sin(time * 1.3 + i) * 0.5, cz + Math.sin(a) * 6);
      q.setFromEuler(e.set(0, time * 2 + i, 0));
      coins.setMatrixAt(i, m.compose(v, q, one));
    }
    coins.instanceMatrix.needsUpdate = true;
  });
  ctx.light(o.x, 2.5, o.z + 2.2, '#ff8a3b', 1.8, 10);
}

// ───────────────────────────── Luna crash site ─────────────────────────────

function buildLuna(ctx: BuildCtx, o: CircleOb, rng: Rng): void {
  const { bag } = ctx;
  const R = o.r;
  const cy = o.h - R;
  const mat = bag.track(new THREE.MeshStandardMaterial({ color: '#343646', roughness: 0.85, metalness: 0.1 }));
  const center = new THREE.Vector3(o.x, cy, o.z);
  patchWorld(mat, {
    key: 'luna',
    uniforms: { uLunaCenter: { value: center } },
    header: /* glsl */ `
      uniform vec3 uLunaCenter;
      vec3 lunaHash3(vec3 p) {
        p = vec3(
          dot(p, vec3(127.1, 311.7, 74.7)),
          dot(p, vec3(269.5, 183.3, 246.1)),
          dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453);
      }
      float lunaCracks(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = lunaHash3(i + g);
          float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
        return d2 - d1;
      }
    `,
    color: /* glsl */ `
      {
        vec3 lp = (vWPos - uLunaCenter) * 0.55;
        float crater = kitNoise(lp.xz * 1.7 + lp.y) * 0.35;
        diffuseColor.rgb *= 0.75 + crater;
      }
    `,
    emissive: /* glsl */ `
      {
        vec3 lp = (vWPos - uLunaCenter) * 0.7;
        float c = lunaCracks(lp);
        float aa = fwidth(c);
        float crack = 1.0 - smoothstep(0.012, 0.012 + aa * 1.5 + 0.02, c);
        float glowBand = exp(-c * 9.0) * 0.25;
        float pulse = 0.7 + 0.3 * sin(uTime * 2.2 + lp.y * 2.0);
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.18) * (crack * 2.2 + glowBand) * pulse;
      }
    `,
  });
  const sphere = new THREE.Mesh(bag.track(new THREE.SphereGeometry(R, 64, 40)), mat);
  sphere.position.copy(center);
  sphere.rotation.set(0.3, 0.8, 0.1);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  ctx.root.add(sphere);
  // impact rim + ejecta chunks
  const p = ctx.batch.at(o.x, o.z);
  p.add('rough', TPL.torus, 0, 0.1, 0, R + 1.2, R + 1.2, 10, '#262634', { rx: Math.PI / 2 });
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(R + 1.5, R + 4.2);
    const s = rng.range(0.25, 0.6);
    p.add(
      rng.chance(0.4) ? 'glow' : 'rough',
      TPL.ico,
      Math.cos(a) * r,
      s * 0.4,
      Math.sin(a) * r,
      s,
      s * 0.8,
      s,
      rng.chance(0.4) ? '#ffc93a' : '#30303e',
      {
        ry: rng.range(0, 6),
        intensity: 1.8,
      },
    );
  }
  const sign = neonSign(ctx, o.label ?? 'LUNA', 4, '#ffd84d', { intensity: 2.8, aspect: 3 });
  placeSign(ctx, sign, o.x, o.h + 1.4, o.z + 1.2, 0.35);
  const ust = neonSign(ctx, 'UST: $1.00 (trust me bro)', 3.4, '#ff3b5c', { intensity: 2, aspect: 10, font: FONT_BODY });
  placeSign(ctx, ust, o.x - 2.2, 1.4, o.z + R + 2.3, 0.3, 0.2);
  const post = ctx.batch.at(o.x - 2.2, o.z + R + 2.3);
  post.cyl('metal', 0, 0.6, -0.05, 0.05, 1.2, '#2a2e40', { rz: 0.2 }, 8);
  buildPlume(ctx, {
    x: o.x,
    y: o.h - 1,
    z: o.z,
    count: 60,
    color: '#6a6470',
    colorEnd: '#221e2a',
    radius: 2.5,
    spread: 3,
    rise: 14,
    life: 9,
    size: 2.2,
    grow: 3,
    opacity: 0.22,
  });
  ctx.light(o.x, cy + R + 1, o.z + R + 1, '#ffd84d', 2, 12);
}
