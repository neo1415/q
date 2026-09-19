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
 * Eligibility policy v2. Pure: snapshots in, decision out. Nothing here
 * reads a database, calls a model, looks at a clock or knows what anybody
 * browsed, said to Q, uploaded or was found about on the public web.
 *
 * Decision rule, in this order of precedence:
 *
 *   any criterion FAIL     → INELIGIBLE   (an explicit hard rule is violated)
 *   else any UNKNOWN       → UNDETERMINED (a hard rule exists, the fact does not)
 *   else                   → ELIGIBLE
 *
 * A FAIL stands even when something else is unknown: a closed company is
 * ineligible whether or not its stage is known. An UNKNOWN never becomes a
 * FAIL: missing data lowers certainty, it never means "poor company".
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
 * from standard discovery. Empty so far: the projector (CQ-NET-012) has
 * defined only DISCOVERED so far, and nothing is inferred from Pass,
 * silence or disinterest. When Network defines an intentionally closed or
 * blocked state, it is added here and the policy version is bumped.
 */
export const RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY: readonly string[] = [];

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
 * missing, so the honest outcome is UNKNOWN — not a silent pass, and never
 * a fill-in from a document, a memory or a model.
 */
function otherHardCriterion(
  mandate: MandateSnapshotForEligibility,
): CriterionResult {
  const other = mandate.constraints.filter(
    (c) =>
      c.isHardExclusion &&
      c.importance === "HARD_EXCLUSION" &&
      c.automatedUse === "ELIGIBLE" &&
      c.dimension !== STAGE_DIMENSION &&
      c.dimension !== GEOGRAPHY_DIMENSION,
  );
  if (other.length === 0)
    return result("HARD_EXCLUSION_OTHER", "NOT_APPLICABLE");
  const [first] = [...other].sort((a, b) =>
    a.dimension.localeCompare(b.dimension),
  );
  return result(
    "HARD_EXCLUSION_OTHER",
    "UNKNOWN",
    "HARD_CRITERION_NOT_EVALUABLE",
    first?.dimension,
  );
}

function relationshipCriterion(
  standing: RelationshipStanding,
): CriterionResult {
  if (standing.kind === "NONE") return result("RELATIONSHIP_STANDING", "PASS");
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

function decide(criteria: readonly CriterionResult[]): EligibilityDecision {
  if (criteria.some((c) => c.outcome === "FAIL")) return "INELIGIBLE";
  if (criteria.some((c) => c.outcome === "UNKNOWN")) return "UNDETERMINED";
  return "ELIGIBLE";
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
  put(relationshipCriterion(input.relationship));

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
