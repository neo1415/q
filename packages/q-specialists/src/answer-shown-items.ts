// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: reading what Q last showed (cards, lists, ordinals) and re-reading a turn.
import { type QPageManifest, type QResultBlock } from "@capital-q/contracts";
import {
  asksForTheWeb,
  asksReasonForPlace,
  cardNamesInWords,
  conversationContextOf,
  type QTurnReading,
  sameCompanyName as sameCardName,
  TURN_READER_RECENT_TURNS_MAX,
} from "@capital-q/model-gateway/q";
import { type QConversationMessage } from "@capital-q/q-runtime";
import { closestByName, type QCapability } from "@capital-q/q-tools";

import {
  focusFromHistory,
  listsFromHistory,
  referenceAskOf,
  type ResolvedReference,
  resolveReference,
} from "./conversation-entities.js";

/**
 * A speed hint only (owner 2026-10-23: "the model decides; a hint can only
 * speed things up"): words shaped as a question or a lookup. It starts the
 * nameless holding line early and decides nothing else -- never whom Q
 * looks into, never whether to research.
 */
export const ASKS_SOMETHING =
  /^(tell me|who|what|what's|whats|where|when|how|why|is|are|does|do|find|search|look up|lookup|show me|give me|any|latest|news|research|check)\b|\?\s*$/iu;

/**
 * How a specialist reaches Q (CQ-Q-020 §11, §53, §56, §91).
 *
 * This implements the runtime's existing answer seam, so the investigation
 * graph, the Context Firewall, the run lifecycle and the stream are all
 * untouched. Q asks for an answer; if the Company Intelligence specialist
 * is the right one for the request it produces findings and a synthesis,
 * and Q writes the message. If it is not, the request goes to the
 * delegate — today the conversational answer path — exactly as before.
 *
 *   QOrchestrator → answer seam → supports()? → specialist → findings
 *                                            ↘ no → delegate
 *
 * A person never learns any of this happened. Nothing written here carries
 * the specialist's id, its version, the provider, the prompt bundle or a
 * word of reasoning: those live in the trace and the telemetry, which is
 * where explainability belongs and where a person's message does not (§55,
 * §57, §91, §103).
 */

/** An action the reader is told of; `available: false` is declared but not offered here. */
export type ReaderAction = {
  readonly name: string;
  readonly does: string;
  readonly available?: boolean | undefined;
  /** v32: a few words, and the area it is grouped under. */
  readonly short?: string | undefined;
  readonly area?: string | undefined;
};

/** The reader's input: the person's own latest words and own recent turns. */
/** A name without its parenthetical ("Savanna Seed Partners (fictional)"). */
function bareName(text: string): string {
  return text
    .replace(/\([^)]*\)/gu, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether the words name this counterpart: the whole name, parentheticals
 * dropped on both sides, or a run of as many words heard slightly wrong
 * ("Ledgefold" for Ledgerfold), by the shared name matcher.
 */
export function namedInWords(utterance: string, name: string): boolean {
  const wanted = bareName(name);
  if (wanted.length < 3) return false;
  const said = bareName(utterance);
  if (` ${said} `.includes(` ${wanted} `)) return true;
  const words = said.split(" ").filter((word) => word.length > 0);
  const size = wanted.split(" ").length;
  for (let start = 0; start + size <= words.length; start += 1) {
    const window = words.slice(start, start + size).join(" ");
    if (
      window.length >= 4 &&
      closestByName([wanted], window, (n) => n).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Live re-check 15 Nov 2026 (T8): whether the turn reading marks a place
 * in a list Q showed -- a numbered pointer into SHOWN (v40
 * `reference.shown`), an answer from a shown turn (v54 `fromShown`), or a
 * reference of its own bound to the same record. Structure only; the
 * word "first" alone never does.
 */
export function readingMarksPlace(
  read: {
    readonly reference?: { readonly shown?: number | null } | null | undefined;
    readonly fromShown?: unknown;
  } | null,
  recordId: string,
  readerBoundIds: readonly string[],
): boolean {
  if (read === null) return false;
  if ((read.reference?.shown ?? null) !== null) return true;
  if ((read.fromShown ?? null) !== null) return true;
  return readerBoundIds.includes(recordId.toLowerCase());
}

/**
 * Live re-check of 3b7145616 (16 Nov 2026, turn C): the companies Q showed
 * on cards in this conversation (fit lists and conditioned lists alike),
 * by lower-case id, with the name each card shows.
 */
export function shownCardCompanies(
  history: readonly {
    readonly role: string;
    readonly blocks?: readonly QResultBlock[] | null | undefined;
  }[],
): ReadonlyMap<string, string> {
  const shown = new Map<string, string>();
  for (const message of history) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards) {
        if (card.subject?.kind === "COMPANY")
          shown.set(card.subject.companyId.toLowerCase(), card.name);
      }
    }
  }
  return shown;
}

/**
 * The person's own words ask for the public web, the news or the press.
 * A question about an item of Q's own list without any of these is
 * answered from Capital Q's records (turn C: research was read EXPLICIT
 * for "Why is the first one there?" because the item is another company).
 */
const WEB_WORDING =
  /\b(?:web|online|internet|google|public(?:ly)?|news|press|headlines?|articles?|media|website|linkedin|crunchbase|search(?:es|ed|ing)?|look(?:ing)?\s+(?:it|them|this|that|him|her)\s+up|sources?|reported|reports?|announce(?:d|s|ments?)?|latest)\b/iu;

/** "Why…", "how come…", "what puts/makes/got…": a reason for a place. */
const ASKS_WHY =
  /\b(?:why|how\s+come)\b|\bwhat\s+(?:puts?|makes?|made|got|gets|lands?|landed|earns?|earned)\b/iu;

type ShownItemReading = {
  readonly kind: string;
  readonly addressedToQ?: boolean | undefined;
  readonly asksForWeb?: boolean | undefined;
  readonly appAction?: unknown;
  readonly askedAction?: unknown;
  readonly tool?: unknown;
  readonly compare?: unknown;
  readonly handOver?: unknown;
  readonly meetingPrep?: unknown;
  readonly teamJob?: boolean | undefined;
  readonly planAsk?: unknown;
  readonly parts?: readonly unknown[] | null | undefined;
  readonly namedOther?:
    { readonly kind: string; readonly name: string } | null | undefined;
  readonly reference?:
    | { readonly name?: string | null; readonly shown?: number | null }
    | null
    | undefined;
  readonly fromShown?: unknown;
};

/**
 * Turn C: a plain question to Q about one thing -- no action, tool, hand
 * over, comparison, team job or compound ask, and not asking for the web.
 */
function plainQuestionToQ(read: ShownItemReading | null): boolean {
  if (read === null || read.kind !== "QUESTION_TO_Q") return false;
  if (read.addressedToQ === false || read.asksForWeb === true) return false;
  const none = (value: unknown): boolean =>
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.length === 0);
  return (
    none(read.appAction) &&
    none(read.askedAction) &&
    none(read.tool) &&
    none(read.compare) &&
    none(read.handOver) &&
    none(read.meetingPrep) &&
    read.teamJob !== true &&
    none(read.planAsk) &&
    (read.parts?.length ?? 0) < 2
  );
}

/**
 * Turn C: the one company on a card Q showed that this turn is about --
 * the bound company when it is on a shown card, else the company the
 * reading itself names (its namedOther or its reference) when exactly one
 * shown card carries that name, else code's place in Q's list when the
 * reading marks one. Null: not about one shown card.
 */
export function shownCardCompanyOf(input: {
  readonly read: ShownItemReading | null;
  readonly shown: ReadonlyMap<string, string>;
  readonly bound: string | null;
  readonly listPlace: { readonly id: string; readonly kind: string } | null;
  /** The companies on the cards of Q's latest turn, in card order. */
  readonly lastShown: readonly string[];
  readonly utterance: string;
}): string | null {
  const { read, shown, bound, listPlace, lastShown, utterance } = input;
  if (shown.size === 0 || read === null) return null;
  if (bound !== null && shown.has(bound.toLowerCase())) return bound;
  const names = [
    read.namedOther?.kind === "COMPANY" ? read.namedOther.name : null,
    read.reference?.name ?? null,
  ].flatMap((name) =>
    name === null || name.trim().length === 0
      ? []
      : [name.trim().toLocaleLowerCase()],
  );
  const byName = [
    ...new Set(
      [...shown].flatMap(([id, name]) =>
        names.includes(name.trim().toLocaleLowerCase()) ? [id] : [],
      ),
    ),
  ];
  if (byName.length === 1) return byName[0] ?? null;
  if (byName.length > 1) return null;
  if (
    listPlace !== null &&
    listPlace.kind === "COMPANY" &&
    shown.has(listPlace.id.toLowerCase()) &&
    readingMarksPlace(read, listPlace.id, [])
  )
    return listPlace.id;
  // Live re-check of 9913a5b64 (turn C): "Why is that one at the top?"
  // after a list of one company. The reading named nobody (no company, and
  // no person or investor either) and the words point back ("that one",
  // "it") or the reading points into what Q showed: the one company on
  // the cards of Q's latest turn is the one meant.
  const lastOne = lastShown.length === 1 ? (lastShown[0] ?? null) : null;
  if (
    lastOne !== null &&
    names.length === 0 &&
    (read.namedOther ?? null) === null &&
    ((read.reference?.shown ?? null) !== null ||
      (read.fromShown ?? null) !== null ||
      POINTS_BACK.test(utterance))
  )
    return lastOne;
  return null;
}

/** Words that point back at something already said or shown. */
const POINTS_BACK =
  /\b(?:it|its|it's|that|this|that\s+one|this\s+one|the\s+one|that\s+company|this\s+company)\b/iu;

/**
 * Live re-check of 9913a5b64 (turn C): the companies on the cards of Q's
 * latest turn, by id, in card order (empty when it showed none).
 */
export function lastShownCardCompanies(
  history: readonly {
    readonly role: string;
    readonly blocks?: readonly QResultBlock[] | null | undefined;
  }[],
): readonly string[] {
  const lastQ = history.findLast((message) => message.role === "Q");
  const ids: string[] = [];
  for (const block of lastQ?.blocks ?? []) {
    if (block.kind !== "ANSWER_CARDS") continue;
    for (const card of block.cards) {
      if (
        card.subject?.kind === "COMPANY" &&
        !ids.includes(card.subject.companyId)
      )
        ids.push(card.subject.companyId);
    }
  }
  return ids;
}

/**
 * Live re-check of cb28c00e5 (16 Nov 2026, turns C and D): "Why is it
 * there?" after a one-card list (read with aboutNamedOther, research
 * EXPLICIT and navigation CONTEXT to Discover: "there" became a place) and
 * "And why is MedTrail ranked first in the earlier list?" (read
 * THEIR_OWN_RECORDS about an earlier list's card: 31 reads). Each earlier
 * fix matched the previous wording; this is the principle, decided in code
 * after the reader from the person's own words and the cards Q showed:
 *
 * A turn that asks why or how an item of any list Q showed in this
 * conversation is placed, ranked or included -- by its name, its place
 * ("the second one"), "it/that one/this one" right after a one-card list,
 * or the reading's own binding -- is a shown-list explanation. It is
 * answered from that card and its list's stated conditions and order; it
 * never reaches the public web unless their words ask for it, and never
 * moves the page unless their words ask to open or go (decision 98).
 *
 * Order matters: a shown company their words name wins; then deixis right
 * after a one-card list (before anything the reading made of "there");
 * then the reading's binding, a company the reading names, and code's
 * place in the list. A company the reading names that is on no card Q showed
 * (and their words name none) is someone else: not bound. Null: not a
 * shown-list explanation.
 */
export function shownListExplanation(input: {
  readonly read: ShownItemReading | null;
  readonly utterance: string;
  /** Every company on a card Q showed in this conversation. */
  readonly shown: ReadonlyMap<string, string>;
  /** The companies on the cards of Q's latest turn, in card order. */
  readonly lastShown: readonly string[];
  readonly bound: string | null;
  readonly listPlace: { readonly id: string; readonly kind: string } | null;
}): string | null {
  const { read, utterance, shown, lastShown, bound, listPlace } = input;
  if (shown.size === 0 || read === null) return null;
  // The reading's own web flag is not the person's words (turn C: the
  // reader's EXPLICIT research came from aboutNamedOther, not from them).
  if (!plainQuestionToQ({ ...read, asksForWeb: false })) return null;
  if (asksForTheWeb(utterance) || !asksReasonForPlace(utterance)) return null;
  const cards = [...shown];
  const idsNamed = (names: readonly string[]): readonly string[] => [
    ...new Set(
      cards.flatMap(([id, cardName]) =>
        names.some((name) => sameCardName(name, cardName)) ? [id] : [],
      ),
    ),
  ];
  const inWords = idsNamed(
    cardNamesInWords(
      utterance,
      cards.map(([, name]) => name),
    ),
  );
  if (inWords.length > 1) return null;
  if (inWords.length === 1) return inWords[0] ?? null;
  const readerNames = [
    read.namedOther?.name ?? null,
    read.reference?.name ?? null,
  ].flatMap((name) =>
    name === null || name.trim().length === 0 ? [] : [name.trim()],
  );
  const readerShown = idsNamed(readerNames);
  const someoneElse = readerNames.length > 0 && readerShown.length === 0;
  const lastOne = lastShown.length === 1 ? (lastShown[0] ?? null) : null;
  if (lastOne !== null && !someoneElse && POINTS_BACK.test(utterance))
    return lastOne;
  if (bound !== null && shown.has(bound.toLowerCase())) return bound;
  // The company the reading names before code's count of places: a
  // worst-first list's cards are stored best first, so "the first one" by
  // storage is not the first one said (live re-check of 3b7145616).
  if (readerShown.length === 1) return readerShown[0] ?? null;
  if (readerShown.length > 1) return null;
  if (
    listPlace !== null &&
    listPlace.kind === "COMPANY" &&
    shown.has(listPlace.id.toLowerCase())
  )
    return listPlace.id;
  if (
    lastOne !== null &&
    !someoneElse &&
    ((read.reference?.shown ?? null) !== null ||
      (read.fromShown ?? null) !== null)
  )
    return lastOne;
  return null;
}

/**
 * Live re-check of 3b7145616 (16 Nov 2026, turn C): "Why is the first one
 * there?" after Q's conditioned list was read ADVICE with research
 * EXPLICIT and class COMPLEX_ANALYSIS: 8 reads, a web search, two model
 * calls and a move to the company's profile. A "why" about one company of
 * Q's own shown list, with no web wording, is answered from its card:
 * a contextual follow-up, no public web, no page. `why` is that shape;
 * `aboutItem` (a pointer into the list, or the why) is the wider shape
 * whose research is held to Capital Q's records. Code-level: the
 * reading's structure plus the person's own words, never the prompt.
 */
export function shownItemTurn(input: {
  readonly read: ShownItemReading | null;
  readonly utterance: string;
  readonly company: string | null;
}): { readonly aboutItem: boolean; readonly why: boolean } {
  const { read, utterance, company } = input;
  if (
    company === null ||
    !plainQuestionToQ(read) ||
    WEB_WORDING.test(utterance)
  )
    return { aboutItem: false, why: false };
  const why = ASKS_WHY.test(utterance);
  const pointsIntoList =
    (read?.reference?.shown ?? null) !== null ||
    (read?.fromShown ?? null) !== null;
  return { aboutItem: why || pointsIntoList, why };
}

/**
 * Scenarios D-E (live 2026-11-16, defect 7): `public_web.search` ran on
 * every investor question about a company's own figures, diligence or
 * documents ("How much cash does Halyard actually have in the bank?",
 * "Does the bank balance agree with their management accounts?"), because
 * the reading said research EXPLICIT. Their own records answer those; the
 * web is asked only when the person's own words ask about the public
 * world. Narrower than WEB_WORDING: "latest", "reports" and "sources" name
 * a bank statement or a management report as often as the press.
 */
const PUBLIC_WORLD_WORDING =
  /\b(?:web|online|internet|google|public(?:ly)?|news|press|headlines?|articles?|media|website|linkedin|crunchbase|search(?:es|ed|ing)?|look(?:ing)?\s+(?:it|them|this|that|him|her)\s+up|announce(?:d|s|ments?)?|out\s+there)\b/iu;

/** A company's figures, as an investor asks for them. */
const COMPANY_FIGURES_WORDING =
  /\b(?:burn(?:s|ing|ed|\s+rate)?|runway|cash|revenue|mrr|arr|margins?|profit|loss(?:es)?|expenses?|costs?|spend(?:ing)?|financials?|p&l|ebitda|balance|payroll|valuation|cap\s+table)\b/iu;

/** Diligence and the documents a company shared. */
const DILIGENCE_WORDING =
  /\b(?:diligence|data\s*room|documents?|statements?|accounts|deck|contracts?|invoices?|requests?|requested|shared|answered|fulfil(?:led|ls)?|fulfill(?:ed|s)?)\b/iu;

/**
 * A company's own plans, as an investor asks about them: hiring and
 * headcount, its team's roles, use of funds, projections, milestones.
 * Live re-check on 927f25ddd (run 9604481f): "How many people is Halyard
 * Security planning to hire next year, and in which roles?" was read as
 * public facts and searched the web with the whole question, while the
 * plan Halyard shared with them answers it.
 */
const COMPANY_PLAN_WORDING =
  /\b(?:hire[sd]?|hiring|headcount|recruit(?:s|ing|ment)?|roles|team\s+size|plan(?:s|ned|ning)?\s+to\s+(?:hire|recruit|grow|spend|raise|use)|hiring\s+plan|use\s+of\s+funds|projections?|forecasts?|budget(?:ed|s)?|milestones?|roadmap)\b/iu;

/**
 * An investor's question that their own records answer: about their own
 * records or progress, or about a company's figures, diligence or shared
 * documents, and with no words asking about the public world. The reading's
 * research flag does not decide it (same principle as SHOWN_LIST_ITEM).
 */
export function ownRecordsInvestorQuestion(input: {
  readonly read: {
    readonly kind: string;
    readonly addressedToQ?: boolean | undefined;
    readonly question?: { readonly kind?: string } | null | undefined;
    readonly namedOther?:
      { readonly kind: string; readonly name: string } | null | undefined;
  } | null;
  readonly utterance: string;
  readonly side: "INVESTOR" | "FOUNDER" | null;
}): boolean {
  const { read, utterance } = input;
  if (input.side !== "INVESTOR" || read === null) return false;
  if (read.kind !== "QUESTION_TO_Q" || read.addressedToQ === false) {
    return false;
  }
  if (PUBLIC_WORLD_WORDING.test(utterance)) return false;
  const kind = read.question?.kind ?? null;
  if (kind === "THEIR_OWN_RECORDS" || kind === "PROGRESS") return true;
  return (
    read.namedOther?.kind === "COMPANY" &&
    (COMPANY_FIGURES_WORDING.test(utterance) ||
      DILIGENCE_WORDING.test(utterance) ||
      COMPANY_PLAN_WORDING.test(utterance))
  );
}

/**
 * Live re-check 15 Nov 2026 (T1): lists a quick first read may not answer
 * before the full reading, whose list conditions it does not carry.
 */
export const RANKED_LIST_LANES: ReadonlySet<string> = new Set([
  "FIT",
  "DISCOVER_COMPANIES",
]);

/** Blocks that are words, not something on screen to look at again. */
export const TEXT_ONLY_BLOCKS: ReadonlySet<QResultBlock["kind"]> = new Set([
  "FINDING",
  "UNCERTAINTY",
  "EVIDENCE",
  "TEXT",
  "SUMMARY",
  "COMPANY_REFERENCE",
  "INVESTOR_REFERENCE",
  "PUBLIC_SOURCE",
  "CLARIFICATION_REQUEST",
  "ATTENTION",
]);

/** Said when an earlier turn's own blocks are shown again (v54 fromShown). */
export const RESHOWN_LINE = "Here's what I showed you, back on screen.";

const ORDINAL_WORDS =
  "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|[4-6]th";

/**
 * "What was the second one?", "which was the third company again?",
 * "remind me what the last one was": only the name of a record Q listed,
 * asked back. Anything more ("…and why does it fit?") is a question for
 * the reading and the answer.
 */
const ORDINAL_RECALL = new RegExp(
  [
    `^(?:(?:and|so|sorry|ok(?:ay)?|wait|hold\\s+on)[,\\s]+)*(?:what|which|who)(?:'s|\\s+(?:was|is))\\s+(?:the\\s+)?(${ORDINAL_WORDS})(?:\\s+(?:one|company|investor|fund|firm|startup|card))?(?:\\s+(?:again|you\\s+(?:showed|mentioned|named|said)(?:\\s+me)?))*[\\s?.!]*$`,
    `^(?:(?:can|could)\\s+you\\s+)?remind\\s+me\\s+(?:what|which|who)\\s+(?:the\\s+)?(${ORDINAL_WORDS})(?:\\s+(?:one|company|investor|fund|firm|startup|card))?\\s+(?:was|is)(?:\\s+again)?[\\s?.!]*$`,
  ].join("|"),
  "iu",
);

/**
 * Owner live 2026-10-17 ("what was the second one?" took 3.3 s: two
 * classification calls and a 1.8 s recall reply): the name of the record
 * at that place in Q's own latest list, said by code with no model call.
 * Only Q's own list in this conversation -- what this person was already
 * shown -- and only when the words ask for nothing but that name.
 */
export function ordinalRecallLine(
  text: string,
  resolved: ResolvedReference | null,
): string | null {
  const said = text.replace(/[’]/gu, "'").trim();
  const asked = ORDINAL_RECALL.exec(said);
  if (asked === null) return null;
  if (resolved?.kind !== "ONE" || resolved.via !== "Q_ANSWER") return null;
  const name = resolved.entity.name?.trim() ?? "";
  if (name.length === 0) return null;
  const place = (asked[1] ?? asked[2] ?? "").toLowerCase();
  const word: Readonly<Record<string, string>> = {
    "1st": "first",
    "2nd": "second",
    "3rd": "third",
    "4th": "fourth",
    "5th": "fifth",
    "6th": "sixth",
  };
  return `The ${word[place] ?? place} one was ${name}.`;
}

/** The same binding from the conversation alone (Q's lists, no page). */
export function ordinalRecallFromHistory(
  text: string,
  history: readonly QConversationMessage[],
): string | null {
  if (!ORDINAL_RECALL.test(text.replace(/[’]/gu, "'").trim())) return null;
  const ask = referenceAskOf(text);
  if (ask?.kind !== "ORDINAL") return null;
  const resolved = resolveReference(ask, {
    page: [],
    answers: listsFromHistory(history),
    answerIsNewest: true,
    focus: focusFromHistory(history),
  });
  return ordinalRecallLine(text, resolved);
}

/** Two summaries of one card: the same words, ignoring case and the full stop. */
export function sameCard(a: string, b: string): boolean {
  const plain = (text: string) =>
    text
      .trim()
      .replace(/[.\s]+$/u, "")
      .toLowerCase();
  return plain(a) === plain(b);
}

export function turnReaderInput(
  history: readonly QConversationMessage[],
  latest: QConversationMessage,
  actions: readonly ReaderAction[],
  context: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
    /** The run the reading is for, so its model usage is the run's. */
    readonly runId: string;
    readonly signal?: AbortSignal | undefined;
    /** Told why a reading failed (QTurnReader `onFailure`). */
    readonly onFailure?:
      ((failure: { readonly serviceUnavailable: boolean }) => void) | undefined;
  },
  /**
   * Capital Q's own note of what was shown and the last action (follow-55),
   * read as the last recent turn so "that one" and "try again" bind.
   */
  note: string | null = null,
  /** v55: the page's own registered controls (the firewall's manifest). */
  screenControls?: QPageManifest["controls"],
  /** Q intelligence step 1: the situation header, built by code. */
  situation?: string,
  /** Q intelligence step 2: the rendered conversation state. */
  conversationState?: string,
) {
  // Spoken turns carry the recogniser's utterance; typed ones never do.
  // The reader needs to know which: only speech can be overheard.
  const spoken = latest.utteranceRef !== undefined;
  return {
    utterance: latest.content,
    actions,
    // v54: what Q already said and showed here, so the reader binds "the
    // second one" or "show them again" by meaning to an earlier turn.
    shown: conversationContextOf(history, latest.id).text,
    recentTurns: [
      ...history
        .filter((m) => m.id !== latest.id)
        // Step 2 (v76): the recent turns whole; older ones reach the
        // reader through the state's summary and ledger, never dropped.
        .slice(
          note === null
            ? -TURN_READER_RECENT_TURNS_MAX
            : -(TURN_READER_RECENT_TURNS_MAX - 1),
        )
        .map((m) => ({
          role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
          text: m.content,
        })),
      ...(note === null ? [] : [{ role: "Q" as const, text: note }]),
    ],
    modality: spoken ? ("VOICE" as const) : ("TEXT" as const),
    ...(screenControls === undefined ? {} : { screenControls }),
    ...(situation === undefined ? {} : { situation }),
    ...(conversationState === undefined ? {} : { conversationState }),
    attribution: {
      tenantId: context.tenantId,
      userId: context.userId,
      correlationId: context.correlationId,
      qRunId: context.runId,
    },
    signal: context.signal,
    ...(context.onFailure === undefined
      ? {}
      : { onFailure: context.onFailure }),
  };
}

/** The capability's reader label and area (v32), when it has them. */
export const labelOf = (capability: QCapability) => ({
  ...(capability.short === undefined ? {} : { short: capability.short }),
  ...(capability.area === undefined ? {} : { area: capability.area }),
});

export const actionsKey = (actions: readonly ReaderAction[]): string =>
  JSON.stringify(
    actions.map((a) => ({
      name: a.name,
      does: a.does,
      ...(a.available === false ? { available: false } : {}),
      ...(a.short === undefined ? {} : { short: a.short }),
      ...(a.area === undefined ? {} : { area: a.area }),
    })),
  );

/**
 * One more reading after the first failed, cut off at its deadline or by
 * the run's own abort; never started for a run already aborted. A reader
 * that ignores its signal is still not waited on past the deadline.
 */
export async function rereadTurn<T>(
  read: (signal: AbortSignal) => Promise<T | null>,
  runSignal: AbortSignal,
  deadlineMs: number,
): Promise<T | null> {
  if (runSignal.aborted) return null;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  const signal = AbortSignal.any([runSignal, deadline.signal]);
  try {
    return await Promise.race([
      read(signal).catch(() => null),
      new Promise<null>((resolve) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live 17-18 Nov 2026: a garbled spoken turn the reader read by sound
 * (TURN_READER v44 heardAs) was answered by reading its likely words again
 * from the start, a second reader call (about 2.6 s, in 7 of 20 spoken
 * turns measured). The first reading already read those words for what
 * they ask, so it is reused for them when nothing in it is bound to the
 * phrases of the garbled text itself: a plain question to Q, with no tool,
 * action, reference, part, control, reply, comparison, plan, sequence,
 * named other, shown list, memory or hand-over. Anything else is read
 * again, as before.
 */
export function heardReadingReusable(
  read: Pick<
    QTurnReading,
    | "kind"
    | "confidence"
    | "addressedToQ"
    | "tool"
    | "askedAction"
    | "appAction"
    | "handOver"
    | "reference"
    | "references"
    | "parts"
    | "control"
    | "remember"
    | "replyTo"
    | "compare"
    | "planAsk"
    | "sequence"
    | "fromShown"
    | "namedOther"
    | "meetingPrep"
    | "saveToOwnProfile"
    | "acceptsOffer"
    | "directsWork"
    | "teamJob"
    | "endVoice"
  >,
): boolean {
  const none = (value: unknown) => value === undefined || value === null;
  const empty = (value: readonly unknown[] | undefined | null) =>
    value === undefined || value === null || value.length === 0;
  return (
    read.kind === "QUESTION_TO_Q" &&
    read.confidence !== "LOW" &&
    read.addressedToQ !== false &&
    none(read.tool) &&
    none(read.askedAction) &&
    none(read.appAction) &&
    none(read.handOver) &&
    none(read.reference) &&
    empty(read.references) &&
    empty(read.parts) &&
    none(read.control) &&
    none(read.remember) &&
    none(read.replyTo) &&
    none(read.compare) &&
    none(read.planAsk) &&
    none(read.sequence) &&
    none(read.fromShown) &&
    none(read.namedOther) &&
    none(read.meetingPrep) &&
    read.saveToOwnProfile !== true &&
    read.acceptsOffer !== true &&
    read.directsWork !== true &&
    read.teamJob !== true &&
    read.endVoice !== true
  );
}
