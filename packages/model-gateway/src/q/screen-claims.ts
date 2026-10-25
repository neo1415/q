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

import { splitSentences } from "@capital-q/q-core";

export const NOT_ON_SCREEN_LINE =
  "I haven't been able to open that on your screen.";

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

/**
 * "They're on screen", "listed on screen", "the rest are in the cards":
 * a list said to be shown (lead live replay 2026-10-07: "the other
 * contacted companies are listed on screen" with no card on screen).
 * Unbacked, such a sentence is simply dropped -- nothing was asked to
 * open, so there is nothing to apologise for.
 */
const LIST_CLAIM =
  /\b(?:(?:listed |shown |laid out )?on(?:-| )screen|in the cards?|(?:are|is) (?:listed|shown) (?:below|above|here))\b/iu;

export function claimsListOnScreen(sentence: string): boolean {
  const plain = plainQuotes(sentence);
  if (APPROVAL.test(plain)) return false;
  return LIST_CLAIM.test(plain);
}

/**
 * Lane A (live 2026-10-15: "I’ve opened the three company records" with
 * nothing opened passed the guard): models write typographic apostrophes
 * and quotes, the patterns are written with plain ones. Read the sentence
 * as plain before testing it; what is said is never changed by this.
 */
export function plainQuotes(sentence: string): string {
  return sentence.replace(/[\u2018\u2019\u02bc\u2032]/gu, "'");
}

/**
 * Whether the person asked for something to be opened or shown ("open my
 * data room", "show me the deck", "take me to Discover"): only then is an
 * unbacked screen claim owed an apology rather than simply dropped.
 */
const ASKED_TO_OPEN =
  /\b(?:open|show|take me|bring up|pull up|go to|navigate|display|put (?:it|that|them) up)\b/iu;

export function askedToOpen(text: string): boolean {
  return ASKED_TO_OPEN.test(text);
}

/**
 * QA F-111: block kinds that are drawn on their screen as the answer
 * arrives. A sentence saying something is on screen is backed by any of
 * them, not by a screen move alone.
 */
export const DRAWN_BLOCK_KINDS: ReadonlySet<string> = new Set([
  "UI_INTENT",
  "ANSWER_CARDS",
  "COMPARISON_CARDS",
  "TABLE",
  "CHART",
  "MAP",
  "TIMELINE",
  "PICTURE",
  "ARTIFACT_REFERENCE",
]);

/** True when the sentence tells the person something is on their screen. */
export function claimsOnScreen(sentence: string): boolean {
  const plain = plainQuotes(sentence);
  if (APPROVAL.test(plain)) return false;
  return CLAIMS.some((claim) => claim.test(plain)) || LIST_CLAIM.test(plain);
}

/**
 * A stateful guard for one answer: sentence by sentence as it streams
 * (spoken, or collected for the realtime voice), the same rule as the
 * finished text. `backed` is read at each sentence: the tool loop has run
 * before the answer's prose streams, so its client actions are known.
 */
export function createScreenClaimGuard(
  backed: () => boolean,
  /**
   * QA F-111 (25 Oct 2026): a data-room answer nobody asked to open
   * anything for ended "I haven't been able to open that on your screen."
   * The apology is owed only when they asked for something to be opened
   * or shown; otherwise the claim is simply dropped.
   */
  apologise = true,
) {
  let corrected = false;
  let removed = 0;
  return {
    sentence(sentence: string): string | null {
      if (backed() || !claimsOnScreen(sentence)) return sentence;
      removed += 1;
      if (
        !apologise ||
        (claimsListOnScreen(sentence) &&
          !CLAIMS.some((claim) => claim.test(plainQuotes(sentence))))
      ) {
        return null;
      }
      if (corrected) return null;
      corrected = true;
      return NOT_ON_SCREEN_LINE;
    },
    removed: () => removed,
  };
}

/** The finished answer, under the same rule. */
export function withoutUnbackedScreenClaims(
  text: string,
  backed: boolean,
  apologise = true,
): { readonly text: string; readonly removed: number } {
  if (backed) return { text, removed: 0 };
  const guard = createScreenClaimGuard(() => false, apologise);
  // Line by line, so a list or a heading without a claim is untouched.
  const lines = text.split("\n").map((line) => {
    // Real sentence ends only: "8.8/10" is one piece, never "8. 8/10" (D9).
    const sentences = splitSentences(line)
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
