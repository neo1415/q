import { describe, expect, it } from "vitest";

import {
  indexCatalog,
  type ModelRecord,
  type ProviderRecord,
} from "../src/catalog.js";
import { createStaticModelCatalog } from "../src/infrastructure/postgres-catalog.js";
import {
  createEmbeddingCeilingReader,
  embeddingProviderCeiling,
} from "../src/policy/embedding-ceiling.js";

/**
 * Decision 99: what a hosted embedding provider may be sent is the gateway's
 * reviewed provider record, never a constant. OpenAI as configured in
 * production (no training, zero retention enabled) is CONFIDENTIAL and
 * never HIGHLY_CONFIDENTIAL; an absent or disabled provider is nothing.
 */

const openai: ProviderRecord = {
  id: "a1000000-0000-4000-8000-000000000003",
  code: "openai",
  name: "OpenAI",
  status: "ACTIVE",
  privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
  supportsZeroRetention: true,
  regionSupport: [],
};

const embeddingModel: ModelRecord = {
  id: "b1000000-0000-4000-8000-000000000099",
  providerId: openai.id,
  modelCode: "text-embedding-3-small",
  modelFamily: "openai-text-embedding-3",
  modelType: "EMBEDDING",
  status: "ACTIVE",
  contextWindow: 8191,
  maxOutputTokens: 1,
  supportsTools: false,
  supportsStructuredOutput: false,
  supportsVision: false,
  supportsAudio: false,
  supportsRealtime: false,
  supportsPromptCache: false,
  supportsReasoning: false,
  sensitivityCeiling: "INTERNAL",
  qualityClass: "STANDARD",
  latencyClass: "FAST",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
};

const catalog = (
  providers: readonly ProviderRecord[],
  models: readonly ModelRecord[] = [],
) =>
  indexCatalog({
    providers: [...providers],
    models: [...models],
    prices: [],
    routingPolicies: [],
    loadedAt: "2026-11-16T00:00:00.000Z",
  });

describe("embedding provider ceiling", () => {
  it("openai with zero retention is CONFIDENTIAL, never HIGHLY_CONFIDENTIAL", () => {
    expect(
      embeddingProviderCeiling(
        catalog([openai]),
        "openai",
        "text-embedding-3-small",
      ),
    ).toBe("CONFIDENTIAL");
  });

  it("without zero retention the same provider is INTERNAL", () => {
    expect(
      embeddingProviderCeiling(
        catalog([{ ...openai, supportsZeroRetention: false }]),
        "openai",
        "text-embedding-3-small",
      ),
    ).toBe("INTERNAL");
  });

  it("an absent or disabled provider may be sent nothing", () => {
    expect(embeddingProviderCeiling(catalog([]), "openai", "m")).toBeNull();
    expect(
      embeddingProviderCeiling(
        catalog([{ ...openai, status: "DISABLED" }]),
        "openai",
        "m",
      ),
    ).toBeNull();
  });

  it("a model row can only lower the ceiling, and a disabled one closes it", () => {
    expect(
      embeddingProviderCeiling(
        catalog([openai], [embeddingModel]),
        "openai",
        "text-embedding-3-small",
      ),
    ).toBe("INTERNAL");
    expect(
      embeddingProviderCeiling(
        catalog([openai], [{ ...embeddingModel, status: "DISABLED" }]),
        "openai",
        "text-embedding-3-small",
      ),
    ).toBeNull();
  });

  it("reads through the catalogue port", async () => {
    const read = createEmbeddingCeilingReader({
      catalog: createStaticModelCatalog({
        providers: [openai],
        models: [],
        prices: [],
        routingPolicies: [],
        loadedAt: "2026-11-16T00:00:00.000Z",
      }),
      providerCode: "openai",
      modelCode: "text-embedding-3-small",
    });
    await expect(read()).resolves.toBe("CONFIDENTIAL");
  });
});
