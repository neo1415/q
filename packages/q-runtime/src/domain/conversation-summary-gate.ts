/**
 * Q intelligence step 2: the deterministic gate a model-written running
 * summary passes before it becomes a revision
 * (q_runtime.conversation_summary_revisions).
 *
 * Models do not persist facts directly (CLAUDE.md, Write Gate). A summary
 * is working memory, not knowledge, so it does not go through the
 * Knowledge Write Gate (Q Knowledge ≠ conversation state); it goes through
 * this one, with the same discipline: code decides, by rules a test can
 * assert, whether the model's text may be kept.
 *
 *   - bounded and non-empty;
 *   - every figure in it (a number of two or more digits, or any number
 *     with a currency, percent or magnitude) appears in what it summarises
 *     -- the transcript it was written from or the revision before it -- so
 *     a compaction can never mint a number that later reads as said.
 *
 * A refused summary is not stored; the previous revision stands.
 */

export const SUMMARY_MAX_CHARS = 4_000;

export type SummaryGateOutcome =
  | { readonly kind: "PASSED"; readonly summary: string }
  | {
      readonly kind: "REFUSED";
      readonly reason: "EMPTY" | "UNGROUNDED_FIGURE";
      /** The figures not found (for the log; never the summary). */
      readonly figures: readonly string[];
    };

const FIGURE =
  /(?:[$€£₦]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|k|m|bn|b|million|billion|thousand)?/giu;

/** The figure as digits and a magnitude, so "$2.4M" and "2.4 million" agree. */
function normalise(raw: string): string | null {
  const text = raw.toLowerCase().replace(/[$€£₦\s]/gu, "");
  const match =
    /^(\d[\d,]*(?:\.\d+)?)(%|percent|k|m|bn|b|million|billion|thousand)?$/u.exec(
      text,
    );
  if (match === null) return null;
  const digits = (match[1] ?? "").replace(/,/gu, "");
  const unit = match[2] ?? "";
  const scale: Readonly<Record<string, number>> = {
    k: 1e3,
    thousand: 1e3,
    m: 1e6,
    million: 1e6,
    b: 1e9,
    bn: 1e9,
    billion: 1e9,
  };
  const value = Number(digits) * (scale[unit] ?? 1);
  if (!Number.isFinite(value)) return null;
  const percent = unit === "%" || unit === "percent";
  return `${String(value)}${percent ? "%" : ""}`;
}

function figuresOf(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(FIGURE)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/gu, "");
    const marked = /[$€£₦%]|[a-z]$/iu.test(raw);
    // A lone single digit ("3 companies", "step 1") is a count, not a figure.
    if (digits.length < 2 && !marked) continue;
    const key = normalise(raw);
    if (key !== null) found.set(key, raw);
  }
  return found;
}

export function gateConversationSummary(input: {
  readonly summary: string;
  /** The turns it was written from, and the revision before it. */
  readonly sources: readonly string[];
}): SummaryGateOutcome {
  const summary = input.summary.trim().slice(0, SUMMARY_MAX_CHARS);
  if (summary.length === 0) {
    return { kind: "REFUSED", reason: "EMPTY", figures: [] };
  }
  const known = new Set<string>();
  for (const source of input.sources) {
    for (const key of figuresOf(source).keys()) known.add(key);
  }
  const missing = [...figuresOf(summary).entries()]
    .filter(([key]) => !known.has(key))
    .map(([, raw]) => raw);
  return missing.length === 0
    ? { kind: "PASSED", summary }
    : {
        kind: "REFUSED",
        reason: "UNGROUNDED_FIGURE",
        figures: missing.slice(0, 8),
      };
}
