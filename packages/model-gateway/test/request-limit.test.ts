import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  ModelGatewayError,
  type FakeBehaviour,
} from "../src/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * Provider fit (live 2026-11-06 13:00): Groq's 8K tokens-per-minute limit
 * refused a 17k-token turn reading (413) that a timed-out primary had
 * handed to it. A model whose per-request limit a request exceeds is never
 * planned for it: not as primary, fallback or hedge.
 */

const READER_SIZED = "x".repeat(17_000 * 4); // ~17k tokens by the estimate

function build(alpha: readonly FakeBehaviour[]) {
  const alphaProvider = createFakeModelProvider({
    code: "alpha",
    script: alpha,
  });
  const beta = createFakeModelProvider({
    code: "beta",
    script: [{ kind: "TEXT", text: "beta answers" }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((snapshot) => ({
        ...snapshot,
        models: snapshot.models.map((model) =>
          model.id === IDS.betaCheap
            ? { ...model, contextWindow: 131_072, maxRequestTokens: 8_000 }
            : { ...model, contextWindow: 131_072 },
        ),
      })),
    ),
    registry: createModelProviderRegistry([alphaProvider, beta]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  return { gateway, alpha: alphaProvider, beta };
}

const sized = (content: string) =>
  request({
    messages: [{ role: "USER", content }],
    budget: {
      maxAttempts: 3,
      maxEstimatedCostUsd: 5,
      maxOutputTokens: 256,
      attemptTimeoutMs: 1_000,
    },
  });

describe("a model is never sent a request above its per-request limit", () => {
  it("a 17k-token reading is not handed to an 8K-limited fallback when the primary fails", async () => {
    const { gateway, alpha, beta } = build([
      { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
    ]);
    let error: unknown;
    try {
      await gateway.execute(sized(READER_SIZED));
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ModelGatewayError);
    const failed = error as ModelGatewayError;
    expect(failed.failureClass).toBe("PROVIDER_OUTAGE");
    expect(
      failed.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("CONTEXT_WINDOW_TOO_SMALL");
    // The primary had its retries; the limited model was never asked.
    expect(alpha.calls).toHaveLength(2);
    expect(beta.calls).toHaveLength(0);
  });

  it("a request within the limit may still fall back to it", async () => {
    const { gateway, beta } = build([
      { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
    ]);
    const result = await gateway.execute(sized("A short classification."));
    expect(result.providerCode).toBe("beta");
    expect(beta.calls).toHaveLength(1);
  });

  it("the output budget counts toward the limit", async () => {
    const { gateway, beta } = build([
      { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
    ]);
    // ~7.9k input tokens + 256 output > 8,000.
    await expect(
      gateway.execute(sized("x".repeat(7_900 * 4))),
    ).rejects.toBeInstanceOf(ModelGatewayError);
    expect(beta.calls).toHaveLength(0);
  });
});
