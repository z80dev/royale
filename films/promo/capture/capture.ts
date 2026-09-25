// Deterministic footage capture: replays a recorded round through the real client on a virtual clock, one
// frame per 1000/(clip.fps ?? 60) ms, encoded at that source frame rate as 1920×1080 H.264.
//
//   bun films/promo/capture/build.ts                      # (re)build the capture client after game changes
//   bun films/promo/capture/capture.ts <clip> [<clip>…]   # clips from shots.ts; --all; --list; --still <clip>@<s>
//   bun films/promo/capture/capture.ts --landmarks r1     # landmark / HQ positions of a recording's match map
//
// Writes films/promo/footage/<clip>.mp4 and upserts films/promo/footage/manifest.json.

import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateMap } from '../../../shared/map';
import type { GameEvent, ServerMsg } from '../../../shared/protocol';
import { Cdp, Page, launchChrome } from './cdp';
import type { CamSpec } from './prelude';
import type { Clip } from './cams';
import { SHOTS } from './shots';

const HERE = import.meta.dir;
const ROOT = join(HERE, '../../..');
const DIST = join(HERE, 'dist');
const FOOTAGE = join(HERE, '../footage');
const RECORDINGS = join(HERE, 'recordings');
const W = 1920;
const H = 1080;
/** Supersampling: the page renders at DSF× device pixels; the game caps its canvas at DPR 1.75 (quality 2). */
const DSF = 2;
const GL_W = Math.floor(W * Math.min(DSF, 1.75));
const GL_H = Math.floor(H * Math.min(DSF, 1.75));
const DEFAULT_FPS = 60;
const FRAME_MS = 1000 / DEFAULT_FPS; // pre-roll / fast-forward only
function fpsOf(clip: Clip): number {
  const fps = clip.fps ?? DEFAULT_FPS;
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`${clip.name}: fps must be a positive integer`);
  return fps;
}
/** LR_CAP_SLOT=0..3 lets several capture processes run side by side (own HTTP + DevTools ports). */
const SLOT = Number(process.env.LR_CAP_SLOT ?? 0);
const HTTP_PORT = 3121 + SLOT;
const CDP_PORT = 3139 - SLOT;
const DATE0 = Date.parse('2026-09-24T20:00:00Z');

// ───────────────────────────── recordings ─────────────────────────────

interface RecLine {
  t: number;
  m: ServerMsg;
  s?: Record<string, unknown>;
}
type Snap = Extract<ServerMsg, { t: 'snap' }>;

const recCache = new Map<string, RecLine[]>();
function loadRec(name: string): RecLine[] {
  let rec = recCache.get(name);
  if (!rec) {
    rec = readFileSync(join(RECORDINGS, `${name}.ndjson`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecLine)
      .filter((line) => line.m.t !== 'pong');
    recCache.set(name, rec);
  }
  return rec;
}

/** Focus id at recording time `sec` from the clip's focus schedule. */
function focusAt(clip: Clip, sec: number): string | null {
  let id: string | null = null;
  for (const [at, who] of clip.focus ?? []) if (at <= sec) id = who;
  return id;
}

/** The recorded stream as this clip's client should see it: "you" swapped in, spectate target directed. */
function streamFor(clip: Clip): { t: number; data: string }[] {
  const rec = loadRec(clip.rec);
  const you = clip.you === undefined ? 'p1' : clip.you;
  const killedBy = new Map<string, string | null>();
  const out: { t: number; data: string }[] = [];
  const cycle = clip.brandCycle;
  const brandAt = (ms: number): string | null =>
    cycle && ms >= cycle.from * 1000
      ? cycle.brands[Math.min(cycle.brands.length - 1, Math.floor((ms - cycle.from * 1000) / (cycle.every * 1000)))]!
      : null;
  let lastLobby: Extract<ServerMsg, { t: 'lobby' }> | null = null;
  let nextSwitch = cycle ? cycle.from * 1000 : Infinity;
  const lobbyAs = (lobby: Extract<ServerMsg, { t: 'lobby' }>, ms: number): string => {
    const brand = brandAt(ms);
    if (!brand) return JSON.stringify(lobby);
    return JSON.stringify({
      ...lobby,
      players: lobby.players.map((p) => (p.id === 'p1' ? { ...p, character: brand } : p)),
    });
  };
  for (const line of rec) {
    const m = line.m;
    // Brand-select montage: synthetic lobby updates where the host flips through the brands.
    while (cycle && lastLobby && nextSwitch <= line.t) {
      out.push({ t: nextSwitch, data: lobbyAs(lastLobby, nextSwitch) });
      nextSwitch += cycle.every * 1000;
    }
    if (m.t === 'lobby') {
      lastLobby = m;
      out.push({ t: line.t, data: lobbyAs(m, line.t) });
      continue;
    }
    if (m.t === 'welcome') {
      out.push({ t: line.t, data: JSON.stringify({ ...m, id: you ?? m.id }) });
    } else if (m.t === 'match') {
      out.push({ t: line.t, data: JSON.stringify({ ...m, you }) });
    } else if (m.t === 'snap') {
      for (const e of m.ev) if (e.e === 'kill') killedBy.set(e.victim, e.killer);
      const alive = new Set(m.players.filter((p) => p.alive).map((p) => p.id));
      const self = you ? ((line.s?.[you] as Snap['self'] | undefined) ?? null) : null;
      let spectating: string | null = null;
      if (!self) {
        const directed = focusAt(clip, line.t / 1000);
        const killer = you ? killedBy.get(you) : null;
        spectating = directed && alive.has(directed)
          ? directed
          : killer && alive.has(killer)
            ? killer
            : (m.players.find((p) => p.alive)?.id ?? null);
      }
      out.push({ t: line.t, data: JSON.stringify({ ...m, self, spectating }) });
    } else {
      out.push({ t: line.t, data: JSON.stringify(m) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ───────────────────────────── moments ─────────────────────────────

interface Moment {
  t: number;
  what: string;
}

function autoMoments(clip: Clip): Moment[] {
  const rec = loadRec(clip.rec);
  const names = new Map<string, { name: string; character: string }>();
  const moments: Moment[] = [];
  const t0 = clip.start * 1000;
  const t1 = t0 + clip.dur * 1000;
  const radius = clip.momentRadius ?? 40;
  for (const line of rec) {
    const m = line.m;
    if (m.t === 'match') for (const r of m.roster) names.set(r.id, { name: r.name, character: r.character });
    if (line.t < t0 || line.t > t1) continue;
    const t = Math.round(((line.t - t0) / 1000) * 100) / 100;
    if (m.t === 'end') moments.push({ t, what: 'match end — results screen' });
    if (m.t !== 'snap') continue;
    const subjectId = clip.you && line.s?.[clip.you] ? clip.you : (focusAt(clip, line.t / 1000) ?? clip.you ?? null);
    const subject = subjectId ? m.players.find((p) => p.id === subjectId) : undefined;
    const center = clip.subjectPoint ?? (subject ? [subject.x, subject.z] : null);
    const near = (x: number, z: number): boolean => !center || Math.hypot(x - center[0], z - center[1]) <= radius;
    const pos = (id: string) => m.players.find((p) => p.id === id);
    const label = (id: string | null) => {
      if (!id) return 'the zone';
      const n = names.get(id);
      return n ? `${n.name} (${n.character})` : id;
    };
    for (const e of m.ev as GameEvent[]) {
      switch (e.e) {
        case 'kill': {
          const v = pos(e.victim);
          if (v && !near(v.x, v.z)) break;
          moments.push({ t, what: `kill: ${label(e.killer)} ${e.verb} ${label(e.victim)}${e.w ? ` [${e.w}]` : ''}` });
          break;
        }
        case 'ability':
          if (near(e.x, e.z)) moments.push({ t, what: `ability ${e.kind} by ${label(e.by)}` });
          break;
        case 'boom':
          if (near(e.x, e.z) && e.r >= 3) moments.push({ t, what: `explosion r=${e.r}` });
          break;
        case 'chest': {
          const p = pos(e.by);
          if (e.rug && (!p || near(p.x, p.z))) moments.push({ t, what: `RUG chest opened by ${label(e.by)} — RUGGED` });
          break;
        }
        case 'pickup': {
          const p = pos(e.by);
          if (e.rarity >= 4 && (!p || near(p.x, p.z))) moments.push({ t, what: `legendary pickup: ${e.label} by ${label(e.by)}` });
          break;
        }
        case 'airdrop':
          moments.push({ t, what: 'airdrop incoming (crate starts falling)' });
          break;
        case 'announce':
          if (clip.ui) moments.push({ t, what: `banner: ${e.text}${e.sub ? ` — ${e.sub}` : ''}` });
          break;
        case 'land':
          if (clip.moments === undefined && e.by === subjectId) moments.push({ t, what: `landing: ${label(e.by)}` });
          break;
        default:
          break;
      }
    }
  }
  return moments;
}

// ───────────────────────────── static server ─────────────────────────────

const CAPTURE_HTML = readFileSync(join(ROOT, 'public/index.html'), 'utf8').replace(
  '<script type="module" src="./dist/main.js"></script>',
  '<script src="/cap/prelude.js"></script>\n    <script type="module" src="/cap/main.js"></script>',
);

/** Where POSTed raw frames go (the running clip's ffmpeg stdin). */
let frameSink: ((bytes: Uint8Array) => Promise<void>) | null = null;

function startServer() {
  return Bun.serve({
    port: HTTP_PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/frame' && req.method === 'POST') {
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.length !== GL_W * GL_H * 4 || !frameSink) return new Response('bad frame', { status: 400 });
        await frameSink(bytes);
        return new Response('ok');
      }
      if (url.pathname === '/capture.html') return new Response(CAPTURE_HTML, { headers: { 'Content-Type': 'text/html' } });
      if (url.pathname === '/rooms') return Response.json({ rooms: [] });
      const base = url.pathname.startsWith('/cap/') ? DIST : join(ROOT, 'public');
      const rel = url.pathname.startsWith('/cap/') ? url.pathname.slice(5) : url.pathname.slice(1);
      const file = Bun.file(join(base, decodeURIComponent(rel)));
      return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 });
    },
  });
}

// ───────────────────────────── capture ─────────────────────────────

const HIDE_UI_CSS = '#ui { display: none !important; }';

async function openClipPage(cdp: Cdp, clip: Clip): Promise<Page> {
  const page = await Page.open(cdp, W, H, DSF);
  await page.navigate(`http://127.0.0.1:${HTTP_PORT}/capture.html?quality=2&date0=${DATE0}#DEGENS`);
  await page.eval('document.fonts.ready.then(() => true)');
  await page.eval('__cap.install(), true');
  const css = [clip.ui ? '' : HIDE_UI_CSS, clip.css ?? ''].join('\n');
  if (css.trim()) {
    await page.eval(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true; })()`);
  }
  return page;
}

class Feeder {
  private i = 0;
  constructor(
    private readonly stream: { t: number; data: string }[],
    private readonly until: number,
  ) {}
  due(vt: number): string[] {
    const out: string[] = [];
    while (this.i < this.stream.length && this.stream[this.i]!.t <= vt && this.stream[this.i]!.t <= this.until) {
      out.push(this.stream[this.i]!.data);
      this.i++;
    }
    return out;
  }
}

async function step(page: Page, feeder: Feeder, vt: number, dt: number, grab = false): Promise<void> {
  const msgs = feeder.due(vt + dt);
  const status = await page.eval<number>(`__cap.step(${dt}, ${JSON.stringify(msgs)}, true, ${grab})`);
  if (grab && status !== 200) throw new Error(`frame upload failed (${status})`);
}

/**
 * Runs the replay up to one frame before the clip start (the first captured step lands exactly on it), with the
 * clip camera engaged during the exact-frame pre-roll so its damping has settled.
 */
async function prepare(page: Page, clip: Clip): Promise<{ feeder: Feeder; vt: number }> {
  const stream = streamFor(clip);
  const feeder = new Feeder(stream, clip.feedUntil !== undefined ? clip.feedUntil * 1000 : Infinity);
  const startMs = clip.start * 1000;
  const endMs = startMs - 1000 / fpsOf(clip);
  const preroll = (clip.preroll ?? 2.5) * 1000;
  let vt = 0;
  // Fast-forward in 100 ms steps (still rendering, so effects/camera/HUD state evolve normally).
  while (vt + 100 < endMs - preroll) {
    await step(page, feeder, vt, 100);
    vt += 100;
  }
  // Exact frame steps through the pre-roll so interpolation, damping and particles are settled.
  const prerollFrames = Math.max(0, Math.floor((endMs - vt) / FRAME_MS));
  const lead = endMs - prerollFrames * FRAME_MS - vt;
  if (lead > 0) {
    await step(page, feeder, vt, lead);
    vt += lead;
  }
  const cam: CamSpec = clip.cam ?? { mode: 'game' };
  const setCamera = () =>
    page.eval(`__cap.setCamera(${JSON.stringify(cam)}, ${startMs}, ${JSON.stringify({ noShake: clip.noShake, dof: clip.dof, subjectPoint: clip.subjectPoint })})`);
  if (clip.camPreroll !== false) await setCamera();
  for (let f = 0; f < prerollFrames; f++) {
    await step(page, feeder, vt, FRAME_MS);
    vt += FRAME_MS;
  }
  if (clip.camPreroll === false) await setCamera();
  return { feeder, vt };
}

async function screenshot(page: Page): Promise<Buffer> {
  const { data } = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 100, fromSurface: true });
  return Buffer.from(data, 'base64');
}

async function captureClip(cdp: Cdp, clip: Clip): Promise<void> {
  const started = performance.now();
  const fps = fpsOf(clip);
  const frameMs = 1000 / fps;
  const page = await openClipPage(cdp, clip);
  const prepared = await prepare(page, clip);
  let vt = prepared.vt;
  const out = join(FOOTAGE, `${clip.name}.mp4`);
  // UI clips need the composited page (DOM HUD) → CDP JPEG screenshots (q100). Clean clips read the WebGL
  // drawing buffer directly → lossless raw RGBA (bottom-up, hence vflip).
  const raw = !clip.ui && !clip.screenshot;
  const input = raw
    ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${GL_W}x${GL_H}`, '-framerate', String(fps), '-i', '-']
    : ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg', '-y', '-loglevel', 'error', ...input,
      '-vf', `${raw ? 'vflip,' : ''}scale=${W}:${H}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high',
      '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-r', String(fps), '-movflags', '+faststart', out,
    ],
    { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' },
  );
  // Per-frame backpressure: answer the page's POST only once ffmpeg has taken the frame (long clips otherwise
  // pile hundreds of 25 MB frames into the pipe buffer and stall).
  frameSink = async (bytes) => {
    ffmpeg.stdin.write(bytes);
    await ffmpeg.stdin.flush();
  };
  const frames = Math.round(clip.dur * fps);
  const prepMs = performance.now() - started;
  // Frame f shows the world at clip time f/fps (vt = start + f/fps s).
  for (let f = 0; f < frames; f++) {
    await step(page, prepared.feeder, vt, frameMs, raw);
    vt += frameMs;
    if (!raw) ffmpeg.stdin.write(await screenshot(page));
    if (f % 30 === 0) await ffmpeg.stdin.flush();
  }
  frameSink = null;
  ffmpeg.stdin.end();
  const code = await ffmpeg.exited;
  if (code !== 0) throw new Error(`ffmpeg failed for ${clip.name}`);
  await cdp.send('Target.closeTarget', { targetId: await targetOf(page) });
  upsertManifest(clip);
  const total = performance.now() - started;
  console.log(
    `✓ ${clip.name}: ${frames} frames (${raw ? 'raw' : 'screenshot'}) in ${(total / 1000).toFixed(1)} s ` +
      `(prep ${(prepMs / 1000).toFixed(1)} s, ${((total - prepMs) / frames).toFixed(1)} ms/frame) → ${out}`,
  );
}

async function targetOf(page: Page): Promise<string> {
  const info = await page.send<{ targetInfo: { targetId: string } }>('Target.getTargetInfo');
  return info.targetInfo.targetId;
}

/** Stills (composited page, UI as the clip has it) at clip-local seconds, for framing checks. */
async function stills(cdp: Cdp, clip: Clip, times: number[], dir: string): Promise<void> {
  const page = await openClipPage(cdp, clip);
  const prepared = await prepare(page, clip);
  let vt = prepared.vt;
  let frame = -1;
  const fps = fpsOf(clip);
  const frameMs = 1000 / fps;
  for (const at of [...times].sort((a, b) => a - b)) {
    const target = Math.round(at * fps);
    while (frame < target) {
      await step(page, prepared.feeder, vt, frameMs);
      frame++;
      vt += frameMs;
    }
    const file = join(dir, `${clip.name}@${at}.jpg`);
    writeFileSync(file, await screenshot(page));
    console.log(`still → ${file}`);
  }
  await cdp.send('Target.closeTarget', { targetId: await targetOf(page) });
}

// ───────────────────────────── manifest ─────────────────────────────

interface ManifestEntry {
  name: string;
  file: string;
  duration: number;
  fps: number;
  hasUi: boolean;
  description: string;
  moments: Moment[];
}

function upsertManifest(clip: Clip): void {
  // Parallel capture processes (LR_CAP_SLOT) share the manifest: serialize the read-modify-write with a lock dir.
  const lock = join(FOOTAGE, '.manifest.lock');
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (i > 200) throw new Error('manifest lock stuck: remove footage/.manifest.lock');
      Bun.sleepSync(50);
    }
  }
  try {
    writeManifestEntry(clip);
  } finally {
    rmdirSync(lock);
  }
}

function writeManifestEntry(clip: Clip): void {
  const file = join(FOOTAGE, 'manifest.json');
  const entries: ManifestEntry[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ManifestEntry[]) : [];
  const moments = [...(clip.moments ?? []), ...(clip.autoMoments === false ? [] : autoMoments(clip))]
    .filter((m) => m.t >= 0 && m.t <= clip.dur)
    .sort((a, b) => a.t - b.t);
  const entry: ManifestEntry = {
    name: clip.name,
    file: `${clip.name}.mp4`,
    duration: Math.round(clip.dur * fpsOf(clip)) / fpsOf(clip),
    fps: fpsOf(clip),
    hasUi: clip.ui,
    description: clip.description,
    moments,
  };
  const index = entries.findIndex((e) => e.name === clip.name);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

// ───────────────────────────── main ─────────────────────────────

const argv = process.argv.slice(2);
if (argv[0] === '--list') {
  for (const c of SHOTS) console.log(`${c.name.padEnd(28)} ${c.rec} ${c.start}s +${c.dur}s ${c.ui ? 'UI' : '  '} ${c.description}`);
  process.exit(0);
}
if (argv[0] === '--landmarks') {
  const rec = loadRec(argv[1]!);
  const match = rec.find((l) => l.m.t === 'match')?.m as Extract<ServerMsg, { t: 'match' }>;
  const map = generateMap(match.seed);
  for (const l of map.landmarks) console.log(`${l.id.padEnd(16)} (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) r=${l.r} ${l.name}`);
  process.exit(0);
}
if (argv[0] === '--manifest') {
  // Rewrite manifest entries (moments, descriptions) for already captured clips without re-capturing.
  for (const clip of SHOTS) if (existsSync(join(FOOTAGE, `${clip.name}.mp4`))) upsertManifest(clip);
  process.exit(0);
}
if (argv[0] === '--moments') {
  const clip = SHOTS.find((c) => c.name === argv[1]);
  if (!clip) throw new Error(`unknown clip ${argv[1]}`);
  console.log(autoMoments(clip));
  process.exit(0);
}

mkdirSync(FOOTAGE, { recursive: true });
const server = startServer();
const chrome = await launchChrome({ port: CDP_PORT, width: W, height: H, headless: true });
const cdp = await Cdp.connect(chrome.wsUrl);
try {
  if (argv[0] === '--sheet') {
    // --sheet <clip…|--all>: 3 stills per clip (start / middle / end) tiled into /tmp/lr-sheets/<clip>.jpg
    const dir = '/tmp/lr-sheets';
    mkdirSync(dir, { recursive: true });
    const names = argv.includes('--all') ? SHOTS.map((c) => c.name) : argv.slice(1);
    const queue = names.map((n) => {
      const clip = SHOTS.find((c) => c.name === n);
      if (!clip) throw new Error(`unknown clip ${n}`);
      return clip;
    });
    const worker = async (): Promise<void> => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        const times = [0, Math.round(clip.dur * 30) / 60, Math.round((clip.dur - 0.1) * 60) / 60];
        await stills(cdp, clip, times, dir);
        const inputs = times.flatMap((t) => ['-i', join(dir, `${clip.name}@${t}.jpg`)]);
        const tile = Bun.spawnSync([
          'ffmpeg', '-y', '-loglevel', 'error', ...inputs, '-filter_complex',
          '[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[a][b][c]hstack=3', '-q:v', '3',
          join(dir, `${clip.name}.jpg`),
        ]);
        if (tile.exitCode !== 0) throw new Error(`tiling failed for ${clip.name}`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } else if (argv[0] === '--eval') {
    // --eval clip@seconds file.js : step to the clip-local time, then evaluate the file in the page and print it
    const [name, at] = argv[1]!.split('@') as [string, string];
    const clip = SHOTS.find((c) => c.name === name);
    if (!clip) throw new Error(`unknown clip ${name}`);
    const page = await openClipPage(cdp, clip);
    const prepared = await prepare(page, clip);
    let vt = prepared.vt;
    const frameMs = 1000 / fpsOf(clip);
    for (let f = 0; f <= Math.round(Number(at) * fpsOf(clip)); f++) {
      await step(page, prepared.feeder, vt, frameMs);
      vt += frameMs;
    }
    console.log(await page.eval(readFileSync(argv[2]!, 'utf8')));
  } else if (argv[0] === '--still') {
    // --still clip@seconds[,seconds…] [outdir]
    const [name, times] = argv[1]!.split('@') as [string, string];
    const clip = SHOTS.find((c) => c.name === name);
    if (!clip) throw new Error(`unknown clip ${name}`);
    const dir = argv[2] ?? '/tmp/lr-stills';
    mkdirSync(dir, { recursive: true });
    await stills(cdp, clip, times.split(',').map(Number), dir);
  } else {
    const wanted = argv.includes('--all') ? SHOTS : argv.map((n) => {
      const clip = SHOTS.find((c) => c.name === n);
      if (!clip) throw new Error(`unknown clip ${n}`);
      return clip;
    });
    for (const clip of wanted) await captureClip(cdp, clip);
  }
} finally {
  cdp.close();
  chrome.proc.kill();
  server.stop(true);
}
process.exit(0);
