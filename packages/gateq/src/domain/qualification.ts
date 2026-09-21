import {
  CRITERION_REASON_CODES,
  type AccessDecision,
  type AccessReasonCode,
  type CompanyQualificationProjection,
  type CriterionConfig,
  type CriterionReasonCode,
  type CriterionResult,
  type CriterionStatus,
  type GatewayCriterion,
  type GatewayPolicy,
  type QualificationOutcome,
  type QualificationResult,
} from "../contracts/index.js";

/**
 * The deterministic GateQ qualification engine (CQ-GATE-001 §13–§15).
 *
 * One published policy version plus one bounded company projection in, one
 * explained answer out. It reads no database, calls no model, draws no
 * random number and reads no clock — the evaluation instant arrives as an
 * argument — so the same policy and the same projection always give the
 * same answer, and a stored result stays reproducible against the version
 * it names.
 *
 * It computes no score. A weighted threshold here would be a second ranker
 * with none of REC-005's governance and none of its calibration, and doc 19
 * §53 leaves scoring open until outcome data exists. A criterion either
 * matched, did not, or nobody has said.
 */

export const QUALIFICATION_POLICY_VERSION = "gateq-qualification.v1" as const;

/** Both are exact decimal strings; comparing them as numbers is the bug. */
function compareDecimal(left: string, right: string): number {
  const [lWhole = "0", lFrac = ""] = left.split(".");
  const [rWhole = "0", rFrac = ""] = right.split(".");
  const whole = lWhole
    .padStart(20, "0")
    .localeCompare(rWhole.padStart(20, "0"));
  if (whole !== 0) return whole;
  return lFrac.padEnd(4, "0").localeCompare(rFrac.padEnd(4, "0"));
}

type Verdict = {
  readonly status: CriterionStatus;
  readonly reasonCode: CriterionReasonCode;
  readonly observed: string | null;
};

function taxonomyVerdict(
  config: Extract<CriterionConfig, { type: "TAXONOMY" }>,
  projection: CompanyQualificationProjection,
): Verdict {
  const inVocabulary = projection.classifications.filter(
    (c) => c.vocabularyCode === config.vocabularyCode,
  );
  // Nobody has classified this company in this vocabulary. That is not a
  // mismatch: an unclassified company has not been assessed, and treating
  // silence as a "no" would reject every company nobody has got to yet.
  if (inVocabulary.length === 0) {
    return {
      status: "UNKNOWN",
      reasonCode: "TAXONOMY_NOT_CLASSIFIED",
      observed: config.vocabularyCode,
    };
  }
  const allowed = new Set(config.allowedNodeIds);
  for (const classification of inVocabulary) {
    if (allowed.has(classification.nodeId)) {
      return {
        status: "MATCH",
        reasonCode: "TAXONOMY_NODE_MATCHED",
        observed: config.vocabularyCode,
      };
    }
  }
  // An allowed parent admits its descendants: an investor who says
  // "fintech" means payments too, which is the canonical hierarchy's job
  // and not a string comparison's.
  for (const classification of inVocabulary) {
    if (classification.ancestorNodeIds.some((id) => allowed.has(id))) {
      return {
        status: "MATCH",
        reasonCode: "TAXONOMY_ANCESTOR_MATCHED",
        observed: config.vocabularyCode,
      };
    }
  }
  return {
    status: "NO_MATCH",
    reasonCode: "TAXONOMY_NO_OVERLAP",
    observed: config.vocabularyCode,
  };
}

function exclusionVerdict(
  config: Extract<CriterionConfig, { type: "EXCLUDED_TAXONOMY" }>,
  projection: CompanyQualificationProjection,
): Verdict {
  const inVocabulary = projection.classifications.filter(
    (c) => c.vocabularyCode === config.vocabularyCode,
  );
  if (inVocabulary.length === 0) {
    // An exclusion needs proof (§10). Unknown never excludes, because an
    // inferred exclusion is indistinguishable from a rejection nobody
    // decided.
    return {
      status: "UNKNOWN",
      reasonCode: "EXCLUSION_NOT_ASSESSABLE",
      observed: config.vocabularyCode,
    };
  }
  const excluded = new Set(config.excludedNodeIds);
  const hit = inVocabulary.some(
    (c) =>
      excluded.has(c.nodeId) ||
      c.ancestorNodeIds.some((id) => excluded.has(id)),
  );
  return hit
    ? {
        status: "NO_MATCH",
        reasonCode: "EXCLUSION_MATCHED",
        observed: config.vocabularyCode,
      }
    : {
        status: "MATCH",
        reasonCode: "EXCLUSION_NOT_MATCHED",
        observed: config.vocabularyCode,
      };
}

function raiseVerdict(
  config: Extract<CriterionConfig, { type: "RAISE_SIZE" }>,
  projection: CompanyQualificationProjection,
): Verdict {
  const raise = projection.raise;
  if (raise === null) {
    return {
      status: "UNKNOWN",
      reasonCode: "RAISE_NOT_DECLARED",
      observed: null,
    };
  }
  // No conversion, ever. An exchange rate is a number nobody in this system
  // is authorised to choose, and a converted amount would look exactly like
  // a declared one.
  if (raise.currency !== config.currency) {
    return {
      status: "UNKNOWN",
      reasonCode: "RAISE_CURRENCY_DIFFERS",
      observed: raise.currency,
    };
  }
  if (
    config.minAmount !== null &&
    compareDecimal(raise.amount, config.minAmount) < 0
  ) {
    return {
      status: "NO_MATCH",
      reasonCode: "RAISE_BELOW_BAND",
      observed: raise.currency,
    };
  }
  if (
    config.maxAmount !== null &&
    compareDecimal(raise.amount, config.maxAmount) > 0
  ) {
    return {
      status: "NO_MATCH",
      reasonCode: "RAISE_ABOVE_BAND",
      observed: raise.currency,
    };
  }
  return {
    status: "MATCH",
    reasonCode: "RAISE_WITHIN_BAND",
    observed: raise.currency,
  };
}

/**
 * Cheque compatibility (§16).
 *
 * The rule is the one the recommendation context wrote down and could not
 * use: the investor's *minimum* cheque has to fit inside the company's
 * round, never "the maximum cheque covers the whole round", which would
 * reject every syndicated raise. REC-001 reported this NOT_COMPUTABLE
 * because a company's capital objective is organisation-internal with no
 * discovery-safe projection. GateQ is the other direction — the company is
 * applying, and its raise is part of what it brings — so here both sides
 * are authoritative and the comparison is real.
 */
function chequeVerdict(
  config: Extract<CriterionConfig, { type: "CHEQUE_COMPATIBILITY" }>,
  projection: CompanyQualificationProjection,
): Verdict {
  const raise = projection.raise;
  if (raise === null) {
    return {
      status: "UNKNOWN",
      reasonCode: "RAISE_NOT_DECLARED",
      observed: null,
    };
  }
  if (raise.currency !== config.currency) {
    return {
      status: "UNKNOWN",
      reasonCode: "CHEQUE_CURRENCY_DIFFERS",
      observed: raise.currency,
    };
  }
  return compareDecimal(config.minCheque, raise.amount) <= 0
    ? {
        status: "MATCH",
        reasonCode: "CHEQUE_FITS_RAISE",
        observed: raise.currency,
      }
    : {
        status: "NO_MATCH",
        reasonCode: "CHEQUE_EXCEEDS_RAISE",
        observed: raise.currency,
      };
}

function verdictFor(
  criterion: GatewayCriterion,
  projection: CompanyQualificationProjection,
): Verdict {
  const config = criterion.config;
  switch (config.type) {
    case "TAXONOMY":
      return taxonomyVerdict(config, projection);
    case "EXCLUDED_TAXONOMY":
      return exclusionVerdict(config, projection);
    case "GEOGRAPHY": {
      const country = projection.headquartersCountry;
      if (country === null) {
        return {
          status: "UNKNOWN",
          reasonCode: "GEOGRAPHY_NOT_DECLARED",
          observed: null,
        };
      }
      return config.allowedCountries.includes(country)
        ? {
            status: "MATCH",
            reasonCode: "GEOGRAPHY_COUNTRY_ALLOWED",
            observed: country,
          }
        : {
            status: "NO_MATCH",
            reasonCode: "GEOGRAPHY_COUNTRY_NOT_ALLOWED",
            observed: country,
          };
    }
    case "STAGE": {
      const stage = projection.currentStageCode;
      if (stage === null) {
        return {
          status: "UNKNOWN",
          reasonCode: "STAGE_NOT_DECLARED",
          observed: null,
        };
      }
      return config.allowedStageCodes.includes(stage)
        ? { status: "MATCH", reasonCode: "STAGE_ALLOWED", observed: stage }
        : {
            status: "NO_MATCH",
            reasonCode: "STAGE_NOT_ALLOWED",
            observed: stage,
          };
    }
    case "RAISE_SIZE":
      return raiseVerdict(config, projection);
    case "CHEQUE_COMPATIBILITY":
      return chequeVerdict(config, projection);
  }
}

export type QualifyInput = {
  readonly policy: GatewayPolicy;
  readonly projection: CompanyQualificationProjection;
  /** Supplied, never read: the engine holds no clock. */
  readonly evaluatedAt: string;
};

export class GateQPolicyNotPublishedError extends Error {
  constructor() {
    super("only a published gateway version can qualify an application");
    this.name = "GateQPolicyNotPublishedError";
  }
}

/**
 * Evaluate one company against one published gateway policy.
 *
 * The aggregation is the whole of §15, written out rather than derived so
 * each branch is visible beside its reason:
 *
 *   CLOSED     → nobody may apply. Fit is still described, because a
 *                closed door is not a judgement about the caller.
 *   OPEN       → anyone may apply. Fit is described and does not gate.
 *   QUALIFIED  → a required NO_MATCH refuses; otherwise a required UNKNOWN
 *                asks for more; otherwise the application is welcome.
 *
 * PREFERRED criteria are reported and never gate. A mismatch on something
 * the organisation merely prefers is information for a human, not a door.
 */
export function qualify(input: QualifyInput): QualificationResult {
  const { policy, projection, evaluatedAt } = input;
  if (policy.version.status !== "PUBLISHED") {
    // A draft is a work in progress. Deciding anybody's access on one would
    // make an unsaved thought into policy.
    throw new GateQPolicyNotPublishedError();
  }

  const criteria: CriterionResult[] = [...policy.criteria]
    .sort((a, b) => a.position - b.position)
    .map((criterion) => {
      const verdict = verdictFor(criterion, projection);
      return {
        criterionId: criterion.id,
        type: criterion.config.type,
        requiredness: criterion.requiredness,
        label: criterion.label,
        status: verdict.status,
        reasonCode: verdict.reasonCode,
        observed: verdict.observed,
      };
    });

  const required = criteria.filter((c) => c.requiredness === "REQUIRED");
  const principalMismatches = required
    .filter((c) => c.status === "NO_MATCH")
    .map((c) => c.criterionId);
  const unknowns = required
    .filter((c) => c.status === "UNKNOWN")
    .map((c) => c.criterionId);

  const outcome: QualificationOutcome =
    principalMismatches.length > 0
      ? "NOT_QUALIFIED"
      : unknowns.length > 0
        ? "INSUFFICIENT_INFORMATION"
        : "QUALIFIED";

  const mode = policy.version.inboundMode;
  let access: AccessDecision;
  let accessReasonCode: AccessReasonCode;
  if (policy.gateway.status === "DISABLED") {
    access = "MAY_NOT_APPLY";
    accessReasonCode = "GATEWAY_DISABLED";
  } else if (mode === "CLOSED") {
    access = "MAY_NOT_APPLY";
    accessReasonCode = "GATEWAY_CLOSED";
  } else if (mode === "OPEN") {
    access = "MAY_APPLY";
    accessReasonCode = "GATEWAY_OPEN";
  } else if (outcome === "NOT_QUALIFIED") {
    access = "MAY_NOT_APPLY";
    accessReasonCode = "REQUIRED_CRITERIA_NOT_SATISFIED";
  } else if (outcome === "INSUFFICIENT_INFORMATION") {
    // Not a refusal. The organisation's policy needs something nobody has
    // told Capital Q yet, and GATE-002's interview is where it gets asked.
    access = "NEEDS_INFORMATION";
    accessReasonCode = "REQUIRED_INFORMATION_MISSING";
  } else {
    access = "MAY_APPLY";
    accessReasonCode = "REQUIRED_CRITERIA_SATISFIED";
  }

  return {
    gatewayId: policy.gateway.id,
    gatewayVersionId: policy.version.id,
    gatewayVersionNumber: policy.version.versionNumber,
    qualificationPolicyVersion: policy.version.qualificationPolicyVersion,
    companyId: projection.companyId,
    inboundMode: mode,
    outcome,
    access,
    accessReasonCode,
    criteria,
    principalMismatches,
    unknowns,
    evaluatedAt,
  };
}

/** Exported so a consumer can assert it has handled every reason. */
export const ALL_CRITERION_REASON_CODES = CRITERION_REASON_CODES;
