import { randomUUID } from "node:crypto";

import type { ModelGatewayRequestInput } from "@capital-q/contracts";

import type {
  ModelCatalogSnapshot,
  ModelPriceRecord,
  ModelRecord,
  RoutingPolicyRecord,
} from "../src/catalog.js";

/**
 * A synthetic catalog for software tests. Two providers with deliberately
 * different data-use standing:
 *
 *   alpha  reviewed, ceiling CONFIDENTIAL, STANDARD/HIGH models, priced
 *   beta   unreviewed, ceiling PUBLIC, cheap BASIC model, priced
 *
 * plus a disabled model and an unpriced model to exercise the edges.
 * Nothing here names a real vendor.
 */

export const IDS = {
  alpha: "11111111-1111-4111-8111-111111111111",
  beta: "22222222-2222-4222-8222-222222222222",
  alphaStandard: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  alphaHigh: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  alphaDisabled: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
  alphaUnpriced: "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
  betaCheap: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  dialoguePolicy: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
  classificationPolicy: "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2",
  deepPolicy: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3",
  extractionPolicy: "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
} as const;

const EPOCH = "2026-01-01T00:00:00.000Z";

function model(
  overrides: Partial<ModelRecord> &
    Pick<ModelRecord, "id" | "providerId" | "modelCode">,
): ModelRecord {
  return {
    modelFamily: "test",
    modelType: "TEXT_GENERATION",
    status: "ACTIVE",
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    supportsTools: false,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsAudio: false,
    supportsRealtime: false,
    supportsPromptCache: false,
    supportsReasoning: false,
    sensitivityCeiling: "CONFIDENTIAL",
    qualityClass: "STANDARD",
    latencyClass: "FAST",
    effectiveFrom: EPOCH,
    effectiveTo: null,
    ...overrides,
  };
}

function price(
  modelId: string,
  inputPerMillion: number,
  outputPerMillion: number,
  extra: Partial<ModelPriceRecord> = {},
): ModelPriceRecord {
  return {
    id: randomUUID(),
    modelId,
    pricingRegion: "global",
    currency: "USD",
    inputPerMillion,
    cachedInputPerMillion: null,
    outputPerMillion,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    ...extra,
  };
}

function policy(
  overrides: Partial<RoutingPolicyRecord> &
    Pick<RoutingPolicyRecord, "id" | "code" | "taskClass" | "preferredModels">,
): RoutingPolicyRecord {
  return {
    sensitivityClass: "RESTRICTED",
    qualityFloor: "BASIC",
    latencyTargetMs: null,
    costCeilingUsd: null,
    fallbackModels: [],
    allowFreeRouter: false,
    status: "ACTIVE",
    version: 1,
    ...overrides,
  };
}

export function testCatalog(
  mutate: (snapshot: ModelCatalogSnapshot) => ModelCatalogSnapshot = (s) => s,
): ModelCatalogSnapshot {
  const snapshot: ModelCatalogSnapshot = {
    providers: [
      {
        id: IDS.alpha,
        code: "alpha",
        name: "Alpha (reviewed)",
        status: "ACTIVE",
        privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
        supportsZeroRetention: true,
        regionSupport: ["global"],
      },
      {
        id: IDS.beta,
        code: "beta",
        name: "Beta (unreviewed, public only)",
        status: "ACTIVE",
        privacyPolicyClass: "UNREVIEWED",
        supportsZeroRetention: false,
        regionSupport: ["global"],
      },
    ],
    models: [
      model({
        id: IDS.alphaStandard,
        providerId: IDS.alpha,
        modelCode: "alpha-standard",
      }),
      model({
        id: IDS.alphaHigh,
        providerId: IDS.alpha,
        modelCode: "alpha-high",
        qualityClass: "HIGH",
        latencyClass: "STANDARD",
        contextWindow: 200_000,
        supportsReasoning: true,
      }),
      model({
        id: IDS.alphaDisabled,
        providerId: IDS.alpha,
        modelCode: "alpha-disabled",
        status: "DISABLED",
      }),
      model({
        id: IDS.alphaUnpriced,
        providerId: IDS.alpha,
        modelCode: "alpha-unpriced",
      }),
      model({
        id: IDS.betaCheap,
        providerId: IDS.beta,
        modelCode: "beta-cheap",
        sensitivityCeiling: "PUBLIC",
        qualityClass: "BASIC",
        contextWindow: 8_000,
        maxOutputTokens: 1_024,
      }),
    ],
    prices: [
      price(IDS.alphaStandard, 1.0, 4.0),
      price(IDS.alphaHigh, 3.0, 12.0),
      price(IDS.alphaDisabled, 1.0, 4.0),
      price(IDS.betaCheap, 0.05, 0.2),
    ],
    routingPolicies: [
      policy({
        id: IDS.dialoguePolicy,
        code: "normal_dialogue.v1",
        taskClass: "NORMAL_DIALOGUE",
        qualityFloor: "BASIC",
        preferredModels: [IDS.alphaStandard],
        fallbackModels: [IDS.betaCheap],
        costCeilingUsd: 0.5,
      }),
      policy({
        id: IDS.classificationPolicy,
        code: "fast_classification.v1",
        taskClass: "FAST_CLASSIFICATION",
        preferredModels: [IDS.betaCheap],
        fallbackModels: [IDS.alphaStandard],
        costCeilingUsd: 0.05,
      }),
      policy({
        id: IDS.deepPolicy,
        code: "deep_investigation.v1",
        taskClass: "DEEP_INVESTIGATION",
        qualityFloor: "HIGH",
        preferredModels: [IDS.alphaHigh],
        fallbackModels: [IDS.alphaStandard, IDS.betaCheap],
        costCeilingUsd: 2,
      }),
      policy({
        id: IDS.extractionPolicy,
        code: "structured_extraction.v1",
        taskClass: "STRUCTURED_EXTRACTION",
        preferredModels: [
          IDS.alphaDisabled,
          IDS.alphaUnpriced,
          IDS.alphaStandard,
        ],
        fallbackModels: [IDS.betaCheap],
      }),
    ],
    loadedAt: EPOCH,
  };
  return mutate(snapshot);
}

export const TENANT = "33333333-3333-4333-8333-333333333333";
export const USER = "44444444-4444-4444-8444-444444444444";
export const RUN = "55555555-5555-4555-8555-555555555555";

export function request(
  overrides: Partial<ModelGatewayRequestInput> = {},
): ModelGatewayRequestInput {
  return {
    taskClass: "NORMAL_DIALOGUE",
    sensitivity: "PUBLIC",
    messages: [
      { role: "SYSTEM", content: "Test instruction." },
      {
        role: "USER",
        content: "Classify: a synthetic sentence about investment software.",
      },
    ],
    output: { kind: "TEXT" },
    budget: {
      maxAttempts: 3,
      maxEstimatedCostUsd: 0.5,
      maxOutputTokens: 256,
      attemptTimeoutMs: 1_000,
    },
    attribution: {
      tenantId: TENANT,
      userId: USER,
      qRunId: RUN,
      correlationId: "cor_test",
    },
    ...overrides,
  };
}
