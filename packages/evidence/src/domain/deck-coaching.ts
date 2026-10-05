import {
  DECK_SECTIONS,
  type DeckCoaching,
  type DeckCoachingCheck,
  type DeckCoachingSection,
  type DeckRubricLevel,
  type DeckSectionCode,
  type DeckSectionReading,
} from "@capital-q/contracts";

/**
 * Pitch-deck coaching (overnight plan A6; research pitch-deck.md §4-§6).
 *
 * The model judged the content once, per section, against the rubric's
 * three rungs ("is the pain quantified?"); this code turns those answers
 * into a 0-5 score, the gaps and the minimum standard, identically for
 * every company. Nothing about the person is an input: no name, photo, age
 * or gender (research §7.1). The result is the founder's alone: it is
 * never stored, never shown to an investor and never read by ranking or
 * matching (deck quality ≠ business quality ≠ fit).
 */

export const DECK_RUBRIC_VERSION = 1;

/** §6: these must reach 3 ("Clear") for the deck to be at standard. */
export const MINIMUM_STANDARD_SECTIONS: readonly DeckSectionCode[] = [
  "PROBLEM",
  "SOLUTION",
  "MARKET",
  "BUSINESS_MODEL",
  "TRACTION",
  "FOUNDERS",
  "THE_ASK",
];
const STANDARD_SCORE = 3;

const LEVELS: readonly DeckRubricLevel[] = [
  "MISSING",
  "MENTIONED",
  "BASIC",
  "CLEAR",
  "STRONG",
  "EXCEPTIONAL",
];

/** The rubric's own words for reaching the next rung, per section (§4). */
const NEXT_RUNG: Readonly<
  Record<DeckSectionCode, readonly [clear: string, strong: string, exceptional: string]>
> = {
  PROBLEM: [
    "Name who has the problem and what it costs them.",
    "Put a number on the pain (time, money or how often) and name how it is solved today.",
    "Add evidence from customers (quotes, a survey, data) and say why now.",
  ],
  SOLUTION: [
    "Explain the product in one sentence and show it.",
    "Show how it removes the pain you described, and say what stage the product is at.",
    "Show it working (a demo or usage) and what makes it hard to copy.",
  ],
  VALUE_PROPOSITION: [
    "Say the benefit in your customer's words.",
    "Put a number on the benefit.",
    "Prove the benefit with a customer's result.",
  ],
  MARKET: [
    "State the market size and where the number comes from.",
    "Build it bottom-up: customers you can reach times what each pays you.",
    "Use real pricing and a reachable first segment you can win.",
  ],
  GO_TO_MARKET: [
    "List how you reach customers.",
    "Explain the sales motion and what it costs to win a customer.",
    "Show your cost to win a customer and conversion from real data, on a channel that repeats.",
  ],
  BUSINESS_MODEL: [
    "Say who pays and how.",
    "State your pricing and gross margin.",
    "Show unit economics from real data, and your currency mix if you earn in more than one.",
  ],
  TRACTION: [
    "Show one concrete number with its date.",
    "Show a trend over at least six months, with the metric defined.",
    "Add retention or cohorts and named customers, consistent with your financials.",
  ],
  COMPETITION: [
    "Name your competitors, including how customers cope today.",
    "Position yourself honestly against them, status quo included.",
    "Give a clear, defensible reason you win, with evidence.",
  ],
  FINANCIALS: [
    "State current revenue and monthly spend.",
    "Add history and a simple plan for the next years, with the key assumptions.",
    "Tie the assumptions to your traction and to the ask.",
  ],
  THE_ASK: [
    "State how much you are raising.",
    "Say the instrument and what the money is for.",
    "Say what milestones it reaches, how many months it lasts and who is committed.",
  ],
  FOUNDERS: [
    "Name each founder and their role.",
    "Give each founder's relevant background.",
    "Show why you are the people to win this (years in the field, prior exits, unique access).",
  ],
  TEAM: [
    "Say how many people are on the team.",
    "Name the key roles and the gaps you know about.",
    "Tie your hiring plan to the use of funds.",
  ],
};

/** The 0-5 score, from the reading alone. */
export function scoreDeckSection(reading: DeckSectionReading): number {
  if (reading.status === "NOT_IN_DECK") return 0;
  const specifics = reading.facts.some((fact) => fact.value !== null);
  if (!reading.criteria.clear) {
    // Present but not yet "Clear": a mention, or stated but generic.
    return specifics || (reading.summary?.length ?? 0) >= 80 ? 2 : 1;
  }
  if (!reading.criteria.strong) return 3;
  return reading.criteria.exceptional ? 5 : 4;
}

function coachSection(reading: DeckSectionReading): DeckCoachingSection {
  const score = scoreDeckSection(reading);
  const required = MINIMUM_STANDARD_SECTIONS.includes(reading.section);
  const rungs = NEXT_RUNG[reading.section];
  const improve =
    score >= 5 ? null : score < 3 ? rungs[0] : score === 3 ? rungs[1] : rungs[2];
  const gaps: string[] = [];
  if (reading.status === "NOT_IN_DECK") {
    gaps.push("This isn't in the deck yet.");
  } else if (reading.status === "CONTRADICTORY") {
    gaps.push("The deck gives different numbers for this; say which is current.");
  } else if (reading.status === "UNCLEAR") {
    gaps.push("Q couldn't read this part clearly.");
  }
  const undated = reading.facts.filter(
    (fact) => fact.kind === "FIGURE" && fact.value !== null && fact.asOf === null,
  );
  if (undated.length > 0) {
    gaps.push(
      `${String(undated.length)} ${undated.length === 1 ? "number has" : "numbers have"} no date.`,
    );
  }
  if (reading.criteria.note !== null) gaps.push(reading.criteria.note);
  return {
    section: reading.section,
    score,
    level: LEVELS[score] ?? "MISSING",
    requiredForMinimum: required,
    atStandard: score >= STANDARD_SCORE,
    gaps: gaps.slice(0, 4),
    improve,
  };
}

function slideList(pages: readonly number[]): string {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  if (unique.length === 1) return `slide ${String(unique[0])}`;
  return `slides ${unique.slice(0, -1).join(", ")} and ${String(unique.at(-1))}`;
}

function checksOf(
  readings: readonly DeckSectionReading[],
  pageCount: number | null,
): DeckCoachingCheck[] {
  const undated = readings.flatMap((reading) =>
    reading.facts.filter(
      (fact) => fact.kind === "FIGURE" && fact.value !== null && fact.asOf === null,
    ),
  );
  const undatedPages = undated.flatMap((fact) => fact.pages);
  const contradictory = readings.filter(
    (reading) =>
      reading.status === "CONTRADICTORY" ||
      reading.facts.some((fact) => fact.unknownReason === "CONTRADICTORY"),
  );
  const ask = readings.find((reading) => reading.section === "THE_ASK");
  const checks: DeckCoachingCheck[] = [
    contradictory.length === 0
      ? { code: "CONTRADICTIONS", passed: true, words: "No conflicting numbers in your deck" }
      : {
          code: "CONTRADICTIONS",
          passed: false,
          words: `Conflicting numbers in: ${contradictory.map((r) => r.section.toLowerCase().replaceAll("_", " ")).join(", ")}`.slice(0, 240),
        },
    undated.length === 0
      ? { code: "UNDATED_FIGURES", passed: true, words: "Every number has a date" }
      : {
          code: "UNDATED_FIGURES",
          passed: false,
          words: `${String(undated.length)} ${undated.length === 1 ? "number has" : "numbers have"} no date${undatedPages.length > 0 ? `: ${slideList(undatedPages)}` : ""}`,
        },
    ask?.criteria.strong === true
      ? { code: "ASK_COMPLETE", passed: true, words: "The ask says how much and what the money is for" }
      : {
          code: "ASK_COMPLETE",
          passed: false,
          words: "The ask should say how much and what the money is for",
        },
  ];
  if (pageCount !== null && (pageCount < 8 || pageCount > 25)) {
    checks.push({
      code: "LENGTH",
      passed: false,
      words: `${String(pageCount)} slides; most decks that get read are 10 to 20`,
    });
  }
  return checks;
}

/**
 * The coaching for one reading of the deck: twelve sections in the
 * standard order, the cross-cutting checks, and whether the deck is at the
 * minimum standard (§6).
 */
export function coachDeck(
  readings: readonly DeckSectionReading[],
  pageCount: number | null,
): DeckCoaching {
  const ordered = DECK_SECTIONS.map((code) => {
    const found = readings.find((reading) => reading.section === code);
    return (
      found ?? {
        section: code,
        status: "NOT_IN_DECK" as const,
        summary: null,
        pages: [],
        facts: [],
        confidence: "LOW" as const,
        criteria: { clear: false, strong: false, exceptional: false, note: null },
      }
    );
  });
  const sections = ordered.map(coachSection);
  const checks = checksOf(ordered, pageCount);
  const requiredMet = sections
    .filter((section) => section.requiredForMinimum)
    .every((section) => section.atStandard);
  const checksMet = checks
    .filter((check) => check.code !== "LENGTH")
    .every((check) => check.passed);
  return {
    rubricVersion: DECK_RUBRIC_VERSION,
    sections,
    checks,
    sectionsAtStandard: sections.filter((section) => section.atStandard).length,
    atMinimumStandard: requiredMet && checksMet,
  };
}
