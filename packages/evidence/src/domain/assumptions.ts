import {
  ASSUMPTION_QUESTION_MAX_LENGTH,
  AssumptionBoardDtoSchema,
  DECK_SECTION_LABELS,
  type AssumptionBoardDto,
  type AssumptionDto,
  type AssumptionStanding,
  type CompanyDeckView,
  type DeckFact,
  type DeckSection,
  type DeckSectionCode,
} from "@capital-q/contracts";

/**
 * Q.07 "Assumptions to test" and the evidence board (2026-10-07).
 *
 * Deterministic: the same reading always gives the same board, and no
 * model is asked anything. The only input is the deck view the deck
 * service already projected for THIS reader, and the board is built only
 * for an investor reader and only from a reading the founder confirmed
 * (the Write Gate). Coaching, the rubric and an unconfirmed reading are
 * the founder's alone and are never read here, even when present.
 *
 * Standing: EVIDENCED needs a document behind the claim AND a stated
 * claim (a Q inference is never evidenced, whatever its evidence label);
 * a stated claim otherwise is CLAIMED; nothing stated is UNKNOWN, which is
 * never a negative: it is the first thing to ask.
 */

const EVIDENCED_STATUSES: ReadonlySet<string> = new Set([
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

/** The sections whose absence an investor always asks about. */
const KEY_SECTIONS: readonly DeckSectionCode[] = [
  "TRACTION",
  "FINANCIALS",
  "MARKET",
  "BUSINESS_MODEL",
  "THE_ASK",
];

/** Sections read for claims, in the order an investor tests them. */
const READ_ORDER: readonly DeckSectionCode[] = [
  "TRACTION",
  "FINANCIALS",
  "MARKET",
  "BUSINESS_MODEL",
  "THE_ASK",
  "GO_TO_MARKET",
  "COMPETITION",
  "TEAM",
  "FOUNDERS",
  "PROBLEM",
  "SOLUTION",
  "VALUE_PROPOSITION",
];

const FACTS_PER_SECTION = 3;
const ASSUMPTIONS_MAX = 24;

/** Standard diligence framing per section: what a claim there rests on. */
const RESTS_ON: Readonly<Record<DeckSectionCode, readonly string[]>> = {
  PROBLEM: ["Customers confirming the pain", "How they solve it today"],
  SOLUTION: ["Customers using it today", "What it replaces"],
  VALUE_PROPOSITION: ["A measured result for a customer", "Why now"],
  MARKET: ["A source for the size", "The share that would actually pay"],
  GO_TO_MARKET: ["Cost to win a customer", "A channel that repeats"],
  BUSINESS_MODEL: ["Pricing holding as they grow", "Margin after delivery"],
  TRACTION: ["The period and the source", "Customers renewing, not one-off"],
  COMPETITION: ["Why customers switch", "What stops a larger player"],
  FINANCIALS: ["Monthly burn holding", "When revenue actually lands"],
  THE_ASK: ["What the money buys", "Milestones before the next raise"],
  FOUNDERS: ["Who is full-time", "Relevant experience, checked"],
  TEAM: ["Who owns each key area", "Hires the plan depends on"],
};

/** The question when a key section is not known. */
const UNKNOWN_QUESTIONS: Readonly<Record<DeckSectionCode, string>> = {
  PROBLEM: "Who has this problem most, and how do they solve it today?",
  SOLUTION: "What does the product do today, and who uses it?",
  VALUE_PROPOSITION: "What result does a customer get, and how is it measured?",
  MARKET:
    "How big is the market you can reach, and where does that figure come from?",
  GO_TO_MARKET: "How do you win customers today, and what does each one cost?",
  BUSINESS_MODEL: "How do you charge, and what is your margin per customer?",
  TRACTION:
    "What are your revenue and customer numbers today, and over what period?",
  COMPETITION: "Who do customers compare you with, and why do they pick you?",
  FINANCIALS: "What is your monthly burn, and your runway after this round?",
  THE_ASK: "How much are you raising, and what will it pay for?",
  FOUNDERS: "Who are the founders, and who is full-time?",
  TEAM: "Who is on the team today, and which hires does the plan need?",
};

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

function sourceOf(pages: readonly number[]): string | null {
  if (pages.length === 0) return null;
  return pages.length === 1
    ? `Pitch deck, slide ${String(pages[0])}`
    : `Pitch deck, slides ${pages.slice(0, 3).join(", ")}`;
}

function standingOf(fact: DeckFact): AssumptionStanding {
  if (fact.value === null) return "UNKNOWN";
  // An inference is Q's reading, never the founder's evidenced claim.
  if (fact.truthClass === "Q_INFERENCE") return "CLAIMED";
  return EVIDENCED_STATUSES.has(fact.evidenceStatus) ? "EVIDENCED" : "CLAIMED";
}

function questionFor(fact: DeckFact, standing: AssumptionStanding): string {
  const label = clip(fact.label, 60);
  const value = fact.value === null ? "" : clip(fact.value, 60);
  if (standing === "UNKNOWN") {
    return fact.unknownReason === "CONTRADICTORY"
      ? `Your deck gives different figures for ${label}. Which one is current?`
      : `What is ${label} today, and where does the figure come from?`;
  }
  if (fact.truthClass === "Q_INFERENCE") {
    return `Q read ${label} as "${value}" from your deck. Is that right, and what is it based on?`;
  }
  if (standing === "EVIDENCED") {
    return `What period does ${label} (${value}) cover, and can you share the underlying record?`;
  }
  return fact.kind === "FIGURE"
    ? `Can you share the source behind ${label}: ${value}?`
    : `What evidence supports this: ${label}?`;
}

function factAssumption(
  section: DeckSection,
  fact: DeckFact,
  index: number,
): AssumptionDto {
  const standing = standingOf(fact);
  return {
    id: `${section.section}:${String(index)}`,
    sectionLabel: DECK_SECTION_LABELS[section.section],
    label: clip(fact.label, 120),
    value: fact.value === null ? null : clip(fact.value, 300),
    standing,
    truthClass: fact.value === null ? null : fact.truthClass,
    evidenceStatus: fact.value === null ? null : fact.evidenceStatus,
    unknownReason: fact.value === null ? (fact.unknownReason ?? "UNCLEAR") : null,
    source: sourceOf(fact.pages),
    restsOn: [...RESTS_ON[section.section]],
    question: clip(questionFor(fact, standing), ASSUMPTION_QUESTION_MAX_LENGTH),
  };
}

function unknownSection(
  code: DeckSectionCode,
  reason: AssumptionDto["unknownReason"],
): AssumptionDto {
  return {
    id: `${code}:unknown`,
    sectionLabel: DECK_SECTION_LABELS[code],
    label: DECK_SECTION_LABELS[code],
    value: null,
    standing: "UNKNOWN",
    truthClass: null,
    evidenceStatus: null,
    unknownReason: reason,
    source: null,
    restsOn: [...RESTS_ON[code]],
    question: UNKNOWN_QUESTIONS[code],
  };
}

function counted(
  companyId: string,
  basis: AssumptionBoardDto["basis"],
  readAt: string | null,
  assumptions: readonly AssumptionDto[],
): AssumptionBoardDto {
  return AssumptionBoardDtoSchema.parse({
    companyId,
    basis,
    readAt,
    assumptions,
    counts: {
      evidenced: assumptions.filter((a) => a.standing === "EVIDENCED").length,
      claimed: assumptions.filter((a) => a.standing === "CLAIMED").length,
      unknown: assumptions.filter((a) => a.standing === "UNKNOWN").length,
    },
  });
}

/**
 * The board for an investor reader, or null for anyone else (the owner
 * sees their own deck and coaching on the deck tab; a founder of another
 * company is never an investor reader).
 */
export function buildAssumptionBoard(
  view: CompanyDeckView,
): AssumptionBoardDto | null {
  if (view.viewer !== "INVESTOR") return null;
  // Defence in depth: the deck service already withholds an unconfirmed
  // reading from an investor; the board refuses one even if it arrived.
  const reading =
    view.deck !== null && view.extraction?.confirmed === true
      ? view.extraction
      : null;
  if (reading === null) {
    return counted(
      view.companyId,
      "NOTHING_SHARED",
      null,
      KEY_SECTIONS.map((code) => unknownSection(code, "NOT_SHARED")),
    );
  }

  const bySection = new Map(
    reading.sections.map((section) => [section.section, section] as const),
  );
  const assumptions: AssumptionDto[] = [];
  for (const code of READ_ORDER) {
    const section = bySection.get(code);
    const key = KEY_SECTIONS.includes(code);
    if (section === undefined || section.facts.length === 0) {
      if (key) {
        assumptions.push(
          unknownSection(
            code,
            section === undefined || section.status === "NOT_IN_DECK"
              ? "NOT_IN_DECK"
              : section.status === "CONTRADICTORY"
                ? "CONTRADICTORY"
                : section.status === "UNCLEAR"
                  ? "UNCLEAR"
                  : "NOT_IN_DECK",
          ),
        );
      }
      continue;
    }
    // Outside the key sections, only figures are tested as assumptions.
    const facts = section.facts
      .map((fact, index) => ({ fact, index }))
      .filter(({ fact }) => key || fact.kind === "FIGURE")
      .slice(0, FACTS_PER_SECTION);
    for (const { fact, index } of facts) {
      assumptions.push(factAssumption(section, fact, index));
    }
  }
  return counted(
    view.companyId,
    "CONFIRMED_DECK_READING",
    reading.readAt,
    assumptions.slice(0, ASSUMPTIONS_MAX),
  );
}

/** The board as plain text, for Q's answer and any surface without cards. */
export function assumptionBoardText(
  name: string,
  board: AssumptionBoardDto,
): string {
  const head =
    board.basis === "NOTHING_SHARED"
      ? `${name} has not shared a confirmed deck reading with you, so every key claim is not known yet.`
      : `${name}: ${String(board.counts.evidenced)} evidenced, ${String(board.counts.claimed)} claimed, ${String(board.counts.unknown)} not known yet (from their confirmed deck reading).`;
  const lines = board.assumptions.map((a) => {
    const labels =
      a.standing === "UNKNOWN"
        ? "not known yet"
        : [
            a.truthClass === "Q_INFERENCE" ? "Q's reading" : "founder's claim",
            (a.evidenceStatus ?? "").toLowerCase().replace(/_/g, " "),
          ].join(", ");
    return `- ${a.sectionLabel} · ${a.label}${a.value === null ? "" : `: ${a.value}`} [${labels}]. Ask: ${a.question}`;
  });
  return [head, ...lines].join("\n");
}
