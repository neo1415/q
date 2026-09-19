import { z } from "zod";

import {
  FEATURE_SCHEMA_VERSION,
  FeatureGroupSchema,
  FeatureIdSchema,
  FeatureVersionSchema,
} from "../features/contracts.js";
import type { FeatureRegistry } from "../features/policy.js";
import { RecommendationModeSchema } from "../eligibility/contracts.js";

/**
 * Ranking configuration (doc 19 §52–§55, §110–§112; CQ-REC-005 §14–§23).
 *
 * Every weight, every normalisation and every tie-break rule the V1 ranker
 * applies lives here, in one frozen, versioned object. Nothing in the
 * ranker holds a number of its own. Changing a weight, a mapping or the
 * factor set is a new config version; a published version is never edited,
 * because a persisted slate (REC-006) records the version it was ranked
 * under.
 *
 * `ranking-config.v1` is an INITIAL, HEURISTIC, UNCALIBRATED ordering
 * policy. No ADR or approved methodology fixes weights (doc 19 §53: the
 * Final System Review leaves exact match scoring open until outcome data
 * exists), so v1 is the simplest transparent baseline: four equally
 * weighted soft factors with monotonic category maps and a linear map for
 * the semantic similarity. It orders; it does not measure quality,
 * readiness, interest or the probability of anything.
 */

export const RANKING_CONFIG_STATUSES = [
  /** Hand-set, not fitted to outcomes. The only status V1 has. */
  "INITIAL_HEURISTIC_UNCALIBRATED",
  /** Reserved for a config fitted against observed outcomes (doc 19 Phase 2). */
  "CALIBRATED",
] as const;

/** Where a present factor sits, for explanation preparation (REC-007). */
export const FACTOR_POLARITIES = [
  "POSITIVE",
  "SOFT_MISMATCH",
  "SIGNAL",
] as const;
export const FactorPolaritySchema = z.enum(FACTOR_POLARITIES);
export type FactorPolarity = z.infer<typeof FactorPolaritySchema>;

/** Bounded internal reason codes. Never prose, never arithmetic. */
export const RANKING_REASON_CODES = [
  "STAGE_ALIGNED",
  "STAGE_MISMATCH",
  "GEOGRAPHY_COUNTRY_ALIGNED",
  "GEOGRAPHY_REGION_ALIGNED",
  "GEOGRAPHY_MISMATCH",
  "TAXONOMY_EXACT",
  "TAXONOMY_RELATED",
  "TAXONOMY_MISMATCH",
  "SEMANTIC_SIMILARITY_PRESENT",
  /** A factor's feature was MISSING; the factor did not contribute. */
  "FACTOR_MISSING",
  /** A factor's feature was NOT_APPLICABLE; the factor did not contribute. */
  "FACTOR_NOT_APPLICABLE",
  /** No scoreable factor was present: the candidate is unscored, not poor. */
  "NO_SCOREABLE_FEATURES",
] as const;
export const RankingReasonCodeSchema = z.enum(RANKING_REASON_CODES);
export type RankingReasonCode = z.infer<typeof RankingReasonCodeSchema>;

const CategoryEntrySchema = z
  .object({
    /** In [0, 1]. */
    value: z.number().finite().min(0).max(1),
    polarity: FactorPolaritySchema,
    reasonCode: RankingReasonCodeSchema,
  })
  .strict();

export const NormalizationSchema = z.discriminatedUnion("kind", [
  /** A category feature: each declared category maps to a value in [0, 1]. */
  z
    .object({
      kind: z.literal("CATEGORY_MAP"),
      map: z.record(z.string().regex(/^[A-Z][A-Z_]*$/), CategoryEntrySchema),
    })
    .strict(),
  /**
   * A number feature: linear from [inMin, inMax] to [0, 1], clamped.
   * Direction is the feature's own (HIGHER_IS_CLOSER).
   */
  z
    .object({
      kind: z.literal("LINEAR"),
      inMin: z.number().finite(),
      inMax: z.number().finite(),
      reasonCode: RankingReasonCodeSchema,
    })
    .strict(),
]);
export type Normalization = z.infer<typeof NormalizationSchema>;

export const RankingFactorSchema = z
  .object({
    featureId: FeatureIdSchema,
    /** The exact feature version this mapping was written for. */
    featureVersion: FeatureVersionSchema,
    group: FeatureGroupSchema,
    /** Non-negative and finite. */
    weight: z.number().finite().min(0),
    normalization: NormalizationSchema,
  })
  .strict();
export type RankingFactor = z.infer<typeof RankingFactorSchema>;

/** Registry features the config knows about and deliberately does not score. */
export const InactiveFeatureSchema = z
  .object({
    featureId: FeatureIdSchema,
    featureVersion: FeatureVersionSchema,
    /** GATE_ONLY: a hard-policy reference, validated, never weighted. NOT_COMPUTABLE: no value exists in this schema. */
    role: z.enum(["GATE_ONLY", "NOT_COMPUTABLE"]),
  })
  .strict();

export const RankingConfigSchema = z
  .object({
    version: z.string().regex(/^ranking-config\.[a-z0-9-]+$/),
    status: z.enum(RANKING_CONFIG_STATUSES),
    /** The only context this config ranks. */
    context: RecommendationModeSchema,
    requiredFeatureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
    /** Scored factors, in the order results are reported. */
    factors: z.array(RankingFactorSchema).min(1).max(32),
    /** Every other feature the context's registry holds, accounted for explicitly. */
    inactiveFeatures: z.array(InactiveFeatureSchema).max(32),
    thresholds: z
      .object({
        /** Unset in v1: no approved threshold removes an eligible candidate. */
        minimumFit: z.number().finite().min(0).max(1).nullable(),
      })
      .strict(),
    tieBreak: z
      .object({
        /** Scored candidates first, by score descending. */
        order: z.literal("SCORE_DESC_THEN_COMPANY_ID_ASC"),
        /** Where candidates with no scoreable factor go. */
        unscored: z.literal("AFTER_SCORED_BY_COMPANY_ID_ASC"),
      })
      .strict(),
    /** Decimal places a score is rounded to, so float noise cannot reorder. */
    scorePrecision: z.number().int().min(6).max(15),
    /** Doc 19 §54 extension points; REC-009 owns them. Inert in v1. */
    exploration: z
      .object({ mode: z.literal("NONE"), rate: z.literal(0) })
      .strict(),
    diversity: z.object({ mode: z.literal("NONE") }).strict(),
    description: z.string().min(1).max(800),
  })
  .strict();
export type RankingConfig = z.infer<typeof RankingConfigSchema>;

export const RANKING_CONFIG_V1: RankingConfig = deepFreeze(
  RankingConfigSchema.parse({
    version: "ranking-config.v1",
    status: "INITIAL_HEURISTIC_UNCALIBRATED",
    context: "INVESTOR_DISCOVER",
    requiredFeatureSchemaVersion: FEATURE_SCHEMA_VERSION,
    factors: [
      {
        featureId: "declared_fit.stage",
        featureVersion: "v1",
        group: "DECLARED_FIT",
        weight: 1,
        normalization: {
          kind: "CATEGORY_MAP",
          map: {
            MATCH: {
              value: 1,
              polarity: "POSITIVE",
              reasonCode: "STAGE_ALIGNED",
            },
            NO_MATCH: {
              value: 0,
              polarity: "SOFT_MISMATCH",
              reasonCode: "STAGE_MISMATCH",
            },
          },
        },
      },
      {
        featureId: "declared_fit.geography",
        featureVersion: "v1",
        group: "DECLARED_FIT",
        weight: 1,
        normalization: {
          kind: "CATEGORY_MAP",
          map: {
            COUNTRY_MATCH: {
              value: 1,
              polarity: "POSITIVE",
              reasonCode: "GEOGRAPHY_COUNTRY_ALIGNED",
            },
            REGION_MATCH: {
              value: 0.75,
              polarity: "POSITIVE",
              reasonCode: "GEOGRAPHY_REGION_ALIGNED",
            },
            NO_MATCH: {
              value: 0,
              polarity: "SOFT_MISMATCH",
              reasonCode: "GEOGRAPHY_MISMATCH",
            },
          },
        },
      },
      {
        featureId: "declared_fit.taxonomy",
        featureVersion: "v1",
        group: "DECLARED_FIT",
        weight: 1,
        normalization: {
          kind: "CATEGORY_MAP",
          map: {
            EXACT_OVERLAP: {
              value: 1,
              polarity: "POSITIVE",
              reasonCode: "TAXONOMY_EXACT",
            },
            DESCENDANT_OVERLAP: {
              value: 0.75,
              polarity: "POSITIVE",
              reasonCode: "TAXONOMY_RELATED",
            },
            NO_OVERLAP: {
              value: 0,
              polarity: "SOFT_MISMATCH",
              reasonCode: "TAXONOMY_MISMATCH",
            },
          },
        },
      },
      {
        featureId: "semantic_fit.mandate_similarity",
        featureVersion: "v1",
        group: "SEMANTIC_FIT",
        weight: 1,
        // (similarity + 1) / 2, clamped: the cosine range onto [0, 1].
        normalization: {
          kind: "LINEAR",
          inMin: -1,
          inMax: 1,
          reasonCode: "SEMANTIC_SIMILARITY_PRESENT",
        },
      },
    ],
    inactiveFeatures: [
      {
        featureId: "eligibility.hard_gate",
        featureVersion: "v1",
        role: "GATE_ONLY",
      },
      {
        featureId: "declared_fit.cheque",
        featureVersion: "v1",
        role: "NOT_COMPUTABLE",
      },
    ],
    thresholds: { minimumFit: null },
    tieBreak: {
      order: "SCORE_DESC_THEN_COMPANY_ID_ASC",
      unscored: "AFTER_SCORED_BY_COMPANY_ID_ASC",
    },
    scorePrecision: 12,
    exploration: { mode: "NONE", rate: 0 },
    diversity: { mode: "NONE" },
    description:
      "Initial, heuristic, uncalibrated V1 ordering for INVESTOR_DISCOVER: stage, geography, taxonomy and semantic similarity, equally weighted, averaged over the factors that are present. Missing factors do not contribute and are not zero; cheque is inactive while not computable; the eligibility gate is never weighted. Not a probability, not a quality score, not a public number.",
  }),
);

/** Every published config. A published version is never edited; a change is a new entry. */
export const RANKING_CONFIGS: readonly RankingConfig[] = Object.freeze([
  RANKING_CONFIG_V1,
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

export class RankingConfigError extends Error {
  constructor(version: string, problem: string) {
    super(`${version}: ${problem}`);
    this.name = "RankingConfigError";
  }
}

/**
 * Fail fast on a malformed config (CQ-REC-005 §45), against the feature
 * registry it claims to understand: every factor and inactive entry names
 * a registered feature at its registered version, allowed in the config's
 * context; every feature the registry allows in that context is accounted
 * for, so a newly registered feature can be neither silently scored nor
 * silently ignored; every category map covers exactly the feature's
 * declared categories; at least one factor has positive weight.
 */
export function validateRankingConfig(
  config: RankingConfig,
  registry: FeatureRegistry,
): void {
  const v = config.version;
  RankingConfigSchema.parse(config);
  if (config.context === "GATEQ") {
    throw new RankingConfigError(
      v,
      "GateQ is not a recommendation ranking context",
    );
  }
  let allowed;
  try {
    allowed = registry.featuresFor(config.context);
  } catch {
    throw new RankingConfigError(
      v,
      `no feature is allowed in ${config.context}`,
    );
  }
  const byId = new Map(allowed.map((d) => [d.id, d] as const));
  const seen = new Set<string>();
  for (const factor of config.factors) {
    const d = byId.get(factor.featureId);
    if (d === undefined) {
      throw new RankingConfigError(
        v,
        `${factor.featureId} is not a registered feature allowed in ${config.context}`,
      );
    }
    if (d.version !== factor.featureVersion) {
      throw new RankingConfigError(
        v,
        `${factor.featureId} is registered at ${d.version}, not ${factor.featureVersion}`,
      );
    }
    if (d.featureGroup !== factor.group) {
      throw new RankingConfigError(
        v,
        `${factor.featureId} belongs to ${d.featureGroup}`,
      );
    }
    if (seen.has(factor.featureId)) {
      throw new RankingConfigError(
        v,
        `${factor.featureId} is configured twice`,
      );
    }
    seen.add(factor.featureId);
    const n = factor.normalization;
    if (n.kind === "CATEGORY_MAP") {
      if (d.dataType !== "category") {
        throw new RankingConfigError(
          v,
          `${factor.featureId} is not a category feature`,
        );
      }
      const keys = Object.keys(n.map).sort();
      if (keys.join("|") !== [...d.categories].sort().join("|")) {
        throw new RankingConfigError(
          v,
          `${factor.featureId} map must cover exactly ${d.categories.join(", ")}`,
        );
      }
    } else {
      if (d.dataType !== "number" || d.range === null) {
        throw new RankingConfigError(
          v,
          `${factor.featureId} is not a number feature`,
        );
      }
      if (
        n.inMin >= n.inMax ||
        n.inMin < d.range.min ||
        n.inMax > d.range.max
      ) {
        throw new RankingConfigError(
          v,
          `${factor.featureId} linear bounds must lie inside the feature range`,
        );
      }
      if (d.range.direction !== "HIGHER_IS_CLOSER") {
        throw new RankingConfigError(
          v,
          `${factor.featureId} has no ordering direction`,
        );
      }
    }
  }
  for (const inactive of config.inactiveFeatures) {
    const d = byId.get(inactive.featureId);
    if (d === undefined || d.version !== inactive.featureVersion) {
      throw new RankingConfigError(
        v,
        `${inactive.featureId}@${inactive.featureVersion} is not registered in ${config.context}`,
      );
    }
    if (seen.has(inactive.featureId)) {
      throw new RankingConfigError(
        v,
        `${inactive.featureId} is both active and inactive`,
      );
    }
    seen.add(inactive.featureId);
  }
  const unaccounted = allowed.filter((d) => !seen.has(d.id)).map((d) => d.id);
  if (unaccounted.length > 0) {
    throw new RankingConfigError(
      v,
      `features not accounted for: ${unaccounted.join(", ")}`,
    );
  }
  if (!config.factors.some((f) => f.weight > 0)) {
    throw new RankingConfigError(
      v,
      "at least one factor must carry a positive weight",
    );
  }
}

/** Every published version is unique and valid against the registry. */
export function validateRankingConfigs(
  configs: readonly RankingConfig[],
  registry: FeatureRegistry,
): void {
  const versions = configs.map((c) => c.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error("ranking config versions must be unique");
  }
  for (const config of configs) validateRankingConfig(config, registry);
}
