import type {
  EvidenceStatus,
  LifecycleStatus,
  TruthClass,
} from "@capital-q/contracts";

import type { CoreDimension, FdnDimension } from "./contracts.js";
import { INVESTIQ_SHADOW_METHOD_V0 } from "./method-v0.js";

/**
 * FDN InvestIQ v1 method: "owner-delegated, pending calibration".
 *
 * The owner (2026-10-15) named InvestIQ FDN's proprietary methodology and
 * delegated the weights, rules and bands to the lead "after deep research".
 * Every number below is traced in docs/product-sources/investiq/RESEARCH.md
 * (R1..R12) and is a CALIBRATION HYPOTHESIS, to be tested against 3-5 real
 * FDN companies (CALIBRATION.md) before anything consumes it. Shadow only.
 *
 * Locked rules kept (not overridden by the owner):
 *   - Investor Fit is a canonical FDN dimension but carries no weight and no
 *     criteria here: it is computed by the discovery fit system (C3).
 *   - No output recommends a capital form (PADL Ch4 #74, C4).
 *   - Valuation and dilution are recorded but never graded (C8).
 *   - Unknown is never zero: unscored criteria leave the mean and count
 *     against coverage only; below coverage the answer is INSUFFICIENT_EVIDENCE.
 */

export const STAGE_BANDS = ["PRE_SEED", "SEED", "SERIES_A", "GROWTH"] as const;
export type StageBand = (typeof STAGE_BANDS)[number];

/** Graded FDN dimensions (Investor Fit excluded by rule C3). */
export const GRADED_DIMENSIONS = [
  "BUSINESS_FUNDAMENTALS",
  "COMMERCIAL_STRENGTH",
  "FINANCIAL_READINESS",
  "GOVERNANCE",
  "MANAGEMENT_AND_TEAM",
  "LEGAL_AND_CORPORATE",
  "INVESTMENT_CASE",
  "DILIGENCE_READINESS",
] as const satisfies readonly FdnDimension[];
export type GradedDimension = (typeof GRADED_DIMENSIONS)[number];

/**
 * Stage weights, percent of the overall InvestIQ assessment; each row sums
 * to 100. Team and fundamentals dominate early (R1 Payne 30% team, R5
 * Gompers et al. 47% "most important = team", R6 Mason et al. team is the
 * main rejection reason); commercial, financial, governance and diligence
 * grow with stage (R4 IRL, R8 IFC CG progression by maturity, R9 YC Series A
 * checklist, R10 Moody's: finances carry the largest weight for mature
 * credits). Investment case ~10% early (R3 RFS: funding + exit are 2 of 12
 * risks; R1 "need for additional investment").
 */
export const STAGE_WEIGHTS: Readonly<
  Record<StageBand, Readonly<Record<GradedDimension, number>>>
> = {
  PRE_SEED: {
    MANAGEMENT_AND_TEAM: 30,
    BUSINESS_FUNDAMENTALS: 30,
    COMMERCIAL_STRENGTH: 10,
    FINANCIAL_READINESS: 5,
    GOVERNANCE: 5,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 10,
    DILIGENCE_READINESS: 5,
  },
  SEED: {
    MANAGEMENT_AND_TEAM: 25,
    BUSINESS_FUNDAMENTALS: 25,
    COMMERCIAL_STRENGTH: 15,
    FINANCIAL_READINESS: 10,
    GOVERNANCE: 5,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 10,
    DILIGENCE_READINESS: 5,
  },
  SERIES_A: {
    MANAGEMENT_AND_TEAM: 20,
    BUSINESS_FUNDAMENTALS: 15,
    COMMERCIAL_STRENGTH: 20,
    FINANCIAL_READINESS: 15,
    GOVERNANCE: 10,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 7,
    DILIGENCE_READINESS: 8,
  },
  GROWTH: {
    MANAGEMENT_AND_TEAM: 15,
    BUSINESS_FUNDAMENTALS: 10,
    COMMERCIAL_STRENGTH: 20,
    FINANCIAL_READINESS: 20,
    GOVERNANCE: 10,
    LEGAL_AND_CORPORATE: 10,
    INVESTMENT_CASE: 5,
    DILIGENCE_READINESS: 10,
  },
};

/** Business Quality vs Investment Readiness stay separate outputs (PADL Ch4 #62). */
export const OUTPUT_GROUPS: Readonly<
  Record<
    "BUSINESS_QUALITY" | "INVESTMENT_READINESS",
    readonly GradedDimension[]
  >
> = {
  BUSINESS_QUALITY: [
    "MANAGEMENT_AND_TEAM",
    "BUSINESS_FUNDAMENTALS",
    "COMMERCIAL_STRENGTH",
    "FINANCIAL_READINESS",
  ],
  INVESTMENT_READINESS: [
    "GOVERNANCE",
    "LEGAL_AND_CORPORATE",
    "INVESTMENT_CASE",
    "DILIGENCE_READINESS",
  ],
};

/**
 * Criterion anchors 0-4, centred on 2 = stage-appropriate baseline. This is
 * R3 Risk Factor Summation's -2..+2 shifted by +2, and R1 Payne's "100% of
 * the norm" at the centre. Defaults when no explicit anchor is supplied.
 */
export const READING_DEFAULT_ANCHOR = {
  INDICATES_WEAKNESS: 1,
  RECORDED: 2,
  SUPPORTS_STRENGTH: 3,
} as const;
export const BASELINE_ANCHOR = 2;

/**
 * Evidence multiplier w in (0, 1]: an observation's deviation from the
 * baseline is scaled by w, so weak evidence cannot push a criterion far
 * from the baseline in EITHER direction (R11 GRADE: start by evidence type,
 * downgrade for risk of bias/indirectness; R10 rating agencies: data
 * quality limits the outcome). Self-reported counts half of verified.
 */
export const EVIDENCE_WEIGHT: Readonly<Record<EvidenceStatus, number>> = {
  NO_EVIDENCE: 0.25,
  SELF_REPORTED: 0.5,
  DOCUMENT_SUPPORTED: 0.75,
  MULTI_SOURCE_SUPPORTED: 0.85,
  EXTERNALLY_VERIFIED: 1,
  PLATFORM_VERIFIED: 1,
};
/** UNKNOWN is excluded upstream; evidence-free Q inference is excluded upstream. */
export const TRUTH_WEIGHT: Readonly<
  Record<Exclude<TruthClass, "UNKNOWN">, number>
> = {
  VERIFIED: 1,
  USER_CLAIM: 1,
  ESTIMATE: 0.75,
  Q_INFERENCE: 0.5,
};
/** SUPERSEDED excluded; CONTRADICTORY/DISPUTED make the criterion CONFLICTED (withheld). */
export const LIFECYCLE_WEIGHT: Readonly<
  Record<
    Exclude<LifecycleStatus, "SUPERSEDED" | "CONTRADICTORY" | "DISPUTED">,
    number
  >
> = {
  CURRENT: 1,
  HISTORICAL: 1,
  STALE: 0.5,
};

/** Bands on the 0-4 scale; lower bound inclusive. R1/R3 semantics, see RESEARCH.md. */
export const READINESS_BANDS = [
  { band: "NOT_YET_READY", min: 0 },
  { band: "DEVELOPING", min: 1.5 },
  { band: "READY", min: 2 },
  { band: "STRONG", min: 2.75 },
] as const;
export type ReadinessBand = (typeof READINESS_BANDS)[number]["band"];

export const COVERAGE_RULES = {
  /** A dimension is scored only when this share of its graded, applicable criteria is scored. */
  dimensionMin: 0.4,
  /** Overall and group bands need this share of the stage weight in scored dimensions. */
  weightedMin: 0.6,
  /** Overall band additionally needs these scored (R1, R5, R6: the decisive early factors). */
  requiredForOverall: ["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS"] as const,
} as const;

/** Discrete levels only (PADL #142). c = coverage, q = mean evidence weight of scored criteria. */
export const CONFIDENCE_RULES = {
  HIGH: { coverage: 0.75, quality: 0.75 },
  MODERATE: { coverage: 0.5, quality: 0.6 },
  /** Any unresolved conflict lowers the level by one (R11 GRADE inconsistency). */
  conflictDowngrade: 1,
  /** Bands above DEVELOPING require at least this confidence; else capped at DEVELOPING. */
  minForReadyBand: "MODERATE",
} as const;
export type ConfidenceLevel = "HIGH" | "MODERATE" | "LOW";

/** Recorded, never graded (C8 valuation stays outside the grade). */
export const UNGRADED_CRITERIA = ["cs.valuation", "cs.dilution"] as const;

export type V1Criterion = {
  readonly key: string;
  readonly label: string;
  readonly dimension: GradedDimension;
  readonly coreSeven: CoreDimension;
  readonly graded: boolean;
};

const PRIMARY_FDN: Readonly<Record<string, GradedDimension>> = {
  "pt.product_definition": "BUSINESS_FUNDAMENTALS",
  "cs.capital_narrative": "INVESTMENT_CASE",
};

function primaryFdn(
  key: string,
  fdn: readonly FdnDimension[],
): GradedDimension {
  const explicit = PRIMARY_FDN[key];
  if (explicit !== undefined) return explicit;
  const first = fdn[0];
  const graded = GRADED_DIMENSIONS.find((d) => d === first);
  if (graded === undefined)
    throw new Error(`criterion ${key} has no graded FDN dimension`);
  return graded;
}

/**
 * Same criterion catalog as v0 (FDN brief p.4 focus areas), now owned by
 * the canonical FDN nine, each also mapped to one Core Seven dimension so
 * Core Seven consumers keep working (C1 as directed by the owner).
 */
export const INVESTIQ_V1_CRITERIA: readonly V1Criterion[] =
  INVESTIQ_SHADOW_METHOD_V0.criteria.map((c) => ({
    key: c.key,
    label: c.label,
    dimension: primaryFdn(c.key, c.fdn),
    coreSeven: c.dimension,
    graded: !(UNGRADED_CRITERIA as readonly string[]).includes(c.key),
  }));

export const INVESTIQ_V1 = {
  version: "investiq/v1",
  status: "OWNER_DELEGATED_PENDING_CALIBRATION",
  applicability: INVESTIQ_SHADOW_METHOD_V0.applicability,
} as const;

/** Explicit, ordered stage parsing; anything unrecognised is null, never "seed". */
export function stageBandOf(stageCode: string | null): StageBand | null {
  if (stageCode === null) return null;
  const code = stageCode.trim().toLowerCase();
  if (/^(idea|concept|pre[_-]?seed)$/.test(code)) return "PRE_SEED";
  if (/^seed$/.test(code)) return "SEED";
  if (/^(series[_-]?a|a)$/.test(code)) return "SERIES_A";
  if (
    /^(series[_-]?[b-z](_plus)?|series_c_plus|growth|late|pre[_-]?ipo)$/.test(
      code,
    )
  ) {
    return "GROWTH";
  }
  return null;
}
