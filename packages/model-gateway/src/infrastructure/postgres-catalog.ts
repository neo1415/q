import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  ModelCatalogSnapshotSchema,
  type ModelCatalogSnapshot,
} from "../catalog.js";
import type { ModelCatalogPort, ModelClock } from "../ports.js";
import { systemModelClock } from "../ports.js";

/**
 * Loads the ai_ops routing configuration (doc 13 §56). Read-only: this
 * port never writes a provider, model, price or policy — those change
 * through migrations and operator data changes, not through the runtime.
 *
 * Cached briefly per process so a burst of Q runs does not re-read four
 * tables per call, and short enough that a kill switch (packet §47) takes
 * effect within the TTL without a restart.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((v) =>
    v instanceof Date ? v.toISOString() : new Date(v).toISOString(),
  );
const Numeric = z.union([z.number(), z.string()]).transform((v) => Number(v));
const NullableNumeric = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v === null ? null : Number(v)));

const ProviderRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.string(),
  privacy_policy_class: z.string(),
  supports_zero_retention: z.boolean(),
  region_support: z.array(z.string()).catch([]),
});

const ModelRow = z.object({
  id: z.string(),
  provider_id: z.string(),
  model_code: z.string(),
  model_family: z.string(),
  model_type: z.string(),
  status: z.string(),
  context_window: z.number().int(),
  max_output_tokens: z.number().int(),
  supports_tools: z.boolean(),
  supports_structured_output: z.boolean(),
  supports_vision: z.boolean(),
  supports_audio: z.boolean(),
  supports_realtime: z.boolean(),
  supports_prompt_cache: z.boolean(),
  supports_reasoning: z.boolean(),
  sensitivity_ceiling: z.string(),
  quality_class: z.string(),
  latency_class: z.string(),
  effective_from: Timestamp,
  effective_to: Timestamp.nullable(),
});

const PriceRow = z.object({
  id: z.string(),
  model_id: z.string(),
  pricing_region: z.string(),
  currency: z.string(),
  input_per_million: Numeric,
  cached_input_per_million: NullableNumeric,
  output_per_million: Numeric,
  effective_from: Timestamp,
  effective_to: Timestamp.nullable(),
});

const PolicyRow = z.object({
  id: z.string(),
  code: z.string(),
  task_class: z.string(),
  sensitivity_class: z.string(),
  quality_floor: z.string(),
  latency_target_ms: z.number().int().nullable(),
  cost_ceiling_usd: NullableNumeric,
  preferred_models: z.array(z.string()),
  fallback_models: z.array(z.string()),
  allow_free_router: z.boolean(),
  status: z.string(),
  version: z.number().int(),
});

export type PostgresModelCatalogOptions = {
  readonly sql: DatabaseExecutor;
  readonly cacheTtlMs?: number | undefined;
  readonly clock?: ModelClock | undefined;
};

export async function loadModelCatalogSnapshot(
  sql: DatabaseExecutor,
  loadedAt: Date,
): Promise<ModelCatalogSnapshot> {
  const [providers, models, prices, policies] = await Promise.all([
    sql`select id, code, name, status, privacy_policy_class, supports_zero_retention, region_support
          from ai_ops.providers order by code`,
    sql`select id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
               supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime,
               supports_prompt_cache, supports_reasoning, sensitivity_ceiling, quality_class, latency_class,
               effective_from, effective_to
          from ai_ops.models order by model_code`,
    sql`select id, model_id, pricing_region, currency, input_per_million, cached_input_per_million,
               output_per_million, effective_from, effective_to
          from ai_ops.model_prices order by effective_from`,
    sql`select id, code, task_class, sensitivity_class, quality_floor, latency_target_ms, cost_ceiling_usd,
               preferred_models, fallback_models, allow_free_router, status, version
          from ai_ops.routing_policies order by task_class, version`,
  ]);

  return ModelCatalogSnapshotSchema.parse({
    providers: z
      .array(ProviderRow)
      .parse(providers)
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        privacyPolicyClass: r.privacy_policy_class,
        supportsZeroRetention: r.supports_zero_retention,
        regionSupport: r.region_support,
      })),
    models: z
      .array(ModelRow)
      .parse(models)
      .map((r) => ({
        id: r.id,
        providerId: r.provider_id,
        modelCode: r.model_code,
        modelFamily: r.model_family,
        modelType: r.model_type,
        status: r.status,
        contextWindow: r.context_window,
        maxOutputTokens: r.max_output_tokens,
        supportsTools: r.supports_tools,
        supportsStructuredOutput: r.supports_structured_output,
        supportsVision: r.supports_vision,
        supportsAudio: r.supports_audio,
        supportsRealtime: r.supports_realtime,
        supportsPromptCache: r.supports_prompt_cache,
        supportsReasoning: r.supports_reasoning,
        sensitivityCeiling: r.sensitivity_ceiling,
        qualityClass: r.quality_class,
        latencyClass: r.latency_class,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
      })),
    prices: z
      .array(PriceRow)
      .parse(prices)
      .map((r) => ({
        id: r.id,
        modelId: r.model_id,
        pricingRegion: r.pricing_region,
        currency: r.currency,
        inputPerMillion: r.input_per_million,
        cachedInputPerMillion: r.cached_input_per_million,
        outputPerMillion: r.output_per_million,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
      })),
    routingPolicies: z
      .array(PolicyRow)
      .parse(policies)
      .map((r) => ({
        id: r.id,
        code: r.code,
        taskClass: r.task_class,
        sensitivityClass: r.sensitivity_class,
        qualityFloor: r.quality_floor,
        latencyTargetMs: r.latency_target_ms,
        costCeilingUsd: r.cost_ceiling_usd,
        preferredModels: r.preferred_models,
        fallbackModels: r.fallback_models,
        allowFreeRouter: r.allow_free_router,
        status: r.status,
        version: r.version,
      })),
    loadedAt: loadedAt.toISOString(),
  });
}

export function createPostgresModelCatalog(
  options: PostgresModelCatalogOptions,
): ModelCatalogPort {
  const ttl = options.cacheTtlMs ?? 60_000;
  const clock = options.clock ?? systemModelClock;
  let cached: { snapshot: ModelCatalogSnapshot; expiresAt: number } | undefined;
  let inflight: Promise<ModelCatalogSnapshot> | undefined;

  return {
    load: async () => {
      const now = clock.now();
      if (cached !== undefined && cached.expiresAt > now.getTime()) {
        return cached.snapshot;
      }
      if (inflight === undefined) {
        inflight = loadModelCatalogSnapshot(options.sql, now)
          .then((snapshot) => {
            cached = { snapshot, expiresAt: now.getTime() + ttl };
            return snapshot;
          })
          .finally(() => {
            inflight = undefined;
          });
      }
      return inflight;
    },
  };
}

/** A fixed snapshot, for tests and for compositions without a database. */
export function createStaticModelCatalog(
  snapshot: ModelCatalogSnapshot,
): ModelCatalogPort {
  const validated = ModelCatalogSnapshotSchema.parse(snapshot);
  return { load: () => Promise.resolve(validated) };
}
