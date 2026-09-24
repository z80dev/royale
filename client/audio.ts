import type { AudioApi, SfxName, SfxOpts } from './view';
import { sound } from './audio/effects';
import { Music, type MusicMode } from './audio/music';
import { Synth, type Voice } from './audio/synth';

interface ActiveVoice {
  synth: Voice;
  gain: GainNode;
  pan: StereoPannerNode;
}

const MAX_VOICES = 32;
const HEARING_DISTANCE = 60;
const THROTTLE_SECONDS = 0.025;

/** Gesture-unlocked, asset-free sound. The caller owns the persisted volume setting. */
export class Audio implements AudioApi {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private synth: Synth | null = null;
  private music: Music | null = null;
  private musicMode: MusicMode = 'off';
  private volume = 0.7;
  private listenerX = 0;
  private listenerZ = 0;
  private voices = new Set<ActiveVoice>();
  private lastVoice = new Map<string, number>();

  unlock(): void {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const sfx = context.createGain();
      const music = context.createGain();
      master.gain.value = this.volume;
      sfx.gain.value = 0.72;
      music.gain.value = 0.16;
      compressor.threshold.value = -12;
      compressor.knee.value = 9;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.15;
      sfx.connect(master);
      music.connect(master);
      master.connect(compressor);
      compressor.connect(context.destination);
      this.context = context;
      this.master = master;
      this.sfxBus = sfx;
      this.synth = new Synth(context);
      this.music = new Music(context, music);
      context.addEventListener('statechange', () => {
        if (context.state === 'running') this.music?.setMode(this.musicMode);
      });
      this.music.setMode(this.musicMode);
    }
    if (this.context.state !== 'running' && this.context.state !== 'closed') {
      // A denied/interrupted resume can be retried on the next user gesture.
      void this.context.resume().catch(() => {});
    }
  }

  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  setVolume(master: number): void {
    if (!Number.isFinite(master)) return;
    this.volume = Math.max(0, Math.min(1, master));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
    }
  }

  setMusic(mode: MusicMode): void {
    this.musicMode = mode;
    this.music?.setMode(mode);
  }

  play(name: SfxName, opts?: SfxOpts): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.synth || !this.sfxBus) return;
    let attenuation = 1;
    let pan = 0;
    if (opts?.x !== undefined || opts?.z !== undefined) {
      const dx = (opts.x ?? this.listenerX) - this.listenerX;
      const dz = (opts.z ?? this.listenerZ) - this.listenerZ;
      const distance = Math.hypot(dx, dz);
      if (!Number.isFinite(distance) || distance >= HEARING_DISTANCE) return;
      const falloff = Math.max(0, (distance - 3) / (HEARING_DISTANCE - 3));
      attenuation = (1 - falloff) ** 2;
      pan = Math.max(-1, Math.min(1, dx / 24));
    }
    const volume = Math.max(0, Math.min(1, opts?.vol ?? 1)) * attenuation;
    if (!Number.isFinite(volume) || volume <= 0.001) return;
    const now = context.currentTime;
    const key = name === 'shot' ? `shot:${opts?.w ?? 'pistol'}` : name;
    const previous = this.lastVoice.get(key);
    if (previous !== undefined && now - previous < THROTTLE_SECONDS) return;

    // onended delivery can be deferred in hidden tabs; audio time remains authoritative.
    for (const active of this.voices) {
      if (active.synth.end <= now) this.release(active);
    }
    if (this.voices.size >= MAX_VOICES) return;
    this.lastVoice.set(key, now);
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    gain.gain.value = volume;
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(this.sfxBus);
    const voice = this.synth.voice(gain, now + 0.003);
    sound(voice, name, opts?.w);
    const active: ActiveVoice = { synth: voice, gain, pan: panner };
    this.voices.add(active);
    voice.finish(() => this.release(active));
  }

  private release(active: ActiveVoice): void {
    if (!this.voices.delete(active)) return;
    active.synth.dispose();
    active.gain.disconnect();
    active.pan.disconnect();
  }
}
