import type {
  QCardAction,
  QCardCategory,
  QCardsIntent,
} from "@capital-q/contracts";

import { selfCorrected } from "./page-request.js";

/**
 * "Q, clear all cards" (founder P5), read by code: no model, no database.
 *
 * Clearing is PRESENTATION ONLY. This reader only ever names a visibility
 * change for temporary cards on this device; it never names an approval,
 * a rejection, a deletion or a cancellation, and its verbs are limited to
 * hide / clear / dismiss / remove / close (never "delete", "decline",
 * "reject", "cancel"). A sentence whose object is not a card ("clear my
 * calendar", "remove this document") is not a cards request.
 *
 * The browser and the Q API read the same sentence with this same code, so
 * a live voice line acts in the frame the words end, and Q's own answer
 * agrees with it.
 */

export type CardsRequest = {
  readonly action: QCardAction;
  readonly category?: QCardCategory;
  readonly name?: string;
};

const HIDE_VERB = "(?:hide|clear|dismiss|remove|close|get\\s+rid\\s+of|wipe)";
const SHOW_VERB = "(?:show|bring|put|restore|unhide|display)";
const FILLER =
  "(?:(?:hey\\s+)?q\\s+|please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+|just\\s+|go\\s+ahead\\s+and\\s+|i\\s+want\\s+you\\s+to\\s+|i\\s+would\\s+like\\s+you\\s+to\\s+)*";
const DET =
  "(?:(?:all|every|each)\\s+(?:of\\s+)?)?(?:(?:the|these|those|my|this)\\s+)?";
const ADJ = "(?:(?:temporary|current|open|visible|floating|extra|other)\\s+)?";

const CATEGORY_WORDS: ReadonlyArray<readonly [RegExp, QCardCategory]> = [
  [/^(?:connection|connections|introduction|introductions)$/u, "CONNECTION"],
  [
    /^(?:needs[\s-]?you|attention|approval|approvals|decision|decisions)$/u,
    "NEEDS_YOU",
  ],
  [/^(?:source|sources|evidence|citation|citations)$/u, "SOURCE"],
  [
    /^(?:recommendation|recommendations|suggestion|suggestions|match|matches|matching|new\s+for\s+you)$/u,
    "RECOMMENDATION",
  ],
  [
    /^(?:answer|answers|result|results|company|companies|investor|investors)$/u,
    "ANSWER",
  ],
];

function categoryOf(words: string): QCardCategory | null {
  const w = words.trim().toLowerCase();
  for (const [pattern, category] of CATEGORY_WORDS) {
    if (pattern.test(w)) return category;
  }
  return null;
}

/** Lower-cased words only; case is kept for a name by the caller. */
function cleaned(text: string): string {
  return selfCorrected(text.trim().slice(0, 300))
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/[.]+(?=\s|$)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const HIDE_ALL = new RegExp(
  `^${FILLER}${HIDE_VERB}\\s+${DET}${ADJ}(?:cards?|everything(?:\\s+(?:off|from|on)\\s+(?:the\\s+)?(?:screen|page|stage|board))?|these|those|them|this\\s+lot)(?:\\s+(?:off|from)\\s+(?:the\\s+)?(?:screen|page|stage|board))?(?:\\s+(?:please|now|for\\s+now))?$`,
  "iu",
);
const HIDE_SCREEN = new RegExp(
  `^${FILLER}(?:clear|wipe|tidy|declutter|clean)(?:\\s+up)?\\s+(?:out\\s+)?(?:the\\s+|my\\s+)?(?:screen|page|stage|board|clutter)(?:\\s+(?:please|now))?$`,
  "iu",
);
const HIDE_CATEGORY = new RegExp(
  `^${FILLER}${HIDE_VERB}\\s+${DET}${ADJ}(?<cat>[a-z -]{3,24}?)\\s+cards?(?:\\s+(?:please|now|for\\s+now))?$`,
  "iu",
);
const RESTORE_ALL = new RegExp(
  `^${FILLER}(?:${SHOW_VERB}(?:\\s+me)?|bring|put|get)\\s+(?:back\\s+)?${DET}(?:(?:hidden|dismissed|cleared|removed)\\s+)?(?<cat>[a-z -]{3,24}?\\s+)?cards?(?:\\s+(?:back|again|up\\s+again|back\\s+up))?$|^${FILLER}(?:show|bring|put|restore|get)(?:\\s+me)?\\s+(?:them|those|these|everything)\\s+(?:back|again)$`,
  "iu",
);
const RESTORE_ALL_BACK = new RegExp(
  `^${FILLER}(?:bring|put|get)\\s+${DET}(?:(?:hidden|dismissed|cleared|removed)\\s+)?(?<cat>[a-z -]{3,24}?\\s+)?cards?\\s+back$`,
  "iu",
);
const RESTORE_ONE = new RegExp(
  `^${FILLER}(?:(?:bring|put|get)\\s+back|restore|unhide|undismiss|(?:show|display)(?:\\s+me)?)\\s+(?:the\\s+|my\\s+)?(?<name>[\\p{L}\\p{N}][\\p{L}\\p{N}\\s'&.-]{0,80}?)\\s+card(?<again>\\s+(?:again|back))?$`,
  "iu",
);
const RESTORE_ONE_BACK = new RegExp(
  `^${FILLER}(?:bring|put|get)\\s+(?:the\\s+|my\\s+)?(?<name>[\\p{L}\\p{N}][\\p{L}\\p{N}\\s'&.-]{0,80}?)\\s+card\\s+back$`,
  "iu",
);
const HIDE_ONE = new RegExp(
  `^${FILLER}${HIDE_VERB}\\s+(?:the\\s+|my\\s+)?(?<name>[\\p{L}\\p{N}][\\p{L}\\p{N}\\s'&.-]{0,80}?)\\s+card(?:\\s+(?:please|now))?$`,
  "iu",
);

/** Words that are never a card's name. */
const NOT_A_NAME =
  /^(?:this|that|these|those|all|every|each|other|temporary|hidden|dismissed|cleared|removed|first|second|third|last|next|previous|same)$/iu;

function nameOf(raw: string | undefined): string | null {
  const name = (raw ?? "").trim();
  if (name.length === 0 || name.length > 80) return null;
  if (NOT_A_NAME.test(name) || categoryOf(name) !== null) return null;
  return name;
}

export function cardsRequestOf(text: string): CardsRequest | null {
  const said = cleaned(text);
  if (said.length === 0) return null;

  if (HIDE_ALL.test(said) || HIDE_SCREEN.test(said)) {
    return { action: "HIDE_ALL" };
  }
  const restoreAll = RESTORE_ALL.exec(said) ?? RESTORE_ALL_BACK.exec(said);
  if (restoreAll !== null) {
    const raw = restoreAll.groups?.["cat"];
    if (raw === undefined) return { action: "RESTORE_ALL" };
    const category = categoryOf(raw);
    // "show me the TensorGate cards" names something else: not this branch.
    if (category !== null) return { action: "RESTORE_ALL", category };
    if (
      /^(?:all|the|my|hidden|dismissed|cleared|removed)$/iu.test(raw.trim())
    ) {
      return { action: "RESTORE_ALL" };
    }
  }
  const hideCategory = HIDE_CATEGORY.exec(said);
  if (hideCategory !== null) {
    const category = categoryOf(hideCategory.groups?.["cat"] ?? "");
    if (category !== null) return { action: "HIDE_CATEGORY", category };
  }
  const restoreOne = RESTORE_ONE.exec(said) ?? RESTORE_ONE_BACK.exec(said);
  if (restoreOne !== null) {
    const verbShow = /^(?:.*?\s)?(?:show|display)\b/iu.test(
      said.slice(
        0,
        said
          .toLowerCase()
          .indexOf((restoreOne.groups?.["name"] ?? "").toLowerCase()),
      ),
    );
    const again = restoreOne.groups?.["again"] !== undefined;
    const name = nameOf(restoreOne.groups?.["name"]);
    // "show me the Q card" opens a page; only "... again" is a restore.
    if (name !== null && (!verbShow || again)) {
      return { action: "RESTORE_ONE", name };
    }
  }
  const hideOne = HIDE_ONE.exec(said);
  if (hideOne !== null) {
    const name = nameOf(hideOne.groups?.["name"]);
    if (name !== null) return { action: "HIDE_ONE", name };
  }
  return null;
}

const CATEGORY_SAID: Readonly<Record<QCardCategory, string>> = {
  NEEDS_YOU: "needs-you",
  CONNECTION: "connection",
  SOURCE: "source",
  RECOMMENDATION: "recommendation",
  ANSWER: "answer",
};

/** The typed intent for a request (the contract's own shape). */
export function cardsIntentOf(request: CardsRequest): QCardsIntent {
  return {
    kind: "CARDS",
    action: request.action,
    ...(request.category === undefined ? {} : { category: request.category }),
    ...(request.name === undefined ? {} : { name: request.name }),
  };
}

/**
 * The short spoken line. It says what changed on the screen and, where
 * cards were hidden, that nothing was decided or removed -- the founder's
 * trust rule: clearing never looks like approving or deleting.
 */
export function cardsLineOf(request: CardsRequest): string {
  switch (request.action) {
    case "HIDE_ALL":
      return "Cleared. Nothing was approved or removed. Say show the cards again to bring them back.";
    case "HIDE_CATEGORY":
      return `Hidden: the ${CATEGORY_SAID[request.category ?? "ANSWER"]} cards. Nothing was approved or removed.`;
    case "HIDE_ONE":
      return `Hidden: the ${request.name ?? "that"} card. Nothing was approved or removed.`;
    case "RESTORE_ALL":
      return request.category === undefined
        ? "Here they are again."
        : `The ${CATEGORY_SAID[request.category]} cards are back.`;
    case "RESTORE_ONE":
      return `The ${request.name ?? "that"} card is back.`;
  }
}
