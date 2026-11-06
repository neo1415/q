import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import type { ModelCatalogSnapshot } from "../src/catalog.js";
import type { AnthropicExchange } from "../src/providers/anthropic.js";
import {
  createAnthropicWireDouble,
  requestRefusal,
  sseOf,
} from "../src/providers/anthropic-wire-double.js";
import { request } from "./fixtures.js";

/**
 * Claude through the REAL gateway, adapter and SDK, over the Messages
 * API's wire shapes (JSON and SSE), with no network (DECISIONS 62; live
 * 2026-11-06: every Q turn on Claude published nothing, and the run said
 * nothing either).
 */

const PROVIDER = "a1000000-0000-4000-8000-000000000004";
const SONNET = "a2000000-0000-4000-8000-000000000030";
const EPOCH = "2026-01-01T00:00:00.000Z";

const catalog: ModelCatalogSnapshot = {
  providers: [
    {
      id: PROVIDER,
      code: "anthropic",
      name: "Anthropic",
      status: "ACTIVE",
      privacyPolicyClass: "NO_TRAINING_DEFAULT_RETENTION",
      supportsZeroRetention: false,
      regionSupport: [],
      ownerApprovedCeiling: "CONFIDENTIAL",
    },
  ],
  models: [
    {
      id: SONNET,
      providerId: PROVIDER,
      modelCode: "claude-sonnet-5-5",
      modelFamily: "claude-sonnet",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsAudio: false,
      supportsRealtime: false,
      supportsPromptCache: true,
      supportsReasoning: true,
      sensitivityCeiling: "CONFIDENTIAL",
      qualityClass: "HIGH",
      latencyClass: "STANDARD",
      effectiveFrom: EPOCH,
      effectiveTo: null,
    },
  ],
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000030",
      modelId: SONNET,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 10,
      effectiveFrom: EPOCH,
      effectiveTo: null,
    },
  ],
  routingPolicies: [
    {
      id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
      code: "normal_dialogue.v2",
      taskClass: "NORMAL_DIALOGUE",
      sensitivityClass: "RESTRICTED",
      qualityFloor: "STANDARD",
      latencyTargetMs: null,
      costCeilingUsd: 0.25,
      preferredModels: [SONNET],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 2,
    },
  ],
  loadedAt: EPOCH,
};

const AnswerSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
});
const structured = {
  kind: "STRUCTURED" as const,
  schemaName: "QAnswer",
  jsonSchema: z.toJSONSchema(AnswerSchema) as Record<string, unknown>,
};
const value = { answer: "Ledgerfold has two founders.", sources: ["profile"] };

function wired(refuse?: (body: Record<string, unknown>) => string | null) {
  const exchanges: AnthropicExchange[] = [];
  const double = createAnthropicWireDouble(
    createFakeModelProvider({
      code: "anthropic",
      script: [{ kind: "JSON", value }],
    }),
    { refuse, onExchange: (exchange) => exchanges.push(exchange) },
  );
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry([double]),
    usage: createInMemoryModelUsageRepository(),
  });
  return { double, gateway, exchanges };
}

// Room for thinking (THINKING_MIN_OUTPUT_TOKENS): the fixture's 256 would
// keep thinking off whatever the level.
const roomy = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.25,
  maxOutputTokens: 8_192,
  attemptTimeoutMs: 5_000,
};

const ask = request({
  sensitivity: "CONFIDENTIAL",
  output: structured,
  reasoning: "NONE",
  budget: roomy,
});

describe("Claude over the Messages API wire, through the gateway", () => {
  it("publishes a streamed, constrained answer: deltas and the validated value", async () => {
    const { double, gateway, exchanges } = wired();
    const deltas: string[] = [];
    const result = await gateway.execute(ask, {
      schema: AnswerSchema,
      onTextDelta: (text) => deltas.push(text),
    });
    expect(result.output).toEqual({ kind: "STRUCTURED", value });
    expect(deltas.join("")).toBe(JSON.stringify(value));
    expect(double.refusals).toEqual([]);
    expect(double.bodies[0]?.["stream"]).toBe(true);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      streaming: true,
      thinking: "between_tools",
      output: "CONSTRAINED",
      outcome: { kind: "MESSAGE", stopReason: "end_turn", blocks: ["text"] },
    });
  });

  it("a format the API refuses is sent again in the plain shape, and remembered", async () => {
    const { double, gateway, exchanges } = wired((body) =>
      body["output_config"] !== undefined &&
      typeof body["output_config"] === "object" &&
      body["output_config"] !== null &&
      "format" in body["output_config"]
        ? "Schema is too complex for compilation."
        : null,
    );
    const first = await gateway.execute(ask, {
      schema: AnswerSchema,
      onTextDelta: () => undefined,
    });
    expect(first.output).toEqual({ kind: "STRUCTURED", value });
    expect(
      exchanges.map((e) => [e.output, e.thinking, e.outcome.kind]),
    ).toEqual([
      ["CONSTRAINED", "between_tools", "ERROR"],
      // Plain: schema by instruction, thinking at the model's default.
      ["INSTRUCTION", "default", "MESSAGE"],
    ]);
    expect(exchanges[0]?.outcome).toMatchObject({
      status: 400,
      type: "invalid_request_error",
      message: expect.stringContaining("Schema is too complex") as unknown,
    });
    // Remembered: the next call with this schema goes by instruction at once.
    await gateway.execute(ask, { schema: AnswerSchema });
    expect(exchanges.at(-1)?.output).toBe("INSTRUCTION");
    expect(exchanges).toHaveLength(3);
    expect(double.refusals).toHaveLength(1);
  });

  it("a refused thinking-off mode is sent again at the model's default thinking", async () => {
    const { gateway, exchanges } = wired((body) =>
      typeof body["thinking"] === "object" &&
      body["thinking"] !== null &&
      (body["thinking"] as { type?: unknown }).type === "between_tools"
        ? "thinking.type.between_tools: not with this request"
        : null,
    );
    const result = await gateway.execute(
      request({
        sensitivity: "CONFIDENTIAL",
        reasoning: "NONE",
        budget: roomy,
      }),
    );
    // The fake's JSON value, as text: the request asked for TEXT.
    expect(result.output).toEqual({
      kind: "TEXT",
      text: JSON.stringify(value),
    });
    expect(exchanges.map((e) => [e.thinking, e.outcome.kind])).toEqual([
      ["between_tools", "ERROR"],
      ["default", "MESSAGE"],
    ]);
  });

  it("a refusal of a shape the adapter did not choose is not retried", async () => {
    const { gateway, exchanges } = wired(() => "messages.0: something else");
    await expect(
      gateway.execute(
        request({
          sensitivity: "CONFIDENTIAL",
          reasoning: "LOW",
          budget: roomy,
        }),
      ),
    ).rejects.toThrow();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.thinking).toBe("adaptive");
  });

  it("emits the Messages API's SSE event sequence", () => {
    const sse = sseOf(
      {
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      [
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "Hello" },
      ],
    );
    const events = [...sse.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("refuses a 1h cache breakpoint after a 5m one, as the API does", () => {
    const body = (first: unknown, second: unknown) => ({
      model: "claude-sonnet-5-5",
      system: [{ type: "text", text: "Charter.", cache_control: first }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hi", cache_control: second }],
        },
      ],
    });
    const long = { type: "ephemeral", ttl: "1h" };
    const short = { type: "ephemeral" };
    expect(requestRefusal(body(long, short))).toBeNull();
    expect(requestRefusal(body(short, long))).toContain("ttl '1h'");
  });
});
