/**
 * A bounded view of a long conversation for a model turn (CQ-QX-007 P0-5).
 *
 * The interview loop sent every kept turn, every turn. This keeps the most
 * recent turns verbatim and condenses the older ones EXTRACTIVELY: each
 * older turn contributes, at most, its own opening words, quoted exactly
 * and marked as cut. Nothing is paraphrased, merged or inferred, so the
 * summary can only ever repeat what is in the record — it cannot introduce
 * a fact, a number or a name that nobody said. Deterministic: the same
 * record gives the same context.
 *
 * What is established (answers, the record) travels separately as state;
 * this is only the conversation, so a dropped older line loses tone and
 * sequence, never a recorded fact.
 */
export type ThreadTurn = {
  readonly role: "PERSON" | "Q";
  readonly text: string;
};

export type CompactThreadOptions = {
  /** Newest turns kept verbatim. */
  readonly recentTurns?: number | undefined;
  /** Upper bound on the condensed summary, in characters. */
  readonly summaryMaxChars?: number | undefined;
  /** Upper bound on one condensed turn's excerpt, in characters. */
  readonly excerptMaxChars?: number | undefined;
};

export type CompactedThread = {
  /** Older turns, condensed; null when nothing is older than the window. */
  readonly summary: string | null;
  /** The newest turns, verbatim and in order. */
  readonly recent: readonly ThreadTurn[];
  /** Older turns that did not fit even in condensed form. */
  readonly omitted: number;
};

export const THREAD_RECENT_TURNS = 12;
export const THREAD_SUMMARY_MAX_CHARS = 2_000;
export const THREAD_EXCERPT_MAX_CHARS = 160;

const CUT = " …";

/**
 * A turn's opening, verbatim: its first sentence when that fits, otherwise
 * as many whole words as fit. The result is always a prefix of the turn's
 * own (whitespace-normalised) text.
 */
export function openingOf(text: string, max: number): string {
  const normalised = text.replace(/\s+/g, " ").trim();
  if (normalised.length <= max) return normalised;
  const sentence = /^[^.!?]*[.!?](?=\s|$)/.exec(normalised)?.[0];
  if (sentence !== undefined && sentence.length <= max) return sentence;
  const cut = normalised.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

export function compactThread(
  turns: readonly ThreadTurn[],
  options: CompactThreadOptions = {},
): CompactedThread {
  const recentCount = Math.max(0, options.recentTurns ?? THREAD_RECENT_TURNS);
  const summaryMax = options.summaryMaxChars ?? THREAD_SUMMARY_MAX_CHARS;
  const excerptMax = options.excerptMaxChars ?? THREAD_EXCERPT_MAX_CHARS;
  const split = Math.max(0, turns.length - recentCount);
  const recent = turns.slice(split);
  const older = turns.slice(0, split);
  if (older.length === 0) {
    return { summary: null, recent, omitted: 0 };
  }
  const header = (kept: number): string =>
    `Earlier in this conversation (${String(older.length)} turns; ${String(kept)} shown by their opening words, oldest first; "…" marks a cut):`;
  // Newest older turns first, so what is dropped under the bound is the
  // oldest; then back to chronological order for reading.
  const lines: string[] = [];
  let used = header(older.length).length;
  for (let index = older.length - 1; index >= 0; index -= 1) {
    const turn = older[index];
    if (turn === undefined) continue;
    const opening = openingOf(turn.text, excerptMax);
    if (opening.length === 0) continue;
    const whole =
      opening.length === turn.text.replace(/\s+/g, " ").trim().length;
    const line = `- ${turn.role === "PERSON" ? "Person" : "Q"}: "${opening}${whole ? "" : CUT}"`;
    if (used + 1 + line.length > summaryMax) break;
    lines.unshift(line);
    used += 1 + line.length;
  }
  if (lines.length === 0) {
    return { summary: null, recent, omitted: older.length };
  }
  return {
    summary: [header(lines.length), ...lines].join("\n"),
    recent,
    omitted: older.length - lines.length,
  };
}
