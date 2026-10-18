import type { QVoiceListeningLevel } from "@capital-q/contracts";

/**
 * BACKCHANNEL: when Q makes a listener's sound while the person is still
 * talking, decided by code, deterministically, so it can be tested and
 * reasoned about. What Q says is never decided here: the model hears the
 * person's in-progress words and picks the reaction (or the softest
 * "mm"). This module only answers "is now a moment a good listener would
 * react, and has Q earned the right to?"
 *
 * The rules, from conversation research on backchannels (continuers,
 * assessments, empathy tokens) and timing at mid-turn pauses:
 *   - Only inside the person's turn (the provider's turn detector says
 *     they have not finished), and only in a pause: never while they are
 *     voiced, so never mid-word.
 *   - A pause qualifies once it is long enough to be a pause and not the
 *     gap between words (from ~350 ms, adapted to how this person pauses)
 *     and not so long that their turn is probably over (900 ms).
 *   - Earned: enough speech in this turn first (a quick command gets
 *     none), and enough speech and time since the last one (never twice
 *     in quick succession), within a per-turn budget.
 *   - Adaptive: a reaction the person talked over makes Q sparser (it was
 *     late or unwanted); one that landed relaxes it again; a long story
 *     and an engaged moment (the model chose more than a bare continuer)
 *     make it more frequent. All bounded by the level.
 *   - Never while Q is speaking, answering or working on a tool.
 */

export type BackchannelLevelRules = {
  /** Speech in this turn before the first reaction. */
  readonly minTurnSpeechMs: number;
  /** Speech since the last reaction before the next. */
  readonly minSpeechSinceMs: number;
  /** Wall time since the last reaction before the next. */
  readonly minGapMs: number;
  readonly maxPerTurn: number;
  /** The shortest pause that is a pause and not a gap between words. */
  readonly triggerMs: number;
};

export const BACKCHANNEL_RULES: Readonly<
  Record<Exclude<QVoiceListeningLevel, "OFF">, BackchannelLevelRules>
> = {
  // voiceq-63 (founder: "it was always talking"): Subtle is rarer -- one
  // reaction in a turn, only after a real stretch of speech and a clear
  // pause, and long gaps between them.
  SUBTLE: {
    minTurnSpeechMs: 5_000,
    minSpeechSinceMs: 5_000,
    minGapMs: 15_000,
    maxPerTurn: 1,
    triggerMs: 450,
  },
  NATURAL: {
    minTurnSpeechMs: 2_500,
    minSpeechSinceMs: 2_500,
    minGapMs: 4_500,
    maxPerTurn: 5,
    triggerMs: 350,
  },
};

/** Past this, the pause is probably the end of their turn: Q waits. */
export const PAUSE_WINDOW_MAX_MS = 900;
/** The latest a pause can be required to last, however slowly they speak. */
const TRIGGER_CEILING_MS = 650;
/** A turn this long is a story: reactions come a little more often. */
const STORY_SPEECH_MS = 15_000;
const BACKOFF_MAX = 3;
/** A turn that resumes this soon after it "ended" is the same turn. */
const CONTINUATION_MS = 2_000;
const RECENT_MAX = 4;

export class BackchannelPolicy {
  #level: QVoiceListeningLevel;
  #inTurn = false;
  #turnEndedAt = Number.NEGATIVE_INFINITY;
  #busy = false;
  #pending = false;
  #voiceSince: number | null = null;
  #pauseSince: number | null = null;
  /** This pause was already decided on (fired or not): one per pause. */
  #pauseSpent = false;
  #turnSpeechMs = 0;
  #speechSinceLastMs = 0;
  #lastFiredAt = Number.NEGATIVE_INFINITY;
  #firedThisTurn = 0;
  #backoff = 1;
  #engaged = false;
  /** How long this person usually pauses mid-turn (EMA), or null. */
  #typicalPauseMs: number | null = null;
  readonly #recent: string[] = [];

  constructor(level: QVoiceListeningLevel) {
    this.#level = level;
  }

  get level(): QVoiceListeningLevel {
    return this.#level;
  }

  /** The reactions Q used lately, for the model not to repeat. */
  get recent(): readonly string[] {
    return this.#recent;
  }

  /** The adaptive back-off, 1 (relaxed) to 3 (sparse); for tests. */
  get backoff(): number {
    return this.#backoff;
  }

  get pending(): boolean {
    return this.#pending;
  }

  setLevel(level: QVoiceListeningLevel): void {
    this.#level = level;
    if (level === "OFF") this.#pending = false;
  }

  /** Q is speaking, answering or working: no reactions. */
  setBusy(busy: boolean): void {
    this.#busy = busy;
  }

  /**
   * The provider heard the person start a turn. Speech resuming within a
   * moment of an end (a reaction's own commit can look like one) is the
   * same turn: its budget and its speech carry on.
   * Returns true when this is a new turn.
   */
  turnStarted(at: number): boolean {
    const fresh = !this.#inTurn && at - this.#turnEndedAt > CONTINUATION_MS;
    if (fresh) {
      this.#turnSpeechMs = 0;
      this.#firedThisTurn = 0;
      this.#engaged = false;
    }
    this.#inTurn = true;
    this.#pauseSince = null;
    this.#voiceSince ??= at;
    return fresh;
  }

  /** The provider decided the person finished their turn. */
  turnEnded(at: number): void {
    this.#account(at);
    this.#inTurn = false;
    this.#turnEndedAt = at;
    this.#pauseSince = null;
  }

  /** The local detector heard the person's voice (again). */
  voiceStarted(at: number): void {
    if (this.#pauseSince !== null) {
      const pause = at - this.#pauseSince;
      // Only mid-turn pauses teach Q how this person pauses.
      if (this.#inTurn && pause < 1_500) {
        this.#typicalPauseMs =
          this.#typicalPauseMs === null
            ? pause
            : this.#typicalPauseMs * 0.8 + pause * 0.2;
      }
    }
    this.#pauseSince = null;
    this.#voiceSince ??= at;
  }

  /** The local detector heard the person stop (a pause, or the end). */
  pauseStarted(at: number): void {
    this.#account(at);
    this.#pauseSince = at;
    this.#pauseSpent = false;
  }

  #account(at: number): void {
    if (this.#voiceSince === null) return;
    const spoken = Math.max(0, at - this.#voiceSince);
    this.#voiceSince = null;
    if (!this.#inTurn) return;
    this.#turnSpeechMs += spoken;
    this.#speechSinceLastMs += spoken;
  }

  /** The pause length that counts as a pause for this person now. */
  triggerMs(): number {
    if (this.#level === "OFF") return Number.POSITIVE_INFINITY;
    const rules = BACKCHANNEL_RULES[this.#level];
    const adapted =
      this.#typicalPauseMs === null ? 0 : this.#typicalPauseMs * 0.8;
    return Math.min(
      TRIGGER_CEILING_MS,
      Math.max(rules.triggerMs, Math.round(adapted)),
    );
  }

  /** Whether a reaction is due now; decides once per pause. Call it often. */
  due(at: number): boolean {
    if (this.#level === "OFF") return false;
    if (!this.#inTurn || this.#busy || this.#pending) return false;
    if (this.#pauseSince === null || this.#pauseSpent) return false;
    if (this.#voiceSince !== null) return false;
    const paused = at - this.#pauseSince;
    if (paused < this.triggerMs()) return false;
    if (paused > PAUSE_WINDOW_MAX_MS) {
      this.#pauseSpent = true;
      return false;
    }
    const rules = BACKCHANNEL_RULES[this.#level];
    let spacing = this.#backoff;
    if (this.#turnSpeechMs >= STORY_SPEECH_MS) spacing *= 0.75;
    if (this.#engaged) spacing *= 0.8;
    const ready =
      this.#firedThisTurn < rules.maxPerTurn &&
      this.#turnSpeechMs >= rules.minTurnSpeechMs &&
      this.#speechSinceLastMs >= rules.minSpeechSinceMs * spacing &&
      at - this.#lastFiredAt >= rules.minGapMs * spacing;
    // Decided once per pause: a pause that did not earn one stays quiet.
    this.#pauseSpent = true;
    return ready;
  }

  /** A reaction was started at this pause. */
  fired(at: number): void {
    this.#pending = true;
    this.#pauseSpent = true;
    this.#lastFiredAt = at;
    this.#firedThisTurn += 1;
    this.#speechSinceLastMs = 0;
  }

  /** The person resumed over it (or before it): it was late or unwanted. */
  cut(): void {
    this.#pending = false;
    this.#backoff = Math.min(BACKOFF_MAX, this.#backoff * 1.5);
  }

  /** It was heard to the end. `said` is the model's own reaction. */
  landed(said: string): void {
    this.#pending = false;
    this.#backoff = Math.max(1, this.#backoff * 0.85);
    const words = said.trim();
    if (words.length === 0) return;
    // Engaged: the model chose more than a bare continuer for this
    // moment (more than one word, or an exclamation or a question).
    if (words.split(/\s+/).length > 1 || /[!?]/.test(words)) {
      this.#engaged = true;
    }
    this.#recent.push(words.slice(0, 40));
    if (this.#recent.length > RECENT_MAX) this.#recent.shift();
  }

  /** It never happened (the provider refused, or nothing was said). */
  dropped(): void {
    this.#pending = false;
  }
}

/**
 * Hears pauses in the person's own microphone, locally (no audio leaves
 * the browser for this): the provider's turn detector says when a turn
 * ends, not where its mid-turn pauses are. Energy against an adaptive
 * noise floor, with a short hysteresis so a plosive or a breath is not a
 * voice and a gap between words is not a pause.
 */
export const LEVEL_FRAME_MS = 50;
const MIN_VOICE_RMS = 0.02;
const FLOOR_FACTOR = 3;
const VOICE_FRAMES = 2;

export type PauseEvent = "VOICE" | "PAUSE";

export class PauseDetector {
  #floor = 0.005;
  #voiced = false;
  #run = 0;

  /** One frame's RMS level (0..1); a transition, or null. */
  feed(rms: number): PauseEvent | null {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    const voice = level > Math.max(MIN_VOICE_RMS, this.#floor * FLOOR_FACTOR);
    if (!voice) {
      this.#floor = Math.min(0.05, this.#floor * 0.95 + level * 0.05);
    }
    if (voice === this.#voiced) {
      this.#run = 0;
      return null;
    }
    this.#run += 1;
    // Voice must hold for two frames; silence counts from its first frame
    // (the policy measures how long the pause lasts).
    if (voice && this.#run < VOICE_FRAMES) return null;
    this.#voiced = voice;
    this.#run = 0;
    return voice ? "VOICE" : "PAUSE";
  }
}

/** Cut a reaction whose words are not a reaction (a sentence, a number). */
export function overlongReaction(text: string, maxWords: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return /\d/.test(trimmed) || trimmed.split(/\s+/).length > maxWords;
}

/**
 * Which level the line uses: the person's remembered one (set by voice,
 * any device) or this device's toggle, whichever was set more recently.
 */
export function resolveListeningLevel(
  server: {
    readonly level: QVoiceListeningLevel;
    readonly setAt: string | null;
  },
  device: {
    readonly level: QVoiceListeningLevel;
    readonly setAt: string;
  } | null,
): QVoiceListeningLevel {
  if (device === null) return server.level;
  if (server.setAt === null) return device.level;
  return Date.parse(device.setAt) >= Date.parse(server.setAt)
    ? device.level
    : server.level;
}
