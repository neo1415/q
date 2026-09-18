import { z } from "zod";

/**
 * Hard eligibility (doc 19 §12–§13, §37; doc 25 CQ-REC-001; DMR-008/009).
 *
 * Eligibility answers one question only:
 *
 *   "May this Company legitimately enter the candidate/ranking pipeline
 *    for this Investor and this Recommendation context?"
 *
 * It never answers "how attractive is this Company". There is no score,
 * no rank, no probability and no prose here: a gate before comparison.
 *
 * Kept apart, permanently:
 *
 *   Eligibility ≠ Ranking ≠ Fit ≠ Business Quality ≠ Investment Readiness
 *   Marketplace Readiness ≠ Investment Readiness
 *   AVOID ≠ HARD_EXCLUSION            DECLARED ≠ Q_PROPOSED ≠ Observed
 *   network_visible ≠ marketplace_ready    Q Knowledge ≠ eligibility input
 *   Interest ≠ Match ≠ Outcome         GateQ ≠ INVESTOR_DISCOVER
 *
 * The same legitimate input snapshot under the same policy version gives
 * the same decision and the same reasons. No model, no provider, no clock
 * inside the decision; `evaluatedAt` is the only non-semantic field.
 */

/**
 * Bumped whenever a criterion, its missing-data behaviour, a reason code or
 * the decision rule changes. Recorded on every result so a decision can be
 * reproduced from (canonical snapshot, mandate snapshot, policy version).
 *
 * v2: only declared company classifications (user_selected, admin_curated)
 * answer a taxonomy hard exclusion. v1 let a Q inference or an extracted
 * suggestion on an excluded node make a company INELIGIBLE.
 */
export const ELIGIBILITY_POLICY_VERSION = "eligibility.v2" as const;

/** Doc 19 §11. REC-001 evaluates INVESTOR_DISCOVER; the others are reserved. */
export const RECOMMENDATION_MODES = [
  "INVESTOR_DISCOVER",
  "FOUNDER_DISCOVER",
  "GATEQ",
  "SEARCH",
  "Q_RECOMMENDATION",
] as const;
export const RecommendationModeSchema = z.enum(RECOMMENDATION_MODES);
export type RecommendationMode = z.infer<typeof RecommendationModeSchema>;

/** The modes this policy version can evaluate. GateQ is a later packet with its own rules. */
export const ELIGIBILITY_SUPPORTED_MODES = ["INVESTOR_DISCOVER"] as const;

/**
 * Tri-state. UNKNOWN ≠ MISMATCH: missing hard-gate information makes a
 * company UNDETERMINED, never INELIGIBLE. Only an explicit hard rule that is
 * definitively violated makes it INELIGIBLE.
 */
export const ELIGIBILITY_DECISIONS = [
  "ELIGIBLE",
  "INELIGIBLE",
  "UNDETERMINED",
] as const;
export const EligibilityDecisionSchema = z.enum(ELIGIBILITY_DECISIONS);
export type EligibilityDecision = z.infer<typeof EligibilityDecisionSchema>;

/**
 * What one criterion concluded. NOT_APPLICABLE means the active mandate
 * declares no hard rule on that dimension (or policy v1 has no hard rule
 * there); UNKNOWN means a hard rule exists but the canonical information
 * needed to apply it is absent.
 */
export const CRITERION_OUTCOMES = [
  "PASS",
  "FAIL",
  "UNKNOWN",
  "NOT_APPLICABLE",
] as const;
export const CriterionOutcomeSchema = z.enum(CRITERION_OUTCOMES);
export type CriterionOutcome = z.infer<typeof CriterionOutcomeSchema>;

/** Evaluated in this order, always all of them, so results read the same twice. */
export const ELIGIBILITY_CRITERIA = [
  /** core.companies.company_status = active. */
  "COMPANY_ACTIVE",
  /** Marketplace Readiness as the Companies context reads it (PADL #58). */
  "MARKETPLACE_PARTICIPATION",
  /** The company is not the investor organisation's own. */
  "COUNTERPART_DISTINCT",
  /** Network classification plus the disclosure evaluator's answer for this actor. */
  "INVESTOR_DISCOVERABILITY",
  /** Exactly one ACTIVE mandate is in force for the investor organisation. */
  "ACTIVE_MANDATE",
  /** Declared HARD_EXCLUSION taxonomy preferences vs the company's ACTIVE classifications. */
  "HARD_EXCLUSION_TAXONOMY",
  /** Declared HARD_EXCLUSION `stage` constraint vs current_stage_code. */
  "HARD_EXCLUSION_STAGE",
  /** Declared HARD_EXCLUSION `geography.country` constraint vs headquarters_country. */
  "HARD_EXCLUSION_GEOGRAPHY",
  /** Declared HARD_EXCLUSION on a dimension canonical company state cannot answer yet. */
  "HARD_EXCLUSION_OTHER",
  /** Cheque is a fit factor, never a hard gate (see policy). */
  "CHEQUE_COMPATIBILITY",
  /** A canonical relationship state that removes the pair from discovery. */
  "RELATIONSHIP_STANDING",
] as const;
export const EligibilityCriterionSchema = z.enum(ELIGIBILITY_CRITERIA);
export type EligibilityCriterion = z.infer<typeof EligibilityCriterionSchema>;

/**
 * Stable machine reason codes. Safe by construction: each names a canonical
 * state or a declared rule, never a source. There is deliberately no code
 * that could reveal that a document, memory, conversation or public page
 * exists, because none of those is an input.
 */
export const ELIGIBILITY_REASON_CODES = [
  "COMPANY_NOT_ACTIVE",
  "COMPANY_NOT_MARKETPLACE_ELIGIBLE",
  "COMPANY_IS_INVESTORS_OWN",
  "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
  "NO_ACTIVE_MANDATE",
  "ACTIVE_MANDATE_AMBIGUOUS",
  "MANDATE_NOT_ACTIVE",
  "EXPLICIT_HARD_EXCLUSION",
  "COMPANY_TAXONOMY_UNKNOWN",
  "STAGE_OUTSIDE_HARD_MANDATE",
  "COMPANY_STAGE_UNKNOWN",
  "GEOGRAPHY_OUTSIDE_HARD_MANDATE",
  "COMPANY_GEOGRAPHY_UNKNOWN",
  "HARD_CRITERION_NOT_EVALUABLE",
  "RELATIONSHIP_CLOSED",
  "RELATIONSHIP_STATE_UNKNOWN",
] as const;
export const EligibilityReasonCodeSchema = z.enum(ELIGIBILITY_REASON_CODES);
export type EligibilityReasonCode = z.infer<typeof EligibilityReasonCodeSchema>;

export const CriterionResultSchema = z
  .object({
    criterion: EligibilityCriterionSchema,
    outcome: CriterionOutcomeSchema,
    /** Present for FAIL and UNKNOWN; absent for PASS and NOT_APPLICABLE. */
    reasonCode: EligibilityReasonCodeSchema.nullable(),
    /**
     * A bounded, safe qualifier: the mandate dimension a rule came from
     * (e.g. `red_flag`) or the relationship state that was not understood.
     * Never a value the company or the investor declared, never a source.
     */
    detail: z
      .string()
      .regex(/^[a-z][a-z0-9_.]*$|^[A-Z][A-Z_]{0,31}$/)
      .max(64)
      .nullable(),
  })
  .strict();
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

/** Doc 19 §11, the part REC-001 needs. Tenant and subject are server-resolved, never client input. */
export const RecommendationContextSchema = z
  .object({
    tenantId: z.string().uuid(),
    investorOrganisationId: z.string().uuid(),
    mode: RecommendationModeSchema,
    /** Named when the caller pins a mandate; otherwise the one ACTIVE mandate is used. */
    mandateId: z.string().uuid().nullable(),
    /** Vocabulary code → version, when the caller supplies it; null when not recorded. */
    taxonomyVersion: z.record(z.string(), z.number().int()).nullable(),
    eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
  })
  .strict();
export type RecommendationContext = z.infer<typeof RecommendationContextSchema>;

export const EligibilityResultSchema = z
  .object({
    eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
    mode: RecommendationModeSchema,
    companyId: z.string().uuid(),
    investorOrganisationId: z.string().uuid(),
    /** The ACTIVE mandate the rules came from; null when none could be used. */
    mandateId: z.string().uuid().nullable(),
    mandateVersion: z.number().int().min(1).nullable(),
    taxonomyVersion: z.record(z.string(), z.number().int()).nullable(),
    decision: EligibilityDecisionSchema,
    /** Distinct, sorted; the union of every FAIL and UNKNOWN reason. */
    reasonCodes: z.array(EligibilityReasonCodeSchema).max(32),
    /** One entry per criterion, in ELIGIBILITY_CRITERIA order. */
    criteria: z
      .array(CriterionResultSchema)
      .length(ELIGIBILITY_CRITERIA.length),
    /** The only field two evaluations of the same snapshot may differ in. */
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>;

/** Candidates evaluated per call. REC-002 sizes its candidate set to this. */
export const ELIGIBILITY_BATCH_MAX = 200;
