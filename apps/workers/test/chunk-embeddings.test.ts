import { describe, expect, it } from "vitest";

import { parseEmbeddingConfig } from "@capital-q/config/embeddings";
import type { TransactionManager } from "@capital-q/database";
import { createStaticModelCatalog } from "@capital-q/model-gateway";
import { OPENAI_TE3_SMALL_1024_CONFIGURATION } from "@capital-q/q-embeddings";
import type { ChunkEmbeddingRepository } from "@capital-q/q-knowledge";

import {
  chunkEmbeddingCeiling,
  runChunkEmbeddingSweepOnce,
} from "../src/chunk-embeddings.js";
import { composeRecommendationEmbedder } from "../src/recommendations/embeddings.js";
import { createRecordingLogger } from "./support/fakes.js";

/**
 * Decision 99: the worker's chunk sweep writes under the same configuration
 * q-api embeds questions with, takes its ceiling from the gateway's reviewed
 * provider record, and never lets a fault escape the loop.
 */

const config = (provider?: string) =>
  parseEmbeddingConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "staging",
    ...(provider === undefined ? {} : { Q_EMBEDDING_PROVIDER: provider }),
  });

const catalog = createStaticModelCatalog({
  providers: [
    {
      id: "a1000000-0000-4000-8000-000000000003",
      code: "openai",
      name: "OpenAI",
      status: "ACTIVE",
      privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
      supportsZeroRetention: true,
      regionSupport: [],
    },
  ],
  models: [],
  prices: [],
  routingPolicies: [],
  loadedAt: "2026-11-16T00:00:00.000Z",
});

describe("worker chunk embeddings", () => {
  it("writes under the configuration q-api reads with (openai)", () => {
    const { embedder } = composeRecommendationEmbedder({
      config: config("openai"),
      openaiApiKey: "disabled-locally-000000000000",
    });
    expect(embedder.describe().configuration.configurationVersion).toBe(
      OPENAI_TE3_SMALL_1024_CONFIGURATION.configurationVersion,
    );
  });

  it("a hosted embedder is bounded by the reviewed provider ceiling; the self-hosted one is not", async () => {
    const hosted = composeRecommendationEmbedder({
      config: config("openai"),
      openaiApiKey: "disabled-locally-000000000000",
    }).embedder;
    const ceiling = chunkEmbeddingCeiling(hosted, catalog);
    expect(ceiling).toBeDefined();
    await expect(ceiling?.()).resolves.toBe("CONFIDENTIAL");

    const local = composeRecommendationEmbedder({
      config: config(),
      openaiApiKey: undefined,
    }).embedder;
    expect(chunkEmbeddingCeiling(local, catalog)).toBeUndefined();
  });

  it("a database fault is an error line with an alert code, never a crash", async () => {
    const logger = createRecordingLogger();
    const reset = () => Promise.reject(new Error("connection reset"));
    const failing: ChunkEmbeddingRepository = {
      upsert: reset,
      findByWorkIdentity: reset,
      listByChunk: reset,
      findById: reset,
      listChunksMissingEmbedding: reset,
      countChunksWithheldBySensitivity: reset,
      countByConfiguration: reset,
    };
    const transactions: TransactionManager = {
      run: (work) => work({} as never),
    };
    const report = await runChunkEmbeddingSweepOnce({
      sql: {} as never,
      transactions,
      embeddings: composeRecommendationEmbedder({
        config: config("openai"),
        openaiApiKey: "disabled-locally-000000000000",
      }).embedder,
      ceiling: () => Promise.resolve("CONFIDENTIAL"),
      repository: failing,
      logger,
    });
    expect(report).toBeNull();
    expect(logger.lines.at(-1)).toMatchObject({
      level: "error",
      fields: { alert: "CHUNK_EMBEDDING_FAILED" },
    });
  });
});
