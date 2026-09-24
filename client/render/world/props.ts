// Scattered props as InstancedMeshes (trees, rocks, crates, containers, bushes + tulips) and batched
// barriers / compound walls. One draw call per prop part regardless of how many the map spawns.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BoxOb, CircleOb, Obstacle } from '../../../shared/map';
import { Rng } from '../../../shared/rng';
import { brandGlow, glowFor, hdr, paintedTexture, patchWorld, type BuildCtx } from './kit';

const TREE_LEAVES = ['#0f3d44', '#123a2c', '#23174a', '#0d2f4a', '#2b1340'];
const TREE_TIPS = ['#00f0ff', '#ff2bd6', '#7cff4f', '#ffe600', '#9d5cff'];
const TULIP_COLORS = ['#ff2b6d', '#ffe600', '#ff7a1a', '#ff4fd8', '#b44bff', '#ffffff', '#ff1a1a'];

export function buildProps(ctx: BuildCtx, obstacles: Obstacle[]): void {
  const by = (style: string) => obstacles.filter((o) => o.style === style);
  buildTrees(ctx, by('tree') as CircleOb[]);
  buildRocks(ctx, by('rock') as CircleOb[]);
  buildCrates(ctx, by('crate') as BoxOb[]);
  buildContainers(ctx, by('container') as BoxOb[]);
  buildBarriers(ctx, by('barrier') as BoxOb[]);
  buildWalls(ctx, by('wall') as BoxOb[]);
  buildBushes(ctx);
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(
  ctx: BuildCtx,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  shadows: { cast: boolean; receive: boolean },
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = shadows.cast;
  mesh.receiveShadow = shadows.receive;
  ctx.root.add(mesh);
  return mesh;
}

function finish(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

// ───────────────────────────── Trees ─────────────────────────────

function buildTrees(ctx: BuildCtx, trees: CircleOb[]): void {
  if (!trees.length) return;
  const { bag } = ctx;
  const rng = new Rng(ctx.map.seed ^ 0x7e1e);
  const trunkGeo = bag.track(new THREE.CylinderGeometry(0.14, 0.24, 1, 6));
  trunkGeo.translate(0, 0.5, 0);
  const tiers = [
    new THREE.ConeGeometry(1, 0.42, 7).translate(0, 0.47, 0),
    new THREE.ConeGeometry(0.78, 0.38, 7).rotateY(0.4).translate(0, 0.66, 0),
    new THREE.ConeGeometry(0.52, 0.34, 7).rotateY(0.9).translate(0, 0.84, 0),
  ];
  const canopyGeo = bag.track(mergeGeometries(tiers)!);
  for (const t of tiers) t.dispose();
  const tipGeo = bag.track(new THREE.OctahedronGeometry(1, 0));
  const trunkMat = bag.track(new THREE.MeshStandardMaterial({ color: '#2a1f2e', roughness: 0.9 }));
  const canopyMat = bag.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, flatShading: true }));
  const tipMat = bag.track(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  patchWorld(trunkMat, { key: 'tree-trunk' });
  patchWorld(canopyMat, {
    key: 'tree-canopy',
    sway: 0.035,
    emissive: `totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - abs(normal.z), 3.0) * 0.9;`,
  });
  patchWorld(tipMat, { key: 'tree-tip', sway: 0.035 });
  const trunks = instanced(ctx, trunkGeo, trunkMat, trees.length, { cast: true, receive: true });
  const canopies = instanced(ctx, canopyGeo, canopyMat, trees.length, { cast: true, receive: true });
  const tips = instanced(ctx, tipGeo, tipMat, trees.length, { cast: false, receive: false });
  trees.forEach((t, i) => {
    const spin = rng.range(0, Math.PI * 2);
    quat.setFromAxisAngle(UP, spin);
    pos.set(t.x, 0, t.z);
    scl.set(t.r * 1.1, t.h * 0.42, t.r * 1.1);
    trunks.setMatrixAt(i, m4.compose(pos, quat, scl));
    pos.set(t.x, t.h * 0.05, t.z);
    scl.set(t.r * 1.75, t.h, t.r * 1.75);
    canopies.setMatrixAt(i, m4.compose(pos, quat, scl));
    canopies.setColorAt(i, col.set(rng.pick(TREE_LEAVES)));
    pos.set(t.x, t.h * 1.07, t.z);
    scl.set(0.22, 0.4, 0.22);
    tips.setMatrixAt(i, m4.compose(pos, quat, scl));
    tips.setColorAt(i, hdr(rng.pick(TREE_TIPS), 3));
  });
  finish(trunks);
  finish(canopies);
  finish(tips);
}

// ───────────────────────────── Rocks ─────────────────────────────

function jitteredRock(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.getAttribute('position');
  const rng = new Rng(seed);
  // jitter shared vertices identically (icosahedron is non-indexed; key by rounded position)
  const offsets = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) offsets.set(key, (k = rng.range(0.78, 1.18)));
    p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i) * k, -0.35), p.getZ(i) * k);
  }
  geo.translate(0, 0.35, 0);
  geo.computeVertexNormals();
  return geo;
}

function buildRocks(ctx: BuildCtx, rocks: CircleOb[]): void {
  if (!rocks.length) return;
  const { bag } = ctx;
  const rng = new Rng(ctx.map.seed ^ 0x40c);
  const geo = bag.track(jitteredRock(ctx.map.seed));
  const mat = bag.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true }));
  patchWorld(mat, { key: 'rock' });
  const mesh = instanced(ctx, geo, mat, rocks.length, { cast: true, receive: true });
  const crystals: { x: number; z: number; h: number; tilt: number; yaw: number; color: string; s: number }[] = [];
  rocks.forEach((r, i) => {
    quat.setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), rng.range(0, Math.PI * 2), rng.range(-0.15, 0.15)));
    pos.set(r.x, 0, r.z);
    scl.set(r.r * 1.05, r.h * 0.78, r.r * 1.05);
    mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
    mesh.setColorAt(i, col.set('#2c2f44').offsetHSL(rng.range(-0.03, 0.05), 0, rng.range(-0.05, 0.05)));
    if (rng.chance(0.4)) {
      const color = rng.pick(['#ff2bd6', '#00f0ff', '#9d5cff']);
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        crystals.push({
          x: r.x + Math.cos(a) * r.r * 0.7,
          z: r.z + Math.sin(a) * r.r * 0.7,
          h: r.h * rng.range(0.5, 0.9),
          tilt: rng.range(0.2, 0.6),
          yaw: a,
          color,
          s: rng.range(0.18, 0.3),
        });
      }
    }
  });
  finish(mesh);
  if (!crystals.length) return;
  const cGeo = bag.track(new THREE.OctahedronGeometry(1, 0));
  const cMat = bag.track(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  patchWorld(cMat, { key: 'crystal' });
  const cm = instanced(ctx, cGeo, cMat, crystals.length, { cast: false, receive: false });
  crystals.forEach((c, i) => {
    quat.setFromEuler(new THREE.Euler(Math.cos(c.yaw) * c.tilt, 0, -Math.sin(c.yaw) * c.tilt));
    pos.set(c.x, c.h * 0.55, c.z);
    scl.set(c.s, c.h * 0.55, c.s);
    cm.setMatrixAt(i, m4.compose(pos, quat, scl));
    cm.setColorAt(i, hdr(c.color, 2.6));
  });
  finish(cm);
}

// ───────────────────────────── Crates ─────────────────────────────

function crateTextures(
  ctx: BuildCtx,
  glyph: string,
  glyphColor: string,
): { map: THREE.Texture; emissive: THREE.Texture } {
  const S = 256;
  const map = paintedTexture(ctx.bag, S, S, (g) => {
    g.fillStyle = '#20232f';
    g.fillRect(0, 0, S, S);
    // brushed panel noise
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 30, 1);
    }
    g.strokeStyle = '#3b4056';
    g.lineWidth = 14;
    g.strokeRect(7, 7, S - 14, S - 14);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(14, 14);
    g.lineTo(S - 14, S - 14);
    g.moveTo(S - 14, 14);
    g.lineTo(14, S - 14);
    g.strokeStyle = 'rgba(70,76,100,0.55)';
    g.stroke();
    // corner hazard tabs
    g.fillStyle = '#ffb020';
    for (const [x, y] of [
      [0, 0],
      [S - 34, 0],
      [0, S - 34],
      [S - 34, S - 34],
    ] as const)
      g.fillRect(x, y, 34, 34);
    g.fillStyle = '#20232f';
    g.fillRect(S / 2 - 62, S / 2 - 62, 124, 124);
    g.fillStyle = glyphColor;
    g.font = '900 120px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, S / 2, S / 2 + 6);
  });
  const emissive = paintedTexture(ctx.bag, S, S, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#fff';
    g.font = '900 120px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, S / 2, S / 2 + 6);
  });
  return { map, emissive };
}

function buildCrates(ctx: BuildCtx, crates: BoxOb[]): void {
  if (!crates.length) return;
  const { bag } = ctx;
  const geo = bag.track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const variants = [
    { glyph: '₿', color: '#f7931a', list: crates.filter((c) => c.id % 2 === 0) },
    { glyph: 'Ξ', color: '#8ea2ff', list: crates.filter((c) => c.id % 2 === 1) },
  ];
  for (const v of variants) {
    if (!v.list.length) continue;
    const tex = crateTextures(ctx, v.glyph, v.color);
    const mat = bag.track(
      new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: hdr(v.color, 1.8),
        roughness: 0.55,
        metalness: 0.45,
      }),
    );
    patchWorld(mat, { key: 'crate' });
    const mesh = instanced(ctx, geo, mat, v.list.length, { cast: true, receive: true });
    v.list.forEach((c, i) => {
      quat.identity();
      pos.set(c.x, 0, c.z);
      scl.set(c.hw * 2, c.h, c.hd * 2);
      mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
    });
    finish(mesh);
  }
}

// ───────────────────────────── Containers ─────────────────────────────

function buildContainers(ctx: BuildCtx, list: BoxOb[]): void {
  if (!list.length) return;
  const { bag } = ctx;
  const tex = paintedTexture(bag, 512, 256, (g) => {
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, '#8c8c8c');
      grd.addColorStop(0.5, '#e6e6e6');
      grd.addColorStop(1, '#8c8c8c');
      g.fillStyle = grd;
      g.fillRect(x, 0, 16, 256);
    }
    g.fillStyle = 'rgba(40,40,40,0.8)';
    g.fillRect(0, 0, 512, 10);
    g.fillRect(0, 246, 512, 10);
    g.fillRect(0, 0, 10, 256);
    g.fillRect(502, 0, 10, 256);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '900 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('HODL LINES', 256, 118);
    g.font = '700 22px ui-monospace, monospace';
    g.fillText('CONTENTS: BAGS · DO NOT SELL', 256, 160);
  });
  const mat = bag.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.4 }));
  patchWorld(mat, { key: 'container' });
  const geo = bag.track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const mesh = instanced(ctx, geo, mat, list.length, { cast: true, receive: true });
  list.forEach((c, i) => {
    // BoxGeometry side faces map the full texture; rotate long containers so text runs along their length
    const alongX = c.hw >= c.hd;
    quat.setFromAxisAngle(UP, alongX ? 0 : Math.PI / 2);
    pos.set(c.x, 0, c.z);
    scl.set(alongX ? c.hw * 2 : c.hd * 2, c.h, alongX ? c.hd * 2 : c.hw * 2);
    mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
    mesh.setColorAt(i, col.set(c.color ?? '#1e6fff').multiplyScalar(0.8));
    // amber corner marker lights
    const p = ctx.batch.at(c.x, c.z, alongX ? 0 : Math.PI / 2);
    const hl = (alongX ? c.hw : c.hd) - 0.12;
    const hw = (alongX ? c.hd : c.hw) - 0.12;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        p.box('blink', sx * hl, c.h + 0.04, sz * hw, 0.12, 0.08, 0.12, '#ffb020', { intensity: 3 });
  });
  finish(mesh);
}

// ───────────────────────────── Barriers + walls ─────────────────────────────

function buildBarriers(ctx: BuildCtx, list: BoxOb[]): void {
  for (const b of list) {
    const alongX = b.hw >= b.hd;
    const p = ctx.batch.at(b.x, b.z, alongX ? 0 : Math.PI / 2);
    const len = (alongX ? b.hw : b.hd) * 2;
    const th = (alongX ? b.hd : b.hw) * 2;
    p.box('rough', 0, b.h * 0.18, 0, len, b.h * 0.36, th * 1.25, '#3a3d52');
    p.box('rough', 0, b.h * 0.64, 0, len, b.h * 0.56, th * 0.8, '#454860');
    p.box('glow', 0, b.h * 0.92 + 0.02, 0, len - 0.1, 0.06, th * 0.3, '#ffd23f', { intensity: 2.4 }); // on top
    for (let s = -len / 2 + 0.4; s < len / 2 - 0.2; s += 0.9) {
      p.box('glow', s, b.h * 0.2, th * 0.63, 0.35, 0.12, 0.02, '#ff2b6d', { intensity: 1.6 });
      p.box('glow', s, b.h * 0.2, -th * 0.63, 0.35, 0.12, 0.02, '#ff2b6d', { intensity: 1.6 });
    }
  }
}

function buildWalls(ctx: BuildCtx, list: BoxOb[]): void {
  for (const w of list) {
    const color = w.brand ? brandGlow(w.brand).main : glowFor(w.color ?? '#00f0ff');
    const alongX = w.hw >= w.hd;
    const p = ctx.batch.at(w.x, w.z, alongX ? 0 : Math.PI / 2);
    const len = (alongX ? w.hw : w.hd) * 2;
    const th = (alongX ? w.hd : w.hw) * 2;
    p.box('lit', 0, w.h / 2, 0, len, w.h, th, '#1a1c2c');
    // trims overhang the wall ends by 1 cm so their end caps never share a plane with the wall's
    p.box('glow', 0, w.h + 0.03, 0, len + 0.02, 0.07, th + 0.04, color, { intensity: 2.2 });
    p.box('glow', 0, 0.08, th / 2 + 0.01, len + 0.02, 0.05, 0.02, color, { intensity: 1.8 });
    p.box('glow', 0, 0.08, -th / 2 - 0.01, len + 0.02, 0.05, 0.02, color, { intensity: 1.8 });
    // panel seams
    for (let s = -len / 2 + 1.5; s < len / 2; s += 1.5)
      p.box('lit', s, w.h / 2, 0, 0.06, w.h * 0.98, th + 0.03, '#2a2d44'); // not flush with the base strips
  }
}

// ───────────────────────────── Bushes + tulips ─────────────────────────────

function buildBushes(ctx: BuildCtx): void {
  const bushes = ctx.map.bushes;
  if (!bushes.length) return;
  const { bag } = ctx;
  const rng = new Rng(ctx.map.seed ^ 0xb05);
  const blobs: THREE.BufferGeometry[] = [];
  const blobSpots = [
    [0, 0.45, 0, 0.62],
    [0.45, 0.35, 0.15, 0.48],
    [-0.4, 0.33, 0.25, 0.46],
    [0.1, 0.32, -0.45, 0.5],
    [-0.25, 0.55, -0.15, 0.42],
    [0.3, 0.5, 0.4, 0.38],
  ] as const;
  for (const [x, y, z, r] of blobSpots) blobs.push(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  const bushGeo = bag.track(mergeGeometries(blobs)!);
  for (const b of blobs) b.dispose();
  const bushMat = bag.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }));
  patchWorld(bushMat, {
    key: 'bush',
    sway: 0.05,
    emissive: `totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - abs(normal.z), 2.5) * 1.3;`,
  });
  const bushMesh = instanced(ctx, bushGeo, bushMat, bushes.length, { cast: true, receive: true });
  const tulips: { x: number; y: number; z: number; color: string; s: number }[] = [];
  bushes.forEach((b, i) => {
    quat.setFromAxisAngle(UP, rng.range(0, Math.PI * 2));
    pos.set(b.x, 0, b.z);
    scl.set(b.r, b.r * 0.72, b.r);
    bushMesh.setMatrixAt(i, m4.compose(pos, quat, scl));
    bushMesh.setColorAt(i, col.set(b.tulip ? '#1d5a2e' : rng.pick(['#14463c', '#173d2f', '#1b3350', '#2a1f4a'])));
    if (b.tulip) {
      const n = Math.round(b.r * 6);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(rng.range(0, 1)) * b.r * 0.85;
        const top = b.r * 0.72 * (0.3 + 0.62 * Math.sqrt(Math.max(0, 1 - (rr / b.r) ** 2)));
        tulips.push({
          x: b.x + Math.cos(a) * rr,
          y: top + 0.12,
          z: b.z + Math.sin(a) * rr,
          color: rng.pick(TULIP_COLORS),
          s: rng.range(0.85, 1.2),
        });
      }
    }
  });
  finish(bushMesh);
  if (!tulips.length) return;
  // tulip = cup (lathe) on a stem; unit height ≈ 0.5 m
  const cupProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.09, 0.02),
    new THREE.Vector2(0.13, 0.1),
    new THREE.Vector2(0.12, 0.2),
    new THREE.Vector2(0.08, 0.26),
  ];
  const cupGeo = bag.track(new THREE.LatheGeometry(cupProfile, 6).translate(0, 0.28, 0));
  const stemGeo = bag.track(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 4).translate(0, 0.14, 0));
  const cupMat = bag.track(new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  const stemMat = bag.track(new THREE.MeshStandardMaterial({ color: '#2f8a3a', roughness: 0.8 }));
  patchWorld(cupMat, { key: 'tulip-cup', sway: 0.12 });
  patchWorld(stemMat, { key: 'tulip-stem', sway: 0.12 });
  const cups = instanced(ctx, cupGeo, cupMat, tulips.length, { cast: false, receive: false });
  const stems = instanced(ctx, stemGeo, stemMat, tulips.length, { cast: false, receive: false });
  tulips.forEach((t, i) => {
    quat.setFromEuler(new THREE.Euler(rng.range(-0.25, 0.25), rng.range(0, 6), rng.range(-0.25, 0.25)));
    pos.set(t.x, t.y - 0.3, t.z);
    scl.setScalar(t.s * 1.6);
    m4.compose(pos, quat, scl);
    cups.setMatrixAt(i, m4);
    stems.setMatrixAt(i, m4);
    cups.setColorAt(i, hdr(t.color, 1.35));
  });
  finish(cups);
  finish(stems);
}
