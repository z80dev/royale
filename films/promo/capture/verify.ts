// Checks captured clips: stream format (1920×1080, 60 fps CFR, H.264 yuv420p), frame count vs manifest, and
// per-frame pacing proxies — frozen frames (no change from the previous frame) and flash/black glitches (a frame
// whose brightness departs sharply from both neighbours).
// Usage: bun films/promo/capture/verify.ts [clip…]   (default: every clip in footage/manifest.json)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FOOTAGE = join(import.meta.dir, '../footage');
const manifest = JSON.parse(readFileSync(join(FOOTAGE, 'manifest.json'), 'utf8')) as { name: string; file: string; duration: number }[];
const wanted = process.argv.slice(2);
let bad = 0;
for (const entry of manifest.filter((e) => !wanted.length || wanted.includes(e.name))) {
  const file = join(FOOTAGE, entry.file);
  const probe = Bun.spawnSync([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames',
    '-of', 'json', file,
  ]);
  const s = (JSON.parse(probe.stdout.toString()) as { streams: Record<string, string | number>[] }).streams[0]!;
  const frames = Number(s.nb_read_frames);
  const problems: string[] = [];
  if (s.codec_name !== 'h264' || s.width !== 1920 || s.height !== 1080 || s.pix_fmt !== 'yuv420p') problems.push(`format ${s.codec_name} ${s.width}x${s.height} ${s.pix_fmt}`);
  if (s.r_frame_rate !== '60/1' || s.avg_frame_rate !== '60/1') problems.push(`fps ${s.r_frame_rate} avg ${s.avg_frame_rate}`);
  if (frames !== Math.round(entry.duration * 60)) problems.push(`frames ${frames} ≠ ${Math.round(entry.duration * 60)}`);
  const stats = Bun.spawnSync([
    'ffmpeg', '-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-',
  ]).stdout.toString();
  const yavg: number[] = [];
  const ydif: number[] = [];
  for (const line of stats.split('\n')) {
    const a = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (a) yavg.push(Number(a[1]));
    const d = /lavfi\.signalstats\.YDIF=([\d.]+)/.exec(line);
    if (d) ydif.push(Number(d[1]));
  }
  const frozen = ydif.map((d, i) => (i > 0 && d === 0 ? i : -1)).filter((i) => i >= 0);
  const glitches: number[] = [];
  for (let i = 1; i < yavg.length - 1; i++) {
    const [p, c, n] = [yavg[i - 1]!, yavg[i]!, yavg[i + 1]!];
    const ref = (p + n) / 2;
    if (Math.abs(c - ref) > Math.max(4, ref * 0.25) && Math.abs(p - n) < Math.max(3, ref * 0.12)) glitches.push(i);
  }
  if (yavg.length && (yavg[0]! < yavg[1]! * 0.6 || yavg[yavg.length - 1]! < yavg[yavg.length - 2]! * 0.6)) glitches.push(-1);
  // A partly black (NaN-bloom) frame shows as a change spike into it AND out of it, far above the clip's usual motion.
  const sortedDif = ydif.slice(1).sort((x, y) => x - y);
  const medianDif = sortedDif[Math.floor(sortedDif.length / 2)] ?? 0;
  for (let i = 1; i < ydif.length - 1; i++) {
    const limit = Math.max(6, medianDif * 4);
    const darker = yavg[i]! < Math.min(yavg[i - 1]!, yavg[i + 1]!) - 3; // NaN blocks are black; flashes brighten
    if (ydif[i]! > limit && ydif[i + 1]! > limit && darker && !glitches.includes(i)) glitches.push(i);
  }
  if (frozen.length) problems.push(`${frozen.length} frozen frames (first ${frozen.slice(0, 5).join(',')})`);
  if (glitches.length) problems.push(`brightness glitches at ${glitches.slice(0, 8).join(',')}`);
  const meanDif = ydif.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, ydif.length - 1);
  console.log(`${problems.length ? '✗' : '✓'} ${entry.name.padEnd(14)} ${frames} f  mean Δ ${meanDif.toFixed(2)}  ${problems.join(' · ')}`);
  if (problems.length) bad++;
}
process.exit(bad ? 1 : 0);
