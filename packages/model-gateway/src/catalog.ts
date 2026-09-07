import { z } from "zod";

import {
  ModelCodeSchema,
  ModelLatencyClassSchema,
  ModelProviderCodeSchema,
  ModelQualityClassSchema,
  ModelSensitivitySchema,
  ModelStatusSchema,
  ModelTaskClassSchema,
  ModelTypeSchema,
  ProviderPrivacyPolicyClassSchema,
  ProviderStatusSchema,
  RoutingPolicyCodeSchema,
  RoutingPolicyStatusSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * The catalog the gateway routes from: an in-memory snapshot of the ai_ops
 * configuration tables (doc 13 §56). Loaded through a port, validated on
 * the way in, and read many times per call — never mutated by a call.
 *
 * Every row is validated with the same closed vocabularies the database
 * enforces, so a hand-built fixture in a test and a row from PostgreSQL
 * are the same thing to the policy code.
 */

export const ProviderRecordSchema = z
  .object({
    id: UuidSchema,
    code: ModelProviderCodeSchema,
    name: z.string().min(1).max(120),
    status: ProviderStatusSchema,
    privacyPolicyClass: ProviderPrivacyPolicyClassSchema,
    supportsZeroRetention: z.boolean(),
    regionSupport: z.array(z.string().max(32)).max(64),
  })
  .strict();
export type ProviderRecord = z.infer<typeof ProviderRecordSchema>;

export const ModelRecordSchema = z
  .object({
    id: UuidSchema,
    providerId: UuidSchema,
    modelCode: ModelCodeSchema,
    modelFamily: z.string().min(1).max(64),
    modelType: ModelTypeSchema,
    status: ModelStatusSchema,
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    supportsTools: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    supportsVision: z.boolean(),
    supportsAudio: z.boolean(),
    supportsRealtime: z.boolean(),
    supportsPromptCache: z.boolean(),
    supportsReasoning: z.boolean(),
    sensitivityCeiling: ModelSensitivitySchema,
    qualityClass: ModelQualityClassSchema,
    latencyClass: ModelLatencyClassSchema,
    effectiveFrom: UtcTimestampSchema,
    effectiveTo: UtcTimestampSchema.nullable(),
  })
  .strict();
export type ModelRecord = z.infer<typeof ModelRecordSchema>;

export const ModelPriceRecordSchema = z
  .object({
    id: UuidSchema,
    modelId: UuidSchema,
    pricingRegion: z.string().min(1).max(32),
    currency: z.literal("USD"),
    inputPerMillion: z.number().min(0),
    cachedInputPerMillion: z.number().min(0).nullable(),
    outputPerMillion: z.number().min(0),
    effectiveFrom: UtcTimestampSchema,
    effectiveTo: UtcTimestampSchema.nullable(),
  })
  .strict();
export type ModelPriceRecord = z.infer<typeof ModelPriceRecordSchema>;

export const RoutingPolicyRecordSchema = z
  .object({
    id: UuidSchema,
    code: RoutingPolicyCodeSchema,
    taskClass: ModelTaskClassSchema,
    sensitivityClass: ModelSensitivitySchema,
    qualityFloor: ModelQualityClassSchema,
    latencyTargetMs: z.number().int().positive().nullable(),
    costCeilingUsd: z.number().positive().nullable(),
    preferredModels: z.array(UuidSchema).min(1).max(8),
    fallbackModels: z.array(UuidSchema).max(8),
    allowFreeRouter: z.boolean(),
    status: RoutingPolicyStatusSchema,
    version: z.number().int().positive(),
  })
  .strict();
export type RoutingPolicyRecord = z.infer<typeof RoutingPolicyRecordSchema>;

export const ModelCatalogSnapshotSchema = z
  .object({
    providers: z.array(ProviderRecordSchema).max(64),
    models: z.array(ModelRecordSchema).max(256),
    prices: z.array(ModelPriceRecordSchema).max(1024),
    routingPolicies: z.array(RoutingPolicyRecordSchema).max(256),
    loadedAt: UtcTimestampSchema,
  })
  .strict();
export type ModelCatalogSnapshot = z.infer<typeof ModelCatalogSnapshotSchema>;

/** Indexed, read-only view over a snapshot. */
export type ModelCatalog = {
  readonly snapshot: ModelCatalogSnapshot;
  readonly providerById: ReadonlyMap<string, ProviderRecord>;
  readonly providerByCode: ReadonlyMap<string, ProviderRecord>;
  readonly modelById: ReadonlyMap<string, ModelRecord>;
  readonly pricesByModelId: ReadonlyMap<string, readonly ModelPriceRecord[]>;
  readonly policiesByTaskClass: ReadonlyMap<
    string,
    readonly RoutingPolicyRecord[]
  >;
};

export function indexCatalog(input: ModelCatalogSnapshot): ModelCatalog {
  const snapshot = ModelCatalogSnapshotSchema.parse(input);
  const providerById = new Map<string, ProviderRecord>();
  const providerByCode = new Map<string, ProviderRecord>();
  for (const provider of snapshot.providers) {
    providerById.set(provider.id, provider);
    providerByCode.set(provider.code, provider);
  }
  const modelById = new Map<string, ModelRecord>();
  for (const model of snapshot.models) {
    modelById.set(model.id, model);
  }
  const pricesByModelId = new Map<string, ModelPriceRecord[]>();
  for (const price of snapshot.prices) {
    const list = pricesByModelId.get(price.modelId) ?? [];
    list.push(price);
    pricesByModelId.set(price.modelId, list);
  }
  const policiesByTaskClass = new Map<string, RoutingPolicyRecord[]>();
  for (const policy of snapshot.routingPolicies) {
    const list = policiesByTaskClass.get(policy.taskClass) ?? [];
    list.push(policy);
    policiesByTaskClass.set(policy.taskClass, list);
  }
  return {
    snapshot,
    providerById,
    providerByCode,
    modelById,
    pricesByModelId,
    policiesByTaskClass,
  };
}

/** The price row in force at `at` for a model and region, or null. */
export function effectivePrice(
  catalog: ModelCatalog,
  modelId: string,
  at: Date,
  pricingRegion = "global",
): ModelPriceRecord | null {
  const time = at.getTime();
  const candidates = (catalog.pricesByModelId.get(modelId) ?? []).filter(
    (price) =>
      price.pricingRegion === pricingRegion &&
      Date.parse(price.effectiveFrom) <= time &&
      (price.effectiveTo === null || Date.parse(price.effectiveTo) > time),
  );
  // The latest-starting period wins if two overlap by mistake: a newer
  // snapshot is the operator's most recent statement.
  candidates.sort(
    (a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom),
  );
  return candidates[0] ?? null;
}

export function isModelEffective(model: ModelRecord, at: Date): boolean {
  const time = at.getTime();
  return (
    Date.parse(model.effectiveFrom) <= time &&
    (model.effectiveTo === null || Date.parse(model.effectiveTo) > time)
  );
}
