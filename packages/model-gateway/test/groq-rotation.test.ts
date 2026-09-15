import { describe, expect, it } from "vitest";

import { ModelProviderFailure } from "../src/errors.js";
import type {
  ModelExecutionContext,
  ModelProviderRequest,
} from "../src/ports.js";
import {
  createGroqModelProvider,
  type GroqLikeClient,
} from "../src/providers/groq.js";

/**
 * Several GroqCloud keys, one adapter: a rate-limited key hands the same
 * request to the next one at once, later requests start from the key that
 * last succeeded, and a limited key is left alone for its cooldown. Which
 * key served a request is never part of the result.
 */

type Call = { readonly key: string };

type ApiLikeError = Error & {
  status: number;
  headers: { get(name: string): string | null };
  error: unknown;
};

function apiError(status: number, code: string, retryAfter?: string): Error {
  const error = new Error(code) as ApiLikeError;
  error.status = status;
  error.headers = new Headers(
    retryAfter === undefined ? {} : { "retry-after": retryAfter },
  );
  error.error = { error: { code } };
  return error;
}

function rateLimited(): Error {
  return apiError(429, "rate_limit_exceeded", "2");
}

function completion(text: string) {
  return {
    id: "cmpl_1",
    model: "openai/gpt-oss-120b",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: text },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  } as never;
}

function fakeClients(behaviour: Record<string, () => Promise<unknown>>) {
  const calls: Call[] = [];
  const factory = (key: string): GroqLikeClient => ({
    chat: {
      completions: {
        create: async () => {
          calls.push({ key });
          const answer = behaviour[key];
          if (answer === undefined) {
            throw new Error(`no behaviour for ${key}`);
          }
          return (await answer()) as never;
        },
      },
    },
  });
  return { factory, calls };
}

const REQUEST: ModelProviderRequest = {
  modelCode: "openai/gpt-oss-120b",
  messages: [{ role: "user", content: "hello" }],
  maxOutputTokens: 64,
  reasoning: "NONE",
  output: { kind: "TEXT" },
  tools: [],
} as unknown as ModelProviderRequest;
const CONTEXT: ModelExecutionContext = {
  signal: new AbortController().signal,
  attemptTimeoutMs: 1_000,
} as unknown as ModelExecutionContext;

describe("groq key rotation", () => {
  it("retries a rate-limited request on the next key and then prefers that key", async () => {
    let firstCalls = 0;
    const { factory, calls } = fakeClients({
      "key-1": () => {
        firstCalls += 1;
        return Promise.reject(rateLimited());
      },
      "key-2": () => Promise.resolve(completion("from two")),
    });
    const provider = createGroqModelProvider({
      apiKey: "key-1",
      additionalApiKeys: ["key-2"],
      clientFactory: factory,
    });
    const first = await provider.generate(REQUEST, CONTEXT);
    expect(first.text).toBe("from two");
    expect(calls.map((c) => c.key)).toEqual(["key-1", "key-2"]);

    // The next request starts on the key that worked; key-1 is cooling down.
    const second = await provider.generate(REQUEST, CONTEXT);
    expect(second.text).toBe("from two");
    expect(calls.map((c) => c.key)).toEqual(["key-1", "key-2", "key-2"]);
    expect(firstCalls).toBe(1);
    expect(JSON.stringify(first)).not.toContain("key-");
  });

  it("fails as a rate limit only when every key is limited", async () => {
    const { factory, calls } = fakeClients({
      "key-1": () => Promise.reject(rateLimited()),
      "key-2": () => Promise.reject(rateLimited()),
    });
    const provider = createGroqModelProvider({
      apiKey: "key-1",
      additionalApiKeys: ["key-2"],
      clientFactory: factory,
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      failureClass: "RATE_LIMIT",
    });
    expect(calls.map((c) => c.key)).toEqual(["key-1", "key-2"]);
  });

  it("does not rotate on failures that are not rate limits", async () => {
    const authError = apiError(401, "invalid_api_key");
    const { factory, calls } = fakeClients({
      "key-1": () => Promise.reject(authError),
      "key-2": () => Promise.resolve(completion("never")),
    });
    const provider = createGroqModelProvider({
      apiKey: "key-1",
      additionalApiKeys: ["key-2"],
      clientFactory: factory,
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toBeInstanceOf(
      ModelProviderFailure,
    );
    expect(calls.map((c) => c.key)).toEqual(["key-1"]);
  });
});
