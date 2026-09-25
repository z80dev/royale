// Cue sheet for the LAUNCHPAD ROYALE promo. 120 BPM: a beat is 0.5 s, a bar 2 s. Every scene cut sits on a bar;
// picture (shots + footage sub-cuts), captions, flashes and the score all read these numbers.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

// Scene starts (seconds). Scenes are 2–3 bars so every caption holds ≥ 3 s before its cut.
export const T = {
  open: 0, //      cold open: "gm."
  title: 4, //     city flyover, LAUNCHPAD ROYALE (drop 1: synthwave groove)
  roster: 10, //   10 launchpads. 1 bag.
  drop: 14, //     drop in (build)
  clanker: 18, //  DROP 2 (trap hybrid): abilities
  orb: 22,
  sendit: 26,
  zone: 30, //     the Liquidation Zone is coming (breakdown)
  airdrop: 34, //  Money Printer: brrrr
  eggsA: 38, //    easter eggs
  eggsB: 42,
  rugged: 46, //   RUGGED / NGMI (rug pull in the score)
  winner: 50, //   WINNER WINNER LAMBO DINNER (final drop)
  end: 54, //      end card
  fin: 60,
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
export const EDL = [
  // cold open: high approach over the city at night, pushed dark and slow
  { at: T.open, clip: 'city', in: 0, speed: 0.6, zoom: [1.15, 1.06], dim: 0.45 },
  // title: one continuous flyover past the moon rocket and over the HQs
  { at: T.title, clip: 'city', in: 4.8, speed: 1.2, zoom: [1.1, 1.0], whip: 1 },
  // roster: character select flipping through all ten brands on 8ths (badge blips in the score)
  { at: T.roster, clip: 'select', hit: 0.5, hitAt: T.roster + 0.25, ramp: [[0, 2.6], [2.55, 2.6], [2.75, 0.5]], zoom: [1.5, 1.58], fx: 0.276, fy: 0.4, cx: 0.5, cy: 0.4 },
  // drop in: 24 skydivers leave together, then touchdown lands right before the drop
  { at: T.drop, clip: 'skydive', in: 0.2, speed: 1, zoom: [1.0, 1.1] },
  { at: T.drop + 1.5, clip: 'landing', hit: 4.2, hitAt: T.clanker - 0.1, ramp: [[0, 1], [1.9, 1], [2.5, 1.6]], zoom: [1.0, 1.1], whip: 1 },
  // abilities: the named ability first (slow-mo on the cast), then beat cuts of other brands' abilities
  { at: T.clanker, clip: 'clanker', hit: 0.87, hitAt: T.clanker + 0.3, ramp: [[0, 1], [0.3, 1], [0.5, 0.35], [1.8, 0.35], [2.2, 1.2]], zoom: [1.3, 1.15], punch: 0.03 },
  { at: T.clanker + 2.5, clip: 'combat-b', hit: 1.23, hitAt: T.clanker + 2.75, speed: 1.2, zoom: [1.35, 1.25], whip: -1, punch: 0.04 },
  { at: T.clanker + 3.25, clip: 'clanker', hit: 3.13, hitAt: T.clanker + 3.5, speed: 1.2, zoom: [1.3, 1.2], punch: 0.04 },
  { at: T.orb, clip: 'orb', hit: 0.8, hitAt: T.orb + 0.3, ramp: [[0, 1], [0.3, 1], [0.5, 0.4], [1.8, 0.4], [2.2, 1]], zoom: [1.3, 1.12], punch: 0.03, whip: 1 },
  { at: T.orb + 2.5, clip: 'pump', hit: 1.7, hitAt: T.orb + 2.75, speed: 1.2, zoom: [1.3, 1.2], whip: 1, punch: 0.04 },
  { at: T.orb + 3.25, clip: 'pool', hit: 0.7, hitAt: T.orb + 3.35, speed: 1.1, zoom: [1.3, 1.2], punch: 0.04 },
  { at: T.sendit, clip: 'sendit', hit: 0.87, hitAt: T.sendit + 0.25, ramp: [[0, 1], [0.25, 1], [0.45, 0.4], [1.9, 0.4], [2.2, 1.1]], zoom: [1.3, 1.12], punch: 0.03, whip: -1 },
  { at: T.sendit + 2.5, clip: 'doppler', hit: 0.87, hitAt: T.sendit + 2.75, speed: 1.2, zoom: [1.3, 1.2], whip: 1, punch: 0.04 },
  { at: T.sendit + 3.25, clip: 'combat-c', hit: 5.33, hitAt: T.sendit + 3.5, speed: 1.2, zoom: [1.35, 1.25], punch: 0.04 },
  // zone: the Liquidation Zone wall sweeping in
  { at: T.zone, clip: 'zone', in: 0.5, speed: 1, zoom: [1.0, 1.1] },
  // airdrop lands on the beat, the Money Printer goes brrrr
  { at: T.airdrop, clip: 'airdrop', hit: 7.1, hitAt: T.airdrop + 1.5, speed: 1, zoom: [1.1, 1.0], whip: 1 },
  { at: T.airdrop + 1.75, clip: 'printer-b', hit: 0.9, hitAt: T.airdrop + 2, speed: 1.2, zoom: [1.35, 1.25], punch: 0.05 },
  // easter eggs, one per 1.5/1.25 beats
  { at: T.eggsA, clip: 'satoshi', in: 0.5, speed: 1, zoom: [1.12, 1.0], whip: 1 },
  { at: T.eggsA + 1.5, clip: 'lambo', in: 1, speed: 1, zoom: [1.12, 1.0], whip: -1 },
  { at: T.eggsA + 2.75, clip: 'pizza', in: 3, speed: 1, zoom: [1.1, 1.0], whip: 1 },
  { at: T.eggsB, clip: 'whale', in: 1, speed: 1, zoom: [1.1, 1.0], whip: -1 },
  { at: T.eggsB + 1.5, clip: 'luna', in: 1, speed: 1, zoom: [1.1, 1.0], whip: 1 },
  { at: T.eggsB + 2.75, clip: 'rocket', hit: 6, hitAt: T.rugged - 0.1, speed: 1.4, zoom: [1.1, 1.0], whip: -1 },
  // rug pull: the RUGGED callout, then the NGMI screen
  { at: T.rugged, clip: 'rugged-ui', hit: 1.47, hitAt: T.rugged + 0.02, speed: 1 },
  { at: T.rugged + 1.5, clip: 'ngmi', hit: 2.83, hitAt: T.rugged + 1.65, speed: 1 },
  // winner: final kill (clean), then the WINNER WINNER LAMBO DINNER results screen
  { at: T.winner, clip: 'winner-b', hit: 0.93, hitAt: T.winner + 0.25, speed: 1, zoom: [1.15, 1.05], punch: 0.02 },
  { at: T.winner + 1.5, clip: 'winner', hit: 2.43, hitAt: T.winner + 1.5, speed: 1, zoom: [1.0, 1.04] },
  // end card over the city
  { at: T.end, clip: 'city-2', hit: 13, hitAt: END, speed: 0.7, zoom: [1.05, 1.12], dim: 0.5 },
];

// Sub-cut starts inside scenes (for flashes/whooshes); scene cuts are in T.
export const SUBCUTS = EDL.map((e) => e.at).filter((t) => !Object.values(T).includes(t));
