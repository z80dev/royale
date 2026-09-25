// Cinematic shots (slice B). Recording times in seconds; see cams.ts for the camera helpers.
// Deploy uses a belly-down pose, comet trail and wind streaks, not a parachute/glider.
// Review contacts live beside each MP4. Ride/laser use take 3; pickup uses take 4 after five angle trials.
// The pickup's east-side corridor avoids the foreground tulips blocking every tested front approach;
// Bankr turns toward this camera on exit. The native legendary burst briefly blooms over his silhouette.

import type { Clip } from './cams';
import { chase, track } from './cams';

export const CINEMA_B: Clip[] = [
  {
    name: 'ride',
    rec: 'r1', start: 19, dur: 7.5, fps: 60,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Bankr rides the glowing deploy comet into the Tulip Mania field, ending on touchdown.',
    cam: chase(95, { dist: 12, pitch: 19, fov: 28, lookY: 0.8, yawSpeed: -2, rate: 16 }),
    dof: { aperture: 0.00045, maxblur: 0.009, focus: 'subject' },
    moments: [{ t: 6.6, what: 'Bankr touchdown in Tulip Mania' }], autoMoments: false,
  },
  {
    name: 'laser-eyes-grab',
    rec: 'r1', start: 25.9, dur: 3, fps: 120,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Low east-side pursuit of the legendary Laser Eyes pickup; Bankr turns toward camera on exit.',
    cam: chase(8, { dist: 13, pitch: 8, fov: 28, lookY: 1.2, yawSpeed: -2, rate: 16 }),
    dof: { aperture: 0.0003, maxblur: 0.01, focus: 'subject' },
    moments: [{ t: 1, what: 'legendary Laser Eyes pickup' }], autoMoments: false,
  },
  {
    name: 'first-laser',
    rec: 'r1', start: 45.5, dur: 3, fps: 120,
    ui: false, you: null, focus: [[0, 'p10']], noShake: true,
    description: 'Street-level telephoto push behind Bankr holds the red Laser Eyes beam through FrontRunner.',
    cam: track([[0, [-16, 2.7, -82], 26], [3, [-17.5, 2.5, -80], 26]], { lookOffset: [-1, 1.1, 4], rate: 10 }),
    dof: { aperture: 0.00015, maxblur: 0.007, focus: 'subject' },
    moments: [{ t: 1.37, what: 'first Laser Eyes kill: FrontRunner' }], autoMoments: false,
  },
];
