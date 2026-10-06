/**
 * Q never says something is on the person's screen unless it is (R0,
 * Zino live 2026-10-06, run d6377e69: "its available diligence materials
 * are now in view" when nothing had opened, and on the voice line "the
 * certificate has appeared on your screen" when it had not).
 *
 * What backs the claim is code's: a UI_INTENT the run's own authorised
 * client-action tool produced. Without one, a sentence claiming that
 * something opened, appeared or is now in view on their screen is
 * replaced -- once -- with the plain truth, and any later such sentence
 * is dropped. An approval card is a different claim ("on your screen to
 * approve" is backed by the approval engine's own card) and is left
 * alone.
 */

export const NOT_ON_SCREEN_LINE = "I haven't been able to open that on your screen.";

const CLAIMS: readonly RegExp[] = [
  // "…has appeared on your screen", "it's on your screen now"
  /\b(?:on|onto|up on) (?:your|the) screen\b/iu,
  // "…are now in view", "now showing", "now open for you"
  /\bnow (?:in view|showing|open(?:ed)?(?: for you| on)?|up)\b/iu,
  /\b(?:is|are) (?:open|opened|showing|up) (?:for you|in front of you|on)\b/iu,
  // "I've opened…", "I opened…", "I've pulled up…", "I have brought up…"
  /\bI(?:'ve| have)? (?:just )?(?:opened|pulled up|brought up|put up|displayed)\b/iu,
  // "…has appeared", "should appear", "will appear"
  /\b(?:has|have|should|will) (?:now )?(?:appeared|appear|opened)\b/iu,
  // "Opening the certificate…", "Here it is on screen"
  /^\s*(?:opening|here(?:'s| is)) (?:it|the|your|that|this|their)\b/iu,
];

const APPROVAL = /\bapprov/iu;

/** True when the sentence tells the person something is on their screen. */
export function claimsOnScreen(sentence: string): boolean {
  if (APPROVAL.test(sentence)) return false;
  return CLAIMS.some((claim) => claim.test(sentence));
}

/**
 * A stateful guard for one answer: sentence by sentence as it streams
 * (spoken, or collected for the realtime voice), the same rule as the
 * finished text. `backed` is read at each sentence: the tool loop has run
 * before the answer's prose streams, so its client actions are known.
 */
export function createScreenClaimGuard(backed: () => boolean) {
  let corrected = false;
  let removed = 0;
  return {
    sentence(sentence: string): string | null {
      if (backed() || !claimsOnScreen(sentence)) return sentence;
      removed += 1;
      if (corrected) return null;
      corrected = true;
      return NOT_ON_SCREEN_LINE;
    },
    removed: () => removed,
  };
}

const SENTENCE = /[^.!?\n]+(?:[.!?]+["”’)]*|\n|$)/gu;

/** The finished answer, under the same rule. */
export function withoutUnbackedScreenClaims(
  text: string,
  backed: boolean,
): { readonly text: string; readonly removed: number } {
  if (backed) return { text, removed: 0 };
  const guard = createScreenClaimGuard(() => false);
  // Line by line, so a list or a heading without a claim is untouched.
  const lines = text.split("\n").map((line) => {
    const sentences = (line.match(SENTENCE) ?? [])
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    if (!sentences.some(claimsOnScreen)) return line;
    const kept = sentences
      .map((sentence) => guard.sentence(sentence))
      .filter((said): said is string => said !== null);
    return kept.length === 0 ? null : kept.join(" ");
  });
  if (guard.removed() === 0) return { text, removed: 0 };
  return {
    text: lines
      .filter((line): line is string => line !== null)
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    removed: guard.removed(),
  };
}
