import {
  Pcm16Decoder,
  PcmScheduler,
  type PcmScheduleOptions,
  type PcmScheduleStats,
  type ScheduledBlock,
} from "./pcm-schedule";

/**
 * Q's speaker: the agent's PCM on one Web Audio timeline (R22).
 *
 * Replaces the provider SDK's `AgentPlayer`, which started every 20 ms
 * frame at the moment it was handed over and so turned every late frame
 * into a gap. The timeline policy lives in `PcmScheduler`; this file only
 * turns its decisions into buffer sources.
 *
 * One context for the whole session. Barge-in stops what is scheduled
 * and keeps the context: the SDK closed it and opened a new one for the
 * next reply, and opening an output device is itself a pause of a few
 * hundred milliseconds on Windows.
 */

export type PcmPlayerOptions = Omit<PcmScheduleOptions, "sampleRate"> & {
  readonly sampleRate: number;
};

export class PcmPlayer {
  private readonly sampleRate: number;
  private readonly scheduler: PcmScheduler;
  private readonly decoder = new Pcm16Decoder();
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private volume = 1;

  constructor(options: PcmPlayerOptions) {
    this.sampleRate = options.sampleRate;
    this.scheduler = new PcmScheduler(options);
  }

  get stats(): PcmScheduleStats {
    return this.scheduler.stats;
  }

  /** One frame of the agent's audio. */
  queue(bytes: ArrayBuffer): void {
    const ctx = this.context();
    const samples = this.decoder.decode(bytes);
    this.play(this.scheduler.push(samples, ctx.currentTime));
  }

  /** The agent finished sending this reply: nothing more is coming to wait for. */
  flush(): void {
    if (this.ctx === null) return;
    this.play(this.scheduler.flush(this.ctx.currentTime));
  }

  /** Stop at once and forget what was coming (barge-in). */
  interrupt(): void {
    this.clearTimer();
    this.scheduler.reset();
    this.decoder.reset();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Never started or already ended.
      }
      source.disconnect();
    }
    this.sources.clear();
  }

  getRemainingPlaybackTime(): number {
    if (this.ctx === null) return 0;
    const held = this.scheduler.holding ? 0.05 : 0;
    return this.scheduler.remaining(this.ctx.currentTime) + held;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain !== null && this.ctx !== null) {
      // A ramp rather than a jump: a stepped gain is a click.
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  getOutputVolume(): number {
    const analyser = this.analyser;
    if (analyser === null) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    return Math.min(1, 4 * Math.sqrt(sum / data.length));
  }

  dispose(): void {
    this.interrupt();
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
    void ctx?.close().catch(() => undefined);
  }

  private context(): AudioContext {
    if (this.ctx === null || this.ctx.state === "closed") {
      // The device's own rate: buffers are made at the agent's rate and
      // Web Audio resamples each one, rather than the whole context
      // running at 24 kHz behind a resampler of its own.
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.analyser = analyser;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private play(blocks: readonly ScheduledBlock[]): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (ctx === null || gain === null) return;
    for (const block of blocks) {
      const buffer = ctx.createBuffer(1, block.samples.length, this.sampleRate);
      buffer.copyToChannel(block.samples as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
      };
      source.start(block.at);
      this.sources.add(source);
    }
    this.arm();
  }

  /** Wake the scheduler when held audio should go even if nothing arrives. */
  private arm(): void {
    this.clearTimer();
    const ctx = this.ctx;
    const wake = this.scheduler.wakeAt();
    if (ctx === null || wake === null) return;
    const delayMs = Math.max(0, (wake - ctx.currentTime) * 1000);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.ctx === null) return;
      this.play(this.scheduler.tick(this.ctx.currentTime));
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
