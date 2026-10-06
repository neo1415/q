/**
 * F17: the session's own refusals, in words a founder can act on. Never the
 * internal code: "(REQUIRED_STEPS_INCOMPLETE)" on a banner reads as a bug.
 */
const REASON_WORDS: Readonly<Record<string, string>> = {
  REQUIRED_STEPS_INCOMPLETE:
    "Q is still finishing its first reading of your company. It takes a few seconds; try again in a moment.",
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
