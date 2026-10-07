import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
import { QConfidenceLevelSchema } from "./confidence.js";
import { QEvidenceRefsSchema } from "./evidence-ref.js";

/**
 * The Capital Readiness Blueprint (PADL #85 Layer 2 "Pro"; spec
 * docs/specs/2026-10/readiness-blueprint.md; ADR 0036). Contracts only:
 * nothing generates a blueprint yet, and the route answers 501.
 *
 * A blueprint turns Q's diagnosis (free, Layer 1) into a sequenced plan.
 * It never restates the diagnosis as new facts: every recommendation
 * points at the gap it closes and the evidence behind it, keeps truth
 * class and evidence status as separate axes (ADR-001), and says when it
 * rests on too little evidence. Unknown stays unknown.
 */

export const Q_READINESS_BLUEPRINTS_PATH =
  "/v1/q/readiness-blueprints" as const;

export const BLUEPRINT_HORIZONS_MONTHS = [3, 6, 12] as const;

export const ReadinessBlueprintRequestSchema = z
  .object({
    /** The founder's own company; the server checks it is theirs. */
    companyId: UuidSchema,
    horizonMonths: z
      .union([z.literal(3), z.literal(6), z.literal(12)])
      .default(6),
    /**
     * Investors to plan for by name. Only organisations the founder may
     * see (a relationship, or network-visible); never inferred from
     * another investor's private data.
     */
    investorOrganisationIds: z.array(UuidSchema).max(5).default([]),
  })
  .strict();
export type ReadinessBlueprintRequest = z.infer<
  typeof ReadinessBlueprintRequestSchema
>;

/**
 * The InvestIQ pillar a step serves (PADL's nine pillars). Investment
 * Fit is per investor and lives in the investor plans, not the roadmap.
 */
export const BLUEPRINT_PILLARS = [
  "FOUNDER",
  "MARKET_OPPORTUNITY",
  "PRODUCT_AND_SOLUTION",
  "COMMERCIAL_VALIDATION",
  "BUSINESS_ECONOMICS",
  "EXECUTION_CAPACITY",
  "GOVERNANCE_AND_TRUST",
  "INVESTMENT_READINESS",
] as const;
export const BlueprintPillarSchema = z.enum(BLUEPRINT_PILLARS);
export type BlueprintPillar = z.infer<typeof BlueprintPillarSchema>;

/** Who carries a step out (PADL #85: resolve yourself → with Q → expert support). */
export const BlueprintExecutorSchema = z.enum([
  "FOUNDER",
  "WITH_Q",
  "EXPERT_SUPPORT",
]);

const Grounding = {
  /** What the step rests on; at least one reference unless the truth class is UNKNOWN. */
  evidence: QEvidenceRefsSchema,
  truthClass: TruthClassSchema,
  evidenceStatus: EvidenceStatusSchema,
  confidence: QConfidenceLevelSchema,
};

export const BlueprintStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(160),
    /** Why it matters to investors, in plain words. */
    why: z.string().min(1).max(800),
    /** The diagnosis gap it closes (the free diagnosis' own finding id). */
    closesGapId: z.string().min(1).max(120).nullable(),
    pillar: BlueprintPillarSchema,
    priority: z.enum(["NOW", "NEXT", "LATER"]),
    effort: z.enum(["HOURS", "DAYS", "WEEKS"]),
    executor: BlueprintExecutorSchema,
    /** Steps that must be done first (sequencing). */
    dependsOn: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(10),
    /** What "done" looks like, checkable by the founder. */
    doneWhen: z.string().min(1).max(400),
    ...Grounding,
  })
  .strict();
export type BlueprintStep = z.infer<typeof BlueprintStepSchema>;

export const BlueprintPhaseSchema = z
  .object({
    label: z.string().min(1).max(80),
    /** Weeks from the start of the horizon. */
    startsWeek: z.number().int().min(0).max(52),
    endsWeek: z.number().int().min(1).max(52),
    stepIds: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(30),
  })
  .strict()
  .refine((phase) => phase.endsWeek > phase.startsWeek, {
    message: "a phase ends after it starts",
  });

export const BlueprintInvestorPlanSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    investorName: z.string().min(1).max(200),
    /** From the investor's declared mandate only (never observed behaviour as a rule). */
    fitSummary: z.string().min(1).max(800),
    likelyQuestions: z.array(z.string().min(1).max(300)).max(10),
    prepareStepIds: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(15),
    ...Grounding,
  })
  .strict();

export const ReadinessBlueprintDtoSchema = z
  .object({
    id: UuidSchema,
    companyId: UuidSchema,
    version: z.number().int().positive(),
    horizonMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    /** What it was built from, so a reader can tell when it is stale. */
    basis: z
      .object({
        diagnosisVersion: z.string().min(1).max(64),
        evidenceAsOf: z.string(),
        mandateVersions: z.array(z.string().min(1).max(64)).max(5),
      })
      .strict(),
    roadmap: z.array(BlueprintStepSchema).max(30),
    sequencing: z.array(BlueprintPhaseSchema).max(8),
    investorPlans: z.array(BlueprintInvestorPlanSchema).max(5),
    /** Plainly stated limits: what Q could not assess, and why. */
    uncertainty: z.array(z.string().min(1).max(400)).max(10),
    generatedAt: z.string(),
  })
  .strict();
export type ReadinessBlueprintDto = z.infer<typeof ReadinessBlueprintDtoSchema>;
