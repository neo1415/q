import type { QResultBlock } from "@capital-q/contracts";
import { splitSentences } from "@capital-q/q-core";

import { plainQuotes } from "./screen-claims.js";

/**
 * Lane A (owner 2026-10-15: artifacts "don't appear when they are being
 * talked about"; live: "here's a map" with no map). A sentence that says a
 * table, map, chart or timeline is shown stands only when the answer
 * carries that kind of object. The screen-claim guard (screen-claims.ts)
 * accepts any card or screen move as backing for any claim; this one is
 * per kind, so cards on screen no longer back "see the map".
 *
 * Words decide nothing here except whether a sentence makes the claim;
 * what backs it is the answer's own result blocks, built by code.
 */

export const CLAIMED_ARTIFACT_KINDS = [
  "TABLE",
  "MAP",
  "CHART",
  "TIMELINE",
] as const;
export type ClaimedArtifact = (typeof CLAIMED_ARTIFACT_KINDS)[number];

const NOUN: Readonly<Record<ClaimedArtifact, RegExp>> = {
  TABLE: /\btables?\b/iu,
  MAP: /\b(?:maps?|mapped)\b/iu,
  CHART: /\b(?:charts?|charted|graphs?|graphed|plotted)\b/iu,
  TIMELINE: /\btimelines?\b/iu,
};

/** The sentence presents the object: "here's", "I've put", "see", "below". */
const PRESENTS =
  /\b(?:here(?:'s| is| are)|i(?:'ve| have)?\s+(?:just\s+|now\s+)?(?:put|laid|drawn|drew|made|built|plotted|mapped|charted|added|created|set|pulled|pinned|placed)|(?:see|shown|showing|displayed|laid out|set out)\b|(?:below|above)\b|on (?:your|the) screen|in (?:the|this) (?:table|map|chart|graph|timeline)|the (?:table|map|chart|graph|timeline) (?:shows|below|above|here|on))/iu;

/** Saying it cannot, or offering to, is not a claim that it is shown. */
const NOT_A_CLAIM =
  /\b(?:can't|cannot|couldn't|could not|unable|not able|don't|do not|won't|isn't|aren't|wasn't|without|no (?:table|map|chart|graph|timeline)|not enough|i can|i could|want me to|would you like|shall i|should i|if you(?:'d| would)? like|if you want)\b/iu;

/** The kinds of object a sentence says are shown. */
export function claimedArtifacts(sentence: string): readonly ClaimedArtifact[] {
  const plain = plainQuotes(sentence).trim();
  if (plain.endsWith("?") || NOT_A_CLAIM.test(plain)) return [];
  if (!PRESENTS.test(plain)) return [];
  return CLAIMED_ARTIFACT_KINDS.filter((kind) => NOUN[kind].test(plain));
}

/** The kinds the answer's own blocks actually draw. */
export function drawnArtifacts(
  blocks: readonly QResultBlock[],
): ReadonlySet<ClaimedArtifact> {
  const drawn = new Set<ClaimedArtifact>();
  for (const block of blocks) {
    switch (block.kind) {
      case "TABLE":
      case "COMPARISON":
        drawn.add("TABLE");
        break;
      case "MAP":
        drawn.add("MAP");
        break;
      case "CHART":
        drawn.add("CHART");
        break;
      case "TIMELINE":
        drawn.add("TIMELINE");
        break;
      case "ANSWER_CARDS":
        // Side-by-side cards are laid out as one table (web
        // comparesAsTable); cards that carry a map draw it.
        if (block.shape === "SIDE_BY_SIDE") drawn.add("TABLE");
        if (block.map !== undefined) drawn.add("MAP");
        break;
      // Draw no table, map, chart or timeline.
      case "TEXT":
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "COMPARISON_CARDS":
      case "EVIDENCE":
      case "FINDING":
      case "UNCERTAINTY":
      case "CLARIFICATION_REQUEST":
      case "ACTION_PROPOSAL":
      case "ARTIFACT_REFERENCE":
      case "WORK_IN_PROGRESS":
      case "UI_INTENT":
      case "PUBLIC_SOURCE":
      case "ATTENTION":
      case "PICTURE":
      case "SUMMARY":
      case "SCHEDULE": // their day as a card: no table, map, chart or timeline claim
        break;
    }
  }
  return drawn;
}

/**
 * What the person's browser reports it has drawn on the Q stage now (the
 * page manifest's `drawn`, browser-confirmed after commit): a map shown
 * by an earlier answer and still on screen backs "as the map shows".
 */
export function drawnOnScreen(
  kinds: readonly string[] | undefined,
): ReadonlySet<ClaimedArtifact> {
  const drawn = new Set<ClaimedArtifact>();
  for (const kind of kinds ?? []) {
    if (kind === "TABLE" || kind === "COMPARISON") drawn.add("TABLE");
    if (kind === "MAP") drawn.add("MAP");
    if (kind === "CHART") drawn.add("CHART");
    if (kind === "TIMELINE") drawn.add("TIMELINE");
  }
  return drawn;
}

const ARTICLE: Readonly<Record<ClaimedArtifact, string>> = {
  TABLE: "a table",
  MAP: "a map",
  CHART: "a chart",
  TIMELINE: "a timeline",
};

/** The plain truth in place of an unbacked claim (said once). */
export function notDrawnLine(kind: ClaimedArtifact): string {
  return `I couldn't build ${ARTICLE[kind]} from what I could read, so there isn't one on screen.`;
}

/**
 * One answer's guard, sentence by sentence. `drawn` is read at each
 * sentence. While the answer streams (`mode: "stream"`), the objects code
 * will build are not known yet, so an unbacked claim is simply held back
 * -- never said before it is true; the finished text says the truth.
 */
export function createArtifactClaimGuard(
  drawn: () => ReadonlySet<ClaimedArtifact>,
  mode: "stream" | "final",
) {
  let corrected = false;
  let removed = 0;
  return {
    sentence(sentence: string): string | null {
      const claimed = claimedArtifacts(sentence);
      const now = drawn();
      const missing = claimed.find((kind) => !now.has(kind));
      if (missing === undefined) return sentence;
      removed += 1;
      if (mode === "stream" || corrected) return null;
      corrected = true;
      return notDrawnLine(missing);
    },
    removed: () => removed,
  };
}

/** The finished answer under the same rule, against its own blocks. */
export function withoutUnbackedArtifactClaims(
  text: string,
  blocks: readonly QResultBlock[],
  onScreen: ReadonlySet<ClaimedArtifact> = new Set(),
): { readonly text: string; readonly removed: number } {
  const drawn = new Set([...drawnArtifacts(blocks), ...onScreen]);
  const guard = createArtifactClaimGuard(() => drawn, "final");
  const lines = text.split("\n").map((line) => {
    const sentences = splitSentences(line)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    if (!sentences.some((one) => claimedArtifacts(one).length > 0)) {
      return line;
    }
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
