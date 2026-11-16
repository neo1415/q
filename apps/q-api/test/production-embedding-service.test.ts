import { describe, expect, it } from "vitest";

import { parseEmbeddingConfig } from "@capital-q/config/embeddings";
import {
  OPENAI_TE3_SMALL_1024_CONFIGURATION,
  QWEN3_EMBEDDING_CONFIGURATION,
} from "@capital-q/q-embeddings";

import { createProductionEmbeddingService } from "../src/composition/q-intelligence.js";

/**
 * Decision 99: q-api's query embedder honours Q_EMBEDDING_PROVIDER=openai
 * under exactly the configuration the workers write chunk vectors with (the
 * OpenAI adapter's default, also asserted by the workers' own test), so a
 * question is embedded into the space the chunks were indexed in. Without
 * it, the self-hosted runtime as before; without a key, lexical-only.
 */

const env = (provider?: string) =>
  parseEmbeddingConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "staging",
    ...(provider === undefined ? {} : { Q_EMBEDDING_PROVIDER: provider }),
  });

describe("q-api production embedding service", () => {
  it("openai: the workers' configuration version, and no missing names with a key", () => {
    const missing: string[][] = [];
    const service = createProductionEmbeddingService({
      config: env("openai"),
      openaiApiKey: "disabled-locally-000000000000",
      onMissing: (names) => missing.push([...names]),
    });
    const { providerCode, configuration } = service.describe();
    expect(providerCode).toBe("openai");
    expect(configuration.runtime).toBe("HOSTED_API");
    expect(configuration.configurationVersion).toBe(
      OPENAI_TE3_SMALL_1024_CONFIGURATION.configurationVersion,
    );
    expect(configuration.dimension).toBe(1024);
    expect(missing).toEqual([]);
  });

  it("openai without a key names it and degrades (no request is made)", async () => {
    const missing: string[][] = [];
    const service = createProductionEmbeddingService({
      config: env("openai"),
      openaiApiKey: undefined,
      onMissing: (names) => missing.push([...names]),
    });
    expect(missing).toEqual([["OPENAI_API_KEY"]]);
    await expect(
      service.embedQuery("market size", "EVIDENCE_RETRIEVAL"),
    ).rejects.toThrow(/not configured/u);
  });

  it("unset: the self-hosted runtime, unchanged (lexical when unconfigured)", () => {
    const missing: string[][] = [];
    const service = createProductionEmbeddingService({
      config: env(),
      openaiApiKey: "disabled-locally-000000000000",
      onMissing: (names) => missing.push([...names]),
    });
    expect(service.describe().configuration.configurationVersion).toBe(
      QWEN3_EMBEDDING_CONFIGURATION.configurationVersion,
    );
    expect(missing).toEqual([["Q_EMBEDDING_BASE_URL"]]);
  });
});
