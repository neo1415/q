import type { GradedDimension, StageBand } from "./method-v1.js";

/**
 * FDN InvestIQ v3 stage weights (metrics methods 2026-11-07, owner
 * decision 76). Percent of the overall assessment; each row sums to 100.
 * Sources, equations and worked examples:
 * docs/specs/metrics/METRICS-METHODS.md (Investability) and its sources
 * list. Every number is a JUDGMENT informed by the direction and relative
 * size of published effects; no study fits weights for these dimensions.
 * Status stays "pending calibration" against Capital Q's own outcomes.
 *
 * Changes from v1/v2 (method-v1.ts STAGE_WEIGHTS) and why:
 *  - Team +5 at pre-seed and seed: VCs rank the team most important, more
 *    so early (Gompers, Gornall, Kaplan & Strebulaev 2020, JFE); a prior
 *    successful founder's next company reaches IPO 30% vs 21% (Gompers,
 *    Kovner, Lerner & Scharfstein 2010, JFE); same-industry experience
 *    roughly doubles upper-tail growth (Azoulay, Jones, Kim & Miranda 2020,
 *    AER: Insights); early investors respond to team information over
 *    traction (Bernstein, Korteweg & Laws 2017, JF).
 *  - Fundamentals unchanged and still heavy early: the business is the
 *    durable asset (Kaplan, Sensoy & Strömberg 2009, JF).
 *  - Commercial +5 at Series A and growth: median ARR at Series A has risen
 *    to ~$2-3M and only ~12-26% of seed cohorts graduate within two years
 *    (Carta data), so commercial proof is the binding constraint.
 *  - Investment case down: valuation and fund fit are "most important" for
 *    few VCs (Gompers et al. 2020); terms are contract, not quality
 *    (Kaplan & Strömberg 2004, JF).
 *  - Governance -2 at Series A: professionalisation is largely installed by
 *    VCs after investing (Hellmann & Puri 2002, JF).
 *  - Diligence readiness -1 at Series A, -3 at growth: weak evidence only.
 */
export const STAGE_WEIGHTS_V3: Readonly<
  Record<StageBand, Readonly<Record<GradedDimension, number>>>
> = Object.freeze({
  PRE_SEED: Object.freeze({
    MANAGEMENT_AND_TEAM: 35,
    BUSINESS_FUNDAMENTALS: 30,
    COMMERCIAL_STRENGTH: 10,
    FINANCIAL_READINESS: 5,
    GOVERNANCE: 5,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 5,
    DILIGENCE_READINESS: 5,
  }),
  SEED: Object.freeze({
    MANAGEMENT_AND_TEAM: 30,
    BUSINESS_FUNDAMENTALS: 25,
    COMMERCIAL_STRENGTH: 15,
    FINANCIAL_READINESS: 10,
    GOVERNANCE: 5,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 5,
    DILIGENCE_READINESS: 5,
  }),
  SERIES_A: Object.freeze({
    MANAGEMENT_AND_TEAM: 20,
    BUSINESS_FUNDAMENTALS: 15,
    COMMERCIAL_STRENGTH: 25,
    FINANCIAL_READINESS: 15,
    GOVERNANCE: 8,
    LEGAL_AND_CORPORATE: 5,
    INVESTMENT_CASE: 5,
    DILIGENCE_READINESS: 7,
  }),
  GROWTH: Object.freeze({
    MANAGEMENT_AND_TEAM: 15,
    BUSINESS_FUNDAMENTALS: 10,
    COMMERCIAL_STRENGTH: 25,
    FINANCIAL_READINESS: 20,
    GOVERNANCE: 10,
    LEGAL_AND_CORPORATE: 10,
    INVESTMENT_CASE: 3,
    DILIGENCE_READINESS: 7,
  }),
});

/**
 * A Strong band needs both pillars of quality to be above the stage norm,
 * not one exceptional area carrying the rest (JUDGMENT; research note:
 * Team and Fundamentals are the two blocks investors weigh most early).
 * On the 0-4 dimension scale, after grading.
 */
export const STRONG_REQUIRES = Object.freeze({
  dimensions: Object.freeze([
    "MANAGEMENT_AND_TEAM",
    "BUSINESS_FUNDAMENTALS",
  ] as const satisfies readonly GradedDimension[]),
  minDimensionScore: 2.5,
});
