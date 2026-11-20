import { LINE_HOLD_MAX_MS } from "./line-hold";

/**
 * Decision 112 (owner, 20 Nov 2026): a person-to-Q voice call closes after
 * about a minute of silence following the last spoken turn, and Q asks
 * "Still there?" a quarter of a minute before. Live voice is billed per
 * connected second; in the week to 20 Nov, 20 of 173 billed minutes came
 * after the last turn, under the old 3-minute idle close.
 *
 * Only the person-to-Q call (live-call.ts) uses this. Q in a meeting
 * (decision 108) runs on its own runtime and its own idle rule, untouched.
 */

/** Silence after the last spoken turn that closes the call. */
export const VOICE_IDLE_CLOSE_MS = 60_000;
/** Silence after the last spoken turn at which Q asks "Still there?". */
export const VOICE_IDLE_PROMPT_MS = 45_000;
/** What Q says, in English; the caller passes it in the person's language. */
export const VOICE_IDLE_PROMPT = "Still there?";

export type VoiceIdleStep = "PROMPT" | "CLOSE" | null;

export type VoiceIdle = {
  /**
   * Someone spoke. The person's speech always resets the timer; Q's own
   * speech does too, except its "Still there?" (that is not a turn: the
   * close still counts from the last real one).
   */
  readonly heard: (who: "PERSON" | "Q", at: number) => void;
  /** What to do now; each prompt is given once per silence. */
  readonly step: (at: number, held: boolean) => VoiceIdleStep;
};

/**
 * The prompt for a close window the server set: the same lead before the
 * close as the defaults (15 s), and never earlier than half the window.
 */
export function promptMsFor(closeMs: number): number {
  return Math.max(
    Math.round(closeMs / 2),
    closeMs - (VOICE_IDLE_CLOSE_MS - VOICE_IDLE_PROMPT_MS),
  );
}

export function createVoiceIdle(options: {
  readonly closeMs: number;
  readonly promptMs: number;
  readonly startedAt: number;
}): VoiceIdle {
  let lastTurnAt = options.startedAt;
  let prompted = false;
  return {
    heard: (who, at) => {
      if (who === "Q" && prompted) return;
      lastTurnAt = at;
      prompted = false;
    },
    step: (at, held) => {
      const silent = at - lastTurnAt;
      // Work Q promised on this line holds it open, bounded (line-hold.ts).
      if (held) {
        return silent > options.closeMs + LINE_HOLD_MAX_MS ? "CLOSE" : null;
      }
      if (silent > options.closeMs) return "CLOSE";
      if (silent > options.promptMs && !prompted) {
        prompted = true;
        return "PROMPT";
      }
      return null;
    },
  };
}
