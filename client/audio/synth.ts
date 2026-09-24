// All oscillators and noise envelopes end at zero, including stolen/finished voices.
// Buffers are generated once per context; firing never allocates sample arrays.
export class Synth {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;

  constructor(readonly context: BaseAudioContext) {
    const length = Math.ceil(context.sampleRate * 2);
    this.white = context.createBuffer(1, length, context.sampleRate);
    this.pink = context.createBuffer(1, length, context.sampleRate);
    const white = this.white.getChannelData(0);
    const pink = this.pink.getChannelData(0);
    let seed = 0x4c504252;
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const sample = (seed >>> 0) / 0x80000000 - 1;
      white[i] = sample;
      smooth = smooth * 0.96 + sample * 0.04;
      pink[i] = smooth * 4;
    }
  }

  voice(destination: AudioNode, start: number): Voice {
    return new Voice(this, destination, start);
  }
}

export class Voice {
  end: number;
  private lastSource: AudioScheduledSourceNode | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly synth: Synth,
    private readonly destination: AudioNode,
    readonly start: number,
  ) {
    this.end = start;
  }

  tone(
    offset: number, frequency: number, duration: number, volume: number,
    type: OscillatorType = 'sine', endFrequency = frequency, attack = 0.003, release = duration,
  ): void {
    const context = this.synth.context;
    const source = context.createOscillator();
    source.type = type;
    const time = this.start + offset;
    source.frequency.setValueAtTime(frequency, time);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), time + duration);
    this.envelope(source, time, duration, volume, attack, release);
  }

  noise(
    offset: number, duration: number, volume: number, frequency = 2000,
    filterType: BiquadFilterType = 'lowpass', endFrequency = frequency, pink = false, attack = 0.002,
  ): void {
    const context = this.synth.context;
    const source = context.createBufferSource();
    source.buffer = pink ? this.synth.pink : this.synth.white;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = filterType === 'bandpass' ? 0.8 : 0.7;
    const time = this.start + offset;
    filter.frequency.setValueAtTime(frequency, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), time + duration);
    source.connect(filter);
    this.nodes.push(filter);
    this.envelope(source, time, duration, volume, attack, duration, filter);
  }

  finish(onEnd: () => void): void {
    if (this.lastSource) this.lastSource.onended = onEnd;
    else onEnd();
  }

  dispose(): void {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
  }

  private envelope(
    source: AudioScheduledSourceNode, time: number, duration: number, volume: number,
    attack: number, release: number, input: AudioNode = source,
  ): void {
    const gain = this.synth.context.createGain();
    const peak = time + Math.min(attack, duration * 0.4);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, peak);
    gain.gain.setValueAtTime(volume, Math.max(peak, time + duration - release));
    gain.gain.exponentialRampToValueAtTime(0.00001, time + duration);
    gain.gain.linearRampToValueAtTime(0, time + duration + 0.005);
    input.connect(gain);
    gain.connect(this.destination);
    this.nodes.push(gain);
    this.sources.push(source);
    const end = time + duration + 0.006;
    if (end >= this.end) {
      this.end = end;
      this.lastSource = source;
    }
    source.start(time);
    source.stop(end);
  }
}
