import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
// Kept independent of company-scores.ts, which optionally embeds this DTO.
const ScoreConfidenceSchema = z.enum(["HIGH", "MODERATE", "LOW"]);
const ScoreFactorSchema = z
  .object({
    label: z.string().min(1).max(80),
    detail: z.string().min(1).max(200),
  })
  .strict();

export const UNICORN_POTENTIAL_CAVEAT =
  "Unicorn Potential is an evidence-based growth-characteristics indicator. It is not the probability of reaching a $1 billion valuation.";
export const UNICORN_PILLAR_IDS = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
] as const;
export const UnicornPillarIdSchema = z.enum(UNICORN_PILLAR_IDS);
export type UnicornPillarId = z.infer<typeof UnicornPillarIdSchema>;
export const UnicornStageSchema = z.enum([
  "PRE_SEED",
  "SEED",
  "SERIES_A_GROWTH",
]);
export type UnicornStage = z.infer<typeof UnicornStageSchema>;
export const UnicornSourceSchema = z
  .object({
    id: z.string().min(1).max(200),
    revision: z.string().min(1).max(200),
    at: UtcTimestampSchema.nullable(),
    kind: z.enum(["CLAIM", "DECK_SECTION", "FOUNDER_BACKGROUND", "PITCH"]),
    label: z.string().min(1).max(200),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    visibilityScope: z.enum(["network_visible", "public_external"]),
    lifecycleStatus: LifecycleStatusSchema,
  })
  .strict();
export type UnicornSource = z.infer<typeof UnicornSourceSchema>;
export const UnicornCriterionSchema = z
  .object({
    id: z.enum(["A", "B"]),
    label: z.string().min(1).max(200),
    state: z.enum([
      "UNKNOWN",
      "OBSERVED",
      "CONFLICTED",
      "NOT_APPLICABLE",
      "STALE",
    ]),
    grade: z.number().int().min(0).max(4).nullable(),
    anchor: z.string().min(1).max(500),
    sources: z.array(UnicornSourceSchema).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.state === "OBSERVED") !== (value.grade !== null))
      ctx.addIssue({
        code: "custom",
        message: "Only observed criteria carry a grade",
        path: ["grade"],
      });
    if (value.state === "OBSERVED" && value.sources.length === 0)
      ctx.addIssue({
        code: "custom",
        message: "Observed criteria require source lineage",
        path: ["sources"],
      });
  });
export const UnicornPillarSchema = z
  .object({
    id: UnicornPillarIdSchema,
    label: z.string().min(1).max(120),
    weight: z.number().min(0).max(100).nullable(),
    grade: z.number().min(0).max(4).nullable(),
    contribution: z.number().min(0).max(100).nullable(),
    coverage: z.number().min(0).max(1),
    criteria: z.array(UnicornCriterionSchema).length(2),
  })
  .strict();
export const UnicornPotentialDtoSchema = z
  .object({
    status: z.enum(["SCORED", "INSUFFICIENT_EVIDENCE", "NOT_ASSESSED"]),
    overallScore: z.number().int().min(0).max(100).nullable(),
    band: z
      .enum([
        "LIMITED_INDICATORS",
        "DEVELOPING",
        "STRONG_SIGNALS",
        "EXCEPTIONAL_SIGNALS",
      ])
      .nullable(),
    confidence: ScoreConfidenceSchema,
    coverage: z.number().min(0).max(1),
    stage: UnicornStageSchema.nullable(),
    methodVersion: z.string().min(1).max(100),
    inputRulesVersion: z.string().min(1).max(100),
    assessedAt: UtcTimestampSchema.nullable(),
    pillars: z.array(UnicornPillarSchema).max(12),
    up: z.array(ScoreFactorSchema).max(3),
    down: z.array(ScoreFactorSchema).max(3),
    missing: z.array(z.string().min(1).max(300)).max(24),
    momentum: z
      .object({
        delta: z.number().int().min(-100).max(100),
        previousScore: z.number().int().min(0).max(100),
        previousAt: UtcTimestampSchema,
        drivers: z.array(z.string().min(1).max(300)).max(12),
      })
      .strict()
      .nullable(),
    benchmark: z.literal("Comparable benchmark unavailable"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status !== "SCORED" &&
      (value.overallScore !== null || value.band !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unscored assessments have no score or band",
        path: ["overallScore"],
      });
    if (
      value.status !== "NOT_ASSESSED" &&
      (value.pillars.length !== 12 ||
        new Set(value.pillars.map((p) => p.id)).size !== 12)
    )
      ctx.addIssue({
        code: "custom",
        message: "An assessment includes all twelve distinct pillars",
        path: ["pillars"],
      });
    for (const [index, pillar] of value.pillars.entries())
      if (new Set(pillar.criteria.map((c) => c.id)).size !== 2)
        ctx.addIssue({
          code: "custom",
          message: "Each pillar includes its two distinct criteria",
          path: ["pillars", index, "criteria"],
        });
    if (
      (value.status === "SCORED") !==
      (value.overallScore !== null && value.band !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "An overall score and band require eligible evidence",
        path: ["overallScore"],
      });
    if (
      value.status === "SCORED" &&
      (value.stage === null ||
        value.coverage < 0.6 ||
        value.pillars.filter((p) => p.grade !== null).length < 6 ||
        !["P1", "P2", "P3"].every((id) =>
          value.pillars.some((p) => p.id === id && p.grade !== null),
        ) ||
        !value.pillars.some(
          (p) => (p.id === "P4" || p.id === "P7") && p.grade !== null,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Score coverage gates failed",
        path: ["status"],
      });
  });
export type UnicornPotentialDto = z.infer<typeof UnicornPotentialDtoSchema>;

/** Entitled and visible, but no persisted assessment exists yet. */
export function notAssessedUnicornPotential(methodVersion: string): UnicornPotentialDto {
  return {
    status: "NOT_ASSESSED", overallScore: null, band: null,
    confidence: "LOW", coverage: 0, stage: null,
    methodVersion, inputRulesVersion: "unicorn-potential-inputs.v1", assessedAt: null,
    pillars: [], up: [], down: [], missing: ["An assessment has not been recorded yet."],
    momentum: null, benchmark: "Comparable benchmark unavailable",
  };
}

export const UNICORN_POTENTIAL_COMPANY_PATH = "/v1/companies/:companyId/unicorn-potential" as const;
