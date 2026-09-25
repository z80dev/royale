// LAUNCHPAD ROYALE — promo (60 s, 1080p60). Real in-game footage (footage/manifest.json, see footage.js) cut on a
// 120 BPM bar grid (timeline.js), a synthwave/trap score (score.js), and crisp overlay type in the game's look:
// Unbounded display type, JetBrains Mono labels, mint #19e3a7 and gold #ffb627 on a near-black night.
import { W, H, F, clamp, lerp, seg, E, hash, txt, measure, rrect } from 'filmkit/lib.js';
import { T, END, BEAT, EDL, SUBCUTS } from './timeline.js';
import { score } from './score.js';
import { loadFootage, seekFootage, drawFootage } from './footage.js';

export const palette = {
  mint: '#19e3a7', mintDeep: '#0fae85', gold: '#ffb627', pink: '#ff3d9a', danger: '#ff3b5c',
  purple: '#b65cff', blue: '#4db8ff', text: '#eaf4f2', muted: '#8b9aa8', bg: '#04060a',
};
const P = palette;
const U = 'Unbounded';

// Brands in the game's roster order, with their primary colours (shared/constants.ts).
const BRANDS = [
  ['doppler', '#0FAE85'], ['uniswap', '#FF007A'], ['pons', '#C9CED6'], ['long', '#DDF5E3'], ['jump', '#1576D2'],
  ['fomo', '#606AF7'], ['pump', '#5FD18B'], ['clanker', '#8A63D2'], ['zora', '#4281D3'], ['bankr', '#FF613D'],
];
const BRAND_COLOR = Object.fromEntries(BRANDS);
const badges = {};

// ---------- caption styles (drawn on the overlay, after post) ----------
function spansOf(line, color) { return Array.isArray(line) ? line : [[line, color]]; }
function drawLine(o, line, x, y, s, a) {
  const spans = spansOf(line, s.color);
  const font = s.font, size = s.size, weight = s.weight, track = s.track ?? 0;
  const widths = spans.map(([str]) => measure(o, str, size, font, track, weight));
  const total = widths.reduce((p, q) => p + q, 0);
  let cx = s.align === 'center' ? x - total / 2 : s.align === 'right' ? x - total : x;
  spans.forEach(([str, col], i) => {
    txt(o, str, cx, y, { size, font, weight, color: col, align: 'left', base: 'middle', track, alpha: a, glow: s.glow ? col : undefined, glowBlur: s.glowBlur, shadow: s.shadow, off: s.off });
    cx += widths[i];
  });
  return total;
}
// Punch-in display type: scales down from `from` with a back-out, per-line stagger, fades out.
function slamDraw(o, cap, s, t) {
  const pout = s.out > 0 ? seg(t, cap.t1 - s.out, cap.t1) : 0;
  const lh = s.size * s.lineHeight, top = s.y - ((cap.lines.length - 1) * lh) / 2;
  cap.lines.forEach((line, i) => {
    const p = seg(t, cap.t0 + i * (s.stagger ?? 0.1), cap.t0 + i * (s.stagger ?? 0.1) + s.in);
    if (p <= 0) return;
    const k = lerp(s.from ?? 1.6, 1, E.outBack(p)) * (1 + (s.breathe ?? 0) * (t - cap.t0));
    const y = top + i * lh - E.inCubic(pout) * 40;
    o.save();
    o.translate(s.x, y);
    o.scale(k, k);
    drawLine(o, line, 0, 0, { ...s, align: 'center' }, clamp(p * 4) * (1 - E.inCubic(pout)));
    o.restore();
  });
}
// Ability lower third: brand badge + ability name + brand line, slides in from the left.
function abilityDraw(o, cap, s, t) {
  const pin = seg(t, cap.t0, cap.t0 + s.in), pout = seg(t, cap.t1 - s.out, cap.t1);
  const a = clamp(pin * 3) * (1 - E.inCubic(pout));
  if (a <= 0) return;
  const col = BRAND_COLOR[cap.brand] ?? P.mint;
  const x = s.x - (1 - E.outExpo(pin)) * 120 - E.inCubic(pout) * 60, y = s.y;
  o.save();
  o.globalAlpha = a;
  // plate
  const name = cap.lines[0];
  const nameW = measure(o, name, s.size, U, 1, 900);
  const kickW = measure(o, cap.kicker ?? '', 22, F.mono, 5, 800);
  const plateW = 150 + Math.max(nameW, kickW) + 50;
  o.fillStyle = 'rgba(4,6,10,0.72)';
  rrect(o, x - 20, y - 70, plateW, 140, 18);
  o.fill();
  o.fillStyle = col;
  o.fillRect(x - 20, y - 70, 8, 140);
  const img = badges[cap.brand];
  if (img) {
    const bk = 1 + 0.25 * Math.exp(-(t - cap.t0) * 10);
    o.save();
    o.translate(x + 58, y);
    o.scale(bk, bk);
    o.shadowColor = col;
    o.shadowBlur = 24;
    o.drawImage(img, -52, -52, 104, 104);
    o.restore();
  }
  txt(o, cap.kicker ?? '', x + 136, y - 34, { size: 22, font: F.mono, weight: 800, color: col, base: 'middle', track: 5 });
  txt(o, name, x + 134, y + 16, { size: s.size, font: U, weight: 900, color: '#ffffff', base: 'middle', track: 1, glow: col, glowBlur: 18 });
  o.restore();
}
// Easter-egg checklist: all lines visible (dim), the current egg's line lights up gold with a marker.
function eggsDraw(o, cap, s, t) {
  const pin = seg(t, cap.t0, cap.t0 + s.in), pout = seg(t, cap.t1 - s.out, cap.t1);
  const a = clamp(pin * 2) * (1 - E.inCubic(pout));
  if (a <= 0) return;
  const lh = s.size * 1.55;
  const top = s.y - ((cap.lines.length - 1) * lh) / 2;
  let active = 0;
  cap.at.forEach((at, i) => { if (t >= at) active = i; });
  o.save();
  o.globalAlpha = a;
  const wMax = Math.max(...cap.lines.map((l) => measure(o, l, s.size, U, 0, 800)));
  o.fillStyle = 'rgba(4,6,10,0.62)';
  rrect(o, s.x - 36, top - lh * 0.75, wMax + 110, lh * cap.lines.length + lh * 0.5 - lh * 0.0, 16);
  o.fill();
  cap.lines.forEach((line, i) => {
    const on = i === active, done = i < active;
    const k = on ? 1 + 0.08 * Math.exp(-(t - cap.at[i]) * 12) : 1;
    const y = top + i * lh;
    o.save();
    o.translate(s.x, y);
    o.scale(k, k);
    txt(o, on ? '▶' : done ? '✓' : '·', 0, 0, { size: s.size * 0.7, font: F.mono, weight: 800, color: on ? P.gold : P.mint, base: 'middle', alpha: on || done ? 1 : 0.5 });
    txt(o, line, 44, 0, { size: s.size, font: U, weight: 800, color: on ? P.gold : '#ffffff', base: 'middle', alpha: on ? 1 : 0.55, glow: on ? P.gold : undefined, glowBlur: 16 });
    o.restore();
  });
  o.restore();
}
const captionStyles = () => ({
  gm: { font: U, size: 230, weight: 900, color: P.text, y: 520, anim: 'type', cps: 10, in: 0, out: 0.25, glow: P.mint, glowBlur: 40 },
  slam: { font: U, size: 150, weight: 900, color: '#ffffff', y: 540, in: 0.35, out: 0.3, lineHeight: 1.08, from: 1.7, draw: slamDraw, glow: true, glowBlur: 30, track: 2 },
  big: { font: U, size: 104, weight: 900, color: '#ffffff', y: 860, in: 0.25, out: 0.2, lineHeight: 1.1, from: 1.4, draw: slamDraw, glow: true, glowBlur: 22, track: 1 },
  kicker: { font: F.mono, size: 30, weight: 800, color: P.mint, y: 170, anim: 'fade', in: 0.3, out: 0.3, track: 10 },
  ability: { font: U, size: 64, x: 150, y: 890, in: 0.3, out: 0.2, draw: abilityDraw },
  eggs: { font: U, size: 46, x: 170, y: 800, in: 0.25, out: 0.2, draw: eggsDraw },
  line: { font: F.mono, size: 34, weight: 700, color: P.text, y: 930, anim: 'rise', in: 0.3, out: 0.2, track: 3 },
  url: { font: U, size: 88, weight: 800, color: P.mint, y: 640, anim: 'rise', in: 0.35, out: 0.3, glow: P.mint, glowBlur: 26 },
  footer: { font: F.mono, size: 26, weight: 600, color: P.muted, y: 940, anim: 'fade', in: 0.4, out: 0.3, track: 4 },
});

const captions = [
  { id: 'gm', style: 'gm', text: [[['gm', P.text], ['.', P.mint]]], t0: 0.2, t1: 3.9 },

  { id: 'title', style: 'slam', text: ['LAUNCHPAD', [['ROYALE', P.mint]]], t0: T.title + 0.02, t1: T.roster - 0.15, y: 520, breathe: 0.012 },
  { id: 'title-kicker', style: 'kicker', text: 'THE CRYPTO BATTLE ROYALE · IN YOUR BROWSER', t0: T.title + 0.6, t1: T.roster - 0.15, y: 790, color: P.gold },

  { id: 'roster', style: 'big', text: [[['10 LAUNCHPADS. ', '#ffffff'], ['1 BAG.', P.gold]]], t0: T.roster + 0.15, t1: T.drop - 0.15, size: 92, y: 948 },

  { id: 'drop', style: 'slam', text: [[['DROP ', '#ffffff'], ['IN.', P.mint]]], t0: T.drop + 0.15, t1: T.clanker - 0.1, size: 170, y: 540 },

  { id: 'ab-clanker', style: 'ability', text: 'DEPLOY CLANKER', brand: 'clanker', kicker: 'CLANKER · AUTO TURRET', t0: T.clanker + 0.1, t1: T.orb - 0.15 },
  { id: 'ab-orb', style: 'ability', text: 'ORB SHIELD', brand: 'zora', kicker: 'ZORA · BULLET-BLOCKING DOME', t0: T.orb + 0.1, t1: T.sendit - 0.15 },
  { id: 'ab-sendit', style: 'ability', text: 'SEND IT', brand: 'jump', kicker: 'JUMP · LEAP + SHOCKWAVE', t0: T.sendit + 0.1, t1: T.zone - 0.15 },

  { id: 'zone', style: 'big', text: [[['THE ', '#ffffff'], ['LIQUIDATION ZONE', P.danger]], 'IS COMING.'], t0: T.zone + 0.2, t1: T.airdrop - 0.15, y: 800, size: 84 },

  { id: 'airdrop-kicker', style: 'kicker', text: 'LEGENDARY AIRDROP', t0: T.airdrop + 0.1, t1: T.eggsA - 0.15, color: P.gold, y: 150 },
  { id: 'printer', style: 'big', text: [[['MONEY PRINTER: ', '#ffffff'], ['brrrr', P.gold]]], t0: T.airdrop + 0.4, t1: T.eggsA - 0.15, y: 880, size: 90 },

  { id: 'eggs-a', style: 'eggs', text: ["SATOSHI'S WATCHING.", 'WEN LAMBO? NOW LAMBO.', '10,000 BTC. TWO PIZZAS.'], at: EDL.filter((e) => e.at >= T.eggsA && e.at < T.eggsB).map((e) => e.at), t0: T.eggsA + 0.05, t1: T.eggsB - 0.1 },
  { id: 'eggs-b', style: 'eggs', text: ['WHALE ALERT.', 'LUNA? NEVER HEARD OF HER.', 'NEXT STOP: THE MOON.'], at: EDL.filter((e) => e.at >= T.eggsB && e.at < T.rugged).map((e) => e.at), t0: T.eggsB + 0.05, t1: T.rugged - 0.1 },

  { id: 'rugged-line', style: 'line', text: 'it happens to the best of us. queue again.', t0: T.rugged + 0.3, t1: T.winner - 0.15, y: 960 },

  { id: 'winner-line', style: 'line', text: [[['last degen standing ', P.text], ['takes the bag.', P.gold]]], t0: T.winner + 0.2, t1: T.end - 0.15, y: 960 },

  { id: 'end-name', style: 'kicker', text: 'LAUNCHPAD ROYALE', t0: T.end + 0.1, t1: END - 0.1, y: 250, color: P.mint, size: 34, track: 14 },
  { id: 'end-cta', style: 'slam', text: ['CREATE A LOBBY.', 'SEND THE LINK.'], t0: T.end + 0.2, t1: END - 0.1, size: 104, y: 440, from: 1.3 },
  { id: 'end-url', style: 'url', text: 'z80.wtf/royale', t0: T.end + 0.9, t1: END - 0.1 },
  { id: 'end-footer', style: 'footer', text: 'a doppler.lol production  ·  not financial advice', t0: T.end + 1.4, t1: END - 0.1 },
];

// ---------- shots ----------
// Aberration + exposure kick on every footage cut; flashes on scene cuts are declared below.
const CUT_TIMES = EDL.map((e) => e.at);
function cutKick(t) {
  let k = 0;
  for (const c of CUT_TIMES) if (t >= c && t < c + 0.4) k = Math.max(k, Math.exp(-(t - c) * 12));
  return k;
}
const baseFx = (t, o = {}) => {
  const kick = cutKick(t);
  return { bloom: 0.16, bloomThresh: 0.78, grain: 0.025, vignette: 1.15, aber: 0.0008 + 0.004 * kick, exposure: 0.08 * kick, sat: 1.08, contrast: 1.04, ...o };
};

function footageShot(name, t0, t1, extra = {}) {
  return {
    name, t0, t1,
    draw(ctx, lt, dur, t, overlay) {
      drawFootage(ctx, t);
      extra.draw?.(ctx, lt, dur, t, overlay);
    },
    fx: extra.fx ?? ((lt, t) => baseFx(t)),
  };
}

// Dark gradient under lower-frame type (keeps busy UI footage from fighting the caption).
function underType(ctx) {
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
  g.addColorStop(0, 'rgba(4,6,10,0)');
  g.addColorStop(1, 'rgba(4,6,10,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);
}

// Liquidation Zone: red pulse at the frame edges on every beat.
function zonePulse(ctx, lt, dur, t) {
  const pulse = Math.exp(-((t % BEAT) / BEAT) * 3);
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(255,59,92,0)');
  g.addColorStop(1, `rgba(255,59,92,${0.18 + 0.32 * pulse})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Money printer: gold coins and green bills raining from the top after the pickup.
function coinRain(ctx, lt) {
  const start = 1.5;
  if (lt < start) return;
  const k = lt - start;
  for (let i = 0; i < 70; i++) {
    const r1 = hash(i * 7 + 1), r2 = hash(i * 7 + 2), r3 = hash(i * 7 + 3);
    const sp = 700 + r2 * 700;
    const y = -80 + ((k * sp + r3 * 400) % (H + 160));
    if (k * sp + r3 * 400 < 0) continue;
    ctx.save();
    ctx.translate(r1 * W, y);
    ctx.rotate(lt * (2 + (i % 5)) + i);
    ctx.globalAlpha = 0.9;
    if (i % 3) {
      ctx.fillStyle = P.gold;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 18 * Math.max(0.15, Math.abs(Math.cos(lt * 6 + i))), 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#5fd18b';
      ctx.fillRect(-30, -15, 60, 30);
      ctx.strokeStyle = '#0b3d25';
      ctx.lineWidth = 3;
      ctx.strokeRect(-24, -10, 48, 20);
    }
    ctx.restore();
  }
}

// End card: darken + mint scanline glow behind the CTA.
function endCard(ctx, lt) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(4,6,10,0.35)');
  g.addColorStop(0.5, 'rgba(4,6,10,0.55)');
  g.addColorStop(1, 'rgba(4,6,10,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const p = E.outExpo(seg(lt, 0.8, 1.6));
  ctx.fillStyle = `rgba(25,227,167,${0.9 * p})`;
  ctx.fillRect(W / 2 - 420 * p, 560, 840 * p, 4);
}
// End card: the ten badges in a row, popping in one per 16th.
function endBadges(ctx, lt, dur, t, o) {
  const size = 64, gap = 86, x0 = W / 2 - (gap * (BRANDS.length - 1)) / 2;
  BRANDS.forEach(([id, col], i) => {
    const p = seg(lt, 1.6 + i * 0.125, 1.6 + i * 0.125 + 0.3);
    if (p <= 0 || !badges[id]) return;
    const k = lerp(0.3, 1, E.outBack(p));
    o.save();
    o.translate(x0 + i * gap, 790);
    o.scale(k, k);
    o.globalAlpha = clamp(p * 3) * (1 - E.inCubic(seg(t, END - 0.6, END)));
    o.shadowColor = col;
    o.shadowBlur = 16;
    o.drawImage(badges[id], -size / 2, -size / 2, size, size);
    o.restore();
  });
}

const shots = [
  footageShot('cold-open', T.open, T.title, { fx: (lt, t) => baseFx(t, { bloom: 0.3, glitch: lt > 0.18 && lt < 0.32 ? 0.35 : 0, fade: 1 - E.outCubic(seg(lt, 0, 0.7)), exposure: -0.1 }) }),
  footageShot('title', T.title, T.roster, { fx: (lt, t) => baseFx(t, { bloom: 0.35, streak: 0.25 * Math.exp(-lt * 2), exposure: 0.25 * Math.exp(-lt * 6) }) }),
  footageShot('roster', T.roster, T.drop, { draw: underType }),
  footageShot('drop-in', T.drop, T.clanker, { fx: (lt, t) => baseFx(t, { aber: 0.001 + 0.004 * seg(lt, 2.5, 4), exposure: 0.2 * seg(lt, 3.4, 4) }) }),
  footageShot('ability-clanker', T.clanker, T.orb),
  footageShot('ability-orb', T.orb, T.sendit),
  footageShot('ability-sendit', T.sendit, T.zone),
  footageShot('zone', T.zone, T.airdrop, { draw: zonePulse, fx: (lt, t) => baseFx(t, { tint: [1.08, 0.94, 0.96], sat: 1.0 }) }),
  footageShot('airdrop', T.airdrop, T.eggsA, { draw: coinRain, fx: (lt, t) => baseFx(t, { bloom: 0.32, warm: 0.15 }) }),
  footageShot('eggs-a', T.eggsA, T.eggsB),
  footageShot('eggs-b', T.eggsB, T.rugged),
  footageShot('rugged', T.rugged, T.winner, { draw: underType, fx: (lt, t) => baseFx(t, { glitch: lt < 0.5 ? 0.5 * (1 - lt / 0.5) : 0, sat: lt < 1.5 ? 0.9 : 1.0, aber: 0.001 + 0.006 * Math.exp(-lt * 4) }) }),
  footageShot('winner', T.winner, T.end, { draw: underType, fx: (lt, t) => baseFx(t, { bloom: 0.38, streak: 0.3 * Math.exp(-lt * 2), exposure: 0.3 * Math.exp(-lt * 5), warm: 0.1 }) }),
  footageShot('end-card', T.end, END, { draw: (ctx, lt, dur, t, o) => { endCard(ctx, lt); endBadges(ctx, lt, dur, t, o); }, fx: (lt, t) => baseFx(t, { fade: E.inCubic(seg(t, END - 0.6, END)) }) }),
];

export default {
  title: 'LAUNCHPAD ROYALE — promo',
  output: 'launchpad-royale-promo.mp4',
  duration: END,
  shots,
  captions,
  captionStyles,
  palette,
  fonts: [{ family: U, url: new URL('./fonts/unbounded.ttf', import.meta.url).href, weight: '200 900' }],
  flashes: [
    [T.title, 0.55, 0.12], [T.roster, 0.2, 0.08], [T.clanker, 0.6, 0.12], [T.orb, 0.35, 0.08], [T.sendit, 0.35, 0.08],
    [T.airdrop + 1.5, 0.45, 0.1], [T.airdrop + 2, 0.3, 0.08], [T.eggsA, 0.25, 0.08], [T.rugged, 0.45, 0.1], [T.winner + 0.25, 0.6, 0.12], [T.winner + 1.5, 0.5, 0.12], [T.end, 0.3, 0.1],
    ...SUBCUTS.filter((t) => t >= T.clanker && t < T.zone).map((t) => [t, 0.15, 0.06]),
  ],
  score,
  audio: { seed: 2140, reverb: 2.6, reverbGain: 0.45 },
  async prepare() {
    await loadFootage();
    await Promise.all(BRANDS.map(async ([id]) => {
      const img = new Image();
      img.src = new URL(`../../public/badges/${id}.png`, import.meta.url).href;
      await img.decode();
      badges[id] = img;
    }));
  },
  seek: seekFootage,
  grid: { bar: 2 },
  lint: { captionHold: 3, safe: { margin: 0.05 } },
};

