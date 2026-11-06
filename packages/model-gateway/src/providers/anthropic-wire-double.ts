import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import type { ModelFailureClass } from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import type {
  ModelExecutionContext,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResult,
} from "../ports.js";
import {
  ANTHROPIC_ANSWER_MODEL,
  ANTHROPIC_PROVIDER_CODE,
  createAnthropicModelProvider,
} from "./anthropic.js";

/**
 * The Anthropic adapter over a WIRE double: the real adapter and the real
 * SDK client, with only the HTTP transport replaced. A scripted provider
 * (a FakeModelProvider, a Q-IQ script) decides WHAT the model says; this
 * file says it the way the Messages API does -- a JSON message, or the
 * SSE event stream (message_start, content_block_start/delta/stop with
 * text_delta, input_json_delta and signature_delta, message_delta,
 * message_stop) -- and refuses, with the API's 400 shape, a request the
 * API would refuse. So a test or a scripted eval exercises the SDK's own
 * encoding and stream parsing and the adapter's mapping, end to end
 * through the gateway, with no network and no key.
 *
 * The refusal rules are the ones the Messages API documents for the two
 * models the adapter runs (checked 2026-11-06). They are a floor, not the
 * API: a request this double accepts can still be refused live.
 *
 * For tests and evals only; nothing in a service composes it.
 */

type Captured = {
  readonly request: ModelProviderRequest;
  readonly context: ModelExecutionContext;
};

export type AnthropicWireDouble = ModelProvider & {
  /** Every request body the SDK sent, as JSON. */
  readonly bodies: readonly Record<string, unknown>[];
  /** Why the double refused a request, in order; empty when none was. */
  readonly refusals: readonly string[];
};

const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "allOf",
  "description",
  "title",
  "default",
  "format",
  "minItems",
  "examples",
]);
const MAX_OPTIONAL = 24;
const MAX_UNIONS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The structured-output schema rules; the first breach, or null. */
export function outputSchemaRefusal(schema: unknown): string | null {
  let optional = 0;
  let unions = 0;
  let refusal: string | null = null;
  const visit = (node: unknown, path: string): void => {
    if (refusal !== null || !isRecord(node)) return;
    for (const key of Object.keys(node)) {
      if (!SCHEMA_KEYWORDS.has(key)) {
        refusal = `output_config.format.schema${path}: '${key}' is not supported`;
        return;
      }
    }
    const minItems = node["minItems"];
    if (minItems !== undefined && minItems !== 0 && minItems !== 1) {
      refusal = `output_config.format.schema${path}: minItems must be 0 or 1`;
      return;
    }
    if (node["type"] === "object" || isRecord(node["properties"])) {
      if (node["additionalProperties"] !== false) {
        refusal = `output_config.format.schema${path}: additionalProperties must be false`;
        return;
      }
      const properties = isRecord(node["properties"]) ? node["properties"] : {};
      const required = new Set(
        Array.isArray(node["required"]) ? node["required"] : [],
      );
      for (const [name, child] of Object.entries(properties)) {
        if (!required.has(name)) optional += 1;
        if (
          isRecord(child) &&
          ("anyOf" in child || Array.isArray(child["type"]))
        ) {
          unions += 1;
        }
        visit(child, `${path}.properties.${name}`);
      }
    }
    if (isRecord(node["items"])) visit(node["items"], `${path}.items`);
    for (const key of ["anyOf", "allOf"] as const) {
      const list = node[key];
      if (Array.isArray(list)) {
        list.forEach((child, i) => visit(child, `${path}.${key}[${i}]`));
      }
    }
  };
  visit(schema, "");
  if (refusal !== null) return refusal;
  if (optional > MAX_OPTIONAL) {
    return `output_config.format.schema: ${optional} optional parameters (limit ${MAX_OPTIONAL})`;
  }
  if (unions > MAX_UNIONS) {
    return `output_config.format.schema: ${unions} union-typed parameters (limit ${MAX_UNIONS})`;
  }
  return null;
}

/** The request rules; the first breach, or null. */
export function requestRefusal(body: Record<string, unknown>): string | null {
  const model = body["model"];
  for (const key of ["temperature", "top_p", "top_k"]) {
    if (key in body) return `${key}: non-default sampling is not supported`;
  }
  const choice = body["tool_choice"];
  if (
    isRecord(choice) &&
    (choice["type"] === "any" || choice["type"] === "tool")
  ) {
    return `tool_choice: type "tool" and "any" are not supported for this model.`;
  }
  const thinking = body["thinking"];
  const effort = isRecord(body["output_config"])
    ? body["output_config"]["effort"]
    : undefined;
  if (isRecord(thinking)) {
    const type = thinking["type"];
    if (type === "enabled" || "budget_tokens" in thinking) {
      return `thinking.budget_tokens is not supported for this model`;
    }
    if (type === "disabled" && model === ANTHROPIC_ANSWER_MODEL) {
      return `"thinking.type.disabled" is not supported for this model.`;
    }
    if (type === "between_tools") {
      if (model !== ANTHROPIC_ANSWER_MODEL) {
        return `"thinking.type.between_tools" is not supported for this model.`;
      }
      if (Object.keys(thinking).length !== 1) {
        return `thinking.between_tools takes no other field`;
      }
    }
    if (
      (type === "between_tools" || type === "disabled") &&
      (effort === "xhigh" || effort === "max")
    ) {
      return `output_config.effort '${String(effort)}' is not supported when thinking is disabled on this model.`;
    }
  }
  let breakpoints = 0;
  // Render order is tools, system, messages; a longer TTL may not follow a
  // shorter one.
  let shortSeen = false;
  let ttlRefusal: string | null = null;
  const countCache = (block: unknown): void => {
    if (!isRecord(block) || !("cache_control" in block)) return;
    breakpoints += 1;
    const control = block["cache_control"];
    const ttl = isRecord(control) ? control["ttl"] : undefined;
    if (ttl === "1h" && shortSeen) {
      ttlRefusal =
        "A cache_control breakpoint with ttl '1h' must not come after one with ttl '5m'.";
    }
    if (ttl !== "1h") shortSeen = true;
  };
  const system = body["system"];
  if (Array.isArray(system)) {
    for (const block of system) {
      countCache(block);
      if (
        isRecord(block) &&
        (typeof block["text"] !== "string" || block["text"].trim() === "")
      ) {
        return "system: text content blocks must be non-empty";
      }
    }
  }
  const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
  for (const [i, tool] of tools.entries()) {
    countCache(tool);
    if (!isRecord(tool)) return `tools.${i}: not an object`;
    const name = tool["name"];
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(name)) {
      return `tools.${i}.name: does not match the pattern`;
    }
    const schema = tool["input_schema"];
    if (!isRecord(schema) || schema["type"] !== "object") {
      return `tools.${i}.input_schema.type: Input should be 'object'`;
    }
  }
  const messages: readonly unknown[] = Array.isArray(body["messages"])
    ? (body["messages"] as unknown[])
    : [];
  if (messages.length === 0)
    return "messages: at least one message is required";
  let pendingToolUses: Set<string> = new Set();
  for (const [i, message] of messages.entries()) {
    if (!isRecord(message)) return `messages.${i}: not an object`;
    const role = message["role"];
    if (i === 0 && role !== "user") {
      return "messages.0.role: the first message must use the user role";
    }
    const content = Array.isArray(message["content"])
      ? message["content"]
      : [{ type: "text", text: message["content"] }];
    if (content.length === 0) {
      return `messages.${i}: all messages must have non-empty content`;
    }
    if (role === "user" && pendingToolUses.size > 0) {
      // Every tool_use is answered in the very next user turn, by
      // tool_result blocks that come first in it.
      let seenOther = false;
      for (const block of content) {
        if (isRecord(block) && block["type"] === "tool_result") {
          if (seenOther) {
            return `messages.${i}: tool_result blocks must come before any other content`;
          }
          pendingToolUses.delete(String(block["tool_use_id"]));
        } else {
          seenOther = true;
        }
      }
      if (pendingToolUses.size > 0) {
        return `messages.${i}: tool_use ids were found without tool_result blocks immediately after: ${[...pendingToolUses].join(", ")}`;
      }
    } else if (role === "user") {
      for (const block of content) {
        if (isRecord(block) && block["type"] === "tool_result") {
          return `messages.${i}: unexpected tool_use_id found in tool_result blocks`;
        }
      }
    }
    if (role === "assistant") {
      pendingToolUses = new Set();
      for (const block of content) {
        if (isRecord(block) && block["type"] === "tool_use") {
          pendingToolUses.add(String(block["id"]));
        }
      }
    }
    for (const block of content) {
      countCache(block);
      if (
        isRecord(block) &&
        block["type"] === "text" &&
        (typeof block["text"] !== "string" || block["text"].trim() === "")
      ) {
        return `messages.${i}: text content blocks must be non-empty`;
      }
    }
  }
  const last: unknown = messages.at(-1);
  if (isRecord(last) && last["role"] === "assistant") {
    return "This model does not support assistant message prefill. The conversation must end with a user message.";
  }
  if (breakpoints > 4) {
    return `A maximum of 4 blocks with cache_control may be provided. Found ${breakpoints}.`;
  }
  if (ttlRefusal !== null) return ttlRefusal;
  const format = isRecord(body["output_config"])
    ? body["output_config"]["format"]
    : undefined;
  if (isRecord(format)) {
    if (format["type"] !== "json_schema") {
      return "output_config.format.type: must be json_schema";
    }
    const refusal = outputSchemaRefusal(format["schema"]);
    if (refusal !== null) return refusal;
  }
  return null;
}

const STATUS: Readonly<Record<ModelFailureClass, [number, string]>> = {
  TRANSIENT: [500, "api_error"],
  RATE_LIMIT: [429, "rate_limit_error"],
  PROVIDER_OUTAGE: [529, "overloaded_error"],
  TIMEOUT: [504, "timeout_error"],
  INVALID_MODEL_OUTPUT: [500, "api_error"],
  INVALID_REQUEST: [400, "invalid_request_error"],
  CONTEXT_LIMIT: [413, "request_too_large"],
  AUTHENTICATION: [401, "authentication_error"],
  POLICY_INELIGIBLE: [400, "invalid_request_error"],
  BUDGET_EXCEEDED: [400, "invalid_request_error"],
  CANCELLED: [499, "api_error"],
  PERMANENT: [400, "invalid_request_error"],
};

function errorResponse(
  status: number,
  type: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    {
      status,
      headers: {
        "content-type": "application/json",
        "request-id": "req_wire_double",
      },
    },
  );
}

type Block =
  | {
      readonly type: "thinking";
      readonly thinking: "";
      readonly signature: string;
    }
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    };

/**
 * The prompt cache, modelled: render order is tools, system, messages; a
 * block with cache_control writes the prefix up to and including it, and
 * a later request whose breakpoint prefix was written reads it. Tokens are
 * characters / 4. Stricter than the API (which also looks back up to 20
 * blocks and keeps entries for 5 minutes): a hit here needs an exact
 * breakpoint match, so real caching can only be as good or better.
 */
export function cachedPrefix(
  body: Record<string, unknown>,
  written: Set<string>,
): {
  readonly totalTokens: number;
  readonly readTokens: number;
  readonly writeTokens: number;
} {
  const blocks: unknown[] = [];
  if (Array.isArray(body["tools"]))
    blocks.push(...(body["tools"] as unknown[]));
  if (Array.isArray(body["system"]))
    blocks.push(...(body["system"] as unknown[]));
  if (Array.isArray(body["messages"])) {
    for (const message of body["messages"] as unknown[]) {
      if (!isRecord(message)) continue;
      const content: unknown = message["content"];
      const list: readonly unknown[] = Array.isArray(content)
        ? (content as unknown[])
        : [content];
      for (const block of list) {
        blocks.push({ role: message["role"], block });
      }
    }
  }
  const strip = (value: unknown): unknown =>
    JSON.stringify(value, (key, inner: unknown) =>
      key === "cache_control" ? undefined : inner,
    );
  const hash = createHash("sha256");
  let chars = 0;
  let readChars = 0;
  let lastBreakpointChars = 0;
  const fresh: string[] = [];
  for (const block of blocks) {
    const text = String(strip(block));
    chars += text.length;
    hash.update(text);
    const marked =
      isRecord(block) &&
      (isRecord(block["block"])
        ? "cache_control" in block["block"]
        : "cache_control" in block);
    if (!marked) continue;
    const key = hash.copy().digest("hex");
    lastBreakpointChars = chars;
    if (written.has(key)) readChars = chars;
    else fresh.push(key);
  }
  for (const key of fresh) written.add(key);
  const totalTokens = Math.ceil(chars / 4);
  const readTokens = Math.floor(readChars / 4);
  const writeTokens = Math.max(
    0,
    Math.floor(lastBreakpointChars / 4) - readTokens,
  );
  return { totalTokens, readTokens, writeTokens };
}

function messageOf(
  body: Record<string, unknown>,
  result: ModelProviderResult,
  id: string,
  cache?: {
    readonly totalTokens: number;
    readonly readTokens: number;
    readonly writeTokens: number;
  },
): {
  readonly message: Record<string, unknown>;
  readonly blocks: readonly Block[];
} {
  const thinkingOn =
    isRecord(body["thinking"]) && body["thinking"]["type"] === "adaptive";
  const blocks: Block[] = [
    // Display omitted (the default): thinking text is empty, only signed.
    ...(thinkingOn
      ? [
          {
            type: "thinking" as const,
            thinking: "" as const,
            signature: "sig_wire_double",
          },
        ]
      : []),
    ...(result.text.length > 0
      ? [{ type: "text" as const, text: result.text }]
      : []),
    ...(result.toolCalls ?? []).map((call) => ({
      type: "tool_use" as const,
      id: call.callId,
      name: call.name,
      input: call.arguments,
    })),
  ];
  const stop =
    result.finish === "TOOL_CALLS"
      ? "tool_use"
      : result.finish === "MAX_OUTPUT_TOKENS"
        ? "max_tokens"
        : result.finish === "CONTENT_FILTERED"
          ? "refusal"
          : "end_turn";
  const scripted = result.usage ?? {
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 20,
  };
  // With the cache modelled, input is what was actually sent.
  const usage =
    cache === undefined
      ? scripted
      : {
          inputTokens: cache.totalTokens,
          cachedInputTokens: cache.readTokens,
          outputTokens: scripted.outputTokens,
        };
  const written = cache?.writeTokens ?? 0;
  return {
    blocks,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: String(body["model"]),
      content: blocks,
      stop_reason: stop,
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: Math.max(
          0,
          usage.inputTokens - usage.cachedInputTokens - written,
        ),
        cache_read_input_tokens: usage.cachedInputTokens,
        cache_creation_input_tokens: written,
        output_tokens: usage.outputTokens,
        service_tier: "standard",
      },
    },
  };
}

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) {
    out.push(text.slice(at, at + size));
  }
  return out;
}

/** The Messages API's SSE event stream for one message. */
export function sseOf(
  message: Record<string, unknown>,
  blocks: readonly Block[],
): string {
  const events: [string, unknown][] = [];
  const usage = message["usage"] as Record<string, unknown>;
  events.push([
    "message_start",
    {
      type: "message_start",
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: { ...usage, output_tokens: 1 },
      },
    },
  ]);
  blocks.forEach((block, index) => {
    if (block.type === "thinking") {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature },
        },
      ]);
    } else if (block.type === "text") {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
      ]);
      for (const piece of chunks(block.text, 17)) {
        events.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: piece },
          },
        ]);
      }
    } else {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        },
      ]);
      for (const piece of chunks(JSON.stringify(block.input), 11)) {
        events.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: piece },
          },
        ]);
      }
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: message["stop_reason"], stop_sequence: null },
      usage: { output_tokens: usage["output_tokens"] },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

/**
 * The Anthropic adapter, with `behind` deciding what the model says. The
 * double registers under the adapter's own code (`anthropic`), so routing,
 * eligibility, prices and the usage ledger all apply as they would live.
 */
export function createAnthropicWireDouble(
  behind: ModelProvider,
  options: {
    /**
     * A further refusal on top of the documented rules, for a test that
     * reproduces something the live API refused (null: accept).
     */
    readonly refuse?:
      ((body: Record<string, unknown>) => string | null) | undefined;
    /** Passed to the adapter: one call per request, shapes and outcome. */
    readonly onExchange?: Parameters<
      typeof createAnthropicModelProvider
    >[0]["onExchange"];
  } = {},
): AnthropicWireDouble {
  const current = new AsyncLocalStorage<Captured>();
  const bodies: Record<string, unknown>[] = [];
  const refusals: string[] = [];
  const written = new Set<string>();
  let serial = 0;

  const transport = async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const parsed: unknown = JSON.parse(raw);
    const body = isRecord(parsed) ? parsed : {};
    bodies.push(body);
    const refusal = requestRefusal(body) ?? options.refuse?.(body) ?? null;
    if (refusal !== null) {
      refusals.push(refusal);
      return errorResponse(400, "invalid_request_error", refusal);
    }
    const captured = current.getStore();
    if (captured === undefined) {
      return errorResponse(
        500,
        "api_error",
        "wire double: no request in scope",
      );
    }
    let result: ModelProviderResult;
    try {
      result = await behind.generate(captured.request, {
        ...captured.context,
        onTextDelta: undefined,
      });
    } catch (error: unknown) {
      if (error instanceof ModelProviderFailure) {
        if (error.accountExhausted) {
          return errorResponse(
            400,
            "invalid_request_error",
            "Your credit balance is too low to access the Anthropic API.",
          );
        }
        const [status, type] = STATUS[error.failureClass];
        return errorResponse(status, type, "wire double: scripted failure");
      }
      throw error;
    }
    serial += 1;
    const { message, blocks } = messageOf(
      body,
      result,
      `msg_wire_${serial}`,
      cachedPrefix(body, written),
    );
    if (body["stream"] === true) {
      return new Response(sseOf(message, blocks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req_wire_double",
        },
      });
    }
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_wire_double",
      },
    });
  };

  const adapter = createAnthropicModelProvider({
    apiKey: "disabled-locally-000000000000",
    fetch: transport,
    onExchange: options.onExchange,
  });
  return {
    code: ANTHROPIC_PROVIDER_CODE,
    capabilities: () => adapter.capabilities(),
    generate: (request, context) =>
      current.run({ request, context }, () =>
        adapter.generate(request, context),
      ),
    bodies,
    refusals,
  };
}
