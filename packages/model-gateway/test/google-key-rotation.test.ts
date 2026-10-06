import { ApiError, ThinkingLevel } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ModelExecutionContext,
  ModelProviderRequest,
} from "../src/ports.js";

/**
 * L1 latency sweep (hosted 2026-10-05 12:12): one Gemini key answered
 * 401/403 six times in thirty seconds. Keys rotated only on a rate limit,
 * so each refusal became AUTHENTICATION, the gateway fell back to another
 * provider's model, and the turn waited 3.5-5 s instead of ~1.2 s.
 */
const behaviour = vi.hoisted(() => ({
  byKey: new Map<string, () => Promise<unknown>>(),
  calls: [] as { key: string; config: unknown }[],
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGoogleGenAI {
    readonly models: { generateContent: (params: unknown) => Promise<unknown> };
    constructor(options: { apiKey: string }) {
      this.models = {
        generateContent: (params: unknown) => {
          behaviour.calls.push({
            key: options.apiKey,
            config: (params as { config: unknown }).config,
          });
          const run = behaviour.byKey.get(options.apiKey);
          if (run === undefined) throw new Error("no behaviour");
          return run();
        },
      };
    }
  }
  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const { createGoogleModelProvider } =
  await import("../src/providers/google.js");

const answer = () =>
  Promise.resolve({
    candidates: [
      {
        content: { role: "model", parts: [{ text: "ok" }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    modelVersion: "gemini-3.5-flash-lite",
    responseId: "r1",
  });
const refused = () =>
  Promise.reject(new ApiError({ message: "API key not valid", status: 403 }));

const REQUEST = {
  modelCode: "gemini-3.5-flash-lite",
  messages: [{ role: "user", content: "hello" }],
  maxOutputTokens: 64,
  reasoning: "NONE",
  output: { kind: "TEXT" },
  tools: [],
} as unknown as ModelProviderRequest;
const CONTEXT = {
  signal: new AbortController().signal,
  attemptTimeoutMs: 6_000,
} as unknown as ModelExecutionContext;

describe("Gemini keys", () => {
  beforeEach(() => {
    behaviour.byKey.clear();
    behaviour.calls.length = 0;
  });

  it("a refused key hands the same request to the next key, and is set aside", async () => {
    behaviour.byKey.set("bad", refused);
    behaviour.byKey.set("good", answer);
    const provider = createGoogleModelProvider({
      apiKey: "bad",
      additionalApiKeys: ["good"],
    });
    const first = await provider.generate(REQUEST, CONTEXT);
    expect(first.text).toBe("ok");
    expect(behaviour.calls.map((call) => call.key)).toEqual(["bad", "good"]);
    // The refused key is not asked again on the next request.
    await provider.generate(REQUEST, CONTEXT);
    expect(behaviour.calls.map((call) => call.key)).toEqual([
      "bad",
      "good",
      "good",
    ]);
  });

  it("with a single key, a refusal is still the caller's AUTHENTICATION", async () => {
    behaviour.byKey.set("only", refused);
    const provider = createGoogleModelProvider({ apiKey: "only" });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      failureClass: "AUTHENTICATION",
    });
  });

  it("asks for minimal thinking when the caller asked for none (Gemini 3)", async () => {
    behaviour.byKey.set("k", answer);
    const provider = createGoogleModelProvider({ apiKey: "k" });
    await provider.generate(REQUEST, CONTEXT);
    expect(behaviour.calls[0]?.config).toMatchObject({
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    });
  });
});
