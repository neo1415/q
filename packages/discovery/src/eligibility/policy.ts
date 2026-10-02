import { reapproachAfterPass } from "@capital-q/network";

import {
  ELIGIBILITY_CRITERIA,
  ELIGIBILITY_POLICY_VERSION,
  type CriterionResult,
  type EligibilityCriterion,
  type EligibilityDecision,
  type EligibilityReasonCode,
  type EligibilityResult,
  type RecommendationMode,
} from "./contracts.js";
import type {
  ActiveMandateLookup,
  CompanyClassification,
  CompanyEligibilityFacts,
  MandateHardConstraint,
  MandateSnapshotForEligibility,
  MandateTaxonomyRule,
  RelationshipStanding,
} from "./ports.js";

/**
 * Eligibility policy v3. Pure: snapshots in, decision out. Nothing here
 * reads a database, calls a model, looks at a clock or knows what anybody
 * browsed, said to Q, uploaded or was found about on the public web.
 *
 * Decision rule, in this order of precedence:
 *
 *   any criterion FAIL          → INELIGIBLE   (an explicit hard rule is violated)
 *   else any gate UNKNOWN       → UNDETERMINED (mandate or relationship unclear)
 *   else                        → ELIGIBLE     (hard exclusions it could not
 *                                               check stay UNKNOWN on the result)
 *
 * A FAIL stands even when something else is unknown: a closed company is
 * ineligible whether or not its stage is known. An UNKNOWN never becomes a
 * FAIL: missing data lowers certainty, it never means "poor company". And
 * since v3 (ADR 0020) an UNKNOWN hard *exclusion* never withholds either:
 * an exclusion removes a company only on positive evidence that it matches,
 * so a rule that could not be checked is reported, not silently applied.
 *
 * Hard rules come from exactly two declared places (doc 19 §13, §15;
 * investors module): a mandate constraint with importance HARD_EXCLUSION,
 * and a taxonomy preference with `isExclusion`. MUST is a strong preference
 * and AVOID is a soft negative; neither is evaluated here. Nothing observed
 * and nothing Q proposed can reach either place, and a taxonomy exclusion
 * is honoured only when its provenance is a person's own selection.
 *
 * The same holds for the company side (v2): only a declared classification
 * says what a company is. A Q inference, an extracted suggestion or an
 * integration row on an excluded node is a candidate awaiting confirmation
 * (ADR 0006 point 5), so it neither excludes the company nor answers the
 * question; a company with nothing declared in that vocabulary is UNKNOWN.
 */

/**
 * Provenance a taxonomy row must carry to count as declared, on either
 * side of a hard exclusion. A `q_inferred` or `document_extracted` mandate
 * row cannot hard-exclude even if it were ever persisted with
 * `isExclusion`, and a company classification with such a source cannot
 * be hard-excluded by one (DECLARED ≠ Q_PROPOSED).
 */
export const DECLARED_TAXONOMY_SOURCES = [
  "user_selected",
  "admin_curated",
] as const;

/** Constraint dimensions with a canonical company counterpart this policy can read. */
const STAGE_DIMENSION = "stage";
const GEOGRAPHY_DIMENSION = "geography.country";

/**
 * Relationship states the Network context defines as removing the pair
 * from standard discovery. Nothing is inferred from Discover's Pass,
 * silence or disinterest.
 *
 * PASSED (relationship-state.v2, 2026-10-02): the investor decided after
 * engaging not to proceed. It is closed until a material change reopens
 * it (founder decision (b), doc 19 §67; reapproachAfterPass). No policy
 * version bump: no relationship could be PASSED before v2, so no earlier
 * evaluation reads differently; before it, every state past DISCOVERED was
 * already UNKNOWN and so never rankable.
 */
export const RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY: readonly string[] = [
  "PASSED",
];

/** Relationship states this policy understands as open. */
const RELATIONSHIP_STATES_OPEN: readonly string[] = ["DISCOVERED"];

export const DISCOVERABLE_VISIBILITIES: readonly string[] = [
  "network_visible",
  "public_external",
];

export type EligibilityEvaluationInput = {
  readonly mode: RecommendationMode;
  readonly investorOrganisationId: string;
  readonly mandate: ActiveMandateLookup;
  readonly company: CompanyEligibilityFacts;
  /**
   * ACTIVE classifications of the company, every provenance; empty when
   * nobody has classified it. The policy reads the declared ones only.
   */
  readonly classifications: readonly CompanyClassification[];
  /** The disclosure evaluator's answer for the acting investor. */
  readonly permittedToView: boolean;
  readonly relationship: RelationshipStanding;
  readonly taxonomyVersion: Readonly<Record<string, number>> | null;
  readonly evaluatedAt: string;
};

function result(
  criterion: EligibilityCriterion,
  outcome: "PASS" | "NOT_APPLICABLE",
): CriterionResult;
function result(
  criterion: EligibilityCriterion,
  outcome: "FAIL" | "UNKNOWN",
  reasonCode: EligibilityReasonCode,
  detail?: string,
): CriterionResult;
function result(
  criterion: EligibilityCriterion,
  outcome: CriterionResult["outcome"],
  reasonCode: EligibilityReasonCode | null = null,
  detail: string | null = null,
): CriterionResult {
  return { criterion, outcome, reasonCode, detail };
}

/**
 * For a HARD_EXCLUSION constraint the operator describes the excluded set:
 * EQ/IN exclude the listed codes ("never show gambling"); NEQ/NOT_IN exclude
 * everything outside them ("seed only"). GTE/LTE/BETWEEN never apply to a
 * codes value and are ignored rather than guessed at.
 */
function excludedByCodes(
  constraint: MandateHardConstraint,
  companyCode: string,
): boolean | null {
  if (constraint.value.kind !== "codes") return null;
  const listed = constraint.value.values.includes(companyCode);
  switch (constraint.operator) {
    case "EQ":
    case "IN":
      return listed;
    case "NEQ":
    case "NOT_IN":
      return !listed;
    case "GTE":
    case "LTE":
    case "BETWEEN":
      return null;
  }
}

function hardConstraints(
  mandate: MandateSnapshotForEligibility,
  dimension: string,
): readonly MandateHardConstraint[] {
  return mandate.constraints.filter(
    (c) =>
      c.dimension === dimension &&
      c.isHardExclusion &&
      c.importance === "HARD_EXCLUSION" &&
      c.automatedUse === "ELIGIBLE",
  );
}

function codeCriterion(
  criterion: EligibilityCriterion,
  constraints: readonly MandateHardConstraint[],
  companyCode: string | null,
  unknownReason: EligibilityReasonCode,
  failReason: EligibilityReasonCode,
): CriterionResult {
  const applicable = constraints.filter((c) => c.value.kind === "codes");
  if (applicable.length === 0) return result(criterion, "NOT_APPLICABLE");
  if (companyCode === null) return result(criterion, "UNKNOWN", unknownReason);
  const excluded = applicable.some(
    (c) => excludedByCodes(c, companyCode) === true,
  );
  return excluded
    ? result(criterion, "FAIL", failReason)
    : result(criterion, "PASS");
}

function declaredExclusions(
  mandate: MandateSnapshotForEligibility,
): readonly MandateTaxonomyRule[] {
  return mandate.taxonomyPreferences.filter(
    (p) =>
      p.isExclusion &&
      p.preferenceStrength === "HARD_EXCLUSION" &&
      (DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(p.source),
  );
}

function taxonomyCriterion(
  mandate: MandateSnapshotForEligibility,
  classifications: readonly CompanyClassification[],
): CriterionResult {
  const exclusions = declaredExclusions(mandate);
  if (exclusions.length === 0) {
    return result("HARD_EXCLUSION_TAXONOMY", "NOT_APPLICABLE");
  }
  const declared = classifications.filter((c) =>
    (DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(c.source),
  );
  const carried = new Set(declared.map((c) => c.nodeId));
  if (exclusions.some((e) => carried.has(e.nodeId))) {
    return result("HARD_EXCLUSION_TAXONOMY", "FAIL", "EXPLICIT_HARD_EXCLUSION");
  }
  // A company classified in the excluded node's vocabulary, under another
  // node, has said what it is. One with nothing declared in that
  // vocabulary has not, and silence is not "not gambling" — nor is Q's
  // guess, either way.
  const vocabulariesKnown = new Set(declared.map((c) => c.vocabularyCode));
  const unanswered = exclusions.some(
    (e) => !vocabulariesKnown.has(e.vocabularyCode),
  );
  return unanswered
    ? result("HARD_EXCLUSION_TAXONOMY", "UNKNOWN", "COMPANY_TAXONOMY_UNKNOWN")
    : result("HARD_EXCLUSION_TAXONOMY", "PASS");
}

/**
 * Hard exclusions declared on dimensions that no canonical company field
 * answers in V1 (red flags, business attributes, founder attributes,
 * declared sector codes, investment role). The rule is real and the fact is
 * missing, so the honest outcome is UNKNOWN — not a silent pass, not an
 * exclusion (ADR 0020), and never a fill-in from a document, a memory or a
 * model.
 */
function otherHardCriterion(
  mandate: MandateSnapshotForEligibility,
): CriterionResult {
  const [first] = unverifiableHardExclusions(mandate);
  if (first === undefined) {
    return result("HARD_EXCLUSION_OTHER", "NOT_APPLICABLE");
  }
  return result(
    "HARD_EXCLUSION_OTHER",
    "UNKNOWN",
    "HARD_CRITERION_NOT_EVALUABLE",
    first,
  );
}

function relationshipCriterion(
  standing: RelationshipStanding,
  mandate: ActiveMandateLookup,
): CriterionResult {
  if (standing.kind === "NONE") return result("RELATIONSHIP_STANDING", "PASS");
  if (standing.currentState === "PASSED" && standing.pass !== undefined) {
    const reopened = reapproachAfterPass(standing.pass.standing, {
      mandate:
        mandate.kind === "FOUND" && mandate.mandate.status === "ACTIVE"
          ? {
              mandateId: mandate.mandate.mandateId,
              version: mandate.mandate.version,
            }
          : null,
      latestPitchReadyAt: standing.pass.latestPitchReadyAt,
      latestCapitalObjectiveAt: standing.pass.latestCapitalObjectiveAt,
    });
    if (reopened !== null) return result("RELATIONSHIP_STANDING", "PASS");
  }
  if (RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY.includes(standing.currentState)) {
    return result("RELATIONSHIP_STANDING", "FAIL", "RELATIONSHIP_CLOSED");
  }
  if (RELATIONSHIP_STATES_OPEN.includes(standing.currentState)) {
    return result("RELATIONSHIP_STANDING", "PASS");
  }
  // A state this policy version does not know is not silently open.
  return result(
    "RELATIONSHIP_STANDING",
    "UNKNOWN",
    "RELATIONSHIP_STATE_UNKNOWN",
    standing.currentState,
  );
}

/**
 * Declared hard exclusions. Their UNKNOWN means "could not be checked", and
 * an unchecked exclusion never withholds (ADR 0020): it is reported through
 * `unverifiedExclusions` instead.
 */
export const HARD_EXCLUSION_CRITERIA: readonly EligibilityCriterion[] = [
  "HARD_EXCLUSION_TAXONOMY",
  "HARD_EXCLUSION_STAGE",
  "HARD_EXCLUSION_GEOGRAPHY",
  "HARD_EXCLUSION_OTHER",
];

/** The rule code a person recognises for each company-answerable exclusion. */
const EXCLUSION_RULE_CODE: Readonly<
  Partial<Record<EligibilityCriterion, string>>
> = {
  HARD_EXCLUSION_TAXONOMY: "taxonomy",
  HARD_EXCLUSION_STAGE: STAGE_DIMENSION,
  HARD_EXCLUSION_GEOGRAPHY: GEOGRAPHY_DIMENSION,
};

function decide(criteria: readonly CriterionResult[]): EligibilityDecision {
  if (criteria.some((c) => c.outcome === "FAIL")) return "INELIGIBLE";
  if (
    criteria.some(
      (c) =>
        c.outcome === "UNKNOWN" &&
        !HARD_EXCLUSION_CRITERIA.includes(c.criterion),
    )
  ) {
    return "UNDETERMINED";
  }
  return "ELIGIBLE";
}

/**
 * The declared exclusions this company's own facts could not answer (its
 * stage, country or sector is not stated), as rule codes. Per company, so
 * a card can say so. Exclusions on dimensions V1 cannot evaluate for any
 * company are `unverifiableHardExclusions`, reported once per slate.
 */
export function unverifiedExclusions(result: EligibilityResult): string[] {
  const out: string[] = [];
  for (const c of result.criteria) {
    const code = EXCLUSION_RULE_CODE[c.criterion];
    if (c.outcome === "UNKNOWN" && code !== undefined) out.push(code);
  }
  return out;
}

/** The rule codes of every declared exclusion that removed this company. */
export function excludingRules(result: EligibilityResult): string[] {
  const out: string[] = [];
  for (const c of result.criteria) {
    if (
      c.outcome !== "FAIL" ||
      !HARD_EXCLUSION_CRITERIA.includes(c.criterion)
    ) {
      continue;
    }
    const code = EXCLUSION_RULE_CODE[c.criterion] ?? c.detail;
    if (code !== undefined && code !== null) out.push(code);
  }
  return out;
}

/**
 * Hard exclusions declared on dimensions no canonical company field answers
 * in V1, distinct and sorted: the same for every company, so said once per
 * slate rather than on every card.
 */
export function unverifiableHardExclusions(
  mandate: MandateSnapshotForEligibility,
): string[] {
  return [
    ...new Set(
      mandate.constraints
        .filter(
          (c) =>
            c.isHardExclusion &&
            c.importance === "HARD_EXCLUSION" &&
            c.automatedUse === "ELIGIBLE" &&
            c.dimension !== STAGE_DIMENSION &&
            c.dimension !== GEOGRAPHY_DIMENSION,
        )
        .map((c) => c.dimension),
    ),
  ].sort();
}

/** Every declared hard exclusion on the mandate, as rule codes, distinct and sorted. */
export function declaredHardExclusions(
  mandate: MandateSnapshotForEligibility,
): string[] {
  const codes = new Set<string>(
    mandate.constraints
      .filter(
        (c) =>
          c.isHardExclusion &&
          c.importance === "HARD_EXCLUSION" &&
          c.automatedUse === "ELIGIBLE",
      )
      .map((c) => c.dimension),
  );
  if (declaredExclusions(mandate).length > 0) codes.add("taxonomy");
  return [...codes].sort();
}

export function evaluateHardEligibility(
  input: EligibilityEvaluationInput,
): EligibilityResult {
  const { company, mandate } = input;
  const byCriterion = new Map<EligibilityCriterion, CriterionResult>();
  const put = (r: CriterionResult) => byCriterion.set(r.criterion, r);

  put(
    company.companyStatus === "active"
      ? result("COMPANY_ACTIVE", "PASS")
      : result("COMPANY_ACTIVE", "FAIL", "COMPANY_NOT_ACTIVE"),
  );
  put(
    company.marketplaceParticipation === "ELIGIBLE"
      ? result("MARKETPLACE_PARTICIPATION", "PASS")
      : result(
          "MARKETPLACE_PARTICIPATION",
          "FAIL",
          "COMPANY_NOT_MARKETPLACE_ELIGIBLE",
        ),
  );
  put(
    company.organisationId === input.investorOrganisationId
      ? result("COUNTERPART_DISTINCT", "FAIL", "COMPANY_IS_INVESTORS_OWN")
      : result("COUNTERPART_DISTINCT", "PASS"),
  );
  // Both halves are required: the declared network classification, and the
  // disclosure evaluator agreeing for this actor. Being allowed to see one's
  // own private company is not discoverability.
  put(
    DISCOVERABLE_VISIBILITIES.includes(company.marketplaceVisibility) &&
      input.permittedToView
      ? result("INVESTOR_DISCOVERABILITY", "PASS")
      : result(
          "INVESTOR_DISCOVERABILITY",
          "FAIL",
          "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
        ),
  );

  const active =
    mandate.kind === "FOUND" && mandate.mandate.status === "ACTIVE"
      ? mandate.mandate
      : null;
  if (active === null) {
    const reason: EligibilityReasonCode =
      mandate.kind === "AMBIGUOUS"
        ? "ACTIVE_MANDATE_AMBIGUOUS"
        : mandate.kind === "FOUND"
          ? "MANDATE_NOT_ACTIVE"
          : "NO_ACTIVE_MANDATE";
    put(result("ACTIVE_MANDATE", "UNKNOWN", reason));
    // Without an ACTIVE mandate no declared rule exists to apply; a DRAFT's
    // exclusions are not read, and a stale CLOSED mandate is history.
    for (const criterion of [
      "HARD_EXCLUSION_TAXONOMY",
      "HARD_EXCLUSION_STAGE",
      "HARD_EXCLUSION_GEOGRAPHY",
      "HARD_EXCLUSION_OTHER",
    ] as const) {
      put(result(criterion, "NOT_APPLICABLE"));
    }
  } else {
    put(result("ACTIVE_MANDATE", "PASS"));
    put(taxonomyCriterion(active, input.classifications));
    put(
      codeCriterion(
        "HARD_EXCLUSION_STAGE",
        hardConstraints(active, STAGE_DIMENSION),
        company.currentStageCode,
        "COMPANY_STAGE_UNKNOWN",
        "STAGE_OUTSIDE_HARD_MANDATE",
      ),
    );
    put(
      codeCriterion(
        "HARD_EXCLUSION_GEOGRAPHY",
        hardConstraints(active, GEOGRAPHY_DIMENSION),
        company.headquartersCountry,
        "COMPANY_GEOGRAPHY_UNKNOWN",
        "GEOGRAPHY_OUTSIDE_HARD_MANDATE",
      ),
    );
    put(otherHardCriterion(active));
  }

  // Cheque compatibility is a fit factor (REC-002+), never a hard gate in
  // this policy. The mandate's cheque range carries no importance and only
  // HARD_EXCLUSION makes a company ineligible; and an investor whose
  // maximum cheque is below a company's total round may still fund part
  // of it. No canonical field says what ticket a company seeks, so no rule
  // is invented.
  put(result("CHEQUE_COMPATIBILITY", "NOT_APPLICABLE"));
  put(relationshipCriterion(input.relationship, mandate));

  const criteria = ELIGIBILITY_CRITERIA.map((criterion) => {
    const found = byCriterion.get(criterion);
    if (found === undefined) {
      throw new Error(`eligibility policy did not evaluate ${criterion}`);
    }
    return found;
  });
  const reasonCodes = [
    ...new Set(
      criteria.flatMap((c) => (c.reasonCode === null ? [] : [c.reasonCode])),
    ),
  ].sort();

  return {
    eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
    mode: input.mode,
    companyId: company.companyId,
    investorOrganisationId: input.investorOrganisationId,
    mandateId: active?.mandateId ?? null,
    mandateVersion: active?.version ?? null,
    taxonomyVersion: input.taxonomyVersion,
    decision: decide(criteria),
    reasonCodes,
    criteria,
    evaluatedAt: input.evaluatedAt,
  };
}
