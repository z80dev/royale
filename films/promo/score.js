// Synthwave/trap hybrid at 120 BPM in A minor (Am – F – C – G), built on the cue sheet:
//   0–4   cold open: drone, heartbeat sub, filtered arp creeping in, riser
//   4–14  drop 1: four-on-the-floor synthwave (octave bass, 16th arp, pumping pad, gated clap)
//   14–18 build: drums out, snare roll, riser + reverse swell into
//   18–30 drop 2: half-time trap (808 glides, hat rolls, big clap on 3, supersaw stabs) + impacts per ability
//   30–34 breakdown: Liquidation Zone alarm, taiko, sub drops, riser
//   34–38 airdrop: printer glitches + coin bells, groove back in
//   38–46 easter eggs: full hybrid groove, blips on every egg cut
//   46–50 rug pull: tape stop, sad detuned keys over the heartbeat, rebuild riser
//   50–54 final drop: everything, choir + braam
//   54–60 end card: groove thins to pad + arp, last impact, tail
import { T, BEAT, BAR, SUBCUTS, END } from './timeline.js';

const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // Am F C G
const ROOTS = [33, 29, 36, 31]; // A1 F1 C2 G1
const chordAt = (t) => Math.floor(t / BAR) % 4;
export function score(k) {
  const { ac } = k;
  // Master: glue compressor + fast limiter in place of the kit's bus compressor, so the peak-normalised mix sits
  // near −14 LUFS with transients ≤ −1 dBTP and the render's loudnorm stays linear (keeps the scene dynamics).
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 6;
  glue.ratio.value = 2;
  glue.attack.value = 0.01;
  glue.release.value = 0.2;
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -5;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.06;
  k.master.disconnect();
  k.master.connect(glue).connect(limit).connect(ac.destination);
  // ---------- custom voices ----------
  const curve = (() => {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 3); }
    return c;
  })();
  // Sidechain pump: gain dips on every beat between t0 and t1.
  const pump = (param, t0, t1, g, depth = 0.75) => {
    param.setValueAtTime(g, t0);
    for (let b = Math.ceil(t0 / BEAT) * BEAT; b < t1; b += BEAT) {
      param.setValueAtTime(g * (1 - depth), b + 0.005);
      param.linearRampToValueAtTime(g, b + BEAT * 0.7);
    }
    param.setValueAtTime(g, t1);
    param.linearRampToValueAtTime(0, t1 + 0.15);
  };
  // Pumping saw pad (synthwave): chord per bar.
  const pumpPad = (t0, t1, g = 0.05, cut = 2200, depth = 0.75) => k.at(t0, () => {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut;
    const a = ac.createGain();
    a.gain.value = 0;
    pump(a.gain, t0, t1, g, depth);
    for (let b = t0; b < t1 - 1e-6; b += BAR) {
      for (const m of CHORDS[chordAt(b)])
        for (const det of [-10, 0, 10]) {
          const o = k.osc('sawtooth', k.hz(m), b, Math.min(BAR, t1 - b) + 0.2);
          o.detune.value = det;
          o.connect(lp);
        }
    }
    lp.connect(a);
    k.out(a, 1, 0.5, 0, 0.8);
  });
  // 808: saturated sine with a pitch dip, optional glide to another note.
  const b808 = (t, m, dur, g = 0.5, glideTo = null) => k.at(t, () => {
    const o = k.osc('sine', k.hz(m + 12) * 1.9, t, dur + 0.2);
    o.frequency.exponentialRampToValueAtTime(k.hz(m + 12), t + 0.04);
    if (glideTo != null) o.frequency.exponentialRampToValueAtTime(k.hz(glideTo + 12), t + dur * 0.9);
    const pre = ac.createGain();
    pre.gain.value = 1.6;
    const ws = ac.createWaveShaper();
    ws.curve = curve;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const a = ac.createGain();
    k.env(a.gain, t, 0.004, g, dur, 0, 0.08);
    o.connect(pre).connect(ws).connect(lp).connect(a);
    k.out(a, 1, 0.05);
  });
  // Supersaw stab: bright, short, wide.
  const stab = (t, notes, g = 0.06, dur = 0.35) => k.at(t, () => {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
    const a = ac.createGain();
    k.env(a.gain, t, 0.005, g, dur);
    for (const m of notes)
      for (const det of [-18, -7, 0, 7, 18]) {
        const o = k.osc('sawtooth', k.hz(m), t, dur + 0.1);
        o.detune.value = det;
        o.connect(lp);
      }
    lp.connect(a);
    k.out(a, 1, 0.45, 0, 0.9);
  });
  // Snare: clap body + noise tail.
  const snare = (t, g = 0.5) => { k.clap(t, g); k.at(t, () => {
    const n = k.noise(t, 0.25);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    const a = ac.createGain();
    k.env(a.gain, t, 0.001, g * 0.6, 0.16);
    n.connect(bp).connect(a);
    k.out(a, 1, 0.25);
  }); };
  // Tape stop: everything bends down (a dying saw chord + sub) — the rug pull.
  const tapeStop = (t, dur = 0.9) => k.at(t, () => {
    const a = ac.createGain();
    a.gain.setValueAtTime(0.09, t);
    a.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(150, t + dur);
    for (const m of [45, 57, 60, 64]) {
      const o = k.osc('sawtooth', k.hz(m), t, dur);
      o.frequency.exponentialRampToValueAtTime(k.hz(m) * 0.18, t + dur);
      o.connect(lp);
    }
    lp.connect(a);
    k.out(a, 1, 0.3, 0, 0.5);
  });

  const arp = (t0, t1, g = 0.05, cut0 = 1800, cut1 = 1800, oct = 12) => {
    for (let t = t0, i = 0; t < t1 - 1e-6; t += BEAT / 4, i++) {
      const ch = CHORDS[chordAt(t)];
      const m = [ch[0], ch[1], ch[2], ch[1] + 12][i % 4] + oct - 12 + (i % 8 >= 4 ? 12 : 0);
      k.pluck(t, m, g * (i % 4 === 0 ? 1 : 0.75), cut0 + (cut1 - cut0) * ((t - t0) / (t1 - t0)), 0.16);
    }
  };
  const fourFloor = (t0, t1, { kick = 0.95, clap = 0.42, hat = 0.07, bass = 0.3 } = {}) => {
    for (let t = t0; t < t1 - 1e-6; t += BEAT) {
      if (kick) k.kick(t, kick);
      const beat = Math.round((t - t0) / BEAT) % 4;
      if (clap && (beat === 1 || beat === 3)) snare(t, clap);
      if (hat) k.hat(t + BEAT / 2, hat * 1.3, 0.05);
      if (hat) { k.hat(t + BEAT / 4, hat * 0.5); k.hat(t + BEAT * 0.75, hat * 0.5); }
    }
    // octave bass on 8ths
    for (let t = t0, i = 0; t < t1 - 1e-6; t += BEAT / 2, i++) {
      const r = ROOTS[chordAt(t)] + 12;
      if (bass) k.bass(t + 0.01, r + (i % 2 ? 12 : 0), BEAT / 2 - 0.03, bass, 'sawtooth', 520);
    }
  };
  // Half-time trap bar pattern: kick on 1 and the "and" of 2, clap on 3, 808 per bar, hats in 8ths/16ths with rolls.
  const trap = (t0, t1, { g808 = 0.8, hat = 0.09, clap = 0.66, kick = 1 } = {}) => {
    for (let b = t0, n = 0; b < t1 - 1e-6; b += BAR, n++) {
      const r = ROOTS[chordAt(b)];
      k.kick(b, kick);
      k.kick(b + BEAT * 1.5, kick * 0.8);
      if (n % 2) k.kick(b + BEAT * 3.25, kick * 0.7);
      snare(b + BEAT * 2, clap);
      b808(b, r, BEAT * 2.6, g808, n % 2 ? r + 5 : null);
      b808(b + BEAT * 3, r + 12, BEAT * 0.9, g808 * 0.8);
      for (let s = 0; s < 16; s++) {
        const t = b + s * BEAT / 4;
        const roll = (n % 2 === 1 && s >= 12) || (n % 2 === 0 && s === 6);
        if (roll) for (let q = 0; q < 3; q++) k.hat(t + q * BEAT / 12, hat * (0.55 + q * 0.2), 0.03);
        else if (s % 2 === 0) k.hat(t, hat * (s % 4 === 0 ? 1.1 : 0.8));
        else if (s % 4 === 3) k.hat(t, hat * 0.45);
      }
    }
  };

  // ---------- 0–4 cold open ----------
  k.drone(0, T.title + 0.5, [33, 45, 52, 57], 0.075, 520);
  for (let t = 0.0; t < T.title; t += BEAT * 2) k.heartbeat(t, 0.5);
  k.glitch(0.3, 0.12, 0.02); // "gm." types
  k.blip(0.32, 1760, 0.02, 0.05);
  k.blip(0.42, 1320, 0.02, 0.05);
  k.blip(0.52, 2640, 0.018, 0.05);
  arp(1, T.title, 0.05, 600, 2600);
  k.riser(1.5, T.title, 0.2);
  k.swell(2.5, T.title, 0.15);

  // ---------- 4–14 drop 1: synthwave ----------
  k.impact(T.title, 0.9, 45);
  k.braam(T.title, [33, 45, 52], 2.4, 0.3, 1.1);
  k.crash(T.title, 0.3);
  k.sub(T.title, 0.6, 80, 30, 2.5);
  fourFloor(T.title + BAR / 2, T.drop, { kick: 0.95, clap: 0.4, hat: 0.07, bass: 0.26 });
  pumpPad(T.title, T.drop, 0.045, 2400);
  arp(T.title, T.drop, 0.05, 2400, 4200);
  // lead melody over the title (A minor pentatonic hook)
  const hook = [[0, 76], [0.75, 74], [1.5, 72], [2, 69], [3, 72], [3.5, 74], [4, 76], [4.75, 79], [5.5, 76], [6, 74]];
  for (const [dt, m] of hook) k.pluck(T.title + BAR + dt, m, 0.05, 5200, 0.4, 'square');
  k.whoosh(T.roster - 0.6, 0.6, 0.18);
  k.impact(T.roster, 0.5, 60);
  // badge pops on 8ths
  for (let i = 0; i < 10; i++) k.blip(T.roster + 0.25 + i * 0.25, k.hz([81, 84, 88, 91, 93][i % 5]), 0.03, 0.06, 'triangle');

  // ---------- 14–18 build ----------
  k.kick(T.drop, 1);
  k.impact(T.drop, 0.45, 50);
  pumpPad(T.drop, T.clanker - BEAT, 0.07, 1600, 0.3);
  arp(T.drop, T.clanker - BEAT, 0.075, 1200, 6500);
  for (let t = T.drop + BAR, i = 0; t < T.clanker - 1e-6; i++) {
    const step = t < T.drop + BAR * 1.5 ? BEAT / 2 : t < T.clanker - BEAT ? BEAT / 4 : BEAT / 8;
    snare(t, 0.2 + 0.3 * ((t - T.drop) / 4));
    t += step;
  }
  for (let t = T.drop; t < T.drop + BAR; t += BEAT) k.kick(t, 0.8);
  k.riser(T.drop, T.clanker, 0.3);
  k.swell(T.drop + 2, T.clanker, 0.3);
  k.whoosh(T.clanker - 0.8, 0.8, 0.22);
  k.sub(T.clanker - BEAT, 0.35, 180, 40, BEAT); // pitch-drop into the drop

  // ---------- 18–30 drop 2: trap hybrid, abilities ----------
  for (const t of [T.clanker, T.orb, T.sendit]) {
    k.impact(t, 0.8, 42);
    k.crash(t, 0.26);
    stab(t, CHORDS[chordAt(t)].map((m) => m + 12), 0.07, 0.5);
  }
  k.braam(T.clanker, [33, 45, 52], 1.8, 0.25, 1.2);
  trap(T.clanker, T.zone);
  fourFloor(T.clanker, T.zone, { kick: 0, clap: 0, hat: 0, bass: 0.17 });
  pumpPad(T.clanker, T.zone, 0.07, 4600, 0.8);
  for (let b = T.clanker; b < T.zone - 1e-6; b += BAR) {
    stab(b + BEAT * 1.5, CHORDS[chordAt(b)].map((m) => m + 12), 0.06, 0.25);
    stab(b + BEAT * 2.5, CHORDS[chordAt(b)].map((m) => m + 12), 0.05, 0.2);
    stab(b + BEAT * 3.5, CHORDS[chordAt(b)].map((m) => m + 12), 0.055, 0.2);
  }
  arp(T.clanker, T.zone, 0.045, 3400, 3400, 24);
  // drop lead: the title hook an octave up, saw + square
  for (const base of [T.clanker, T.sendit - BAR]) for (const [dt, m] of hook) { k.pluck(base + dt, m + 12, 0.06, 6500, 0.35, 'sawtooth'); k.pluck(base + dt, m, 0.045, 4000, 0.35, 'square'); }

  // ---------- 30–34 breakdown: Liquidation Zone ----------
  k.impact(T.zone, 0.7, 38);
  k.sweepDown(T.zone, 1.2, 400, 40, 0.25, 'sawtooth');
  k.drone(T.zone, T.airdrop, [33, 40, 45], 0.09, 700);
  for (let t = T.zone; t < T.airdrop - 1e-6; t += BEAT) {
    // alarm: two-tone siren blips + taiko pulse
    k.blip(t, 988, 0.05, 0.2, 'sawtooth');
    k.blip(t + BEAT / 2, 740, 0.04, 0.2, 'sawtooth');
    if (Math.round((t - T.zone) / BEAT) % 2 === 0) k.taiko(t, 0.55, 58);
  }
  k.strings(T.zone, [45, 52, 57, 60], 3.6, 0.05, 0.8, 0.6);
  for (let t = T.zone; t < T.airdrop; t += BAR) b808(t, 33, BAR * 0.9, 0.5);
  k.riser(T.zone + 2, T.airdrop, 0.3);
  k.whoosh(T.airdrop - 0.6, 0.6, 0.2);

  // ---------- 34–38 airdrop: money printer ----------
  k.impact(T.airdrop + 1.5, 0.7, 50); // crate lands
  k.crash(T.airdrop + 1.5, 0.25);
  k.whoosh(T.airdrop + 0.6, 0.9, 0.16, 2500, 300);
  fourFloor(T.airdrop, T.eggsA, { kick: 0.9, clap: 0.4, hat: 0.07, bass: 0.24 });
  pumpPad(T.airdrop, T.eggsA, 0.04, 2600);
  // brrrr: glitch printer bursts, then coins raining (bells)
  k.impact(T.airdrop + 2, 0.55, 70);
  k.glitch(T.airdrop + 2, 0.5, 0.06);
  k.glitch(T.airdrop + 2.75, 0.4, 0.05);
  for (let i = 0; i < 14; i++) k.bell(T.airdrop + 2.05 + i * 0.125, k.hz([88, 91, 93, 96][i % 4]), 0.035, 0.5, 3.5, 2);

  // ---------- 38–46 easter eggs ----------
  k.impact(T.eggsA, 0.6, 48);
  k.crash(T.eggsA, 0.22);
  fourFloor(T.eggsA, T.rugged, { kick: 0.9, clap: 0.45, hat: 0.075, bass: 0.18 });
  for (let b = T.eggsA, n = 0; b < T.rugged - 1e-6; b += BAR, n++) b808(b, ROOTS[chordAt(b)], BAR * 0.95, 0.6, n % 2 ? ROOTS[chordAt(b)] + 7 : null);
  pumpPad(T.eggsA, T.rugged, 0.06, 3800);
  arp(T.eggsA, T.rugged, 0.05, 3600, 3600);
  for (const t of SUBCUTS.filter((x) => x > T.eggsA && x < T.rugged)) { k.whoosh(t - 0.25, 0.3, 0.12, 600, 5000); k.blip(t, 1568, 0.03, 0.08, 'triangle'); }

  // ---------- 46–50 rug pull ----------
  tapeStop(T.rugged, 0.9);
  k.sweepDown(T.rugged, 0.9, 220, 30, 0.35, 'sawtooth');
  k.impact(T.rugged, 0.6, 40);
  k.glitch(T.rugged + 0.02, 0.3, 0.06);
  for (let t = T.rugged + 1; t < T.winner; t += BEAT * 2) k.heartbeat(t, 0.65);
  // NGMI: detuned minor keys
  for (const [dt, m] of [[1.5, 69], [1.5, 72], [1.5, 76], [2.5, 68], [2.5, 71], [2.5, 74]]) k.piano(T.rugged + dt, m, 0.2, 2.5);
  k.drone(T.rugged + 0.8, T.winner, [33, 44], 0.09, 480);
  k.riser(T.rugged + 2, T.winner, 0.3);
  k.swell(T.rugged + 2.5, T.winner, 0.28);
  snare(T.winner - BEAT, 0.4); snare(T.winner - BEAT * 0.75, 0.45); snare(T.winner - BEAT / 2, 0.5); snare(T.winner - BEAT / 4, 0.55);

  // ---------- 50–54 final drop ----------
  k.impact(T.winner, 1, 40);
  k.crash(T.winner, 0.32);
  k.braam(T.winner, [33, 45, 52, 57], 2.6, 0.28, 1.3);
  k.choir(T.winner, [57, 64, 69, 72], 3.8, 0.05, 'a', 0.3, 1.2);
  k.impact(T.winner + 1.5, 0.6, 55); // results screen
  k.crash(T.winner + 1.5, 0.22);
  trap(T.winner, T.end, { g808: 0.75, hat: 0.09, clap: 0.65 });
  fourFloor(T.winner, T.end, { kick: 0, clap: 0, hat: 0, bass: 0.22 });
  pumpPad(T.winner, T.end, 0.06, 4200, 0.8);
  arp(T.winner, T.end, 0.045, 4200, 4200);
  const win = [[0, 76], [0.5, 79], [1, 81], [1.5, 84], [2, 81], [2.5, 79], [3, 76], [3.5, 74]];
  for (const [dt, m] of win) k.pluck(T.winner + dt, m, 0.07, 6000, 0.45, 'square');

  // ---------- 54–60 end card ----------
  k.impact(T.end, 0.7, 45);
  k.crash(T.end, 0.25);
  fourFloor(T.end, T.end + BAR, { kick: 0.85, clap: 0.35, hat: 0.06, bass: 0.22 });
  pumpPad(T.end, END - 0.5, 0.05, 2200, 0.5);
  arp(T.end, END - 1, 0.04, 3200, 800);
  k.strings(T.end + BAR, [45, 52, 57, 64], 3, 0.05, 1, 1.5);
  k.bell(T.end + BAR * 2, k.hz(81), 0.07, 2.5);
  k.impact(END - 2, 0.45, 45);
  k.sub(END - 2, 0.4, 70, 30, 2);
}
