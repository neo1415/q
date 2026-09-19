import type { FactorResult } from "../ranking/contracts.js";
import {
  EXPLANATION_VERSION,
  type ExplanationDimension,
  type ExplanationFactor,
  type ExplanationOutcome,
} from "./contracts.js";

/**
 * The deterministic half of an explanation (doc 19 §58): ranked factors in,
 * safe factors and plain English out. Pure — no database, no model, no
 * clock — so an explanation exists whether or not Q is reachable.
 *
 * Nothing here reads an internal score, a weight, a contribution or a
 * similarity. Those produced the ordering and stay behind it; what a
 * person is told is which declared criteria matched, which did not, and
 * what is still unknown.
 */

/** Which registry feature speaks for which dimension a person understands. */
const DIMENSION_BY_FEATURE: Readonly<Record<string, ExplanationDimension>> = {
  "declared_fit.stage": "STAGE",
  "declared_fit.geography": "GEOGRAPHY",
  "declared_fit.taxonomy": "TAXONOMY",
  "declared_fit.cheque": "CHEQUE",
  "semantic_fit.mandate_similarity": "SEMANTIC",
  // `eligibility.hard_gate` is deliberately absent. It is a gate, not a
  // dimension of fit: every item in a slate passed it, so restating it
  // would tell a reader nothing and invite reading a gate as a merit.
};

const OUTCOME_BY_REASON: Readonly<Record<string, ExplanationOutcome>> = {
  STAGE_ALIGNED: "MATCH",
  STAGE_MISMATCH: "MISMATCH",
  GEOGRAPHY_COUNTRY_ALIGNED: "MATCH",
  GEOGRAPHY_REGION_ALIGNED: "PARTIAL",
  GEOGRAPHY_MISMATCH: "MISMATCH",
  TAXONOMY_EXACT: "MATCH",
  TAXONOMY_RELATED: "PARTIAL",
  TAXONOMY_MISMATCH: "MISMATCH",
  SEMANTIC_SIMILARITY_PRESENT: "MATCH",
  FACTOR_MISSING: "UNKNOWN",
  FACTOR_NOT_APPLICABLE: "NOT_APPLICABLE",
};

/** The noun a person would use for the dimension. */
const NOUN: Readonly<Record<ExplanationDimension, string>> = {
  STAGE: "stage",
  GEOGRAPHY: "geography",
  TAXONOMY: "sector",
  SEMANTIC: "what the business does",
  CHEQUE: "cheque size",
};

const ALIGNED_LABEL: Readonly<Record<ExplanationDimension, string>> = {
  STAGE: "Stage matches the stage your mandate names",
  GEOGRAPHY: "Based in a country your mandate names",
  TAXONOMY: "Sector matches a sector your mandate names",
  SEMANTIC: "What the business does reads close to your mandate",
  CHEQUE: "Cheque size is compatible",
};

const PARTIAL_LABEL: Readonly<Record<ExplanationDimension, string>> = {
  STAGE: "Stage is adjacent to the stage your mandate names",
  GEOGRAPHY: "Based in a region your mandate names, not a named country",
  TAXONOMY: "Sector sits under a sector your mandate names, not an exact match",
  SEMANTIC: "What the business does is loosely related to your mandate",
  CHEQUE: "Cheque size is partly compatible",
};

const MISMATCH_LABEL: Readonly<Record<ExplanationDimension, string>> = {
  STAGE: "Stage is outside the stages your mandate names",
  GEOGRAPHY: "Based outside the geographies your mandate names",
  TAXONOMY: "Sector is not one your mandate names",
  SEMANTIC: "What the business does reads far from your mandate",
  CHEQUE: "Cheque size does not fit",
};

/**
 * Absence, said accurately. A missing feature is either something the
 * company has not declared or something the investor has not asked for,
 * and the two are different facts — neither of them a shortcoming.
 */
const MISSING_LABEL: Readonly<Record<string, string>> = {
  COMPANY_STAGE_UNKNOWN: "This company has not stated its stage",
  COMPANY_GEOGRAPHY_UNKNOWN: "This company has not stated where it is based",
  COMPANY_TAXONOMY_UNKNOWN: "This company has not declared a sector",
  NO_DECLARED_PREFERENCE: "Your mandate does not name one",
  UNRESTRICTED_PREFERENCE: "Your mandate is open on this",
  CHEQUE_NOT_COMPUTABLE: "Cheque compatibility is not available yet",
  SEMANTIC_NOT_RETRIEVED: "No description-level comparison was made",
  SOURCE_NOT_AUTHORISED: "Not available for this comparison",
};

function labelFor(
  dimension: ExplanationDimension,
  outcome: ExplanationOutcome,
  missingReason: string | null,
): string {
  switch (outcome) {
    case "MATCH":
      return ALIGNED_LABEL[dimension];
    case "PARTIAL":
      return PARTIAL_LABEL[dimension];
    case "MISMATCH":
      return MISMATCH_LABEL[dimension];
    case "UNKNOWN":
    case "NOT_APPLICABLE": {
      const because =
        missingReason === null ? undefined : MISSING_LABEL[missingReason];
      // Name the dimension either way, so a bare "not recorded" is never
      // left for a reader to attach to the wrong thing.
      return because === undefined
        ? `${capitalise(NOUN[dimension])} is not recorded`
        : `${capitalise(NOUN[dimension])}: ${lowerFirst(because)}`;
    }
  }
}

const capitalise = (text: string): string =>
  text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1);
const lowerFirst = (text: string): string =>
  text.length === 0 ? text : text[0]?.toLowerCase() + text.slice(1);

export type ExplanationBuckets = {
  readonly matchedFactors: readonly ExplanationFactor[];
  readonly mismatchedFactors: readonly ExplanationFactor[];
  readonly uncertainties: readonly ExplanationFactor[];
};

/**
 * Sort the ranker's factor results into the three buckets doc 19 §57 asks
 * for, in registry order. A factor whose feature is not a fit dimension is
 * omitted rather than described.
 */
export function toExplanationFactors(
  factors: readonly FactorResult[],
): ExplanationBuckets {
  const matchedFactors: ExplanationFactor[] = [];
  const mismatchedFactors: ExplanationFactor[] = [];
  const uncertainties: ExplanationFactor[] = [];

  for (const factor of factors) {
    const dimension = DIMENSION_BY_FEATURE[factor.featureId];
    if (dimension === undefined) continue;
    const outcome = OUTCOME_BY_REASON[factor.reasonCode];
    if (outcome === undefined) continue;
    const entry: ExplanationFactor = {
      dimension,
      outcome,
      label: labelFor(dimension, outcome, factor.missingReason),
      reasonCode: factor.reasonCode,
    };
    if (outcome === "MATCH" || outcome === "PARTIAL")
      matchedFactors.push(entry);
    else if (outcome === "MISMATCH") mismatchedFactors.push(entry);
    else uncertainties.push(entry);
  }
  return { matchedFactors, mismatchedFactors, uncertainties };
}

/** "a, b and c" — no Oxford comma, because a person would not use one here. */
function joinNouns(nouns: readonly string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? "";
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

const nounsOf = (factors: readonly ExplanationFactor[]): readonly string[] => [
  ...new Set(factors.map((f) => NOUN[f.dimension])),
];

/**
 * The explanation a person reads when no model is available (doc 19 §58).
 * Composed from the bucket nouns rather than written as one template, so a
 * new dimension changes a word and not a paragraph — and so it can never
 * assert something the factors do not carry.
 */
export function deterministicSummary(buckets: ExplanationBuckets): string {
  const { matchedFactors, mismatchedFactors, uncertainties } = buckets;
  const sentences: string[] = [];

  if (matchedFactors.length > 0) {
    const exact = matchedFactors.filter((f) => f.outcome === "MATCH");
    const partial = matchedFactors.filter((f) => f.outcome === "PARTIAL");
    if (exact.length > 0) {
      sentences.push(
        `${capitalise(joinNouns(nounsOf(exact)))} ${exact.length === 1 ? "matches" : "match"} what your mandate names.`,
      );
    }
    if (partial.length > 0) {
      sentences.push(
        `${capitalise(joinNouns(nounsOf(partial)))} ${partial.length === 1 ? "is" : "are"} related rather than an exact match.`,
      );
    }
  }
  if (mismatchedFactors.length > 0) {
    sentences.push(
      `${capitalise(joinNouns(nounsOf(mismatchedFactors)))} ${mismatchedFactors.length === 1 ? "does" : "do"} not match.`,
    );
  }
  if (uncertainties.length > 0) {
    // Said as "not established", never as a shortcoming: doc 19 §92.
    sentences.push(
      `${capitalise(joinNouns(nounsOf(uncertainties)))} ${uncertainties.length === 1 ? "is" : "are"} not established from the information used to rank.`,
    );
  }
  if (sentences.length === 0) {
    return "Nothing in your declared mandate could be compared with this company yet.";
  }
  return sentences.join(" ");
}

/** The version string a reader-facing explanation carries (doc 19 §57). */
export function rankingVersionLabel(input: {
  readonly rankerVersion: string;
  readonly rankingConfigVersion: string;
}): string {
  return `${input.rankerVersion}/${input.rankingConfigVersion}`;
}

export { EXPLANATION_VERSION };
