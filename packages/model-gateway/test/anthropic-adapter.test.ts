import { describe, expect, it } from "vitest";

import type { ModelMessage } from "@capital-q/contracts";

import { ModelProviderFailure } from "../src/errors.js";
import type { ModelProviderRequest } from "../src/ports.js";
import {
  TOOL_USE_GUIDANCE,
  CONSTRAINED_SCHEMA_MAX_CHARS,
  jsonObjectOf,
  lineHashes,
  stableHeadOf,
  AnthropicAPIError as APIError,
  AnthropicConnectionTimeoutError as APIConnectionTimeoutError,
  AnthropicUserAbortError as APIUserAbortError,
  ANTHROPIC_ANSWER_MODEL,
  ANTHROPIC_FAST_MODEL,
  createAnthropicModelProvider,
  finishOf,
  normalizeError,
  thinkingFor,
  toMessages,
  toOutputSchema,
  toRequest,
  toUsage,
  type AnthropicClient,
} from "../src/providers/anthropic.js";

/**
 * The Anthropic adapter (DECISIONS 62), without a network or a key. The
 * response and error fixtures are the Messages API's recorded shapes: a
 * message with text, tool_use and an empty thinking block (display
 * omitted), and error bodies of the form {type:"error", error:{type, message}}.
 */

const SYSTEM = "You are Q. Capital Q charter (stable prefix).";

function request(
  overrides: Partial<ModelProviderRequest> = {},
): ModelProviderRequest {
  return {
    modelCode: ANTHROPIC_ANSWER_MODEL,
    messages: [
      { role: "SYSTEM", content: SYSTEM },
      { role: "USER", content: "Who are Ledgerfold's founders?" },
    ],
    output: { kind: "TEXT" },
    tools: [],
    maxOutputTokens: 4_096,
    temperature: 0.2,
    reasoning: "MEDIUM",
    ...overrides,
  };
}

const context = (onTextDelta?: (text: string) => void) => ({
  signal: new AbortController().signal,
  attemptTimeoutMs: 5_000,
  attempt: 1,
  correlationId: "cor_anthropic",
  ...(onTextDelta === undefined ? {} : { onTextDelta }),
});

/** A recorded-shape Messages API response. */
const recorded = {
  id: "msg_01SyntheticRecordedShape",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [
    // display omitted (the default): thinking text is empty; never read.
    { type: "thinking", thinking: "", signature: "sig_synthetic" },
    { type: "text", text: "Two founders, ", citations: null },
    { type: "text", text: "per the profile.", citations: null },
    {
      type: "tool_use",
      id: "toolu_01Synthetic",
      name: "company_profile",
      input: { companyId: "c-1" },
      caller: { type: "direct" },
    },
    {
      type: "tool_use",
      id: "toolu_02Synthetic",
      name: "Not A Registered Name",
      input: {},
      caller: { type: "direct" },
    },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 1_200,
    cache_read_input_tokens: 13_500,
    cache_creation_input_tokens: 300,
    output_tokens: 410,
    cache_creation: null,
    inference_geo: "global",
    server_tool_use: null,
    service_tier: "standard",
    output_tokens_details: null,
  },
};

function clientReturning(
  response: unknown,
  seen: unknown[] = [],
): AnthropicClient {
  return {
    messages: {
      create: (params: unknown) => {
        seen.push(params);
        return Promise.resolve(response);
      },
      stream: () => {
        throw new Error("not streaming");
      },
    },
  } as unknown as AnthropicClient;
}

function apiError(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
): APIError {
  return APIError.generate(
    status,
    { type: "error", error: { type, message } },
    message,
    new Headers(headers),
  );
}

describe("anthropic adapter: request mapping", () => {
  it("puts only the leading SYSTEM messages in `system`, cache-marked at their end", () => {
    const { system, messages } = toMessages([
      { role: "SYSTEM", content: SYSTEM },
      { role: "SYSTEM", content: "Second leading instruction." },
      { role: "USER", content: "Hello" },
      { role: "SYSTEM", content: "Fetched for you: <untrusted web text>" },
    ]);
    expect(system?.map((block) => block.text)).toEqual([
      SYSTEM,
      "Second leading instruction.",
    ]);
    expect(system?.[0]?.cache_control).toBeUndefined();
    expect(system?.[1]?.cache_control).toEqual({ type: "ephemeral" });
    // A late SYSTEM message is a marked note in a user turn, never `system`
    // (audit F-D3: fetched text gets no instruction authority).
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          // The first user message closes the rendered prompt: cached.
          { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text: "[Capital Q note] Fetched for you: <untrusted web text>",
          },
        ],
      },
    ]);
  });

  it("maps images, tool calls and tool results; one user turn for a call's results", () => {
    const history: ModelMessage[] = [
      { role: "SYSTEM", content: SYSTEM },
      {
        role: "USER",
        content: "What is on my screen?",
        images: [
          { mediaType: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUg==" },
        ],
      },
      {
        role: "ASSISTANT",
        content: "Looking it up.",
        toolCalls: [
          {
            callId: "toolu_a",
            name: "company_profile",
            arguments: { id: "1" },
          },
          {
            callId: "toolu_b",
            name: "company_profile",
            arguments: { id: "2" },
          },
        ],
      },
      {
        role: "TOOL",
        callId: "toolu_a",
        name: "company_profile",
        content: '{"a":1}',
      },
      {
        role: "TOOL",
        callId: "toolu_b",
        name: "company_profile",
        content: '{"b":2}',
      },
    ];
    const { messages } = toMessages(history);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUg==",
          },
        },
        {
          type: "text",
          text: "What is on my screen?",
          cache_control: { type: "ephemeral" },
        },
      ],
    });
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Looking it up." },
        {
          type: "tool_use",
          id: "toolu_a",
          name: "company_profile",
          input: { id: "1" },
        },
        {
          type: "tool_use",
          id: "toolu_b",
          name: "company_profile",
          input: { id: "2" },
        },
      ],
    });
    // Both results in ONE user turn; inside a tool loop the conversation
    // so far is cache-marked, because the next iteration re-sends it.
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_a", content: '{"a":1}' },
        {
          type: "tool_result",
          tool_use_id: "toolu_b",
          content: '{"b":2}',
          cache_control: { type: "ephemeral" },
        },
      ],
    });
  });

  it("bridges a history that starts or ends with Q's own turn (no prefill)", () => {
    const { messages } = toMessages([
      { role: "SYSTEM", content: SYSTEM },
      { role: "ASSISTANT", content: "Welcome back." },
      { role: "USER", content: "Thanks." },
      { role: "ASSISTANT", content: "Here is the start of it" },
    ]);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages.at(-1)?.content).toEqual([
      { type: "text", text: "[Capital Q note] Continue from your last turn." },
    ]);
  });

  it("sends no temperature and no tool_choice; projects tools as declared", () => {
    const body = toRequest(
      request({
        tools: [
          {
            name: "company_profile",
            description: "Read a company profile.",
            inputJsonSchema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        ] as ModelProviderRequest["tools"],
      }),
    );
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.tools).toEqual([
      {
        name: "company_profile",
        description: "Read a company profile.",
        input_schema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    ]);
    expect(body.max_tokens).toBe(4_096);
    expect(body.model).toBe("claude-sonnet-5-5");
  });
});

describe("anthropic adapter: reasoning levels", () => {
  const ask: ModelMessage[] = [{ role: "USER", content: "Hi" }];

  it("NONE turns thinking off the way each model accepts", () => {
    expect(thinkingFor(ANTHROPIC_ANSWER_MODEL, "NONE", ask)).toEqual({
      thinking: { type: "between_tools" },
      effort: "low",
    });
    expect(thinkingFor(ANTHROPIC_FAST_MODEL, "NONE", ask)).toEqual({
      thinking: { type: "disabled" },
      effort: "low",
    });
  });

  it("LOW, MEDIUM and HIGH are adaptive thinking at that effort; no budget_tokens", () => {
    for (const [level, effort] of [
      ["LOW", "low"],
      ["MEDIUM", "medium"],
      ["HIGH", "high"],
    ] as const) {
      const mapped = thinkingFor(ANTHROPIC_ANSWER_MODEL, level, ask);
      expect(mapped).toEqual({ thinking: { type: "adaptive" }, effort });
      expect(JSON.stringify(mapped)).not.toContain("budget_tokens");
      // display is never asked for: no reasoning text comes back.
      expect(JSON.stringify(mapped)).not.toContain("display");
    }
  });

  it("a tool-call continuation runs with thinking off at the requested effort", () => {
    const continuation: ModelMessage[] = [
      { role: "USER", content: "Compare them" },
      {
        role: "ASSISTANT",
        content: "",
        toolCalls: [{ callId: "t1", name: "company_profile", arguments: {} }],
      },
      { role: "TOOL", callId: "t1", name: "company_profile", content: "{}" },
    ];
    expect(thinkingFor(ANTHROPIC_ANSWER_MODEL, "HIGH", continuation)).toEqual({
      thinking: { type: "between_tools" },
      effort: "high",
    });
  });

  it("refuses a model it has no request rules for, before any request", async () => {
    const seen: unknown[] = [];
    const provider = createAnthropicModelProvider({
      apiKey: "disabled-locally-000000000000",
      client: clientReturning(recorded, seen),
    });
    const refusal = await provider
      .generate(request({ modelCode: "claude-opus-5-5" }), context())
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ModelProviderFailure);
    expect((refusal as ModelProviderFailure).failureClass).toBe(
      "INVALID_REQUEST",
    );
    expect(seen).toHaveLength(0);
  });
});

describe("anthropic adapter: structured output", () => {
  const simple = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["CHAT", "LOOKUP"] },
      note: { type: "string", minLength: 1, maxLength: 200, pattern: "^.+$" },
      count: { type: "integer", minimum: 0, maximum: 9 },
      items: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
      },
      at: { type: "string", format: "date-time" },
      odd: { type: "string", format: "x-custom" },
    },
    required: ["kind"],
  };

  it("constrains a schema within the limits, closing objects and dropping unsupported bounds", () => {
    expect(toOutputSchema(simple)).toEqual({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["CHAT", "LOOKUP"] },
        note: { type: "string" },
        count: { type: "integer" },
        items: { type: "array", items: { type: "string" } },
        at: { type: "string", format: "date-time" },
        odd: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    });
    const body = toRequest(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "TurnReading",
          jsonSchema: simple,
        },
      }),
    );
    expect(body.output_config?.format).toEqual({
      type: "json_schema",
      schema: toOutputSchema(simple),
    });
  });

  it("states the schema in the instructions when it cannot be constrained", () => {
    const record = {
      type: "object",
      properties: {
        tags: { type: "object", additionalProperties: { type: "string" } },
      },
    };
    const many = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`f${i}`, { type: "string" }]),
      ),
    };
    const referenced = { $ref: "#/$defs/x", $defs: { x: { type: "string" } } };
    expect(toOutputSchema(record)).toBeNull();
    expect(toOutputSchema(many)).toBeNull();
    expect(toOutputSchema(referenced)).toBeNull();

    const body = toRequest(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "TurnReading",
          jsonSchema: many,
        },
      }),
    );
    expect(body.output_config?.format).toBeUndefined();
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system.at(-1)?.text).toContain("TurnReading");
    expect(system.at(-1)?.text).toContain(JSON.stringify(many));
    // The stable charter stays first; the breakpoint closes the block list.
    expect(system[0]?.text).toBe(SYSTEM);
    expect(system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("anthropic adapter: responses", () => {
  it("maps text, valid tool calls, usage and finish from a recorded response", async () => {
    const seen: unknown[] = [];
    const provider = createAnthropicModelProvider({
      apiKey: "disabled-locally-000000000000",
      client: clientReturning(recorded, seen),
    });
    const result = await provider.generate(request(), context());
    expect(result).toEqual({
      text: "Two founders, per the profile.",
      // The unregistered tool name is dropped, not passed on.
      toolCalls: [
        {
          callId: "toolu_01Synthetic",
          name: "company_profile",
          arguments: { companyId: "c-1" },
        },
      ],
      // Whole prompt = uncached + cache read + cache write.
      usage: {
        inputTokens: 15_000,
        cachedInputTokens: 13_500,
        outputTokens: 410,
      },
      finish: "TOOL_CALLS",
      modelCode: "claude-sonnet-5-5",
      providerReference: "msg_01SyntheticRecordedShape",
    });
    expect(JSON.stringify(result)).not.toContain("sig_synthetic");
    expect(seen).toHaveLength(1);
  });

  it("maps every stop reason the gateway distinguishes", () => {
    const text = [{ type: "text", text: "x", citations: null }] as never;
    expect(finishOf({ stop_reason: "end_turn", content: text })).toBe(
      "COMPLETE",
    );
    expect(finishOf({ stop_reason: "max_tokens", content: text })).toBe(
      "MAX_OUTPUT_TOKENS",
    );
    expect(finishOf({ stop_reason: "refusal", content: text })).toBe(
      "CONTENT_FILTERED",
    );
    expect(finishOf({ stop_reason: "pause_turn", content: text })).toBe(
      "OTHER",
    );
    // tool_use whose only call is unregistered: nothing to run.
    expect(
      finishOf({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t", name: "Bad Name", input: {} },
        ] as never,
      }),
    ).toBe("OTHER");
  });

  it("reads usage when the cache fields are null", () => {
    expect(
      toUsage({
        usage: {
          ...recorded.usage,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      } as never),
    ).toEqual({ inputTokens: 1_200, cachedInputTokens: 0, outputTokens: 410 });
  });

  it("streams text deltas and returns the final message's result", async () => {
    const final = {
      ...recorded,
      stop_reason: "end_turn",
      content: recorded.content.slice(0, 3),
    };
    const listeners: ((delta: string) => void)[] = [];
    const client = {
      messages: {
        create: () => {
          throw new Error("not this path");
        },
        stream: () => {
          const stream = {
            on: (event: string, listener: (delta: string) => void) => {
              if (event === "text") listeners.push(listener);
              return stream;
            },
            finalMessage: async () => {
              await Promise.resolve();
              for (const piece of ["Two founders, ", "per the profile."]) {
                for (const listener of listeners) listener(piece);
              }
              return final;
            },
          };
          return stream;
        },
      },
    } as unknown as AnthropicClient;
    const deltas: string[] = [];
    const provider = createAnthropicModelProvider({ apiKey: "unused", client });
    const result = await provider.generate(
      request(),
      context((d) => deltas.push(d)),
    );
    expect(deltas.join("")).toBe(result.text);
    expect(result.text).toBe("Two founders, per the profile.");
    expect(result.finish).toBe("COMPLETE");
  });
});

describe("anthropic adapter: failures, in the gateway's classes", () => {
  it("classes rate limits, overload, auth, timeouts and cancellation", () => {
    const limited = normalizeError(
      apiError(
        429,
        "rate_limit_error",
        "Number of request tokens has exceeded your rate limit",
        {
          "retry-after": "7",
        },
      ),
    );
    expect(limited.failureClass).toBe("RATE_LIMIT");
    expect(limited.retryAfterMs).toBe(7_000);
    expect(limited.vendorErrorCode).toBe("rate_limit_error");
    expect(limited.accountExhausted).toBe(false);

    expect(
      normalizeError(apiError(529, "overloaded_error", "Overloaded"))
        .failureClass,
    ).toBe("PROVIDER_OUTAGE");
    expect(
      normalizeError(apiError(500, "api_error", "Internal")).failureClass,
    ).toBe("PROVIDER_OUTAGE");
    expect(
      normalizeError(apiError(401, "authentication_error", "invalid x-api-key"))
        .failureClass,
    ).toBe("AUTHENTICATION");
    expect(
      normalizeError(apiError(504, "timeout_error", "Request timed out"))
        .failureClass,
    ).toBe("TIMEOUT");
    expect(
      normalizeError(apiError(413, "request_too_large", "too large"))
        .failureClass,
    ).toBe("CONTEXT_LIMIT");
    expect(
      normalizeError(apiError(400, "invalid_request_error", "messages: bad"))
        .failureClass,
    ).toBe("INVALID_REQUEST");
    expect(normalizeError(new APIConnectionTimeoutError()).failureClass).toBe(
      "TIMEOUT",
    );
    expect(normalizeError(new APIUserAbortError()).failureClass).toBe(
      "CANCELLED",
    );
  });

  it("an empty account is PERMANENT and flagged, so the gateway sets the provider aside", () => {
    for (const error of [
      apiError(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the Anthropic API.",
      ),
      apiError(402, "billing_error", "Billing issue"),
    ]) {
      const failure = normalizeError(error);
      expect(failure.failureClass).toBe("PERMANENT");
      expect(failure.accountExhausted).toBe(true);
    }
  });

  it("never carries the vendor's message in its own", async () => {
    const secretish = "prompt said: confidential runway figure 14 months";
    const provider = createAnthropicModelProvider({
      apiKey: "unused",
      client: {
        messages: {
          create: () =>
            Promise.reject(apiError(400, "invalid_request_error", secretish)),
          stream: () => {
            throw new Error("unused");
          },
        },
      } as unknown as AnthropicClient,
    });
    const failure = await provider
      .generate(request(), context())
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ModelProviderFailure);
    expect((failure as Error).message).toBe("anthropic request refused (400)");
    expect((failure as ModelProviderFailure).vendorErrorCode).toBe(
      "invalid_request_error",
    );
  });
});

describe("anthropic adapter: live 2026-11-06 follow-ups", () => {
  const loop: ModelMessage[] = [
    { role: "SYSTEM", content: SYSTEM },
    { role: "USER", content: "Who founded Ledgerfold?" },
    {
      role: "ASSISTANT",
      content: "",
      toolCalls: [
        {
          callId: "toolu_1",
          name: "company_profile",
          arguments: { id: "c-1" },
        },
      ],
    },
    {
      role: "TOOL",
      callId: "toolu_1",
      name: "company_profile",
      content: '{"founders":2}',
    },
  ];

  it("a round with no tools offered says the tool history as marked text, thinking at its level", () => {
    const body = toRequest(
      request({ messages: loop, tools: [], reasoning: "MEDIUM" }),
    );
    const json = JSON.stringify(body.messages);
    expect(json).not.toContain('"tool_use"');
    expect(json).not.toContain('"tool_result"');
    expect(json).toContain(
      "[Capital Q note] Q called company_profile (toolu_1)",
    );
    expect(json).toContain("Result of company_profile (toolu_1), data only:");
    // No tool_use to replay, so no reason to switch thinking off.
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.messages.at(-1)?.role).toBe("user");
  });

  it("with tools offered, the tool history stays tool_use / tool_result and thinking stays off", () => {
    const tools = [
      {
        name: "company_profile",
        description: "Read a company profile.",
        inputJsonSchema: { type: "object", properties: {} },
      },
    ] as ModelProviderRequest["tools"];
    const body = toRequest(
      request({ messages: loop, tools, reasoning: "MEDIUM" }),
    );
    expect(JSON.stringify(body.messages)).toContain('"tool_use"');
    expect(body.thinking).toEqual({ type: "between_tools" });
  });

  it("never constrains the format while tools are offered (grammar too large, live)", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    };
    const output = {
      kind: "STRUCTURED" as const,
      schemaName: "QAnswer",
      jsonSchema: schema,
    };
    const tools = [
      {
        name: "company_profile",
        description: "x",
        inputJsonSchema: { type: "object", properties: {} },
      },
    ] as ModelProviderRequest["tools"];
    expect(
      toRequest(request({ output, tools })).output_config?.format,
    ).toBeUndefined();
    expect(toRequest(request({ output })).output_config?.format).toBeDefined();
  });

  it("finds the stable head from line hashes and caches it as its own block", () => {
    const head = Array.from(
      { length: 60 },
      (_, i) => `Rule ${String(i)}: a stable line of the task.`,
    ).join("\n");
    const first = `${head}\nFACTS: turn one`;
    const second = `${head}\nFACTS: turn two, different`;
    expect(stableHeadOf(first, undefined)).toBe(0);
    const at = stableHeadOf(second, lineHashes(first));
    expect(second.slice(0, at)).toBe(`${head}\n`);
    // Too short a shared head is not worth a breakpoint.
    expect(stableHeadOf("a\nb", lineHashes("a\nc"))).toBe(0);

    const body = toRequest(
      request({
        messages: [
          { role: "SYSTEM", content: SYSTEM },
          { role: "USER", content: second },
        ],
      }),
      true,
      at,
    );
    const user = body.messages[0]?.content as {
      text: string;
      cache_control?: unknown;
    }[];
    expect(
      user.map((b) => [b.text.length, b.cache_control !== undefined]),
    ).toEqual([
      [at, true],
      [second.length - at, true],
    ]);
  });

  it("an empty end_turn is asked once more in the plain shape", async () => {
    const empty = {
      ...recorded,
      content: [],
      stop_reason: "end_turn",
      usage: { ...recorded.usage, output_tokens: 1 },
    };
    const answered = {
      ...recorded,
      content: [{ type: "text", text: "Two founders.", citations: null }],
      stop_reason: "end_turn",
    };
    const seen: Record<string, unknown>[] = [];
    let call = 0;
    const client = {
      messages: {
        create: (params: Record<string, unknown>) => {
          seen.push(params);
          call += 1;
          return Promise.resolve(call === 1 ? empty : answered);
        },
        stream: () => {
          throw new Error("unused");
        },
      },
    } as unknown as AnthropicClient;
    const provider = createAnthropicModelProvider({ apiKey: "unused", client });
    const result = await provider.generate(
      request({ reasoning: "NONE" }),
      context(),
    );
    expect(result.text).toBe("Two founders.");
    expect(seen).toHaveLength(2);
    expect(seen[0]?.["thinking"]).toEqual({ type: "between_tools" });
    expect(seen[1]?.["thinking"]).toBeUndefined();
  });

  it("an empty answer to a tool continuation is retried at default thinking too", async () => {
    const empty = {
      ...recorded,
      content: [],
      stop_reason: "end_turn",
      usage: { ...recorded.usage, output_tokens: 1 },
    };
    const answered = {
      ...recorded,
      content: [{ type: "text", text: '{"answer":"x"}', citations: null }],
      stop_reason: "end_turn",
    };
    const seen: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: (params: Record<string, unknown>) => {
          seen.push(params);
          return Promise.resolve(seen.length === 1 ? empty : answered);
        },
        stream: () => {
          throw new Error("unused");
        },
      },
    } as unknown as AnthropicClient;
    const tools = [
      {
        name: "company_profile",
        description: "x",
        inputJsonSchema: { type: "object", properties: {} },
      },
    ] as ModelProviderRequest["tools"];
    const provider = createAnthropicModelProvider({ apiKey: "unused", client });
    const result = await provider.generate(
      request({ messages: loop, tools, reasoning: "LOW" }),
      context(),
    );
    expect(result.text).toBe('{"answer":"x"}');
    expect(seen[0]?.["thinking"]).toEqual({ type: "between_tools" });
    expect(seen[1]?.["thinking"]).toBeUndefined();
    // The tool history is still sent as tool_use / tool_result.
    expect(JSON.stringify(seen[1]?.["messages"])).toContain('"tool_use"');
  });
});

describe("anthropic adapter: live 2026-11-06 round 3", () => {
  it("a short structured reply (the turn reader's 1,200 tokens) runs with thinking off", () => {
    const reader = toRequest(
      request({
        modelCode: ANTHROPIC_FAST_MODEL,
        reasoning: "LOW",
        maxOutputTokens: 1_200,
      }),
    );
    expect(reader.thinking).toEqual({ type: "disabled" });
    const roomy = toRequest(
      request({
        modelCode: ANTHROPIC_FAST_MODEL,
        reasoning: "LOW",
        maxOutputTokens: 8_192,
      }),
    );
    expect(roomy.thinking).toEqual({ type: "adaptive" });
  });

  it("a schema larger than the grammar cap goes by instruction from the start", () => {
    const big = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `field${String(i)}`,
          {
            type: "string",
            enum: Array.from(
              { length: 30 },
              (_, j) => `VALUE_${String(i)}_${String(j)}`,
            ),
          },
        ]),
      ),
      required: Array.from({ length: 12 }, (_, i) => `field${String(i)}`),
    };
    expect(JSON.stringify(toOutputSchema(big)).length).toBeGreaterThan(
      CONSTRAINED_SCHEMA_MAX_CHARS,
    );
    const body = toRequest(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "CompanyAnalyst",
          jsonSchema: big,
        },
      }),
    );
    expect(body.output_config?.format).toBeUndefined();
    // The format is the last word of the final user turn.
    const last = body.messages.at(-1)?.content as { text: string }[];
    expect(last.at(-1)?.text).toContain(
      "Reply with only the CompanyAnalyst JSON object",
    );
  });

  it("keeps the one JSON object when prose surrounds it, and nothing else changes", () => {
    expect(jsonObjectOf('Here it is: {"answer":"x"} Thanks.')).toBe(
      '{"answer":"x"}',
    );
    expect(jsonObjectOf('{"answer":"x"}')).toBe('{"answer":"x"}');
    expect(jsonObjectOf("No JSON here.")).toBe("No JSON here.");
    expect(jsonObjectOf("Broken { not json }")).toBe("Broken { not json }");
  });

  it("a structured answer by instruction is returned as its JSON object", async () => {
    const big = {
      type: "object",
      properties: {
        answer: { type: "string" },
        extra: { type: "string", description: "x".repeat(5_000) },
      },
    };
    const provider = createAnthropicModelProvider({
      apiKey: "unused",
      client: clientReturning({
        ...recorded,
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: 'Sure.\n{"answer":"Two founders."}',
            citations: null,
          },
        ],
      }),
    });
    const result = await provider.generate(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "CompanyAnalyst",
          jsonSchema: big,
        },
      }),
      context(),
    );
    expect(result.text).toBe('{"answer":"Two founders."}');
  });
});

describe("anthropic adapter: tool narration (DECISIONS 67 follow-up)", () => {
  it("says the no-narration line in a tool round's closing reminder, not the system prompt", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    };
    const tools = [
      {
        name: "company_profile",
        description: "x",
        inputJsonSchema: { type: "object", properties: {} },
      },
    ] as ModelProviderRequest["tools"];
    const body = toRequest(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "CompanyAnalyst",
          jsonSchema: schema,
        },
        tools,
      }),
    );
    expect(JSON.stringify(body.system)).not.toContain(TOOL_USE_GUIDANCE);
    const last = body.messages.at(-1)?.content as { text: string }[];
    expect(last.at(-1)?.text).toContain(TOOL_USE_GUIDANCE);
    // Without tools, no such line at all.
    const plain = toRequest(
      request({
        output: {
          kind: "STRUCTURED",
          schemaName: "CompanyAnalyst",
          jsonSchema: { ...schema, description: "x".repeat(5_000) },
        },
      }),
    );
    expect(JSON.stringify(plain)).not.toContain(TOOL_USE_GUIDANCE);
  });
});
