/**
 * F17: the session's own refusals, in words a founder can act on. Never the
 * internal code: "(REQUIRED_STEPS_INCOMPLETE)" on a banner reads as a bug.
 */
const REASON_WORDS: Readonly<Record<string, string>> = {
  // Journey-neutral (QA F-138: an investor was told Q was reading "your
  // company"). True for both: a founder's first reading is still filling
  // it in (waiting is the fix), or an answer is still to give.
  REQUIRED_STEPS_INCOMPLETE:
    "Setup can't finish quite yet: an answer it needs isn't in place. Try again in a moment, or answer what Q asks.",
  STEP_NOT_ELIGIBLE: "That step isn't open yet. Finish the one before it.",
};

export function friendlyDetail(detail: string): {
  readonly text: string;
  readonly reason: string | null;
} {
  const match = /\s*\(([A-Z][A-Z0-9_]{2,})\)\s*$/u.exec(detail);
  const reason = match?.[1] ?? null;
  if (reason !== null && REASON_WORDS[reason] !== undefined) {
    return { text: REASON_WORDS[reason], reason };
  }
  const text = match === null ? detail : detail.slice(0, match.index).trim();
  return { text: text === "" ? "That didn't save. Try again." : text, reason };
}
