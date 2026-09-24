import { Synth } from './synth';

export type MusicMode = 'lobby' | 'match' | 'off';
type TrackMode = Exclude<MusicMode, 'off'>;

interface Layer {
  mode: TrackMode;
  source: AudioBufferSourceNode;
  gain: GainNode;
  fadeStart: number;
  fadeEnd: number;
  from: number;
  to: number;
}

const CROSSFADE = 1.5;
const LOOKAHEAD = 0.10;
const CHORDS = [[0, 3, 7, 10], [-5, -2, 2, 5], [-8, -5, -1, 2], [-2, 2, 5, 9]];

/**
 * A lookahead clock arms transitions in audio time, not setInterval time.
 * The procedural score is rendered once and looped on the audio thread: Chrome can
 * throttle background timers for minutes without dropping notes or catching up in a burst.
 */
export class Music {
  private desired: MusicMode = 'off';
  private active: Layer | null = null;
  private layers = new Set<Layer>();
  private buffers = new Map<TrackMode, AudioBuffer>();
  private pending = new Map<TrackMode, Promise<void>>();
  private timer: number | null = null;

  constructor(private readonly context: AudioContext, private readonly bus: GainNode) {}

  setMode(mode: MusicMode): void {
    this.desired = mode;
    if (mode !== 'off' && !this.buffers.has(mode) && !this.pending.has(mode)) {
      const render = renderMusic(mode, this.context.sampleRate).then(buffer => {
        this.buffers.set(mode, buffer);
        this.pending.delete(mode);
        this.tick();
      }).catch(error => {
        this.pending.delete(mode);
        console.warn('Music synthesis unavailable:', error);
      });
      this.pending.set(mode, render);
    }
    this.tick();
    if (mode !== 'off' && this.timer === null) this.timer = window.setInterval(() => this.tick(), 25);
    if (mode === 'off' && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.context.state !== 'running') return;
    if (this.active?.mode === this.desired) return;
    if (this.desired !== 'off' && !this.buffers.has(this.desired)) return;
    const time = this.context.currentTime + LOOKAHEAD;
    for (const layer of this.layers) {
      if (layer.to === 0) continue;
      const fraction = Math.max(0, Math.min(1, (time - layer.fadeStart) / (layer.fadeEnd - layer.fadeStart)));
      const level = layer.from + (layer.to - layer.from) * fraction;
      layer.gain.gain.cancelScheduledValues(time);
      layer.gain.gain.setValueAtTime(level, time);
      layer.gain.gain.linearRampToValueAtTime(0, time + CROSSFADE);
      layer.from = level;
      layer.to = 0;
      layer.fadeStart = time;
      layer.fadeEnd = time + CROSSFADE;
      layer.source.stop(time + CROSSFADE + 0.01);
    }
    this.active = null;
    if (this.desired === 'off') return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers.get(this.desired)!;
    source.loop = true;
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1, time + CROSSFADE);
    source.connect(gain);
    gain.connect(this.bus);
    const layer: Layer = {
      mode: this.desired, source, gain, fadeStart: time, fadeEnd: time + CROSSFADE, from: 0, to: 1,
    };
    this.layers.add(layer);
    this.active = layer;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.layers.delete(layer);
    };
    source.start(time);
  }
}

/** Four-bar, sample-aligned loop; the second cycle includes the previous cycle's release tails. */
export async function renderMusic(mode: TrackMode, sampleRate: number): Promise<AudioBuffer> {
  const driving = mode === 'match';
  const beat = 60 / (driving ? 120 : 100);
  const stepDuration = beat / 4;
  const loopFrames = Math.round(beat * 16 * sampleRate);
  const loopDuration = loopFrames / sampleRate;
  const context = new OfflineAudioContext(2, loopFrames * 2, sampleRate);
  const synth = new Synth(context);
  const padBus = context.createGain();
  const bassBus = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = driving ? 2100 : 1250;
  filter.Q.value = 0.6;
  padBus.connect(filter);
  filter.connect(context.destination);
  bassBus.connect(context.destination);
  const pads = [context.createStereoPanner(), context.createStereoPanner()];
  pads[0].pan.value = -0.55;
  pads[1].pan.value = 0.55;
  for (const pan of pads) pan.connect(padBus);

  for (let cycle = 0; cycle < 2; cycle++) {
    const base = cycle * loopDuration;
    for (let step = 0; step < 64; step++) {
      const time = base + step * stepDuration;
      const chord = CHORDS[Math.floor(step / 16)];
      const voice = synth.voice(context.destination, time);
      if (step % 16 === 0) {
        for (let note = 0; note < chord.length; note++) {
          const frequency = 220 * 2 ** (chord[note] / 12);
          const pad = synth.voice(pads[note % 2], time);
          pad.tone(0, frequency * 0.998, beat * 4.5, 0.075, 'sawtooth', frequency * 0.998, 0.18, beat);
          pad.tone(0, frequency * 1.002, beat * 4.5, 0.05, 'triangle', frequency * 1.002, 0.23, beat);
        }
      }
      if (step % 4 === 0) {
        // Pump the sustained chord/bass under every kick without a sidechain plugin.
        padBus.gain.setValueAtTime(0.30, time);
        padBus.gain.exponentialRampToValueAtTime(0.80, time + beat * 0.8);
        bassBus.gain.setValueAtTime(0.42, time);
        bassBus.gain.linearRampToValueAtTime(0.9, time + beat * 0.55);
        voice.tone(0, 145, 0.22, driving ? 0.48 : 0.36, 'sine', 38);
        voice.noise(0, 0.016, 0.12, 4300, 'highpass');
      }
      if (step % 2 === 0 || driving) {
        const note = [0, 2, 1, 3][Math.floor(step / (driving ? 1 : 2)) % 4];
        const frequency = 55 * 2 ** ((chord[note] + (step % 8 === 6 ? 12 : 0)) / 12);
        const bass = synth.voice(bassBus, time);
        bass.tone(0, frequency, stepDuration * (driving ? 0.8 : 1.5), 0.19, 'triangle');
        bass.tone(0, frequency * 2, stepDuration * 0.65, 0.035, 'sawtooth');
      }
      if (step % 8 === 4) {
        voice.noise(0, 0.14, driving ? 0.24 : 0.13, 1400, 'highpass');
        voice.tone(0, 185, 0.10, 0.11, 'triangle', 95);
        if (driving) voice.noise(0.022, 0.07, 0.10, 2800, 'bandpass');
      }
      if (step % 2 === 0 || driving) {
        voice.noise(0, step % 8 === 6 ? 0.13 : 0.035, driving ? 0.11 : 0.07, 7300, 'highpass');
      }
      if (driving && (step % 16 === 14 || step % 16 === 15)) {
        voice.tone(0, step % 2 === 0 ? 170 : 125, 0.10, 0.14, 'sine', 65);
      }
      if (step % 4 === 2) {
        const frequency = 440 * 2 ** (chord[Math.floor(step / 4) % 4] / 12);
        const arp = synth.voice(pads[step % 8 === 2 ? 0 : 1], time);
        arp.tone(0, frequency, beat * 0.65, 0.09, 'triangle');
        arp.tone(beat * 0.75, frequency, beat * 0.5, 0.025, 'sine');
      }
    }
  }
  const rendered = await context.startRendering();
  const loop = new AudioBuffer({ numberOfChannels: 2, length: loopFrames, sampleRate });
  for (let channel = 0; channel < 2; channel++) {
    loop.copyToChannel(rendered.getChannelData(channel).subarray(loopFrames), channel);
  }
  return loop;
}
