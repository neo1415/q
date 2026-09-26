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
