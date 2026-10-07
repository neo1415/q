import { describe, expect, it } from "vitest";

import { parseEmbeddingConfig } from "@capital-q/config/embeddings";
import { EmbeddingProviderFailure } from "@capital-q/q-embeddings";

import {
  composeRecommendationEmbedder,
  refreshCompanyEmbeddings,
} from "../src/recommendations/embeddings.js";
import { createRecordingLogger } from "./support/fakes.js";

/** Q.02: hosted embeddings are selectable, and a failure is never quiet. */

const staging = (provider?: string) =>
  parseEmbeddingConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "staging",
    ...(provider === undefined ? {} : { Q_EMBEDDING_PROVIDER: provider }),
  });

describe("recommendation embedder", () => {
  it("openai: needs only the OpenAI key, and names it when absent", () => {
    const withKey = composeRecommendationEmbedder({
      config: staging("openai"),
      openaiApiKey: "disabled-locally-000000000000",
    });
    expect(withKey.missing).toEqual([]);
    expect(withKey.embedder.describe().providerCode).toBe("openai");
    expect(withKey.embedder.describe().configuration.dimension).toBe(1024);
    expect(
      composeRecommendationEmbedder({
        config: staging("openai"),
        openaiApiKey: undefined,
      }).missing,
    ).toEqual(["OPENAI_API_KEY"]);
  });

  it("local-tei outside local still names its missing runtime address", () => {
    expect(
      composeRecommendationEmbedder({
        config: staging(),
        openaiApiKey: "disabled-locally-000000000000",
      }).missing,
    ).toEqual(["Q_EMBEDDING_BASE_URL"]);
  });

  it("a refresh that cannot embed is an error line with an alert code", async () => {
    const logger = createRecordingLogger();
    const ok = await refreshCompanyEmbeddings({
      semantic: {
        refreshCompanyRepresentations: () =>
          Promise.reject(
            new EmbeddingProviderFailure("down", {
              failureClass: "UNAVAILABLE",
              providerCode: "openai",
            }),
          ),
      },
      logger,
      limit: 10,
    });
    expect(ok).toBe(false);
    expect(logger.lines.at(-1)).toMatchObject({
      level: "error",
      fields: { alert: "SEMANTIC_EMBEDDING_FAILED", failure: "UNAVAILABLE" },
    });
  });
});
