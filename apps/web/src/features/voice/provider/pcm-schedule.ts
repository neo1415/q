/**
 * When each piece of Q's speech plays (R22, voice stutter).
 *
 * Q's audio reaches the browser as raw 16-bit PCM in 20 ms frames, in
 * bursts: a trickle for the first few hundred milliseconds of a sentence,
 * then seconds of audio at once (measured against the live agent,
 * 2026-09-26). The provider SDK's player started every frame the moment
 * it was handed over, with nothing held back, so any frame handed over
 * late — a slow first trickle, or the page busy rendering for a moment —
 * left a gap in the voice, and the next frame started from "now" with no
 * lead again. This decides the timeline instead, with no audio APIs in
 * it, so the policy is testable against a fake clock:
 *
 *   - a jitter buffer: a sentence starts only once a little audio is in
 *     hand (or has waited long enough), so the trickle does not stutter;
 *   - gapless: everything after the start is placed end to end on one
 *     timeline, sample-exact;
 *   - recovery: when the timeline does run dry, the buffer refills before
 *     playing on, and the target grows for the rest of the session, so a
 *     slow line costs one pause rather than a stutter on every frame;
 *   - fewer, larger pieces: while there is comfortable lead, small frames
 *     are gathered into one block rather than scheduled one by one.
 *
 * Times are seconds on the audio clock (`AudioContext.currentTime`).
 */

export type PcmScheduleOptions = {
  readonly sampleRate: number;
  /** Audio in hand before a sentence starts. */
  readonly prebufferMs?: number | undefined;
  /** Start with whatever is in hand once the first frame has waited this long. */
  readonly maxWaitMs?: number | undefined;
  /** Lead given to a start, so it is never placed in the past. */
  readonly safetyMs?: number | undefined;
  /** While playing, frames are gathered into blocks at least this long... */
  readonly blockMs?: number | undefined;
  /** ...unless the lead has fallen below this, when they go at once. */
  readonly lowWaterMs?: number | undefined;
  /** Max-wait never starts a sentence with less than this in hand. */
  readonly minStartMs?: number | undefined;
  /** How far the prebuffer target may grow after underruns. */
  readonly maxPrebufferMs?: number | undefined;
};

export type ScheduledBlock = {
  readonly samples: Float32Array;
  /** Audio-clock time at which the block starts. */
  readonly at: number;
};

export type PcmScheduleStats = {
  /** Times the timeline ran dry in the middle of speech. */
  readonly underruns: number;
  /** Total silence those underruns put into the voice, in ms. */
  readonly gapMs: number;
  readonly blocks: number;
  readonly frames: number;
  readonly prebufferMs: number;
};

/*
 * I1 (Dubai demo 2026-10-05, "slow and it stuttered"): on a jittery line
 * the max-wait start began a sentence with a frame or two in hand and ran
 * dry at once, and each underrun grew the buffer by only half. Now a
 * sentence never starts on max-wait with less than `minStartMs` in hand
 * (a complete reply is still played at once, however short), and an
 * underrun doubles the buffer, up to a second: one pause, then smooth.
 */
const DEFAULTS = {
  prebufferMs: 180,
  maxWaitMs: 250,
  minStartMs: 80,
  safetyMs: 25,
  blockMs: 100,
  lowWaterMs: 250,
  maxPrebufferMs: 1_000,
} as const;
const UNDERRUN_GROWTH = 2;

export class PcmScheduler {
  private readonly rate: number;
  private readonly maxWait: number;
  private readonly minStart: number;
  private readonly safety: number;
  private readonly block: number;
  private readonly lowWater: number;
  private readonly maxPrebuffer: number;
  private prebuffer: number;

  private pending: Float32Array[] = [];
  private pendingSamples = 0;
  /** Audio-clock time the first pending frame arrived while buffering. */
  private waitingSince: number | null = null;
  /** End of the last scheduled block; null while not playing. */
  private nextStart: number | null = null;
  /** The provider said the current reply is complete. */
  private ended = true;

  private underruns = 0;
  private gap = 0;
  private blocks = 0;
  private frames = 0;

  constructor(options: PcmScheduleOptions) {
    this.rate = options.sampleRate;
    this.prebuffer = (options.prebufferMs ?? DEFAULTS.prebufferMs) / 1000;
    this.maxWait = (options.maxWaitMs ?? DEFAULTS.maxWaitMs) / 1000;
    this.minStart = (options.minStartMs ?? DEFAULTS.minStartMs) / 1000;
    this.safety = (options.safetyMs ?? DEFAULTS.safetyMs) / 1000;
    this.block = (options.blockMs ?? DEFAULTS.blockMs) / 1000;
    this.lowWater = (options.lowWaterMs ?? DEFAULTS.lowWaterMs) / 1000;
    this.maxPrebuffer =
      (options.maxPrebufferMs ?? DEFAULTS.maxPrebufferMs) / 1000;
  }

  get stats(): PcmScheduleStats {
    return {
      underruns: this.underruns,
      gapMs: Math.round(this.gap * 1000),
      blocks: this.blocks,
      frames: this.frames,
      prebufferMs: Math.round(this.prebuffer * 1000),
    };
  }

  /** Seconds of audio scheduled ahead of `now`. */
  remaining(now: number): number {
    return this.nextStart === null ? 0 : Math.max(0, this.nextStart - now);
  }

  /** Whether audio is waiting to be scheduled. */
  get holding(): boolean {
    return this.pendingSamples > 0;
  }

  /** One frame of PCM arrived. Returns what to start now, if anything. */
  push(samples: Float32Array, now: number): ScheduledBlock[] {
    if (samples.length === 0) return [];
    this.frames += 1;
    this.noticeUnderrun(now, true);
    this.ended = false;
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    if (this.nextStart === null && this.waitingSince === null) {
      this.waitingSince = now;
    }
    return this.decide(now, false);
  }

  /**
   * Time passing with no new frame (the caller's timer, at `wakeAt`).
   * Starts a sentence that has waited long enough, or releases gathered
   * frames before the timeline runs low.
   */
  tick(now: number): ScheduledBlock[] {
    this.noticeUnderrun(now, false);
    return this.decide(now, false);
  }

  /** The provider said the sentence is complete: play what is held now. */
  flush(now: number): ScheduledBlock[] {
    this.noticeUnderrun(now, false);
    this.ended = true;
    return this.decide(now, true);
  }

  /**
   * When the caller should call `tick` if nothing arrives first, or null
   * when nothing is held.
   */
  wakeAt(): number | null {
    if (this.pendingSamples === 0) return null;
    if (this.nextStart === null) {
      // Too little in hand to start on max-wait: the next frame (or the
      // end of the reply) decides, never a timer spinning on the past.
      if (this.waitingSince === null) return null;
      if (this.pendingSamples / this.rate < this.minStart) return null;
      return this.waitingSince + this.maxWait;
    }
    return this.nextStart - this.lowWater;
  }

  /** Barge-in or teardown: forget everything scheduled and held. */
  reset(): void {
    this.pending = [];
    this.pendingSamples = 0;
    this.waitingSince = null;
    this.nextStart = null;
    this.ended = true;
  }

  /**
   * The timeline has run out. That is a gap the person hears when audio
   * was still held back, or when a frame lands in the middle of a reply;
   * a frame landing after the provider said the reply was complete is
   * simply the next reply. Either way playing on means buffering first.
   */
  private noticeUnderrun(now: number, arriving: boolean): void {
    if (this.nextStart === null || now < this.nextStart) return;
    const heard = this.pendingSamples > 0 || (arriving && !this.ended);
    if (heard) {
      this.underruns += 1;
      this.gap += now - this.nextStart;
      this.prebuffer = Math.min(
        this.maxPrebuffer,
        this.prebuffer * UNDERRUN_GROWTH,
      );
    }
    this.waitingSince = this.pendingSamples > 0 ? now : null;
    this.nextStart = null;
  }

  private decide(now: number, final: boolean): ScheduledBlock[] {
    if (this.pendingSamples === 0) return [];
    const held = this.pendingSamples / this.rate;
    if (this.nextStart === null) {
      const waited = this.waitingSince === null ? 0 : now - this.waitingSince;
      if (
        !final &&
        held < this.prebuffer &&
        (waited < this.maxWait || held < this.minStart)
      ) {
        return [];
      }
      return [this.take(now + this.safety)];
    }
    const lead = this.nextStart - now;
    if (!final && held < this.block && lead > this.lowWater) return [];
    // End to end, sample-exact. `now < nextStart` here (a dry timeline was
    // handled above), so the block is never placed in the past.
    return [this.take(this.nextStart)];
  }

  private take(at: number): ScheduledBlock {
    const samples = new Float32Array(this.pendingSamples);
    let offset = 0;
    for (const part of this.pending) {
      samples.set(part, offset);
      offset += part.length;
    }
    this.pending = [];
    this.pendingSamples = 0;
    this.waitingSince = null;
    this.nextStart = at + samples.length / this.rate;
    this.blocks += 1;
    return { samples, at };
  }
}

/**
 * Signed 16-bit little-endian PCM to floats, carrying a split sample.
 *
 * A frame boundary is a network boundary, not a sample boundary; an odd
 * byte is kept for the next frame rather than thrown away (the SDK's
 * `new Int16Array(buffer)` throws on an odd length, losing the frame and
 * misaligning everything after it).
 */
export class Pcm16Decoder {
  private carry: number | null = null;

  decode(bytes: ArrayBuffer): Float32Array {
    const input = new Uint8Array(bytes);
    const total = input.length + (this.carry === null ? 0 : 1);
    const count = Math.floor(total / 2);
    const out = new Float32Array(count);
    let index = 0;
    let read = 0;
    if (this.carry !== null && count > 0) {
      out[index++] = toFloat(this.carry, input[0] ?? 0);
      read = 1;
      this.carry = null;
    }
    const view = new DataView(bytes);
    for (; index < count; index += 1, read += 2) {
      out[index] = int16ToFloat(view.getInt16(read, true));
    }
    if (read < input.length) this.carry = input[read] ?? null;
    return out;
  }

  reset(): void {
    this.carry = null;
  }
}

function int16ToFloat(value: number): number {
  return value < 0 ? value / 32768 : value / 32767;
}

function toFloat(low: number, high: number): number {
  const unsigned = low | (high << 8);
  return int16ToFloat(unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned);
}
