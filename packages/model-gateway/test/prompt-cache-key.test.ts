import { describe, expect, it } from "vitest";

import type { ModelToolDefinition } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createOpenAIModelProvider } from "../src/providers/openai.js";
import { request, TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Production measured 111 of 219 first answer rounds with zero cached
 * input tokens: nothing told the vendor which calls share a prefix. The
 * gateway now sets a hashed cache key for a model the catalogue marks as
 * caching prompts, and the OpenAI adapter sends it as `prompt_cache_key`.
 */

const tool = (name: string): ModelToolDefinition => ({
  name,
  description: `The ${name} tool.`,
  inputJsonSchema: { type: "object", properties: {} },
});

function build(supportsPromptCache: boolean) {
  const catalog = testCatalog((s) => ({
    ...s,
    models: s.models.map((m) => ({
      ...m,
      supportsTools: true,
      supportsPromptCache,
    })),
  }));
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: Array.from({ length: 8 }, () => ({
      kind: "TEXT" as const,
      text: "ok",
    })),
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return { gateway, alpha };
}

describe("the gateway's prompt-cache key", () => {
  it("is a stable 32-hex hash that changes with the user and the tools and holds no raw id", async () => {
    const { gateway, alpha } = build(true);
    await gateway.execute(
      request({ tools: [tool("get_beta"), tool("get_alpha")] }),
    );
    // Same tools in another order: the same key.
    await gateway.execute(
      request({ tools: [tool("get_alpha"), tool("get_beta")] }),
    );
    await gateway.execute(request({ tools: [tool("get_alpha")] }));
    const other = request();
    await gateway.execute(
      request({
        tools: [tool("get_alpha"), tool("get_beta")],
        attribution: {
          ...other.attribution,
          userId: "55555555-5555-4555-8555-555555555555",
        },
      }),
    );
    const keys = alpha.calls.map((call) => call.request.cacheKey);
    expect(keys).toHaveLength(4);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(key).not.toContain(TENANT.replaceAll("-", "").slice(0, 8));
      expect(key).not.toContain(USER.replaceAll("-", "").slice(0, 8));
    }
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("changes with the task class", async () => {
    const { gateway, alpha } = build(true);
    await gateway.execute(request({ taskClass: "NORMAL_DIALOGUE" }));
    await gateway.execute(request({ taskClass: "DEEP_INVESTIGATION" }));
    const [first, second] = alpha.calls.map((call) => call.request.cacheKey);
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("is not set for a model the catalogue does not mark as caching prompts", async () => {
    const { gateway, alpha } = build(false);
    await gateway.execute(request({ tools: [tool("get_alpha")] }));
    expect(alpha.calls[0]?.request.cacheKey).toBeUndefined();
  });
});

describe("the OpenAI adapter's prompt_cache_key", () => {
  type AdapterClient = NonNullable<
    Parameters<typeof createOpenAIModelProvider>[0]["client"]
  >;

  async function sent(cacheKey: string | undefined) {
    const bodies: Record<string, unknown>[] = [];
    const client = {
      responses: {
        create: (body: Record<string, unknown>) => {
          bodies.push(body);
          return Promise.resolve({
            id: "resp_1",
            model: "gpt-5.6-luna",
            status: "completed",
            output_text: "ok",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "ok", annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
            },
          });
        },
      },
    } as unknown as AdapterClient;
    const provider = createOpenAIModelProvider({ apiKey: "unused", client });
    await provider.generate(
      {
        modelCode: "gpt-5.6-luna",
        messages: [{ role: "USER", content: "Is it?" }],
        tools: [],
        maxOutputTokens: 100,
        temperature: undefined,
        reasoning: "NONE",
        output: { kind: "TEXT" },
        ...(cacheKey === undefined ? {} : { cacheKey }),
      },
      {
        signal: new AbortController().signal,
        attemptTimeoutMs: 1000,
        attempt: 1,
        correlationId: "cor_test",
      },
    );
    return bodies[0];
  }

  it("sends the gateway's key", async () => {
    const body = await sent("0123456789abcdef0123456789abcdef");
    expect(body?.["prompt_cache_key"]).toBe("0123456789abcdef0123456789abcdef");
  });

  it("sends nothing when the gateway set no key", async () => {
    const body = await sent(undefined);
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty("prompt_cache_key");
  });
});
