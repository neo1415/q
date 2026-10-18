import {
  ModelCatalogSnapshotSchema,
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";

/**
 * The smallest catalogue that can route one NORMAL_DIALOGUE call: one
 * unreviewed provider (Gemini's class, PUBLIC ceiling) and one model.
 * Deliberately unreviewed, so a test that reaches it under a
 * NETWORK_VISIBLE request is only passing because a synthetic-demo
 * attestation admitted it — which is the behaviour REC-007 A added.
 */

const PROVIDER = "a1000000-0000-4000-8000-000000000002";
const MODEL = "a2000000-0000-4000-8000-000000000002";

export function narratorCatalog(): ModelCatalogSnapshot {
  return ModelCatalogSnapshotSchema.parse({
    providers: [
      {
        id: PROVIDER,
        code: "beta",
        name: "Beta (unreviewed terms)",
        status: "ACTIVE",
        privacyPolicyClass: "UNREVIEWED",
        supportsZeroRetention: false,
        regionSupport: [],
      },
    ],
    models: [
      {
        id: MODEL,
        providerId: PROVIDER,
        modelCode: "beta-fast",
        modelFamily: "beta",
        modelType: "TEXT_GENERATION",
        status: "ACTIVE",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsVision: false,
        supportsAudio: false,
        supportsRealtime: false,
        supportsPromptCache: false,
        supportsReasoning: false,
        sensitivityCeiling: "PUBLIC",
        qualityClass: "STANDARD",
        latencyClass: "FAST",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    prices: [
      {
        id: "a3000000-0000-4000-8000-000000000002",
        modelId: MODEL,
        pricingRegion: "global",
        currency: "USD",
        inputPerMillion: 0,
        cachedInputPerMillion: null,
        outputPerMillion: 0,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    routingPolicies: [
      {
        id: "a4000000-0000-4000-8000-000000000004",
        code: "normal_dialogue.v1",
        taskClass: "NORMAL_DIALOGUE",
        sensitivityClass: "RESTRICTED",
        qualityFloor: "BASIC",
        latencyTargetMs: 20_000,
        costCeilingUsd: 0.1,
        preferredModels: [MODEL],
        fallbackModels: [],
        allowFreeRouter: false,
        status: "ACTIVE",
        version: 1,
      },
    ],
    loadedAt: "2026-09-20T00:00:00.000Z",
  });
}
