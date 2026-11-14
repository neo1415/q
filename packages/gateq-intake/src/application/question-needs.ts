import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import {
  APPLICATION_DIMENSIONS,
  type ApplicationDimension,
  type ApplicationFact,
} from "../contracts/index.js";
import {
  missingSpecifics,
  QUANTITATIVE_DIMENSIONS,
} from "./answer-specificity.js";
import { unreconciledPairs, unreconciledStatements } from "./fact-history.js";
import type { ApplicationStatementView } from "../contracts/statements.js";
import { NEVER_ASKED_AGAIN } from "./statement-view.js";

/**
 * What is worth asking next, and why (CQ-GATE-002 §22, §28).
 *
 * Deterministic, and deliberately so. The model composes the question; the
 * platform decides what the question should be about, because only the
 * platform knows which criteria are required, what is already answered and
 * what contradicts what. A model left to choose from nothing would ask
 * whatever came to mind, and an interview that wanders is an interview
 * nobody finishes.
 *
 * The other half is §28. A private criterion still needs its answer, and
 * the need can be stated without the rule: "ask about the current stage"
 * carries everything the conversation requires, while the allowed stage
 * codes stay on the server. A model that never receives a threshold cannot
 * leak one, cannot be argued into revealing one, and cannot be tricked
 * into coaching somebody past it.
 */

export type QuestionNeed = {
  readonly dimension: ApplicationDimension;
  /**
   * Why it is worth asking, in bounded vocabulary. Never the rule itself.
   */
  readonly reason:
    | "REQUIRED_BY_GATEWAY"
    | "PREFERRED_BY_GATEWAY"
    /**
     * The investor's own private mandate emphasises this dimension. Only
     * the dimension crosses: never the mandate's values, wording or
     * thresholds (§28), and never a qualification decision.
     */
    | "INVESTOR_EMPHASIS"
    | "CONTRADICTION"
    | "UNDERSTANDING"
    /**
     * Answered, but not in decision-grade terms ("we have a big market").
     * One follow-up for the specific missing element; still parked after
     * MAX_ASKS_PER_DIMENSION like everything else.
     */
    | "NEEDS_SPECIFICS";
  /**
   * NEEDS_SPECIFICS only: the kind of figure still missing, in platform
   * words. Never the applicant's own text and never a threshold.
   */
  readonly missing?: string;
};

/** Which application dimension answers which kind of criterion. */
const CRITERION_DIMENSION: Readonly<
  Record<string, ApplicationDimension | undefined>
> = {
  GEOGRAPHY: "company.country",
  STAGE: "company.stage",
  TAXONOMY: "company.sector_phrases",
  EXCLUDED_TAXONOMY: "company.sector_phrases",
  RAISE_SIZE: "raise.amount",
  CHEQUE_COMPATIBILITY: "raise.amount",
};

/**
 * What an investor reads first, when nothing is pressing.
 *
 * Ordered as a partner would want it: what the company is and does, then
 * who it serves, then the shape of the raise. Not the schema's order, and
 * not every dimension — a question asked only because a field exists is
 * the thing §22 forbids.
 */
const UNDERSTANDING_ORDER: readonly ApplicationDimension[] = [
  "company.name",
  "company.description",
  "company.problem",
  "company.solution",
  "company.customers",
  "company.business_model",
  "company.market",
  "claims.traction",
  "claims.revenue",
  "company.team",
  "raise.use_of_funds",
  "contact.name",
];

/**
 * What a founder has, in substance, already told us about a dimension.
 *
 * Live 2026-10-17 (Partech, Atlas): founders who explained the product were
 * asked "what are you building, and who is it for?" four times, because
 * their answer was recorded as the solution or problem rather than the
 * description. Any of these answers the description.
 */
const COVERED_BY: Readonly<
  Partial<Record<ApplicationDimension, readonly ApplicationDimension[]>>
> = {
  "company.description": ["company.solution", "company.problem"],
};

/**
 * How many times a dimension may be asked before the interview moves on.
 *
 * Twice: once, and once more when the first answer was lost or unclear
 * (a dropped spoken fragment). A third time is a script, not an analyst;
 * what is still unknown afterwards is reported as unknown, never pressed.
 */
export const MAX_ASKS_PER_DIMENSION = 2;

export function questionNeedsFor(input: {
  readonly policy: GatewayPolicy;
  readonly qualification: QualificationResult;
  readonly facts: readonly ApplicationFact[];
  readonly limit?: number | undefined;
  /**
   * How many Q turns already asked about each dimension. A dimension asked
   * MAX_ASKS_PER_DIMENSION times is parked, whatever its reason.
   */
  readonly askedCounts?: ReadonlyMap<ApplicationDimension, number> | undefined;
  /**
   * Dimensions the investor's active mandate emphasises, derived by the
   * composition from automation-eligible mandate fields. Shapes what is
   * asked; never what qualifies.
   */
  readonly emphasis?: readonly ApplicationDimension[] | undefined;
  /**
   * Slice 2: the statement view. Present, what may be asked comes from
   * each dimension's status, not from how often Q asked: SETTLED, ZERO,
   * DECLINED and LEFT_OPEN are never asked again; an OPEN disagreement is
   * put to them once; an UNKNOWN is asked at most once more; UNANSWERED is
   * asked as usual. `askedCounts` stays only as a ceiling.
   */
  readonly view?: ApplicationStatementView | undefined;
  /**
   * With `view`: how many Q questions about the dimension came after what
   * decides it now (the open disagreement, or the latest statement).
   */
  readonly asksSince?: ((dimension: ApplicationDimension) => number) | undefined;
}): readonly QuestionNeed[] {
  const limit = input.limit ?? 6;
  const statusOf = (dimension: ApplicationDimension) =>
    input.view?.dimensions.find((d) => d.dimension === dimension)?.status;
  /** Whether the view rules a question out, whatever its reason. */
  const settledByView = (
    dimension: ApplicationDimension,
    reason: QuestionNeed["reason"],
  ): boolean => {
    const status = statusOf(dimension);
    if (status === undefined) return false;
    // A vague settled answer may still get its one figure follow-up.
    if (status === "SETTLED" && reason === "NEEDS_SPECIFICS") return false;
    if (NEVER_ASKED_AGAIN.has(status)) return true;
    if (status === "DISAGREEMENT_OPEN" || status === "UNKNOWN")
      return (input.asksSince?.(dimension) ?? 0) >= 1;
    return false;
  };
  const answered = new Set(
    input.facts
      .filter((fact) => fact.supersededAt === null)
      .map((fact) => fact.dimension),
  );
  for (const entry of input.view?.dimensions ?? [])
    if (entry.status !== "UNANSWERED") answered.add(entry.dimension);
  for (const [dimension, covers] of Object.entries(COVERED_BY)) {
    if (covers?.some((covering) => answered.has(covering))) {
      answered.add(dimension as ApplicationDimension);
    }
  }
  // Live D3 (2026-11-14, Routeix): "we went from 6 to 18 operators" was on
  // record under traction, and Q still asked how many operators were live.
  // Traction with its figures already says how many are using it; the
  // customer count is not asked for again.
  const traction = input.facts.some(
    (fact) =>
      fact.dimension === "claims.traction" &&
      fact.supersededAt === null &&
      fact.value.kind !== "NONE",
  );
  if (traction && missingSpecifics("claims.traction", input.facts) === null)
    answered.add("company.customers");
  const needs: QuestionNeed[] = [];
  const seen = new Set<ApplicationDimension>();
  const parked = (dimension: ApplicationDimension): boolean =>
    (input.askedCounts?.get(dimension) ?? 0) >= MAX_ASKS_PER_DIMENSION;

  const add = (
    dimension: ApplicationDimension | undefined,
    reason: QuestionNeed["reason"],
    missing?: string,
  ): void => {
    if (dimension === undefined) return;
    if (seen.has(dimension)) return;
    if (parked(dimension)) return;
    if (settledByView(dimension, reason)) return;
    if (!APPLICATION_DIMENSIONS.includes(dimension)) return;
    seen.add(dimension);
    needs.push(
      missing === undefined
        ? { dimension, reason }
        : { dimension, reason, missing },
    );
  };

  const criterionById = new Map(
    input.policy.criteria.map(
      (criterion) => [criterion.id, criterion] as const,
    ),
  );

  // An open disagreement not yet put to them comes first: the founder is
  // the one who knows which is right (asked once, never pressed).
  for (const entry of input.view?.dimensions ?? [])
    if (entry.status === "DISAGREEMENT_OPEN")
      add(entry.dimension, "CONTRADICTION");

  // A required criterion nobody can answer yet is the most useful thing in
  // the conversation: it is the difference between an application that can
  // be assessed and one that cannot.
  for (const criterionId of input.qualification.unknowns) {
    const criterion = criterionById.get(criterionId);
    add(
      CRITERION_DIMENSION[criterion?.config.type ?? ""],
      "REQUIRED_BY_GATEWAY",
    );
  }

  // Then a preferred criterion, which informs a human without gating.
  for (const result of input.qualification.criteria) {
    if (result.requiredness !== "PREFERRED" || result.status !== "UNKNOWN") {
      continue;
    }
    const criterion = criterionById.get(result.criterionId);
    add(
      CRITERION_DIMENSION[criterion?.config.type ?? ""],
      "PREFERRED_BY_GATEWAY",
    );
  }

  // Then an answer that is on record but says nothing an investor can act
  // on. Asked next, while the founder still has the thread, and before new
  // topics: depth on what they raised beats breadth across what they did not.
  for (const dimension of QUANTITATIVE_DIMENSIONS) {
    const missing = missingSpecifics(dimension, input.facts);
    if (missing !== null) add(dimension, "NEEDS_SPECIFICS", missing);
  }

  // Then what this investor's own mandate emphasises, ahead of the general
  // order: two founders applying to two different funds should not be asked
  // the same things in the same order.
  for (const dimension of input.emphasis ?? []) {
    if (answered.has(dimension)) continue;
    add(dimension, "INVESTOR_EMPHASIS");
  }

  // Then what a partner would want to know, in the order they would want
  // it, skipping anything the applicant has already told us.
  for (const dimension of UNDERSTANDING_ORDER) {
    if (answered.has(dimension)) continue;
    add(dimension, "UNDERSTANDING");
  }

  return needs.slice(0, limit);
}

/**
 * Things that do not agree, stated without deciding between them.
 *
 * A contradiction is a question, not a verdict: the applicant is the one
 * who knows which is right. Contradictions coexist until somebody
 * reconciles them, and the somebody is a person.
 */
export function contradictionsIn(
  facts: readonly ApplicationFact[],
): readonly string[] {
  // Their own statements that disagree (Q's reading of the turn flagged it):
  // both are kept and shown, never one picked.
  return [...figureContradictions(facts), ...unreconciledStatements(facts)];
}

/**
 * The same, as the interviewer is shown them (live D3, 2026-11-14): Q put
 * "600 or about 1,500 weekly active?" to the founder, heard "I'm not sure
 * which is right", said it would leave it open, and asked it twice more.
 * A disagreement on a dimension Q has already asked about was put to them
 * when it was found; it is marked so, and it stays open without being
 * pressed. Nothing is resolved here: the founder settles it, or nobody.
 */
export function contradictionsForInterview(
  facts: readonly ApplicationFact[],
  askedCounts?: ReadonlyMap<ApplicationDimension, number>,
): readonly string[] {
  return [
    ...figureContradictions(facts),
    ...unreconciledPairs(facts).map((pair) =>
      (askedCounts?.get(pair.dimension as ApplicationDimension) ?? 0) > 0
        ? `${pair.line} (already asked; leave it open)`
        : pair.line,
    ),
  ];
}

export function figureContradictions(
  facts: readonly ApplicationFact[],
): readonly string[] {
  const out: string[] = [];
  const raise = facts.find(
    (fact) => fact.dimension === "raise.amount" && fact.supersededAt === null,
  );
  const revenue = facts.find(
    (fact) => fact.dimension === "claims.revenue" && fact.supersededAt === null,
  );
  // The one pair that is worth raising with a founder unprompted: a round
  // far smaller than the revenue it is supposedly needed for usually means
  // one of the two numbers means something else.
  if (
    raise?.value.kind === "AMOUNT" &&
    revenue?.value.kind === "AMOUNT" &&
    raise.value.currency === revenue.value.currency &&
    Number(revenue.value.amount) > Number(raise.value.amount)
  ) {
    out.push(
      "the stated revenue is larger than the raise; worth checking which period each figure covers",
    );
  }
  return out;
}
