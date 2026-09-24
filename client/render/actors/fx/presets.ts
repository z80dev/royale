// Particle burst presets. Constant objects → zero allocation per emission.

import { Atlas, type AtlasCell } from './particles';

export interface BurstPreset {
  layer: 'add' | 'alpha';
  speed: number; // m/s
  speedJitter: number; // 0..1 fraction of speed randomized away
  up: number; // extra upward velocity
  upJitter: number;
  flat: number; // 0 = spherical scatter, 1 = horizontal disc
  cone: number; // with an explicit direction: 0 = exactly along it, 1 = wide scatter
  life: number;
  lifeJitter: number;
  size: number;
  sizeEnd: number;
  sizeJitter: number;
  gravity: number; // m/s² (negative = rises)
  drag: number;
  stretch: number; // >0 → velocity-aligned streak
  cell: AtlasCell;
  spin: number; // rad/s max random spin (spinning particles also get a random start rotation)
  rot: number; // fixed screen rotation for non-spinning sprites (π = arrow pointing down)
  glow: number; // color multiplier (bloom)
  alpha: number;
  radius: number; // spawn position jitter
  fadeIn: number; // fraction of life
  bounce: number; // ground restitution (0 = passes through)
}

const base: BurstPreset = {
  layer: 'add',
  speed: 0,
  speedJitter: 0.5,
  up: 0,
  upJitter: 0,
  flat: 0,
  cone: 0.5,
  life: 0.5,
  lifeJitter: 0.4,
  size: 0.2,
  sizeEnd: 0,
  sizeJitter: 0.3,
  gravity: 0,
  drag: 2,
  stretch: 0,
  cell: Atlas.Dot,
  spin: 0,
  rot: 0,
  glow: 2.5,
  alpha: 1,
  radius: 0,
  fadeIn: 0,
  bounce: 0,
};

export const P = {
  spark: {
    ...base,
    speed: 15, speedJitter: 0.7, up: 2, flat: 0.25, cone: 0.55, life: 0.32, size: 0.07, sizeEnd: 0.02, gravity: 20,
    drag: 3, stretch: 0.03, glow: 3.2, bounce: 0.35,
  },
  bigSpark: {
    ...base,
    speed: 26, speedJitter: 0.7, up: 6, flat: 0.1, life: 0.8, size: 0.12, sizeEnd: 0.03, gravity: 16, drag: 1.6,
    stretch: 0.035, glow: 3.5, bounce: 0.4,
  },
  flash: {
    ...base,
    life: 0.075, lifeJitter: 0, size: 0.9, sizeEnd: 1.4, sizeJitter: 0.2, cell: Atlas.Star, spin: 0, glow: 3.2,
    drag: 0,
  },
  glow: { ...base, life: 0.25, lifeJitter: 0.2, size: 1.2, sizeEnd: 2.2, glow: 2.2, drag: 0 },
  ember: {
    ...base,
    speed: 5, speedJitter: 0.8, up: 3.5, upJitter: 3, life: 1.3, lifeJitter: 0.5, size: 0.09, sizeEnd: 0.0,
    gravity: -1.2, drag: 1.4, glow: 3.4,
  },
  fire: {
    ...base,
    speed: 6, speedJitter: 0.8, up: 2.5, life: 0.55, lifeJitter: 0.4, size: 1.0, sizeEnd: 2.4, gravity: -4,
    drag: 3.2, cell: Atlas.Smoke, spin: 2, glow: 1.5, alpha: 0.55,
  },
  smoke: {
    ...base,
    layer: 'alpha', speed: 2.6, speedJitter: 0.8, up: 1.4, upJitter: 1, life: 2.4, lifeJitter: 0.4, size: 1.0,
    sizeEnd: 3.4, gravity: -0.7, drag: 1.3, cell: Atlas.Smoke, spin: 0.6, glow: 1, alpha: 0.6, fadeIn: 0.08,
  },
  puff: {
    ...base,
    layer: 'alpha', speed: 1.4, up: 0.8, life: 0.6, size: 0.25, sizeEnd: 0.8, gravity: -0.5, drag: 2.5,
    cell: Atlas.Smoke, spin: 1, glow: 0.6, alpha: 0.25, fadeIn: 0.1,
  },
  dust: {
    ...base,
    layer: 'alpha', speed: 7, speedJitter: 0.5, up: 0.7, flat: 1, life: 1.0, lifeJitter: 0.3, size: 0.55,
    sizeEnd: 1.7, drag: 3.6, cell: Atlas.Smoke, spin: 0.8, glow: 1, alpha: 0.42, fadeIn: 0.05,
  },
  shard: {
    ...base,
    speed: 9, speedJitter: 0.6, up: 3, cone: 0.7, life: 0.5, size: 0.17, sizeEnd: 0.05, gravity: 16, drag: 2,
    cell: Atlas.Shard, spin: 14, glow: 2.6, bounce: 0.3,
  },
  sparkle: {
    ...base,
    speed: 1.6, up: 2.6, upJitter: 1.5, life: 0.95, size: 0.28, sizeEnd: 0.0, gravity: -0.6, drag: 1.4,
    cell: Atlas.Star, spin: 3, glow: 3, radius: 0.5,
  },
  arrow: {
    ...base,
    speed: 0.3, up: 4.5, upJitter: 2, life: 0.95, size: 0.34, sizeEnd: 0.18, drag: 1.2, cell: Atlas.Arrow,
    glow: 2.6, radius: 0.75,
  },
  plus: {
    ...base,
    speed: 0.4, up: 2.2, upJitter: 1, life: 1.0, size: 0.24, sizeEnd: 0.1, drag: 1, cell: Atlas.Plus, glow: 2.6,
    radius: 0.65,
  },
  confetti: {
    ...base,
    speed: 5, speedJitter: 0.6, up: 7, upJitter: 2, life: 1.5, size: 0.15, sizeEnd: 0.1, gravity: 10, drag: 1.3,
    cell: Atlas.Shard, spin: 12, glow: 1.9,
  },
  coinGlint: {
    ...base,
    speed: 3, up: 5, upJitter: 2, life: 1.1, size: 0.42, sizeEnd: 0.1, gravity: 5, drag: 1.3, cell: Atlas.Bitcoin,
    glow: 2.4, spin: 2,
  },
  bubble: {
    ...base,
    speed: 0.25, up: 1.1, upJitter: 0.6, life: 1.3, size: 0.1, sizeEnd: 0.2, drag: 0.5, cell: Atlas.Ring, glow: 1.8,
    alpha: 0.9,
  },
  speedLine: {
    ...base,
    speed: 0, life: 0.28, lifeJitter: 0.3, size: 0.05, sizeEnd: 0.02, drag: 0, stretch: 0.06, glow: 3,
  },
  trail: { ...base, speed: 0.3, life: 0.8, lifeJitter: 0.3, size: 0.32, sizeEnd: 0.03, drag: 1, glow: 1.6, alpha: 0.7 },
  exhaust: { ...base, speed: 1.2, life: 0.18, lifeJitter: 0.3, size: 0.45, sizeEnd: 0.1, drag: 3, glow: 3.2 },
  swirl: {
    ...base,
    speed: 0, life: 0.5, lifeJitter: 0.2, size: 0.09, sizeEnd: 0.02, drag: 0, glow: 2.2, stretch: 0.04,
  },
  ringPop: {
    ...base,
    speed: 0, life: 0.5, lifeJitter: 0, size: 0.5, sizeEnd: 2.2, sizeJitter: 0, drag: 0, cell: Atlas.Ring,
    glow: 2.5,
  },
  chevronDown: {
    ...base,
    speed: 0, life: 0.8, lifeJitter: 0.2, size: 0.5, sizeEnd: 0.3, drag: 0, cell: Atlas.Arrow, glow: 2.8,
    rot: Math.PI,
  },
  candle: {
    ...base,
    speed: 6, speedJitter: 0.6, up: 9, upJitter: 3, life: 1.3, size: 0.26, sizeEnd: 0.18, gravity: 14, drag: 0.8,
    cell: Atlas.Arrow, spin: 0, glow: 1.8,
  },
} satisfies Record<string, BurstPreset>;
