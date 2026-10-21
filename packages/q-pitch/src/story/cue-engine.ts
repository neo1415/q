import type { StoryAct, StoryCue } from "./acts.js";
import { wordAt, type BeatAlignment } from "./alignment.js";
import type { StoryBeat } from "./beats.js";

/**
 * The story's director (plan §1): a cue timeline on the audio clock.
 *
 * The audio clock is the master. A cue fires CUE_LEAD_MS before its word
 * starts, so the screen lands on the word rather than after it. The engine
 * is pure: the host feeds it the clock (AudioContext time into the beat,
 * or the fallback voice's transcript position) and runs what comes due.
 * Audio never waits for a visual; a visual that does not acknowledge in
 * its budget is replaced by the safe fallback (stay on the Q stage and
 * show the artifact there), and the story carries on.
 */
export const CUE_LEAD_MS = 120;

export type ScheduledCue = {
  /** `beat-NN:k`, stable across renders (the k-th cue of the beat). */
  readonly cueId: string;
  readonly beat: number;
  readonly wordIndex: number;
  /** When the word starts, ms into the beat's audio. */
  readonly wordMs: number;
  /**
   * When the act is run: CUE_LEAD_MS ahead of the word. Negative for a
   * beat's first words: narrators start their audio a little after the
   * clock starts, so even the first word's cue lands on it.
   */
  readonly fireMs: number;
  readonly act: StoryAct;
};

export function scheduleBeat(
  beat: StoryBeat,
  alignment: BeatAlignment,
  leadMs: number = CUE_LEAD_MS,
): ScheduledCue[] {
  return beat.cues
    .map((cue: StoryCue, k) => {
      const wordMs = alignment.words[cue.at]?.startMs ?? 0;
      return {
        cueId: `${beat.id}:${String(k)}`,
        beat: beat.n,
        wordIndex: cue.at,
        wordMs,
        fireMs: wordMs - leadMs,
        act: cue.act,
      };
    })
    .sort((a, b) => a.fireMs - b.fireMs || a.cueId.localeCompare(b.cueId));
}

/**
 * One beat's cues, released as the clock passes them. Each cue fires once.
 * A seek backwards (beat restart) re-arms what is ahead of the new time; a
 * jump forward fires what was skipped, in order, so the screen is in the
 * state the words expect.
 */
export class BeatCueClock {
  readonly #cues: readonly ScheduledCue[];
  #next = 0;

  constructor(cues: readonly ScheduledCue[]) {
    this.#cues = cues;
  }

  /** The cues due at `ms` (into the beat) not yet released. */
  due(ms: number): ScheduledCue[] {
    const released: ScheduledCue[] = [];
    while (this.#next < this.#cues.length) {
      const cue = this.#cues[this.#next];
      if (cue === undefined || cue.fireMs > ms) break;
      released.push(cue);
      this.#next += 1;
    }
    return released;
  }

  /** Re-arms every cue at or after `ms`. */
  seek(ms: number): void {
    this.#next = this.#cues.findIndex((cue) => cue.fireMs >= ms);
    if (this.#next === -1) this.#next = this.#cues.length;
  }

  get remaining(): number {
    return this.#cues.length - this.#next;
  }
}

/**
 * Each act's acknowledgement budget (plan §1, Verifier): the route visible,
 * the anchor found and lit, the stage visual painted. Stage and mood acts
 * are local paint, so their budget is a frame or two of slack.
 */
export const ACT_BUDGET_MS: Readonly<Record<StoryAct["kind"], number>> = {
  navigate: 2_500,
  light: 1_500,
  stage: 400,
  mood: 400,
  unlight: 200,
};

export type ActOutcome =
  | {
      readonly kind: "ACKNOWLEDGED";
      readonly cueId: string;
      readonly ms: number;
    }
  | {
      readonly kind: "SAFE_FALLBACK";
      readonly cueId: string;
      readonly act: StoryAct;
    };

/**
 * Tracks each fired act until its acknowledgement. `expire` returns the
 * acts whose budget passed without one; the host then runs the safe
 * fallback for each. A late acknowledgement after the fallback is ignored,
 * so a slow page never yanks the screen back mid-sentence.
 */
export class ActVerifier {
  readonly #pending = new Map<
    string,
    { readonly act: StoryAct; readonly firedAt: number }
  >();
  readonly #outcomes: ActOutcome[] = [];

  begin(cue: ScheduledCue, now: number): void {
    this.#pending.set(cue.cueId, { act: cue.act, firedAt: now });
  }

  acknowledge(cueId: string, now: number): ActOutcome | null {
    const pending = this.#pending.get(cueId);
    if (pending === undefined) return null;
    this.#pending.delete(cueId);
    const outcome: ActOutcome = {
      kind: "ACKNOWLEDGED",
      cueId,
      ms: now - pending.firedAt,
    };
    this.#outcomes.push(outcome);
    return outcome;
  }

  expire(now: number): ActOutcome[] {
    const expired: ActOutcome[] = [];
    for (const [cueId, pending] of this.#pending) {
      if (now - pending.firedAt <= ACT_BUDGET_MS[pending.act.kind]) continue;
      this.#pending.delete(cueId);
      expired.push({ kind: "SAFE_FALLBACK", cueId, act: pending.act });
    }
    this.#outcomes.push(...expired);
    return expired;
  }

  /** Drops what is pending (pause, seek, end): nothing late fires a fallback. */
  clear(): void {
    this.#pending.clear();
  }

  get outcomes(): readonly ActOutcome[] {
    return this.#outcomes;
  }
}

/**
 * Where a beat stands at `ms`: the word being spoken, for the captions'
 * karaoke light. The fallback voice reports progress by transcript, not
 * time; `msAtWord` turns a heard word count back into the beat's clock so
 * the same cues fire (less precisely, as the plan accepts).
 */
export function spokenWord(alignment: BeatAlignment, ms: number): number {
  return wordAt(alignment, ms);
}

export function msAtWord(alignment: BeatAlignment, heardWords: number): number {
  if (heardWords <= 0) return 0;
  const word =
    alignment.words[Math.min(heardWords, alignment.words.length) - 1];
  return word === undefined ? 0 : word.endMs;
}

/** Median and 95th percentile, for the cue-to-word evidence. */
export function percentiles(samples: readonly number[]): {
  readonly median: number;
  readonly p95: number;
  readonly count: number;
} {
  if (samples.length === 0) return { median: 0, p95: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))
    ] ?? 0;
  return { median: at(0.5), p95: at(0.95), count: sorted.length };
}
