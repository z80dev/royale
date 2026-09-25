// Cinematic shots (slice C). Recording times in seconds; see cams.ts for the camera helpers.

import { path, track, type Clip } from './cams';

const mint = { rec: 'r1', start: 102.3, dur: 2.5, fps: 240, ui: false, you: null, focus: [[0, 'b14']], noShake: true, subjectPoint: [-63, 41], description: 'JPEG Mint Drop: 0xRugger leaps and shockwave-kills DiamondDave.', moments: [{ t: 0.37, what: 'Mint Drop leap' }, { t: 1.03, what: 'Mint Drop shockwave kills DiamondDave' }], autoMoments: false } satisfies Omit<Clip, 'name' | 'cam' | 'dof'>;
const turret = { rec: 'r2', start: 36.2, dur: 3.5, fps: 120, ui: false, you: null, focus: [[0, 'b10']], noShake: true, subjectPoint: [33.4, -56], description: 'Clanker deploys its auto turret beside Zora HQ and fires on a JPEG player.', moments: [{ t: 0.47, what: 'Clanker turret deploys' }, { t: 2.73, what: 'Auto-turret downs jumpman' }], autoMoments: false } satisfies Omit<Clip, 'name' | 'cam' | 'dof'>;
const orb = { rec: 'r1', start: 36.9, dur: 3.1, fps: 120, ui: false, you: null, focus: [[0, 'b7']], noShake: true, subjectPoint: [-25, -63], description: 'Zora Orb Shield blossoms around FrontRunner amid nearby tracer fire.', moments: [{ t: 0.4, what: 'FrontRunner raises the Orb Shield' }], autoMoments: false } satisfies Omit<Clip, 'name' | 'cam' | 'dof'>;
const zone = { rec: 'r1', start: 136, dur: 6, fps: 60, ui: false, you: null, focus: [[0, 'b14']], noShake: true, subjectPoint: [-68, -9], description: 'The Liquidation Zone advances across the western street behind 0xRugger.', moments: [{ t: 0, what: 'Liquidation Zone wall advancing' }, { t: 5, what: 'The energy wall gains ground behind 0xRugger' }], autoMoments: false } satisfies Omit<Clip, 'name' | 'cam' | 'dof'>;

export const CINEMA_C: Clip[] = [
  {
    ...mint,
    name: 'mintdrop-cine',
    cam: track([[0, [-76, 1.8, 34], 29], [2.5, [-77, 1.7, 32], 29]], { lookOffset: [0, 1, -2], rate: 14 }),
    dof: { aperture: 0.0018, maxblur: 0.014, focus: 'subject' },
  },
  {
    ...turret,
    name: 'clanker-cine',
    cam: path([[0, [32, 4.5, -62.5], [31.5, 1.1, -54.9], 36], [3.5, [30.5, 4.8, -62.5], [31.5, 1.1, -54.9], 36]]),
    dof: { aperture: 0.0002, maxblur: 0.009, focus: 'subject' },
  },
  {
    ...orb,
    name: 'orb-cine',
    cam: path([[0, [-18, 1.7, -44], [-25.8, 1.1, -63.5], 27], [3.1, [-17, 1.8, -46], [-25.5, 1.1, -63.5], 27]]),
    dof: { aperture: 0.001, maxblur: 0.012, focus: 'subject' },
  },
  {
    ...zone,
    name: 'zone-cine',
    cam: track([[0, [-56, 1.7, -8], 26], [6, [-54, 1.8, -8], 26]], { lookOffset: [0, 1.1, 2.7], rate: 11 }),
    dof: { aperture: 0.0007, maxblur: 0.01, focus: 'subject' },
  },
];
