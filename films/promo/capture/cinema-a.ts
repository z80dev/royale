// Cinematic shots (slice A). Recording times in seconds; see cams.ts for the camera helpers.

import { chase, track, type Clip } from './cams';

export const CINEMA_A: Clip[] = [
  {
    name: 'hook-laser',
    rec: 'r1', start: 171.3, dur: 2.5, fps: 240,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Cold open: Bankr fires the red Laser Eyes beam through moonboi in Pump territory.',
    cam: track([[0, [-47, 2.05, -46], 28], [2.5, [-47, 2.15, -48], 28]], { lookOffset: [3.7, 1.05, -0.9], rate: 12 }),
    dof: { aperture: 0.0008, maxblur: 0.011, focus: 'subject' },
    moments: [{ t: 0.9, what: 'Bankr Laser Eyes kills moonboi — red beam' }],
    autoMoments: false,
  },
  {
    name: 'final2-laser',
    rec: 'r1', start: 178.12, dur: 3, fps: 120,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Bankr sweeps a long red beam across the street to finish 0xRugger (JPEG).',
    cam: track([[0, [-11, 2.1, -9], 31], [3, [-10, 2.2, -11], 31]], { lookOffset: [-0.6, 1.05, 18], rate: 11 }),
    dof: { aperture: 0.0004, maxblur: 0.008, focus: 'subject' },
    moments: [{ t: 0.98, what: 'Laser Eyes crosses the frame and kills 0xRugger' }],
    autoMoments: false,
  },
  {
    name: 'duel',
    rec: 'r1', start: 218.92, dur: 1.8, fps: 240,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Low telephoto across the final 1v1: Bankr sniper tracer to WhaleAlert.',
    cam: track([[0, [-28, 2, -17], 28], [1.8, [-26.5, 2.1, -17], 28]], { lookOffset: [-2, 1.05, 9], rate: 12 }),
    dof: { aperture: 0.0006, maxblur: 0.012, focus: 'subject' },
    moments: [{ t: 0.95, what: 'Bankr fires the final sniper shot' }, { t: 1.01, what: 'WhaleAlert falls — match-winning hit' }],
    autoMoments: false,
  },
  {
    name: 'duel-ots',
    rec: 'r1', start: 217.8, dur: 2.45, fps: 120,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Shoulder-level tracking behind Bankr as he lines up the last sniper shot on WhaleAlert.',
    cam: chase(-83, { dist: 9, pitch: 5, fov: 32, lookY: 1.16, yawSpeed: -0.8, rate: 12 }),
    dof: { aperture: 0.0008, maxblur: 0.01, focus: 'subject' },
    moments: [{ t: 2.07, what: 'Bankr fires at WhaleAlert' }],
    autoMoments: false,
  },
];
