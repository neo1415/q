import { describe, expect, it } from "vitest";

import {
  createOpenAIEmbeddingProvider,
  EmbeddingProviderFailure,
  OPENAI_TE3_SMALL_1024_CONFIGURATION,
} from "../src/index.js";

/**
 * Q.02: the hosted adapter. No live call: every test injects fetch, and a
 * disabled key never reaches it.
 */

const unit = (seed: number): number[] => {
  const v = Array.from({ length: 1024 }, (_, i) => Math.sin(seed + i));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
};

function fakeFetch(
  respond: (body: Record<string, unknown>) => { status: number; json: unknown },
) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] =
    [];
  const fetch = ((url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({
      url,
      body,
      auth: new Headers(init.headers).get("authorization") ?? "",
    });
    const { status, json } = respond(body);
    return Promise.resolve(new Response(JSON.stringify(json), { status }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("OpenAI embedding provider", () => {
  it("asks for 1024 dimensions and maps vectors by index, not arrival", async () => {
    const { fetch, calls } = fakeFetch((body) => ({
      status: 200,
      json: {
        data: (body["input"] as string[])
          .map((_t, index) => ({ index, embedding: unit(index) }))
          .reverse(),
      },
    }));
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "sk-test-not-real",
      timeoutMs: 1000,
      fetch,
    });
    const result = await provider.embedDocuments({ inputs: ["a", "b"] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      model: "text-embedding-3-small",
      dimensions: 1024,
      input: ["a", "b"],
    });
    expect(result.embeddings[0]?.vector[0]).toBeCloseTo(unit(0)[0] ?? 0, 12);
    expect(result.embeddings[1]?.vector[0]).toBeCloseTo(unit(1)[0] ?? 0, 12);
    expect(result.embeddings[0]).toMatchObject({
      providerCode: "openai",
      configurationVersion:
        OPENAI_TE3_SMALL_1024_CONFIGURATION.configurationVersion,
      instructionVersion: "none-v1",
      dimension: 1024,
    });
    const query = await provider.embedQuery({
      query: "seed fintech Nigeria",
      task: "MANDATE_MATCHING",
    });
    expect(query.instructionVersion).toBe("capital-q-mandate-matching-v1");
  });

  it("a disabled key is unavailable and sends nothing", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, json: {} }));
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "disabled-locally-000000000000",
      timeoutMs: 1000,
      fetch,
    });
    await expect(
      provider.embedDocuments({ inputs: ["a"] }),
    ).rejects.toMatchObject({ failureClass: "UNAVAILABLE" });
    expect(calls).toHaveLength(0);
    expect((await provider.health()).state).toBe("UNAVAILABLE");
  });

  it("refusals are classed, never echo the provider's message", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 429,
      json: { error: { message: "secret input text quoted here" } },
    }));
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "sk-test-not-real",
      timeoutMs: 1000,
      fetch,
    });
    const error = await provider
      .embedDocuments({ inputs: ["a"] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingProviderFailure);
    expect((error as EmbeddingProviderFailure).failureClass).toBe(
      "UNAVAILABLE",
    );
    expect(String((error as Error).message)).not.toContain("secret");
  });

  it("a wrong dimension is an invalid vector, never resized", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      json: { data: [{ index: 0, embedding: [0.6, 0.8] }] },
    }));
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "sk-test-not-real",
      timeoutMs: 1000,
      fetch,
    });
    await expect(
      provider.embedDocuments({ inputs: ["a"] }),
    ).rejects.toMatchObject({ failureClass: "INVALID_VECTOR" });
  });
});
