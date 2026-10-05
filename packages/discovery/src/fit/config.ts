import { z } from "zod";

import {
  EVIDENCE_STATUSES,
  FIT_PARAMETERS,
  FitParameterSchema,
  type EvidenceStatus,
  type FitParameter,
} from "@capital-q/contracts";

import { RANKING_CONFIG_STATUSES } from "../ranking/config.js";

/**
 * The fit model's config (founder brief 2026-10-05, B1; ADR 0052).
 *
 * `ranking-config.v4` extends v3's four factors (stage, geography,
 * taxonomy as sector, semantic similarity as thesis) with cheque size,
 * business model, traction, team and round terms: nine parameters, each
 * weighted, each with its own outcome map. It is a separate, frozen,
 * versioned object because it describes a fit PROFILE shown to a person,
 * not the Discover slate order: v3 still orders the feed, unchanged, and a
 * persisted slate still names v1-v3. Changing anything here is a new
 * version; a published one is never edited, so a profile shown yesterday
 * can be reproduced from its inputs and the version it names.
 *
 * Weights are an INITIAL heuristic (doc 19 §53: exact scoring is open
 * until outcome data exists). They order and band; they are not a
 * probability, a quality score or anything a person sees as a number.
 *
 * Unknown contributes nothing and is never zero: the value is averaged
 * over KNOWN parameters only, and what is unknown lowers coverage and so
 * confidence. A parameter the investor declared no preference on is not
 * applicable: it counts toward neither.
 */

export const FitOutcomeValuesSchema = z
  .object({
    STRONG: z.number().min(0).max(1),
    PARTIAL: z.number().min(0).max(1),
    MISMATCH: z.number().min(0).max(1),
  })
  .strict()
  .refine((v) => v.STRONG > v.PARTIAL && v.PARTIAL > v.MISMATCH, {
    message: "outcome values are strictly monotonic",
  });

export const FitConfigSchema = z
  .object({
    version: z.string().regex(/^ranking-config\.v[0-9]+$/),
    /** What a person reads: "Fit rules version 4". */
    label: z.string().min(1).max(16),
    status: z.enum(RANKING_CONFIG_STATUSES),
    extends: z.string().regex(/^ranking-config\.v[0-9]+$/),
    parameters: z
      .array(
        z
          .object({
            parameter: FitParameterSchema,
            weight: z.number().positive().max(1),
            values: FitOutcomeValuesSchema,
          })
          .strict(),
      )
      .length(FIT_PARAMETERS.length),
    /** Display bands over the value of known parameters. */
    bands: z
      .object({
        strong: z
          .object({
            minValue: z.number().min(0).max(1),
            minCoverage: z.number().min(0).max(1),
            /** "Strong" is a claim; it needs the evidence to carry it. */
            requiresConfidence: z.literal("HIGH"),
          })
          .strict(),
        good: z.object({ minValue: z.number().min(0).max(1) }).strict(),
        partial: z.object({ minValue: z.number().min(0).max(1) }).strict(),
        /** Below this coverage the band is NOT_ENOUGH_INFORMATION, whatever the value. */
        minCoverageForBand: z.number().min(0).max(1),
      })
      .strict(),
    confidence: z
      .object({
        /** How much a known input counts toward confidence, by evidence status. */
        evidenceFactor: z.record(
          z.enum(EVIDENCE_STATUSES),
          z.number().min(0).max(1),
        ),
        /** A known input with no recorded evidence status (a declared field). */
        undeclaredEvidenceFactor: z.number().min(0).max(1),
        staleFactor: z.number().min(0).max(1),
        highMin: z.number().min(0).max(1),
        mediumMin: z.number().min(0).max(1),
      })
      .strict(),
    comparators: z
      .object({
        /** Cosine similarity (thesis) at or above: STRONG; at or above: PARTIAL. */
        thesisStrongMin: z.number().min(-1).max(1),
        thesisPartialMin: z.number().min(-1).max(1),
        /** Cheque as a share of the round: inside [min, max] STRONG. */
        chequeShareStrongMin: z.number().positive(),
        chequeShareStrongMax: z.number().positive(),
        /** Below this share: MISMATCH; between it and the strong minimum: PARTIAL. */
        chequeSharePartialMin: z.number().positive(),
        /** Revenue at or above this share of the declared minimum: PARTIAL. */
        tractionPartialShare: z.number().positive().max(1),
        /** Traction older than this is STALE (lowers confidence, not fit). */
        tractionFreshDays: z.number().int().positive(),
      })
      .strict(),
    reasonTemplatesVersion: z.string().regex(/^fit-reasons\.v[0-9]+$/),
    tieBreak: z.literal("VALUE_DESC_THEN_CONFIDENCE_DESC_THEN_COMPANY_ID_ASC"),
    precision: z.number().int().min(6).max(15),
    description: z.string().min(1).max(800),
  })
  .strict()
  .refine(
    (c) =>
      c.parameters.every((p, i) => p.parameter === FIT_PARAMETERS[i]) &&
      Math.abs(c.parameters.reduce((s, p) => s + p.weight, 0) - 1) < 1e-9,
    {
      message: "nine parameters in FIT_PARAMETERS order, weights summing to 1",
    },
  )
  .refine(
    (c) =>
      c.bands.strong.minValue > c.bands.good.minValue &&
      c.bands.good.minValue > c.bands.partial.minValue,
    { message: "bands are strictly ordered" },
  );
export type FitConfig = z.infer<typeof FitConfigSchema>;

const values = (partial: number) => ({
  STRONG: 1,
  PARTIAL: partial,
  MISMATCH: 0,
});

const EVIDENCE_FACTOR: Readonly<Record<EvidenceStatus, number>> = {
  NO_EVIDENCE: 0.5,
  SELF_REPORTED: 0.7,
  DOCUMENT_SUPPORTED: 0.85,
  MULTI_SOURCE_SUPPORTED: 0.95,
  EXTERNALLY_VERIFIED: 1,
  PLATFORM_VERIFIED: 1,
};

export const FIT_CONFIG_V4: FitConfig = deepFreeze(
  FitConfigSchema.parse({
    version: "ranking-config.v4",
    label: "4",
    status: "INITIAL_HEURISTIC_UNCALIBRATED",
    extends: "ranking-config.v3",
    parameters: [
      { parameter: "STAGE", weight: 0.18, values: values(0.5) },
      { parameter: "SECTOR", weight: 0.18, values: values(0.5) },
      { parameter: "GEOGRAPHY", weight: 0.14, values: values(0.5) },
      { parameter: "CHEQUE_SIZE", weight: 0.12, values: values(0.5) },
      { parameter: "BUSINESS_MODEL", weight: 0.06, values: values(0.5) },
      { parameter: "TRACTION", weight: 0.1, values: values(0.5) },
      { parameter: "TEAM", weight: 0.08, values: values(0.5) },
      { parameter: "THESIS", weight: 0.08, values: values(0.5) },
      { parameter: "ROUND_TERMS", weight: 0.06, values: values(0.5) },
    ],
    bands: {
      strong: { minValue: 0.9, minCoverage: 0.6, requiresConfidence: "HIGH" },
      good: { minValue: 0.75 },
      partial: { minValue: 0.45 },
      minCoverageForBand: 0.4,
    },
    confidence: {
      evidenceFactor: EVIDENCE_FACTOR,
      undeclaredEvidenceFactor: 0.8,
      staleFactor: 0.5,
      highMin: 0.75,
      mediumMin: 0.55,
    },
    comparators: {
      thesisStrongMin: 0.5,
      thesisPartialMin: 0.25,
      chequeShareStrongMin: 0.05,
      chequeShareStrongMax: 1,
      chequeSharePartialMin: 0.025,
      tractionPartialShare: 0.5,
      tractionFreshDays: 183,
    },
    reasonTemplatesVersion: "fit-reasons.v1",
    tieBreak: "VALUE_DESC_THEN_CONFIDENCE_DESC_THEN_COMPANY_ID_ASC",
    precision: 12,
    description:
      "Initial, heuristic, uncalibrated fit profile: v3's stage, geography, sector and thesis similarity plus cheque size, business model, traction, team and round terms, weighted, averaged over KNOWN parameters only. Unknown is never zero: it lowers confidence. Evidence quality is confidence, not fit. Hard rules come only from the investor's declared mandate and are never weighted. Not a probability, not a quality score, never shown as a number.",
  }),
);

/** The config new profiles are computed under. */
export const FIT_CONFIG_CURRENT: FitConfig = FIT_CONFIG_V4;

/** Every published fit config, oldest first; never edited. */
export const FIT_CONFIGS: readonly FitConfig[] = Object.freeze([FIT_CONFIG_V4]);

export function fitConfigByVersion(version: string): FitConfig | null {
  return FIT_CONFIGS.find((c) => c.version === version) ?? null;
}

export function weightOf(config: FitConfig, parameter: FitParameter): number {
  const entry = config.parameters.find((p) => p.parameter === parameter);
  if (entry === undefined)
    throw new Error(`${config.version}: no ${parameter}`);
  return entry.weight;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}
