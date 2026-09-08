import type {
  MandateConstraintDimension,
  MandatePreferenceClass,
} from "@capital-q/contracts";
import type { MandateDimension, MandateStrength } from "@capital-q/q-core";

/**
 * What a model's reading of an investor's words is allowed to become
 * (CQ-Q-022 §18-§20, §30, §36).
 *
 * One rule governs this whole file, and everything else follows from it:
 *
 *   HARD_EXCLUSION is unreachable from a model's output.
 *
 * Not discouraged, not gated by a flag a caller could pass — unreachable.
 * `preferenceClassFor` has no branch that returns it, and the only function
 * that does requires a confirmation the investor gave. A hard exclusion
 * makes candidates ineligible; that consequence belongs to a person who
 * chose it, not to a model that read "we don't really do hardware" firmly.
 *
 * The distinctions this preserves, none of which may collapse:
 *
 *   preference ≠ avoid ≠ hard exclusion
 *   a model's reading ≠ the investor's decision
 *   declared ≠ inferred ≠ observed
 */

/**
 * The strongest class a model's reading may produce.
 *
 * `EXCLUSION_CLAIMED` — the model's judgement that the investor asked for
 * an exclusion — maps to AVOID, not HARD_EXCLUSION. Both are negatives, so
 * nothing is lost while it waits: an unconfirmed exclusion still ranks the
 * candidate down, it simply does not make it ineligible.
 */
export function preferenceClassFor(
  strength: MandateStrength,
): Exclude<MandatePreferenceClass, "HARD_EXCLUSION" | "MUST"> {
  switch (strength) {
    case "EXCLUSION_CLAIMED":
      // The investor may well have meant exactly this. Until they say so,
      // it is the strongest negative that is not an eligibility rule.
      return "AVOID";
    case "AVOID":
      return "AVOID";
    case "STRONG":
      return "STRONG";
    case "PREFERENCE":
      return "NICE";
  }
}

/** True when a reading is a candidate for confirmation as an exclusion (§20). */
export function proposesExclusion(strength: MandateStrength): boolean {
  return strength === "EXCLUSION_CLAIMED";
}

/**
 * A confirmed hard exclusion.
 *
 * The only route to HARD_EXCLUSION anywhere in this package, and it takes
 * the investor's confirmation as an argument rather than a default: a
 * caller cannot reach it by forgetting a flag.
 */
export function confirmedExclusionClass(input: {
  readonly confirmedByInvestor: true;
}): MandatePreferenceClass {
  void input;
  return "HARD_EXCLUSION";
}

/**
 * Where a synthesised dimension lands among the canonical constraint
 * dimensions (§42).
 *
 * The target set is a closed allowlist of investment-relevant dimensions,
 * so a dimension with no mapping produces no constraint rather than a
 * `custom.text` catch-all: silently filing something Capital Q cannot use
 * for matching, as though it could, is worse than leaving it in the raw
 * narrative where a person will read it.
 */
const DIMENSION_TO_CONSTRAINT: Readonly<
  Partial<Record<MandateDimension, MandateConstraintDimension>>
> = {
  stages: "stage",
  geography: "geography.country",
  sectors: "sector",
  sectors_avoid: "sector",
  business_models: "business.attribute",
  customer_types: "business.attribute",
  capital_intensity: "business.attribute",
  regulatory_appetite: "business.attribute",
  revenue_state: "business.attribute",
  founder_preferences: "founder.business_attribute",
  green_flags: "green_flag",
  hard_exclusions: "red_flag",
  investment_role: "investment_role",
  custom_criteria: "custom.text",
};

export function constraintDimensionFor(
  dimension: MandateDimension,
): MandateConstraintDimension | null {
  return DIMENSION_TO_CONSTRAINT[dimension] ?? null;
}

/**
 * Dimensions that are mandate columns rather than constraints: the cheque
 * band, the currency, the stage envelope and the discovery mode. A
 * candidate for one of these is offered for confirmation the same way, but
 * it does not become a constraint row.
 */
const COLUMN_DIMENSIONS: ReadonlySet<MandateDimension> =
  new Set<MandateDimension>([
    "cheque_min",
    "cheque_typical",
    "cheque_max",
    "currency",
    "discovery_mode",
    "inbound_preference",
  ]);

export function isColumnDimension(dimension: MandateDimension): boolean {
  return COLUMN_DIMENSIONS.has(dimension);
}

/**
 * Dimensions whose value is a canonical taxonomy node rather than a code
 * the investor typed (§41).
 *
 * These never take a raw phrase as a constraint value. The investor's own
 * words are preserved separately; what becomes a matching criterion is a
 * node id Capital Q's own service resolved, because companies are
 * classified with those same ids and free strings would never match them.
 */
export function requiresTaxonomyMapping(dimension: MandateDimension): boolean {
  return dimension === "sectors" || dimension === "sectors_avoid";
}

/**
 * Wording that asks Capital Q to screen on a protected or irrelevant
 * personal characteristic (§16, §36).
 *
 * A second line of defence, not the first: the canonical dimension
 * allowlist has no column such a criterion could occupy, so this cannot be
 * the thing standing between a request and a discriminatory constraint.
 * What it does is let Capital Q notice and say so plainly, rather than have
 * the request disappear without explanation.
 *
 * Deliberately narrow. It matches requests to screen *by* a characteristic,
 * not every mention of a word: "we back female founders through our
 * diversity fund" is a legitimate thing an investor may say to a person,
 * and a filter that flagged the noun alone would be both wrong and
 * insulting.
 */
const PROTECTED_SCREENING_PATTERNS: readonly RegExp[] = [
  /\b(?:only|exclusively|prefer|no|never|avoid|exclude)\b[^.]{0,40}\b(?:white|black|asian|hispanic|latino|caucasian|african[- ]american)\b/i,
  /\b(?:only|exclusively|prefer|no|never|avoid|exclude)\b[^.]{0,40}\b(?:muslim|christian|jewish|hindu|buddhist|catholic|religio\w*)\b/i,
  /\b(?:only|exclusively|prefer|no|never|avoid|exclude)\b[^.]{0,40}\b(?:male|female|men|women|gay|lesbian|straight|transgender)\s+founders?\b/i,
  /\b(?:only|exclusively|prefer|no|never|avoid|exclude)\b[^.]{0,40}\b(?:under|over)\s*\d{2}\s*(?:years old|yo\b)/i,
  /\bfounders?\s+(?:must|should)\s+be\s+(?:male|female|white|black|christian|muslim|under|over)\b/i,
  /\b(?:no|never|avoid|exclude)\s+(?:disabled|immigrant|foreign)\s+founders?\b/i,
];

export function requestsProtectedScreening(text: string): boolean {
  return PROTECTED_SCREENING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * What Capital Q says when it will not screen on something.
 *
 * Plain, brief, and not an accusation: an investor may have phrased a
 * legitimate thought carelessly, and the response is a statement about what
 * Capital Q does rather than a judgement about them.
 */
export const PROTECTED_SCREENING_MESSAGE =
  "Capital Q matches on business and experience criteria, so it can't use that as part of your mandate. Anything about the company, the market or what the team has actually done is fair game.";
