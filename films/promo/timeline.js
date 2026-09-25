// Cue sheet for the LAUNCHPAD ROYALE promo. 120 BPM: a beat is 0.5 s, a bar 2 s. Every scene cut sits on a bar;
// picture (shots + footage sub-cuts), captions, flashes and the score all read these numbers.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

// Scene starts (seconds). Scenes are 2–3 bars so every caption holds ≥ 3 s before its cut. The trailer follows one
// match (recording r1) from the drop to the last shot, told through bankr_bot, with the ten factions around him.
export const T = {
  open: 0, //      cold open: slow-mo Laser Eyes kill (hook), snap to black
  title: 4, //     city flyover + Blender 3D title (drop 1: synthwave groove)
  roster: 10, //   10 launchpads. 1 bag.
  drop: 14, //     riding the skydive down (build)
  loot: 18, //     DROP 2 (trap hybrid): Laser Eyes legendary, first blood
  mintdrop: 22, // faction abilities
  clanker: 26,
  orb: 30,
  zone: 34, //     the Liquidation Zone is coming (breakdown)
  eggs: 38, //     the city's lore
  final: 42, //    2 degens left (tension)
  duel: 46, //     the last shot, slow motion
  winner: 50, //   WINNER WINNER LAMBO DINNER (final drop)
  end: 54, //      end card (Blender: blender/endcard.py → footage/end-slabs.mp4)
  fin: 60,
};
// Film times the score hits (picture lands these moments via EDL hit/hitAt).
export const HIT = {
  hookKill: 2, //   cold-open Laser Eyes kill
  black: 3.25, //   snap to black before the title
  logo: 4, //       LAUNCHPAD slams (ROYALE on the next beat)
  landing: 17.75, // bankr touches down
  grab: 18.5, //    Laser Eyes picked up
  firstKill: 21, // first Laser Eyes kill
  mintLand: 24, //  Mint Drop landing shockwave
  final2: 43, //    Laser Eyes kills 0xRugger: 2 left
  shot: 47, //      the last sniper shot
};
export const END = T.fin;

// Footage edit decision list: sub-cuts inside the scenes, on beats. Each entry:
//   at      film seconds where the sub-cut starts (it runs until the next entry)
//   clip    logical clip name (see CLIPS in footage.js for the mapping to footage/manifest.json)
//   in      source seconds at the sub-cut start
//   speed   constant playback speed, or ramp: [[localSeconds, speed], …] (piecewise linear, integrated)
//   zoom    [from, to] scale over the sub-cut (1 = full frame); fx/fy source focus point 0..1, drawn at screen cx/cy
//   hit/hitAt  instead of `in`: land source second `hit` (a manifest moment) at film second `hitAt`
//   whip    ±1: whip-pan transition into this sub-cut (horizontal smear), 0/undefined: hard cut
//   punch   beat punch-in strength (scale kick on every beat)
//   dim     darken 0..1 (under type)
// Alpha WebM overlays are composited over the footage in declaration order. Each layer has:
//   clip, at, until, alpha: true  manifest clip alias, active film-time interval [at, until), alpha channel required
//   in, speed                     source start and playback speed (defaults to 0 and 1)
// Layers without alpha: true are unsupported and skipped.
export const LAYERS = [
  // Blender 3D title (blender/title.py): LAUNCHPAD lands on source frame 7, so start 7 frames early to land on the beat
  { clip: 'title-logo', at: HIT.logo - 7 / 60, until: T.roster, in: 0, speed: 1, alpha: true },
];

export const EDL = [
  // cold open: the hook, a 240 fps Laser Eyes kill in slow motion, then a hard snap to black
  { at: T.open, clip: 'hook-laser', hit: 0.9, hitAt: HIT.hookKill, speed: 0.3, zoom: [1.08, 1.0] },
  { at: HIT.black, clip: 'hook-laser', in: 2.4, speed: 1, dim: 1 },
  // title: one continuous flyover past the moon rocket and over the HQs, the 3D title slams over it
  { at: T.title, clip: 'city', in: 4.8, speed: 1.2, zoom: [1.1, 1.0] },
  // roster: character select flipping through all ten brands on 8ths (badge blips in the score)
  { at: T.roster, clip: 'select', hit: 0.5, hitAt: T.roster + 0.25, ramp: [[0, 2.6], [2.55, 2.6], [2.75, 0.5]], zoom: [1.5, 1.58], fx: 0.276, fy: 0.4, cx: 0.5, cy: 0.4 },
  // drop: 24 skydivers leave together, then ride down with bankr_bot to the touchdown
  { at: T.drop, clip: 'skydive', in: 0.2, speed: 1, zoom: [1.0, 1.1] },
  { at: T.drop + 1.5, clip: 'ride', hit: 6.6, hitAt: HIT.landing, speed: 1, zoom: [1.0, 1.05], whip: 1 },
  // loot: the Laser Eyes legendary in the tulip field (slow motion), then its first kill
  { at: T.loot, clip: 'laser-eyes-grab', hit: 1.0, hitAt: HIT.grab, ramp: [[0, 0.5], [1.2, 0.4], [2.2, 1]], zoom: [1.1, 1.0] },
  { at: T.loot + 2.5, clip: 'first-laser', hit: 1.37, hitAt: HIT.firstKill, ramp: [[0, 1], [0.35, 0.45], [1.1, 0.45], [1.5, 1]], zoom: [1.12, 1.04], whip: 1 },
  // abilities: each faction's hero shot (slow motion on the moment), then beat cuts
  { at: T.mintdrop, clip: 'mintdrop-cine', hit: 1.03, hitAt: HIT.mintLand, ramp: [[0, 1], [0.35, 1], [0.5, 0.3], [2.3, 0.3], [2.6, 1]], zoom: [1.1, 1.0] },
  { at: T.mintdrop + 3, clip: 'pump', hit: 1.7, hitAt: T.mintdrop + 3.25, speed: 1.2, zoom: [1.3, 1.2], whip: 1, punch: 0.04 },
  { at: T.mintdrop + 3.5, clip: 'combat-c', hit: 5.33, hitAt: T.mintdrop + 3.75, speed: 1.2, zoom: [1.35, 1.25], punch: 0.04 },
  { at: T.clanker, clip: 'clanker-cine', hit: 2.73, hitAt: T.clanker + 2.5, ramp: [[0, 1], [0.8, 0.6], [2.2, 0.6], [2.75, 1]], zoom: [1.08, 1.0], whip: -1 },
  { at: T.clanker + 3, clip: 'doppler', hit: 0.87, hitAt: T.clanker + 3.25, speed: 1.2, zoom: [1.3, 1.2], whip: 1, punch: 0.04 },
  { at: T.clanker + 3.5, clip: 'combat-b', hit: 1.23, hitAt: T.clanker + 3.75, speed: 1.2, zoom: [1.35, 1.25], punch: 0.04 },
  { at: T.orb, clip: 'orb-cine', hit: 0.4, hitAt: T.orb + 0.5, ramp: [[0, 1], [0.8, 0.45], [2.2, 0.45], [2.75, 1]], zoom: [1.08, 1.0], whip: 1 },
  { at: T.orb + 3, clip: 'pool', hit: 0.7, hitAt: T.orb + 3.1, speed: 1.1, zoom: [1.3, 1.2], whip: -1, punch: 0.04 },
  // zone: the Liquidation Zone wall from the street, then from above
  { at: T.zone, clip: 'zone-cine', in: 0.5, speed: 1, zoom: [1.05, 1.0] },
  { at: T.zone + 2.5, clip: 'zone', in: 2, speed: 1, zoom: [1.0, 1.08], whip: 1 },
  // the city's lore, one per 1.5/1.25 beats
  { at: T.eggs, clip: 'satoshi', in: 0.5, speed: 1, zoom: [1.12, 1.0], whip: 1 },
  { at: T.eggs + 1.5, clip: 'lambo', in: 1, speed: 1, zoom: [1.12, 1.0], whip: -1 },
  { at: T.eggs + 2.75, clip: 'pizza', in: 3, speed: 1, zoom: [1.1, 1.0], whip: 1 },
  // final: Laser Eyes takes out JPEG's 0xRugger (2 left), then over bankr's shoulder toward the last whale
  { at: T.final, clip: 'final2-laser', hit: 0.98, hitAt: HIT.final2, ramp: [[0, 1], [0.6, 0.5], [1.6, 0.5], [2.0, 1]], zoom: [1.06, 1.0] },
  { at: T.final + 2.5, clip: 'duel-ots', hit: 2.0, hitAt: T.duel, speed: 1, zoom: [1.04, 1.1] },
  // duel: the last shot in slow motion, then the end-of-match orbit around the winner
  { at: T.duel, clip: 'duel', hit: 1.01, hitAt: HIT.shot, speed: 0.3, zoom: [1.1, 1.0] },
  { at: T.duel + 2.5, clip: 'winner-b', hit: 0.93, hitAt: T.duel + 2.6, speed: 1, zoom: [1.15, 1.05], whip: 1 },
  // winner: the WINNER WINNER LAMBO DINNER results screen
  { at: T.winner, clip: 'winner', hit: 2.43, hitAt: T.winner, speed: 1, zoom: [1.0, 1.04] },
  // end card: the ten launchpad slabs slam down one per 16th from +1.6 s (Blender render, source = film time)
  { at: T.end, clip: 'end-slabs', in: 0, speed: 1 },
];

// Sub-cut starts inside scenes (for flashes/whooshes); scene cuts are in T.
export const SUBCUTS = EDL.map((e) => e.at).filter((t) => !Object.values(T).includes(t));
