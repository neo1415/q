import { samePeriod, type KnowledgePeriod } from "./temporal.js";

/**
 * Whether two understandings actually disagree (CQ-KNW-003 §11-§14).
 *
 * The rule this file exists to avoid is `a !== b → contradiction`. Applied
 * to a company's own numbers that rule reports growth as a discrepancy, a
 * forecast as a lie, a currency as an error and a corrected typo as a
 * decline — and every one of those reaches a founder as an accusation.
 *
 * So difference is examined along the axes that make two numbers legitimately
 * different before it is ever called a conflict:
 *
 *   period       January ARR and August ARR are both true
 *   definition   gross ARR and ARR net of churn are both true
 *   basis        a forecast of 4m and an actual of 2m are both true
 *   metric       FY revenue and current ARR are different questions
 *   currency     100m naira and 65k dollars may be the same money
 *
 * Only when every axis matches and the values still differ is there
 * something for a person to reconcile.
 */

export type MeasurementBasis =
  "ACTUAL" | "FORECAST" | "ESTIMATE" | "UNSPECIFIED";

export type ComparableKnowledge = KnowledgePeriod & {
  readonly knowledgeKey: string;
  readonly definitionQualifier: string | null;
  readonly measurementBasis: MeasurementBasis;
  readonly structuredValue: Record<string, unknown> | null;
};

export const COMPATIBILITY_VERDICTS = [
  /** The same question, the same answer. */
  "SAME",
  /** Different questions. Nothing to reconcile. */
  "DIFFERENT_SUBJECT_MATTER",
  /** The same question asked of different periods. A series, not a conflict. */
  "DIFFERENT_PERIOD",
  /** The same metric measured two defensible ways. Both may stand. */
  "ACCEPTED_DIFFERENCE",
  /** One is a projection. A projection is not a competing measurement. */
  "DIFFERENT_BASIS",
  /** Same question, incompatible answers. */
  "CONTRADICTION",
  /** Same question, and no basis on which to compare the answers. */
  "INCOMPARABLE",
] as const;
export type CompatibilityVerdict = (typeof COMPATIBILITY_VERDICTS)[number];

export type CompatibilityResult = {
  readonly verdict: CompatibilityVerdict;
  /** The axis that decided. Auditable, and never a private value. */
  readonly reason:
    | "IDENTICAL_VALUE"
    | "DIFFERENT_KNOWLEDGE_KEY"
    | "PERIODS_DO_NOT_MATCH"
    | "DIFFERENT_DEFINITION"
    | "FORECAST_VERSUS_ACTUAL"
    | "DIFFERENT_CURRENCY"
    | "DIFFERENT_VALUE_KIND"
    | "VALUE_MISMATCH"
    | "VALUE_ABSENT";
  /** For a contradiction, what kind. Null otherwise. */
  readonly conflictKind:
    "VALUE_MISMATCH" | "UNIT_MISMATCH" | "CURRENCY_MISMATCH" | null;
};

const verdict = (
  value: CompatibilityVerdict,
  reason: CompatibilityResult["reason"],
  conflictKind: CompatibilityResult["conflictKind"] = null,
): CompatibilityResult => ({ verdict: value, reason, conflictKind });

/**
 * Compares two understandings along every axis, in order of how completely
 * each one settles the question.
 *
 * The order is deliberate. A different metric ends the comparison outright:
 * FY2025 revenue and current ARR are not a discrepancy however far apart the
 * numbers are, so there is nothing further to examine. Period comes next,
 * then definition, then basis — each one a complete explanation of the
 * difference. Only what survives all four is compared by value.
 */
export function compareKnowledge(
  a: ComparableKnowledge,
  b: ComparableKnowledge,
): CompatibilityResult {
  // Different questions (§41). Revenue is not ARR; a headcount is not a
  // churn rate. Values are not even commensurable.
  if (a.knowledgeKey !== b.knowledgeKey) {
    return verdict("DIFFERENT_SUBJECT_MATTER", "DIFFERENT_KNOWLEDGE_KEY");
  }

  // Different stretches of time (§40). January and August ARR are a series.
  if (!samePeriod(a, b)) {
    return verdict("DIFFERENT_PERIOD", "PERIODS_DO_NOT_MATCH");
  }

  // Different definitions of the same metric (§13). Gross ARR and ARR net of
  // churn are both correct, and forcing one to supersede the other destroys
  // information the subject deliberately reported twice.
  if ((a.definitionQualifier ?? null) !== (b.definitionQualifier ?? null)) {
    return verdict("ACCEPTED_DIFFERENCE", "DIFFERENT_DEFINITION");
  }

  // A projection against a measurement (§42). These answer different
  // questions about the same period and are routinely both stated.
  if (a.measurementBasis !== b.measurementBasis) {
    return verdict("DIFFERENT_BASIS", "FORECAST_VERSUS_ACTUAL");
  }

  // Same question, so the answers must now be comparable.
  const left = a.structuredValue;
  const right = b.structuredValue;
  if (left === null || right === null) {
    // One side carries no typed value. Nothing can be shown to disagree,
    // and asserting a conflict from prose alone would be a guess.
    return left === right
      ? verdict("SAME", "IDENTICAL_VALUE")
      : verdict("INCOMPARABLE", "VALUE_ABSENT");
  }
  if (left["kind"] !== right["kind"]) {
    // A count against an amount of money. Neither is wrong; they are not
    // the same kind of answer, and no conversion exists between them.
    return verdict("INCOMPARABLE", "DIFFERENT_VALUE_KIND", "UNIT_MISMATCH");
  }

  if (left["kind"] === "MONEY") {
    if (left["currency"] !== right["currency"]) {
      // 100m naira and 65k dollars may be exactly the same money (§43).
      // Without a trusted, dated conversion basis this cannot be decided,
      // and inventing an FX rate to decide it would manufacture a fact.
      // Both readings are kept, each with its own currency.
      return verdict("INCOMPARABLE", "DIFFERENT_CURRENCY", "CURRENCY_MISMATCH");
    }
    return left["amount"] === right["amount"]
      ? verdict("SAME", "IDENTICAL_VALUE")
      : verdict("CONTRADICTION", "VALUE_MISMATCH", "VALUE_MISMATCH");
  }

  return left["value"] === right["value"]
    ? verdict("SAME", "IDENTICAL_VALUE")
    : verdict("CONTRADICTION", "VALUE_MISMATCH", "VALUE_MISMATCH");
}

/**
 * Whether a recorded disagreement warrants interrupting a person (§14).
 *
 * This repository has no calibrated materiality methodology, and inventing
 * one — "more than 5% is material" — would put a number nobody can defend in
 * front of a founder as though it had been measured. So the honest answer is
 * usually UNDETERMINED, and a person decides.
 *
 * Two things ARE decidable without a methodology, and only two:
 *
 *   a value that cannot be compared at all is not a discrepancy to size;
 *   two identical numbers are not a discrepancy at all.
 *
 * When a calibrated policy exists this function is where it goes, and its
 * version belongs beside it.
 */
export function classifyMateriality(
  result: CompatibilityResult,
): "MATERIAL" | "IMMATERIAL" | "UNDETERMINED" {
  if (result.verdict === "SAME") {
    return "IMMATERIAL";
  }
  if (result.verdict !== "CONTRADICTION") {
    return "IMMATERIAL";
  }
  // A genuine, comparable, same-period disagreement about the same metric.
  // Whether it matters is a business judgement this packet does not have the
  // methodology to make, and pretending otherwise is the failure mode.
  return "UNDETERMINED";
}
