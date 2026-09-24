// Shared tunables + content tables. Imported by server AND client — keep pure (no DOM / Bun APIs).

export const TICK_RATE = 30; // server sim + client input step (Hz)
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 1; // send snapshot every N ticks
export const INTERP_DELAY_MS = 100; // client-side interpolation buffer for remote entities

export const MAP_HALF = 100; // playable area is [-MAP_HALF, MAP_HALF] on x and z
export const PLAYER_RADIUS = 0.7;
export const PLAYER_SPEED = 7.2; // m/s
export const DASH_SPEED = 22;
export const DASH_TIME = 0.16; // s
export const DASH_COOLDOWN = 2.2; // s
export const MAX_HP = 100;
export const MAX_ARMOR = 100;
// Deploy: during the 'deploy' phase everyone glides from DEPLOY_ALTITUDE toward their chosen landing
// point (horizontal speed ≤ DEPLOY_STEER_SPEED) and descends linearly so ALL players land exactly
// when the phase ends (y = DEPLOY_ALTITUDE · phaseT / PHASE_TIMES.deploy). No early-landing advantage.
export const DEPLOY_ALTITUDE = 70;
export const DEPLOY_STEER_SPEED = 24; // m/s horizontal glide toward target
export const PICKUP_RADIUS = 2.2; // interact range for loot + chests
export const AUTO_PICKUP_RADIUS = 1.4; // ammo / heals / armor are auto-picked when walked over
export const MAX_PLAYERS = 32;
export const MAX_TEAM_SIZE = 6;

export const PHASE_TIMES = {
  countdown: 5, // s in lobby countdown before deploy
  deploy: 12, // s window to choose landing spot (players fall during it)
  ended: 14, // s results screen before returning to lobby
};

// ───────────────────────────── Characters ─────────────────────────────

export type CharacterId =
  | 'doppler'
  | 'uniswap'
  | 'pons'
  | 'long'
  | 'jump'
  | 'fomo'
  | 'pump'
  | 'clanker'
  | 'zora'
  | 'bankr';

export type AbilityKind =
  | 'blink' // teleport up to `range` toward aim, sonic ring slows enemies near origin+dest
  | 'healPool' // area entity healing allies
  | 'reveal' // reveals enemies within range to team (minimap + outline) for duration
  | 'dmgBuff' // outgoing damage multiplier for duration
  | 'leap' // arc jump to aim point (clamped to range), ignores walls, landing shockwave dmg
  | 'rush' // speed + fire-rate buff for self and nearby teammates
  | 'grenade' // thrown explosive to aim point
  | 'turret' // deploys sentry entity that shoots nearest enemy
  | 'dome' // bubble entity that blocks all enemy projectiles
  | 'armorUp'; // instant armor refill + brief damage immunity

export interface AbilityDef {
  kind: AbilityKind;
  name: string;
  desc: string;
  cooldown: number; // s
  duration?: number; // s
  range?: number; // m
  radius?: number; // m
  power?: number; // kind-specific: heal/s, dmg mult, dmg, speed mult, armor amount…
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  site: string;
  logo: string; // URL path under public/, e.g. /logos/doppler.svg
  primary: string; // hex
  secondary: string; // hex
  tagline: string;
  blurb: string;
  ability: AbilityDef;
}

// `logo` = page-relative 512×512 rounded-square badge PNG (public/badges/, built from the real marks in public/logos/).
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'doppler',
    name: 'Doppler',
    site: 'doppler.lol',
    logo: 'badges/doppler.png',
    primary: '#0FAE85',
    secondary: '#7CFFD4',
    tagline: 'Price discovery at the speed of sound',
    blurb: 'Onchain token launches with fair price discovery. The home team.',
    ability: {
      kind: 'blink',
      name: 'Doppler Shift',
      desc: 'Blink 11m toward your aim. Sonic boom slows enemies at both ends.',
      cooldown: 9,
      range: 11,
      radius: 4.5,
      duration: 2,
      power: 0.5,
    },
  },
  {
    id: 'uniswap',
    name: 'Uniswap',
    site: 'uniswap.org',
    logo: 'badges/uniswap.png',
    primary: '#FF007A',
    secondary: '#FFD6EA',
    tagline: 'x · y = k',
    blurb: 'The OG AMM. Where every token eventually trades.',
    ability: {
      kind: 'healPool',
      name: 'Liquidity Pool',
      desc: 'Deploy a pool that heals allies 14 HP/s for 5s.',
      cooldown: 18,
      duration: 5,
      radius: 4,
      power: 14,
    },
  },
  {
    id: 'pons',
    name: 'Pons',
    site: 'ponsfamily.com',
    logo: 'badges/pons.png',
    primary: '#C9CED6',
    secondary: '#FFFFFF',
    tagline: 'Fixed supply, family ties',
    blurb: 'Fixed-supply launchpad on Robinhood Chain. Nobody moves on the family unseen.',
    ability: {
      kind: 'reveal',
      name: 'Family Radar',
      desc: 'Reveal every enemy within 45m to your whole team for 6s.',
      cooldown: 16,
      duration: 6,
      range: 45,
    },
  },
  {
    id: 'long',
    name: 'Long',
    site: 'long.xyz',
    logo: 'badges/long.png',
    primary: '#DDF5E3',
    secondary: '#27C46B',
    tagline: 'Only up',
    blurb: 'Tokenized markets & capital formation on Robinhood Chain. Never short the team.',
    ability: {
      kind: 'dmgBuff',
      name: 'Long Position',
      desc: '+45% weapon damage for 6s. Up only.',
      cooldown: 16,
      duration: 6,
      power: 1.45,
    },
  },
  {
    id: 'jump',
    name: 'Jump',
    site: 'jump.fun',
    logo: 'badges/jump.png',
    primary: '#1576D2',
    secondary: '#8DEEFF',
    tagline: 'Win the LiqWar',
    blurb: 'Ethereum memecoin launchpad, liquidity-war veteran. Launch first, ask questions never.',
    ability: {
      kind: 'leap',
      name: 'Send It',
      desc: 'Leap up to 16m over anything. Landing shockwave deals 30.',
      cooldown: 11,
      range: 16,
      radius: 4,
      power: 30,
      duration: 0.7,
    },
  },
  {
    id: 'fomo',
    name: 'Fomo',
    site: 'fomo.family',
    logo: 'badges/fomo.png',
    primary: '#606AF7',
    secondary: '#C9CCFF',
    tagline: 'Where traders become legends',
    blurb: 'Social trading app with feeds, copy trading and alerts. You will not miss this one.',
    ability: {
      kind: 'rush',
      name: 'FOMO Rush',
      desc: '+45% move speed and +35% fire rate for you and allies within 10m for 5s.',
      cooldown: 15,
      duration: 5,
      radius: 10,
      power: 1.45,
    },
  },
  {
    id: 'pump',
    name: 'Pump',
    site: 'pump.fun',
    logo: 'badges/pump.png',
    primary: '#5FD18B',
    secondary: '#E9FFF1',
    tagline: 'Bonding curve go brrr',
    blurb: 'The memecoin factory. Pump it, then dump it on them.',
    ability: {
      kind: 'grenade',
      name: 'Pump & Dump',
      desc: 'Lob a bonding-curve bomb up to 18m. 65 damage in a 4.5m blast.',
      cooldown: 9,
      range: 18,
      radius: 4.5,
      power: 65,
    },
  },
  {
    id: 'clanker',
    name: 'Clanker',
    site: 'clanker.world',
    logo: 'badges/clanker.png',
    primary: '#8A63D2',
    secondary: '#E0D4FF',
    tagline: 'Clank it into existence',
    blurb: 'The AI agent that deploys tokens. And turrets.',
    ability: {
      kind: 'turret',
      name: 'Deploy Clanker',
      desc: 'Deploy a sentry for 9s that shoots enemies within 22m.',
      cooldown: 18,
      duration: 9,
      range: 22,
      power: 9,
    },
  },
  {
    id: 'zora',
    name: 'Zora',
    site: 'zora.co',
    logo: 'badges/zora.png',
    primary: '#4281D3',
    secondary: '#F2CEFE',
    tagline: 'Everything is a coin',
    blurb: 'Onchain creator network. Mint the orb, block the bullets.',
    ability: {
      kind: 'dome',
      name: 'Orb Shield',
      desc: 'Summon a 4m orb dome that blocks enemy bullets for 5s.',
      cooldown: 18,
      duration: 5,
      radius: 4,
    },
  },
  {
    id: 'bankr',
    name: 'Bankr',
    site: 'bankr.bot',
    logo: 'badges/bankr.png',
    primary: '#FF613D',
    secondary: '#A78BFA',
    tagline: 'Your AI banker',
    blurb: 'AI crypto agent that trades on command. It moves the money. And the armor.',
    ability: {
      kind: 'armorUp',
      name: 'Vault Mode',
      desc: 'Instantly refill 60 armor and take no damage for 1.2s.',
      cooldown: 20,
      duration: 1.2,
      power: 60,
    },
  },
];

export const CHARACTER_BY_ID: Record<CharacterId, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
) as Record<CharacterId, CharacterDef>;

// ───────────────────────────── Weapons ─────────────────────────────

export type AmmoType = 'light' | 'shells' | 'heavy' | 'rocket' | 'energy';
export type Rarity = 0 | 1 | 2 | 3 | 4; // common, uncommon, rare, epic, legendary
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const;
export const RARITY_COLORS = ['#B8C2CC', '#3DDC84', '#3FA9FF', '#B65CFF', '#FFB627'] as const;

export type WeaponId =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'ar'
  | 'sniper'
  | 'rocket'
  | 'laser'
  | 'minigun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  flavor: string;
  rarity: Rarity;
  ammo: AmmoType;
  damage: number; // per pellet
  fireInterval: number; // s between shots
  pellets: number;
  spread: number; // radians (half-angle, uniform)
  moveSpreadMul: number; // spread multiplier while moving
  projectileSpeed: number; // m/s (Infinity-like values = effectively hitscan)
  range: number; // m before projectile expires
  mag: number;
  reloadTime: number; // s
  auto: boolean; // hold to fire
  explosionRadius?: number; // rockets
  pierce?: boolean; // laser passes through players (not walls)
  spinUp?: number; // s of held fire before full rate (minigun)
  color: string; // tracer / muzzle color
  kick: number; // screen shake / recoil feel 0..1
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'Gwei Pistol', flavor: 'Cheap shots. Low fees.', rarity: 0, ammo: 'light',
    damage: 13, fireInterval: 0.3, pellets: 1, spread: 0.035, moveSpreadMul: 1.6,
    projectileSpeed: 90, range: 42, mag: 12, reloadTime: 1.1, auto: false, color: '#9FE8FF', kick: 0.15,
  },
  smg: {
    id: 'smg', name: 'MEV Bot', flavor: 'Sandwiches you before you can react.', rarity: 1, ammo: 'light',
    damage: 8, fireInterval: 0.09, pellets: 1, spread: 0.09, moveSpreadMul: 1.3,
    projectileSpeed: 85, range: 34, mag: 30, reloadTime: 1.6, auto: true, color: '#7CFFB2', kick: 0.12,
  },
  shotgun: {
    id: 'shotgun', name: 'Rug Puller', flavor: 'Up close, everyone gets rugged.', rarity: 1, ammo: 'shells',
    damage: 8, fireInterval: 0.9, pellets: 9, spread: 0.22, moveSpreadMul: 1.1,
    projectileSpeed: 70, range: 16, mag: 5, reloadTime: 2.2, auto: false, color: '#FFB35C', kick: 0.6,
  },
  ar: {
    id: 'ar', name: 'Whale AR', flavor: 'Moves markets. And bodies.', rarity: 2, ammo: 'heavy',
    damage: 13, fireInterval: 0.12, pellets: 1, spread: 0.045, moveSpreadMul: 1.8,
    projectileSpeed: 110, range: 55, mag: 25, reloadTime: 1.9, auto: true, color: '#FFE45C', kick: 0.25,
  },
  sniper: {
    id: 'sniper', name: 'Diamond Hands', flavor: 'Never sells. Never misses.', rarity: 3, ammo: 'heavy',
    damage: 72, fireInterval: 1.4, pellets: 1, spread: 0.004, moveSpreadMul: 6,
    projectileSpeed: 220, range: 110, mag: 4, reloadTime: 2.6, auto: false, color: '#9AF7FF', kick: 0.8,
  },
  rocket: {
    id: 'rocket', name: 'Moon Rocket', flavor: 'Wen moon? Now.', rarity: 3, ammo: 'rocket',
    damage: 75, fireInterval: 1.2, pellets: 1, spread: 0.01, moveSpreadMul: 1.5,
    projectileSpeed: 38, range: 60, mag: 1, reloadTime: 2.2, auto: false, color: '#FF6B3D', kick: 0.9,
    explosionRadius: 5,
  },
  laser: {
    id: 'laser', name: 'Laser Eyes', flavor: '100k or bust. Pierces bodies.', rarity: 4, ammo: 'energy',
    damage: 50, fireInterval: 0.9, pellets: 1, spread: 0, moveSpreadMul: 1,
    projectileSpeed: 400, range: 90, mag: 5, reloadTime: 2.4, auto: false, color: '#FF2244', kick: 0.7,
    pierce: true,
  },
  minigun: {
    id: 'minigun', name: 'Money Printer', flavor: 'brrrrrrrrrrrrrrrr', rarity: 4, ammo: 'heavy',
    damage: 9, fireInterval: 0.05, pellets: 1, spread: 0.11, moveSpreadMul: 1.2,
    projectileSpeed: 100, range: 45, mag: 120, reloadTime: 3.2, auto: true, color: '#7DFF6B', kick: 0.2,
    spinUp: 0.6,
  },
};

export const AMMO_NAMES: Record<AmmoType, string> = {
  light: 'Light Sats',
  shells: 'Rug Shells',
  heavy: 'Whale Rounds',
  rocket: 'Moon Fuel',
  energy: 'Laser Cells',
};
export const AMMO_MAX: Record<AmmoType, number> = { light: 240, shells: 40, heavy: 180, rocket: 8, energy: 20 };
export const AMMO_PICKUP: Record<AmmoType, number> = { light: 45, shells: 10, heavy: 30, rocket: 2, energy: 5 };
export const STARTING_AMMO: Record<AmmoType, number> = { light: 36, shells: 0, heavy: 0, rocket: 0, energy: 0 };

// Heals / armor (consumables). Channel = seconds standing-ish (movement allowed at 50% speed) before applied.
export type ConsumableId = 'stable' | 'medkit' | 'armorS' | 'armorL';
export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  flavor: string;
  rarity: Rarity;
  heal?: number;
  armor?: number;
  channel: number; // s (0 = instant on pickup)
  maxCarry: number;
}
export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  stable: { id: 'stable', name: 'Stablecoin', flavor: '1:1 backed by vibes. +25 HP', rarity: 0, heal: 25, channel: 1.2, maxCarry: 6 },
  medkit: { id: 'medkit', name: 'Cold Wallet', flavor: 'Full restore. Not your keys, not your HP.', rarity: 2, heal: 100, channel: 3.5, maxCarry: 3 },
  armorS: { id: 'armorS', name: 'Seed Phrase', flavor: '+25 armor. Write it down.', rarity: 1, armor: 25, channel: 0, maxCarry: 0 },
  armorL: { id: 'armorL', name: 'Hardware Wallet', flavor: '+75 armor. Ledger-grade.', rarity: 3, armor: 75, channel: 0, maxCarry: 0 },
};

// ───────────────────────────── Zone ─────────────────────────────
// "The Liquidation Zone". Each phase: wait `wait` s, then shrink over `shrink` s to radius `r`.
export interface ZonePhaseDef { wait: number; shrink: number; r: number; dps: number; name: string }
export const ZONE_START_RADIUS = 150; // covers corners of the 200×200 map
export const ZONE_PHASES: ZonePhaseDef[] = [
  { wait: 45, shrink: 30, r: 80, dps: 2, name: 'Bear market incoming' },
  { wait: 35, shrink: 25, r: 50, dps: 4, name: 'Margin call' },
  { wait: 30, shrink: 22, r: 30, dps: 7, name: 'Cascading liquidations' },
  { wait: 25, shrink: 18, r: 16, dps: 11, name: 'Capitulation' },
  { wait: 20, shrink: 15, r: 6, dps: 16, name: 'Max pain' },
  { wait: 15, shrink: 15, r: 0, dps: 25, name: 'Total liquidation' },
];

// Airdrops (legendary crate falling from the sky) — times in seconds after 'playing' starts.
export const AIRDROP_TIMES = [60, 150, 240];
export const AIRDROP_FALL_TIME = 10; // s from announce to landing

// ───────────────────────────── Scoring ─────────────────────────────
// Shown in-game as "PnL" in dollars.
export const SCORE = {
  kill: 100,
  damage: 1, // per HP dealt
  placement: [500, 300, 200, 120, 80, 50, 30, 20], // by team place (1st, 2nd…)
  win: 0, // included in placement[0]
};

// ───────────────────────────── Bots ─────────────────────────────
export const BOT_NAMES = [
  'SmolDegen', 'WhaleAlert', 'gmBot', 'JeetMaster', 'ExitLiquidity', '0xRugger', 'PaperHands',
  'DiamondDave', 'BagHolder', 'WAGMI_Wendy', 'NGMI_Ned', 'LamboLarry', 'ApeFirst', 'FloorSweeper',
  'GasGuzzler', 'MEV_Mike', 'Satoshi_Jr', 'FUDster', 'CopeCat', 'Ser_Pump', 'HODLbot9000',
  'FrontRunner', 'WenMoon', 'ShillBill', 'AirdropHunter', 'BullishBarb', 'LiquidLouie', 'SandwichSam',
];

export const KILL_VERBS = {
  weapon: ['rugged', 'liquidated', 'rekt', 'dumped on', 'front-ran', 'sandwiched', 'margin-called', 'soft-rugged', 'sniped', 'burned'],
  explosion: ['sent to the moon', 'blew up the bags of', 'nuked'],
  zone: ['got liquidated by the zone', 'couldn\'t outrun the bear market', 'paper-handed the zone'],
  rug: ['opened a rug chest'],
};
