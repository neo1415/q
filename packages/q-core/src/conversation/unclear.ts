/**
 * What Q does with words it could not make out (lead, 2026-09-25; voice
 * transport and end-of-turn are VN2's).
 *
 * Live, a cut-off or noisy turn went to the answer model, which replied
 * with a meta-statement ("I can't identify a clear company question").
 * A transcription matter is not a reasoning one: no model is asked. Q
 * gives one brief, natural prompt; if the next turn is unclear too, it
 * says nothing and keeps listening, so the prompt is never repeated.
 *
 * The prompt lines are transport copy owned by code, like failure copy;
 * nothing here reads what the words meant (the turn reader did).
 */
export type UnclearTurnReply =
  | { readonly kind: "PROMPT"; readonly line: string }
  | { readonly kind: "SILENT" };

type Reading = {
  readonly kind: string;
  readonly transcript: "CLEAR" | "NOISY" | "FRAGMENT";
};

/** Whether a reading is a transcription matter rather than a turn to answer. */
export function isUnclearTurn(reading: Reading): boolean {
  return (
    reading.kind === "UNCLEAR_TRANSCRIPT" || reading.transcript === "FRAGMENT"
  );
}

/**
 * The reply to an unclear turn, given how many turns in a row before it
 * were unclear. A fragment (cut off part-way) invites them to go on; noise
 * asks them to say it again.
 */
export function unclearTurnReply(
  reading: Reading,
  unclearBefore: number,
): UnclearTurnReply {
  if (unclearBefore > 0) return { kind: "SILENT" };
  return reading.transcript === "FRAGMENT" &&
    reading.kind !== "UNCLEAR_TRANSCRIPT"
    ? { kind: "PROMPT", line: "Go on." }
    : { kind: "PROMPT", line: "Sorry, say that again?" };
}

/**
 * RECOVERY-2026-10 (live T1, 2026-10-08 11:13): a spoken turn addressed
 * to Q that could not be made out is never answered with silence. Silence
 * let the realtime voice improvise for Q ("could you give me more
 * detail…") and lost the turn. Speech meant for someone else is decided
 * earlier (the reader's addressedToQ) and is the only silent case; here Q
 * always says something short, varied so it never repeats itself, and
 * offers typing once it has failed twice.
 */
export function spokenUnclearReply(
  reading: Reading,
  unclearBefore: number,
): { readonly kind: "PROMPT"; readonly line: string } {
  if (
    reading.transcript === "FRAGMENT" &&
    reading.kind !== "UNCLEAR_TRANSCRIPT"
  ) {
    return {
      kind: "PROMPT",
      line: unclearBefore === 0 ? "Go on." : "Go on, I'm listening.",
    };
  }
  if (unclearBefore === 0) {
    return {
      kind: "PROMPT",
      line: "Sorry, I didn't catch that. Say it again?",
    };
  }
  if (unclearBefore === 1) {
    return {
      kind: "PROMPT",
      line: "I still couldn't make that out. Could you put it another way, or type it?",
    };
  }
  return {
    kind: "PROMPT",
    line: "I'm not catching it, sorry. Typing it in the box works too.",
  };
}
