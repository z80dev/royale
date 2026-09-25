// Real game footage for the promo: footage/manifest.json lists clips (1920×1080, 60 fps H.264, short GOPs).
// film.seek(t) brings the one <video> the edit needs at t to the exact source frame; draw() then paints it
// synchronously. Clips missing from the manifest draw a labelled placeholder, so the cut plays before the
// footage exists and picks real clips up as they land.
import { W, H, F, clamp, lerp, E, hash, txt } from 'filmkit/lib.js';
import { EDL, BEAT } from './timeline.js';

// Logical clip name (used in the EDL) → footage manifest name(s); the first one present in the manifest wins, so a
// fallback take stands in until the preferred capture lands. Unlisted names map to themselves.
export const CLIPS = {
  city: ['city', 'city-b'],
};

const BASE = new URL('./footage/', import.meta.url);
const FPS = 60;
let manifest = new Map();
const videos = new Map(); // manifest name → Promise<HTMLVideoElement>
const ready = new Map(); //  manifest name → HTMLVideoElement (after load)

export async function loadFootage() {
  try {
    const res = await fetch(new URL('manifest.json', BASE), { cache: 'no-store' });
    if (res.ok) manifest = new Map((await res.json()).map((c) => [c.name, c]));
  } catch {
    manifest = new Map();
  }
}
export const entryOf = (clip) => [CLIPS[clip] ?? clip].flat().map((n) => manifest.get(n)).find(Boolean) ?? null;

// Blob URLs: the filmkit server doesn't serve byte ranges, and seeking needs the whole file in the media cache.
// Each clip has up to two <video> elements (slot 1 holds the next frame for slow-motion frame blending).
const blobs = new Map();
function blobUrl(entry) {
  let p = blobs.get(entry.name);
  if (!p) {
    p = (async () => {
      const res = await fetch(new URL(entry.file, BASE));
      if (!res.ok) throw new Error(`footage ${entry.file}: HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    })();
    blobs.set(entry.name, p);
  }
  return p;
}
function video(entry, slot = 0) {
  const key = `${entry.name}|${slot}`;
  let p = videos.get(key);
  if (!p) {
    p = (async () => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.src = await blobUrl(entry);
      await new Promise((resolve, reject) => {
        v.addEventListener('loadeddata', resolve, { once: true });
        v.addEventListener('error', () => reject(new Error(`footage ${entry.file}: ${v.error?.message ?? 'decode error'}`)), { once: true });
      });
      v.frame = -1;
      v.frames = Math.max(1, Math.floor((entry.duration ?? v.duration) * FPS) - 1);
      ready.set(key, v);
      return v;
    })();
    videos.set(key, p);
  }
  return p;
}

// Integrated source time for a sub-cut at local time lt.
function sourceTime(cut, lt) {
  if (!cut.ramp) return cut.in + lt * (cut.speed ?? 1);
  const k = cut.ramp;
  let s = cut.in, prev = [0, k[0][1]];
  for (const key of k) {
    if (lt <= key[0]) {
      const [t0, v0] = prev, v1 = lerp(v0, key[1], (lt - t0) / Math.max(1e-6, key[0] - t0));
      return s + ((v0 + v1) / 2) * (lt - t0);
    }
    s += ((prev[1] + key[1]) / 2) * (key[0] - prev[0]);
    prev = key;
  }
  return s + prev[1] * (lt - prev[0]);
}

export function cutAt(t) {
  let i = 0;
  while (i + 1 < EDL.length && EDL[i + 1].at <= t + 1e-9) i++;
  return { cut: EDL[i], next: EDL[i + 1] ?? null, lt: t - EDL[i].at };
}

// An EDL entry may align a source moment to a film time instead of giving `in`:
//   hit: source seconds of the moment (e.g. manifest moments[].t), hitAt: film seconds where it should land.
for (const cut of EDL) if (cut.hit != null) cut.in = cut.hit - sourceTime({ ...cut, in: 0 }, (cut.hitAt ?? cut.at) - cut.at);

// Source frame (and blend weight toward the next frame) for film time t. Slow-motion sub-cuts (< 0.95×) blend
// neighbouring frames so 60 fps footage doesn't stutter; normal speed shows exact frames.
function frameAt(cut, lt, frames) {
  const src = sourceTime(cut, lt);
  const speed = (sourceTime(cut, lt + 1e-3) - src) / 1e-3;
  const x = Math.max(0, src * FPS);
  const f = clamp(Math.floor(x + 1e-6), 0, frames);
  const w = speed < 0.95 && f < frames ? x - f : 0;
  return { src, f, w: w > 0.02 ? w : 0 };
}

async function seekTo(v, f) {
  if (v.frame === f) return;
  await new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`seek failed: ${v.src}`));
    v.addEventListener('seeked', () => { v.removeEventListener('error', fail); resolve(); }, { once: true });
    v.addEventListener('error', fail, { once: true });
    v.currentTime = (f + 0.5) / FPS;
  });
  v.frame = f;
}

// film.seek: bring the active sub-cut's clip to its exact frame (and the next one when blending). Pure function of t.
export async function seekFootage(t) {
  const { cut, lt } = cutAt(t);
  const entry = entryOf(cut.clip);
  if (!entry) return;
  const v = await video(entry);
  const { f, w } = frameAt(cut, lt, v.frames);
  await Promise.all([seekTo(v, f), w ? video(entry, 1).then((b) => seekTo(b, f + 1)) : null]);
}

function placeholder(ctx, cut, src) {
  const h = hash(cut.clip.length * 131 + cut.clip.charCodeAt(0));
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${Math.round(260 + h * 80)},60%,12%)`);
  g.addColorStop(1, `hsl(${Math.round(170 + h * 40)},70%,8%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(25,227,167,0.25)';
  ctx.lineWidth = 2;
  const off = (src * 120) % 120;
  for (let x = -120 + off; x < W + 120; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 120) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  txt(ctx, `FOOTAGE: ${cut.clip}`, W / 2, H / 2 - 30, { size: 64, font: F.mono, weight: 700, color: 'rgba(255,255,255,0.5)', align: 'center', base: 'middle' });
  txt(ctx, `src ${src.toFixed(2)}s`, W / 2, H / 2 + 40, { size: 36, font: F.mono, color: 'rgba(255,255,255,0.35)', align: 'center', base: 'middle' });
}

// Paint the footage for film time t: zoom, beat punch, whip smear in/out of whipped sub-cuts, dim.
export function drawFootage(ctx, t) {
  const { cut, next, lt } = cutAt(t);
  const nextAt = next ? next.at : Infinity;
  const len = Math.max(1e-3, nextAt - cut.at);
  const entry = entryOf(cut.clip);
  const v = entry ? ready.get(`${entry.name}|0`) : null;
  const { src, w } = v ? frameAt(cut, lt, v.frames) : { src: sourceTime(cut, lt), w: 0 };
  const vb = w ? ready.get(`${entry.name}|1`) : null;
  const [z0, z1] = cut.zoom ?? [1, 1];
  let z = lerp(z0, z1, E.inOutCubic(clamp(lt / (Number.isFinite(len) ? len : 4))));
  if (cut.punch) z += cut.punch * Math.exp(-((t % BEAT) / BEAT) * 6);
  // whip: 0.12 s smear into this cut (from the side), and 0.12 s out of the previous one
  const WHIP = 0.12;
  let dx = 0, smear = 0;
  if (cut.whip && lt < WHIP) { const p = 1 - lt / WHIP; dx = -cut.whip * W * 0.35 * E.inCubic(p); smear = p; }
  if (next?.whip && nextAt - t < WHIP) { const p = 1 - (nextAt - t) / WHIP; dx = next.whip * W * 0.35 * E.inCubic(p); smear = p; }
  // (fx, fy): source point (0..1) that zooms about; drawn at screen point (cx, cy), default the same point.
  const fx = cut.fx ?? 0.5, fy = cut.fy ?? 0.5, cx = cut.cx ?? fx, cy = cut.cy ?? fy;
  const paint = (ox, a) => {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W * cx + ox, H * cy);
    ctx.scale(z, z);
    ctx.translate(-W * fx, -H * fy);
    if (v) {
      ctx.drawImage(v, 0, 0, W, H);
      if (vb) {
        ctx.globalAlpha = a * w;
        ctx.drawImage(vb, 0, 0, W, H);
      }
    } else placeholder(ctx, cut, src);
    ctx.restore();
  };
  paint(dx, 1);
  if (smear > 0.02) {
    const n = 8;
    for (let i = 1; i <= n; i++) paint(dx - Math.sign(dx || 1) * smear * 200 * (i / n), 0.2);
  }
  if (cut.dim) {
    ctx.fillStyle = `rgba(2,4,8,${cut.dim})`;
    ctx.fillRect(0, 0, W, H);
  }
  return { cut, lt, src, whip: smear };
}
