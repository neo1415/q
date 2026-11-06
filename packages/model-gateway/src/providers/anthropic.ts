import { createHash } from "node:crypto";

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import type {
  CacheControlEphemeral,
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  OutputConfig,
  TextBlockParam,
  ThinkingConfigParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";

import {
  ModelToolNameSchema,
  type ModelFailureClass,
  type ModelFinishStatus,
  type ModelMessage,
  type ModelOutputSpec,
  type ModelReasoningLevel,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelUsage,
} from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import { createSectionOrder } from "./anthropic-sections.js";
import type {
  ModelExecutionContext,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResult,
} from "../ports.js";

/**
 * Anthropic adapter, behind the official SDK's Messages API. The only file
 * in Capital Q that imports it.
 *
 * DECISIONS 62 (owner, 2026-11-06): Claude for reasoning, OpenAI for voice,
 * OpenAI the fallback either way. This adapter is reached only through the
 * gateway's routing, after the same eligibility as every other provider;
 * whether a CONFIDENTIAL request may come here is the catalogue's call
 * (ai_ops.providers, migration 20261231280000), never this file's.
 *
 * Held to what the other adapters are held to. Anthropic's shapes stop
 * here; the only tools declared are the canonical definitions the Tool
 * Registry offered; SDK retries are off because the gateway owns them;
 * thinking is never displayed or read back, so no chain of thought reaches
 * a result; and the key never leaves this process.
 */

export const ANTHROPIC_PROVIDER_CODE = "anthropic";

/**
 * The SDK's error classes, for the adapter's tests: the provider-boundary
 * rule keeps every SDK import inside this directory, and the tests need
 * real instances to prove the failure mapping.
 */
export {
  APIConnectionTimeoutError as AnthropicConnectionTimeoutError,
  APIError as AnthropicAPIError,
  APIUserAbortError as AnthropicUserAbortError,
};

/** Sonnet-class: answers, synthesis, comparison, investigation. */
export const ANTHROPIC_ANSWER_MODEL = "claude-sonnet-5-5";
/** Haiku-class: the turn reader, fast classification and extraction. */
export const ANTHROPIC_FAST_MODEL = "claude-haiku-5-5";

/**
 * How each permitted model turns thinking OFF. The two differ: Sonnet 5.5
 * refuses `disabled` with a 400 and takes `between_tools` (its lowest
 * setting, only at effort high or below); Haiku 5.5 takes `disabled` at
 * effort high or below. Anything not listed is refused before a request
 * is made: a model with unknown request rules is a configuration fault,
 * and a loud one.
 */
const THINKING_OFF: Readonly<Record<string, ThinkingConfigParam>> = {
  [ANTHROPIC_ANSWER_MODEL]: { type: "between_tools" },
  [ANTHROPIC_FAST_MODEL]: { type: "disabled" },
};

export const ANTHROPIC_MODELS: readonly string[] = Object.keys(THINKING_OFF);

/**
 * The caller's reasoning level as this vendor spells it. These models take
 * no thinking budget at all (`budget_tokens` is a 400 on both); depth is
 * set by `output_config.effort` with adaptive thinking. NONE turns thinking
 * off and asks for the least effort.
 */
const EFFORT: Readonly<
  Record<ModelReasoningLevel, NonNullable<OutputConfig["effort"]>>
> = {
  NONE: "low",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export type AnthropicProviderOptions = {
  readonly apiKey: string;
  /** For tests: a client already built. */
  readonly client?: AnthropicClient | undefined;
  /**
   * For tests and evals: the HTTP transport under the real SDK client, so
   * the SDK's own request encoding and SSE parsing run against recorded
   * response shapes (anthropic-wire-double.ts). Ignored with `client`.
   */
  readonly fetch?: typeof fetch | undefined;
  /** Opt-in diagnostics: called once per request with its shape and outcome. */
  readonly onExchange?: ((exchange: AnthropicExchange) => void) | undefined;
};

/** The part of the SDK client this adapter uses; the test seam. */
export type AnthropicClient = {
  readonly messages: Pick<Anthropic["messages"], "create" | "stream">;
};

// --- thinking ----------------------------------------------------------------

/**
 * A request continuing its own tool calls: an ASSISTANT turn with tool
 * calls after the last USER message.
 *
 * Capital Q's message contract does not carry thinking blocks (nothing of
 * a model's reasoning is kept), so an assistant tool-call turn comes back
 * to the vendor without the thinking that preceded it. With thinking on,
 * that is a turn the API may refuse; with thinking off it is an ordinary
 * history. So a continuation runs with thinking off at the requested
 * effort. The first call of a turn, where the deciding happens, keeps it.
 */
export function continuesToolCalls(messages: readonly ModelMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.role === "USER") return false;
    if (message.role === "ASSISTANT" && (message.toolCalls?.length ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Thinking shares the output budget. Below this, a short structured reply
 * (the turn reader's is 1,200 tokens) runs with thinking off: live
 * 2026-11-06, Haiku's adaptive thinking ended four reader calls at
 * max_tokens with the JSON unfinished, and each was asked again.
 */
export const THINKING_MIN_OUTPUT_TOKENS = 4_096;

export function thinkingFor(
  modelCode: string,
  reasoning: ModelReasoningLevel,
  messages: readonly ModelMessage[],
  /** False when tools are not offered: the history is then flattened to text. */
  toolsOffered = true,
  /** The attempt's output budget; thinking shares it. */
  maxOutputTokens: number = THINKING_MIN_OUTPUT_TOKENS,
): {
  readonly thinking: ThinkingConfigParam;
  readonly effort: NonNullable<OutputConfig["effort"]>;
} {
  const off = THINKING_OFF[modelCode];
  if (off === undefined) {
    throw new ModelProviderFailure(
      `anthropic adapter refuses model ${modelCode}`,
      {
        failureClass: "INVALID_REQUEST",
        providerCode: ANTHROPIC_PROVIDER_CODE,
      },
    );
  }
  const effort = EFFORT[reasoning];
  if (
    reasoning === "NONE" ||
    maxOutputTokens < THINKING_MIN_OUTPUT_TOKENS ||
    (toolsOffered && continuesToolCalls(messages))
  ) {
    return { thinking: off, effort };
  }
  // Adaptive is the only on-mode these models accept. `display` is left at
  // its default (omitted): thinking text is never returned, never read.
  return { thinking: { type: "adaptive" }, effort };
}

// --- structured output --------------------------------------------------------

/**
 * Constrained decoding's published limits (structured outputs, checked
 * 2026-11-06): across every strict schema in a request, at most 24
 * optional properties and 16 union-typed properties; every object closed
 * with `additionalProperties: false`; no recursion; no numeric, string or
 * (beyond minItems 0/1) array bounds. A schema past these is a 400 every
 * time, which would spend a fallback on every call.
 */
const MAX_OPTIONAL_PROPERTIES = 24;
const MAX_UNION_PROPERTIES = 16;
const SUPPORTED_FORMATS: ReadonlySet<string> = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);
/**
 * Bounds the grammar cannot carry. They are dropped from what is SENT
 * only: the gateway validates every answer against the caller's Zod
 * schema, so each bound is still enforced, after the fact.
 */
const DROPPED_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "patternProperties",
  "propertyNames",
]);

class UnsupportedSchema extends Error {}

/**
 * The caller's JSON Schema as constrained decoding accepts it, or null
 * when it cannot be expressed within the limits (an open record, a
 * reference, or too many optional or union-typed properties). Null is not
 * a failure: the schema is then stated in the instructions instead, and
 * the gateway's validation and correction pass apply exactly as they do
 * for every provider.
 */
export function toOutputSchema(
  schema: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  let optional = 0;
  let unions = 0;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node !== "object" || node === null) return node;
    const source = node as Record<string, unknown>;
    if ("$ref" in source || "$defs" in source || "definitions" in source) {
      // References may be recursive, and resolving them is not this file's
      // business; the instruction route handles them.
      throw new UnsupportedSchema("reference");
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (DROPPED_KEYWORDS.has(key)) continue;
      if (key === "format" && !SUPPORTED_FORMATS.has(String(value))) continue;
      if (key === "minItems") {
        if (value === 0 || value === 1) out[key] = value;
        continue;
      }
      if (key === "properties" && typeof value === "object" && value !== null) {
        const properties: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(value)) {
          if (
            typeof child === "object" &&
            child !== null &&
            ("anyOf" in child ||
              Array.isArray((child as { type?: unknown }).type))
          ) {
            unions += 1;
          }
          properties[name] = visit(child);
        }
        out[key] = properties;
        continue;
      }
      out[key] = visit(value);
    }
    const isObject =
      source["type"] === "object" || typeof source["properties"] === "object";
    if (isObject) {
      const additional = source["additionalProperties"];
      if (additional !== undefined && additional !== false) {
        // An open record: closing it would forbid every key it exists for.
        throw new UnsupportedSchema("record");
      }
      out["additionalProperties"] = false;
      const names = Object.keys(
        (source["properties"] as Record<string, unknown> | undefined) ?? {},
      );
      const required = new Set(
        Array.isArray(source["required"]) ? source["required"] : [],
      );
      optional += names.filter((name) => !required.has(name)).length;
    }
    return out;
  };
  try {
    const result = visit(schema) as Record<string, unknown>;
    if (optional > MAX_OPTIONAL_PROPERTIES || unions > MAX_UNION_PROPERTIES) {
      return null;
    }
    return result;
  } catch (error: unknown) {
    if (error instanceof UnsupportedSchema) return null;
    throw error;
  }
}

/** The JSON instruction used when a schema cannot be constrained. */
export function schemaInstruction(
  output: Extract<ModelOutputSpec, { kind: "STRUCTURED" }>,
): string {
  return [
    `Reply with exactly one JSON object named ${output.schemaName}, and nothing else: no prose before or after it.`,
    "It must conform to this JSON Schema:",
    JSON.stringify(output.jsonSchema),
  ].join("\n");
}

// --- messages ------------------------------------------------------------------

const CACHE: CacheControlEphemeral = { type: "ephemeral" };

/**
 * Capital Q's messages as a Messages API request. Nothing else travels.
 *
 * Only the LEADING system messages become the system prompt (audit F-D3):
 * a SYSTEM message added later in the turn can carry fetched, untrusted
 * text, and lifting it into `system` would give web content instruction
 * authority. It is said where it was added, as a marked note in a user
 * turn, exactly as the OpenAI and Google adapters place it.
 *
 * Tool history without tools (`flattenTools`): a round that offers no
 * tools but replays earlier tool_use / tool_result blocks came back live
 * as an empty end_turn (2026-11-06, the final round of a tool loop: no
 * blocks, one output token, twice). With no tool on offer, the calls and
 * their results are said as marked text instead -- the same facts, still
 * data, never instructions -- so the round is an ordinary conversation.
 *
 * Prompt caching, at most four breakpoints (render order tools, system,
 * messages):
 *   1. the end of the system prompt: tools + charter;
 *   2. `stableHead` characters into the first user message: the rendered
 *      task text every turn of this kind shares, before its variables
 *      (found by the caller from the previous request; see stableHeadOf);
 *   3. the end of the first user message: the whole rendered prompt, which
 *      every later call in the same turn (tool rounds, follow-ups) re-sends;
 *   4. inside a tool loop, the conversation so far.
 */
export function toMessages(
  messages: readonly ModelMessage[],
  extraInstruction?: string,
  options: {
    readonly flattenTools?: boolean | undefined;
    readonly stableHead?: number | undefined;
  } = {},
): {
  readonly system: TextBlockParam[] | undefined;
  readonly messages: MessageParam[];
} {
  const flatten = options.flattenTools === true;
  const leading = messages.findIndex((message) => message.role !== "SYSTEM");
  const system: TextBlockParam[] = (
    leading === -1 ? messages : messages.slice(0, leading)
  ).map((message) => ({ type: "text", text: message.content }));
  if (extraInstruction !== undefined) {
    system.push({ type: "text", text: extraInstruction });
  }
  const last = system.at(-1);
  if (last !== undefined) last.cache_control = CACHE;

  const out: MessageParam[] = [];
  // The API combines consecutive turns of one role; doing it here keeps
  // every tool result for one assistant turn in the single user turn the
  // API requires, ahead of any note that follows them.
  const push = (
    role: "user" | "assistant",
    blocks: readonly ContentBlockParam[],
  ): void => {
    if (blocks.length === 0) return;
    const previous = out.at(-1);
    if (previous !== undefined && previous.role === role) {
      previous.content = [
        ...(previous.content as ContentBlockParam[]),
        ...blocks,
      ];
      return;
    }
    out.push({ role, content: [...blocks] });
  };

  let sawToolResult = false;
  let firstUser = true;
  for (const [index, message] of messages.entries()) {
    if (message.role === "SYSTEM") {
      if (leading !== -1 && index >= leading) {
        push("user", [
          { type: "text", text: `[Capital Q note] ${message.content}` },
        ]);
      }
      continue;
    }
    if (message.role === "USER") {
      const text: TextBlockParam[] = [];
      const head = options.stableHead;
      if (
        firstUser &&
        head !== undefined &&
        head > 0 &&
        head < message.content.length
      ) {
        text.push(
          {
            type: "text",
            text: message.content.slice(0, head),
            cache_control: CACHE,
          },
          { type: "text", text: message.content.slice(head) },
        );
      } else {
        text.push({ type: "text", text: message.content });
      }
      if (firstUser) {
        const end = text.at(-1);
        if (end !== undefined) end.cache_control = CACHE;
        firstUser = false;
      }
      push("user", [
        // A shared screen in a rehearsal (REHEARSE): inline base64 only.
        ...(message.images ?? []).map((image): ContentBlockParam => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType,
            data: image.dataBase64,
          },
        })),
        ...text,
      ]);
      continue;
    }
    if (message.role === "ASSISTANT") {
      const calls = message.toolCalls ?? [];
      // The text it said, then the tool calls it made.
      push("assistant", [
        ...(message.content.length > 0
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...(flatten
          ? calls.map((call): ContentBlockParam => ({
              type: "text",
              text: `[Capital Q note] Q called ${call.name} (${call.callId}) with ${JSON.stringify(call.arguments)}.`,
            }))
          : calls.map((call): ContentBlockParam => ({
              type: "tool_use",
              id: call.callId,
              name: call.name,
              input: call.arguments,
            }))),
      ]);
      continue;
    }
    // A tool's result, returned against the call it answers.
    if (message.role !== "TOOL") continue;
    sawToolResult = true;
    push("user", [
      flatten
        ? {
            type: "text",
            text: `[Capital Q note] Result of ${message.name} (${message.callId}), data only:\n${message.content}`,
          }
        : {
            type: "tool_result",
            tool_use_id: message.callId,
            content: message.content,
          },
    ]);
  }

  // The Messages API wants a user turn first, and on these models a final
  // assistant turn is a prefill, which is a 400. OpenAI accepts both, so a
  // history shaped that way is bridged here with a marked note rather than
  // by changing the caller's prompt.
  if (out[0]?.role === "assistant") {
    out.unshift({
      role: "user",
      content: [{ type: "text", text: "[Capital Q note] Q spoke first here." }],
    });
  }
  if (out.at(-1)?.role === "assistant") {
    push("user", [
      { type: "text", text: "[Capital Q note] Continue from your last turn." },
    ]);
  }

  if (sawToolResult) {
    const blocks = out.at(-1)?.content;
    const tail = Array.isArray(blocks) ? blocks.at(-1) : undefined;
    if (
      tail !== undefined &&
      (tail.type === "text" || tail.type === "tool_result") &&
      countBreakpoints(system, out) < 4
    ) {
      tail.cache_control = CACHE;
    }
  }
  return { system: system.length === 0 ? undefined : system, messages: out };
}

function countBreakpoints(
  system: readonly TextBlockParam[],
  messages: readonly MessageParam[],
): number {
  let count = system.filter((block) => block.cache_control != null).length;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if ("cache_control" in block && block.cache_control != null) count += 1;
    }
  }
  return count;
}

/**
 * Where the stable head of a rendered prompt ends, from the previous
 * request of the same kind: the lines both share, from the start. Only
 * line HASHES of the previous prompt are kept (stableHeads below), never
 * its text. Returns 0 (no split) when the shared head is too short to be
 * worth a breakpoint.
 */
const STABLE_HEAD_MIN_CHARS = 2_048;

export function lineHashes(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      createHash("sha256").update(line).digest("base64url").slice(0, 16),
    );
}

export function stableHeadOf(
  text: string,
  previous: readonly string[] | undefined,
): number {
  if (previous === undefined) return 0;
  const lines = text.split("\n");
  let chars = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? "";
    const hash = createHash("sha256")
      .update(line)
      .digest("base64url")
      .slice(0, 16);
    if (previous[index] !== hash) break;
    chars += line.length + 1;
  }
  return chars >= STABLE_HEAD_MIN_CHARS ? chars : 0;
}

/** The canonical tool definitions, and nothing provider-side. */
function toTools(tools: readonly ModelToolDefinition[]): Tool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputJsonSchema as Tool["input_schema"],
  }));
}

// --- response ------------------------------------------------------------------

/**
 * Usage in the gateway's terms. Anthropic reports uncached, cache-read and
 * cache-written input separately; the gateway's `inputTokens` is the whole
 * prompt and `cachedInputTokens` the part served from cache, so the three
 * are summed. Cache writes are priced by the gateway at the base input
 * rate; the vendor bills them at 1.25x, so a turn's recorded cost
 * understates a write by a quarter of its tokens (receipt 2026-11-06).
 * Thinking is already inside `output_tokens`; it is not reported again as
 * reasoning tokens, which the gateway would add a second time.
 */
export function toUsage(message: Pick<Message, "usage">): ModelUsage {
  const usage = message.usage;
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + read + written,
    cachedInputTokens: read,
    outputTokens: usage.output_tokens,
  };
}

export function textOf(message: Pick<Message, "content">): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("");
}

/**
 * The tool calls the model proposed. A name the Tool Registry would not
 * recognise is dropped rather than passed on; the executor would refuse it
 * anyway.
 */
export function toToolCalls(
  message: Pick<Message, "content">,
): readonly ModelToolCall[] | undefined {
  const calls: ModelToolCall[] = [];
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    const name = ModelToolNameSchema.safeParse(block.name);
    if (!name.success) continue;
    const input: unknown = block.input;
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      continue;
    }
    calls.push({
      callId: block.id,
      name: name.data,
      arguments: input as Record<string, unknown>,
    });
  }
  return calls.length === 0 ? undefined : calls;
}

export function finishOf(
  message: Pick<Message, "stop_reason" | "content">,
): ModelFinishStatus {
  switch (message.stop_reason) {
    case "end_turn":
    case "stop_sequence":
      return "COMPLETE";
    case "tool_use":
      return toToolCalls(message) === undefined ? "OTHER" : "TOOL_CALLS";
    case "max_tokens":
      return "MAX_OUTPUT_TOKENS";
    case "refusal":
      return "CONTENT_FILTERED";
    case "pause_turn":
    case "model_context_window_exceeded":
    case null:
      return "OTHER";
  }
  // A stop reason the SDK's types do not know yet.
  return "OTHER";
}

/**
 * By instruction only: when prose precedes (or follows) one JSON object
 * that parses, the object is the answer. The gateway still validates it
 * against the caller's schema; anything else is returned as written.
 */
export function jsonObjectOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) return text;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return text;
  const candidate = trimmed.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(candidate);
    return typeof parsed === "object" && parsed !== null ? candidate : text;
  } catch {
    return text;
  }
}

function result(message: Message, structured = false): ModelProviderResult {
  return {
    text: structured ? jsonObjectOf(textOf(message)) : textOf(message),
    toolCalls: toToolCalls(message),
    usage: toUsage(message),
    finish: finishOf(message),
    modelCode: message.model,
    providerReference: message.id,
  };
}

// --- errors --------------------------------------------------------------------

/**
 * The account, not the request: nothing will be served until someone tops
 * up. Anthropic says so with a `billing_error` (or a 402), and has also
 * said it as a 400 `invalid_request_error` whose only distinguishing mark
 * is its message. That one wording is matched, narrowly, because getting
 * it wrong is the 2026-10-01 failure again: an empty account treated as a
 * bad request is retried on every turn instead of being set aside.
 */
const CREDIT_EXHAUSTED_MESSAGE = /credit balance is too low/i;

export function accountExhausted(error: APIError): boolean {
  if (error.status === 402 || error.type === "billing_error") return true;
  return (
    error.status === 400 &&
    error.type === "invalid_request_error" &&
    CREDIT_EXHAUSTED_MESSAGE.test(error.message)
  );
}

export function classify(error: APIError): ModelFailureClass {
  const status = error.status;
  if (error.type === "overloaded_error") return "PROVIDER_OUTAGE";
  if (error.type === "timeout_error") return "TIMEOUT";
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 413) return "CONTEXT_LIMIT";
  if (status === 400 || status === 404 || status === 422) {
    return "INVALID_REQUEST";
  }
  if (status !== undefined && status >= 500) return "PROVIDER_OUTAGE";
  return "TRANSIENT";
}

function retryAfterMs(error: APIError): number | undefined {
  const header = error.headers?.get("retry-after");
  if (header === null || header === undefined) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : undefined;
}

export function normalizeError(error: unknown): ModelProviderFailure {
  if (error instanceof ModelProviderFailure) return error;
  if (error instanceof APIUserAbortError) {
    return new ModelProviderFailure("anthropic request aborted", {
      failureClass: "CANCELLED",
      providerCode: ANTHROPIC_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderFailure("anthropic request timed out", {
      failureClass: "TIMEOUT",
      providerCode: ANTHROPIC_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new ModelProviderFailure("anthropic connection failed", {
      failureClass: "TRANSIENT",
      providerCode: ANTHROPIC_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIError) {
    // instanceof widens the SDK's generic to any; this is its declared shape.
    const refused: APIError = error as APIError;
    const exhausted = accountExhausted(refused);
    const status = refused.status;
    const retryAfter = retryAfterMs(refused);
    return new ModelProviderFailure(
      `anthropic request refused (${status ?? "no status"})`,
      {
        // An exhausted account is PERMANENT for the attempt -- another
        // candidate may answer -- and flagged, so the provider is set
        // aside until a probe succeeds rather than retried every turn.
        failureClass: exhausted ? "PERMANENT" : classify(refused),
        ...(exhausted ? { accountExhausted: true } : {}),
        providerCode: ANTHROPIC_PROVIDER_CODE,
        ...(status === undefined ? {} : { providerStatus: status }),
        ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
        // The vendor's error TYPE token, never its message.
        ...(refused.type === null ? {} : { vendorErrorCode: refused.type }),
        cause: refused,
      },
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelProviderFailure("anthropic request aborted", {
      failureClass: "CANCELLED",
      providerCode: ANTHROPIC_PROVIDER_CODE,
      cause: error,
    });
  }
  return new ModelProviderFailure("anthropic request failed", {
    failureClass: "TRANSIENT",
    providerCode: ANTHROPIC_PROVIDER_CODE,
    cause: error,
  });
}

// --- the request -----------------------------------------------------------------

/**
 * The full request body for one attempt. Exported for the tests.
 * `constrain: false` states a structured schema in the instructions even
 * when it would fit constrained decoding (the refusal fallback below).
 */
/**
 * Claude narrates its tool use more readily than the models Q's prompts
 * were tuned on (live 2026-11-06: "My search for Silo Credit on Capital Q
 * came back empty, so I..." before a correct answer). As a line in the
 * system prompt it did not hold live ("Two searches for Silo Credit, one
 * by name and one by sector..."), so it is said in the trailing format
 * reminder of a tool round instead -- the last thing the model reads.
 * Unverified live. It does not change what may be said about the record:
 * what is unknown is still said to be unknown, only not as an account of
 * searches.
 */
export const TOOL_USE_GUIDANCE =
  "When you use tools, answer with what you found, not an account of how you looked: never mention a search, lookup or tool, and never say that one came back empty. If something is not on record, say only that it is not on record.";

/**
 * The largest sanitised schema sent for constrained decoding. The API does
 * not publish its grammar-size limit; the live refusal was a schema of
 * about 7.8k characters. Larger schemas go by instruction from the start
 * instead of paying a refused request first.
 */
export const CONSTRAINED_SCHEMA_MAX_CHARS = 4_096;

export function toRequest(
  request: ModelProviderRequest,
  constrain = true,
  stableHead?: number,
): MessageCreateParamsNonStreaming {
  const toolsOffered = request.tools.length > 0;
  const { thinking, effort } = thinkingFor(
    request.modelCode,
    request.reasoning,
    request.messages,
    toolsOffered,
    request.maxOutputTokens,
  );
  const structured =
    request.output.kind === "STRUCTURED" ? request.output : undefined;
  // Constrained decoding only without tools: with tools offered the API
  // compiles their schemas into the same grammar, and live (2026-11-06)
  // Q's answer schema plus four tools was refused as "compiled grammar is
  // too large ... simplify your tool schemas or reduce the number".
  const sanitized =
    structured === undefined || !constrain || toolsOffered
      ? null
      : toOutputSchema(structured.jsonSchema);
  // And only a small grammar: live 2026-11-06 the company analyst's answer
  // schema alone (no tools) was refused as "compiled grammar is too large".
  const constrained =
    sanitized !== null &&
    JSON.stringify(sanitized).length <= CONSTRAINED_SCHEMA_MAX_CHARS
      ? sanitized
      : null;
  const extra =
    structured !== undefined && constrained === null
      ? [schemaInstruction(structured)]
      : [];
  const { system, messages } = toMessages(
    request.messages,
    extra.length === 0 ? undefined : extra.join("\n\n"),
    { flattenTools: !toolsOffered, stableHead },
  );
  // By instruction, the last word is the format: a reminder at the end of
  // the final user turn (after every cache breakpoint, so the cached prefix
  // is untouched). Live 2026-11-06: prose before the JSON cost a refused
  // round and a text round each time.
  const tail = messages.at(-1);
  if (
    structured !== undefined &&
    constrained === null &&
    tail !== undefined &&
    tail.role === "user" &&
    Array.isArray(tail.content)
  ) {
    tail.content = [
      ...tail.content,
      {
        type: "text",
        text: `[Capital Q note] Reply with only the ${structured.schemaName} JSON object: start with { and end with }, nothing before or after it.${
          toolsOffered ? ` ${TOOL_USE_GUIDANCE}` : ""
        }`,
      },
    ];
  }
  const tools = toTools(request.tools);
  return {
    model: request.modelCode,
    max_tokens: request.maxOutputTokens,
    messages,
    ...(system === undefined ? {} : { system }),
    ...(tools === undefined ? {} : { tools }),
    thinking,
    output_config: {
      effort,
      ...(constrained === null
        ? {}
        : { format: { type: "json_schema" as const, schema: constrained } }),
    },
    // No temperature: both permitted models refuse non-default sampling
    // values with a 400, and the gateway's temperature is a hint, not a
    // contract. No tool_choice: forced choice is a 400 on Sonnet 5.5, and
    // `auto` is the default. `request.cacheKey` has no Anthropic
    // counterpart (caching is by exact prefix), so it is not sent.
  };
}

/**
 * One request and what came of it, for an opt-in diagnostic hook (the
 * Q-IQ world's CQ_Q_IQ_LOG=debug). Shapes and counts only, plus the
 * vendor's own error message on a refusal, which is what tells a refused
 * request shape from anything else. Never wired in a service.
 */
export type AnthropicExchange = {
  readonly model: string;
  readonly streaming: boolean;
  readonly thinking: string;
  readonly effort: string | undefined;
  readonly tools: number;
  readonly output: "TEXT" | "CONSTRAINED" | "INSTRUCTION";
  /** The structured output's schema name, or TEXT. */
  readonly schema: string;
  readonly messages: number;
  readonly cacheBreakpoints: number;
  readonly outcome:
    | {
        readonly kind: "MESSAGE";
        readonly stopReason: string | null;
        readonly blocks: readonly string[];
        readonly textChars: number;
        /** The shape of the text, never its words. */
        readonly textShape:
          "EMPTY" | "JSON" | "FENCED_JSON" | "PROSE_THEN_JSON" | "PROSE";
        readonly inputTokens: number;
        readonly cacheReadTokens: number;
        readonly cacheWriteTokens: number;
        readonly outputTokens: number;
      }
    | {
        readonly kind: "ERROR";
        readonly status: number | undefined;
        readonly type: string | null;
        readonly message: string;
      };
};

export function textShapeOf(
  text: string,
): "EMPTY" | "JSON" | "FENCED_JSON" | "PROSE_THEN_JSON" | "PROSE" {
  const trimmed = text.trim();
  if (trimmed === "") return "EMPTY";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return "JSON";
  if (trimmed.startsWith("```")) return "FENCED_JSON";
  return trimmed.includes("{") ? "PROSE_THEN_JSON" : "PROSE";
}

function exchangeOf(
  params: MessageCreateParamsNonStreaming,
  request: ModelProviderRequest,
  streaming: boolean,
  outcome: AnthropicExchange["outcome"],
): AnthropicExchange {
  return {
    model: params.model,
    streaming,
    thinking: params.thinking?.type ?? "default",
    effort: params.output_config?.effort ?? undefined,
    tools: params.tools?.length ?? 0,
    schema:
      request.output.kind === "STRUCTURED" ? request.output.schemaName : "TEXT",
    messages: params.messages.length,
    cacheBreakpoints: countBreakpoints(
      Array.isArray(params.system) ? params.system : [],
      params.messages,
    ),
    output:
      request.output.kind === "TEXT"
        ? "TEXT"
        : params.output_config?.format === undefined ||
            params.output_config.format === null
          ? "INSTRUCTION"
          : "CONSTRAINED",
    outcome,
  };
}

/**
 * Model and schema pairs the API refused in the adapter's chosen shape,
 * for this provider instance: they go straight to the plain shape after
 * the first refusal. Bounded; a pair forgotten is refused once more and
 * remembered again.
 */
const REFUSED_SCHEMAS_MAX = 256;
const STABLE_HEADS_MAX = 128;

/**
 * The plainest request for an attempt: no constrained format, and no
 * explicit thinking mode unless the turn continues its own tool calls
 * (where thinking must stay off; see continuesToolCalls).
 */
export function plainRequest(
  request: ModelProviderRequest,
  stableHead?: number,
): MessageCreateParamsNonStreaming {
  const params = toRequest(request, false, stableHead);
  if (
    (request.tools.length > 0 && continuesToolCalls(request.messages)) ||
    request.maxOutputTokens < THINKING_MIN_OUTPUT_TOKENS
  ) {
    return params;
  }
  const { thinking: _chosen, ...rest } = params;
  return rest;
}

/** Whether the adapter's chosen shape differs from the plain one. */
function choseShape(
  chosen: MessageCreateParamsNonStreaming,
  plain: MessageCreateParamsNonStreaming,
): boolean {
  const format = chosen.output_config?.format;
  // Adaptive is both models' default, so sending it explicitly is not a
  // choice; only an explicit off-mode is.
  const thinking = (params: MessageCreateParamsNonStreaming): string =>
    params.thinking?.type ?? "adaptive";
  return (
    (format !== undefined && format !== null) ||
    thinking(chosen) !== thinking(plain)
  );
}

export function createAnthropicModelProvider(
  options: AnthropicProviderOptions,
): ModelProvider {
  const refusedShapes = new Set<string>();
  // Line hashes of the last rendered prompt per kind (never its text), to
  // find the stable head the next one shares. Oldest entry evicted first.
  const stableHeads = new Map<string, string[]>();
  const sectionOrder = createSectionOrder();
  const client: AnthropicClient =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      // The gateway owns retry; the SDK gets one shot.
      maxRetries: 0,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

  return {
    code: ANTHROPIC_PROVIDER_CODE,
    capabilities: () => ({
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      cancellation: true,
    }),
    generate: async (
      incoming: ModelProviderRequest,
      context: ModelExecutionContext,
    ): Promise<ModelProviderResult> => {
      // Replaced below by the section-ordered copy, never mutated.
      let request = incoming;
      const requestOptions = {
        signal: context.signal,
        timeout: context.attemptTimeoutMs,
      };
      const streaming = context.onTextDelta !== undefined;
      const send = async (
        params: MessageCreateParamsNonStreaming,
      ): Promise<Message> => {
        try {
          let message: Message;
          if (context.onTextDelta === undefined) {
            message = await client.messages.create(params, requestOptions);
          } else {
            const onTextDelta = context.onTextDelta;
            const stream = client.messages.stream(params, requestOptions);
            // Text deltas only: thinking deltas are never surfaced.
            stream.on("text", (delta: string) => onTextDelta(delta));
            message = await stream.finalMessage();
          }
          options.onExchange?.(
            exchangeOf(params, request, streaming, {
              kind: "MESSAGE",
              stopReason: message.stop_reason,
              blocks: message.content.map((block) => block.type),
              textChars: textOf(message).length,
              textShape: textShapeOf(textOf(message)),
              inputTokens: toUsage(message).inputTokens,
              cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
              outputTokens: message.usage.output_tokens,
            }),
          );
          return message;
        } catch (error: unknown) {
          if (error instanceof APIError) {
            const refused: APIError = error as APIError;
            options.onExchange?.(
              exchangeOf(params, request, streaming, {
                kind: "ERROR",
                status: refused.status,
                type: refused.type,
                message: refused.message.slice(0, 500),
              }),
            );
          }
          throw error;
        }
      };
      try {
        const structured = request.output.kind === "STRUCTURED";
        const plainKey = `${request.modelCode}|${
          request.output.kind === "STRUCTURED"
            ? request.output.schemaName
            : "TEXT"
        }`;
        // The stable head of the rendered prompt, against the previous
        // request of the same kind (same model, output and tool set).
        const headKey = `${plainKey}|${request.tools
          .map((tool) => tool.name)
          .join(",")}`;
        // Stable sections first in the first user message (Anthropic only;
        // anthropic-sections.ts), learned per person from the gateway's
        // hashed cache key.
        const firstIndex = request.messages.findIndex(
          (message) => message.role === "USER",
        );
        const original = request.messages[firstIndex];
        const ordered =
          original === undefined || original.role !== "USER"
            ? undefined
            : sectionOrder.order(
                plainKey,
                request.cacheKey ?? headKey,
                original.content,
              );
        if (
          ordered !== undefined &&
          original !== undefined &&
          original.role === "USER" &&
          ordered.text !== original.content
        ) {
          const messages = [...request.messages];
          messages[firstIndex] = { ...original, content: ordered.text };
          request = { ...request, messages };
        }
        const firstUser = ordered?.text;
        const stableHead =
          firstUser === undefined
            ? undefined
            : ordered !== undefined && ordered.stableChars > 0
              ? ordered.stableChars
              : stableHeadOf(firstUser, stableHeads.get(headKey));
        if (firstUser !== undefined) {
          stableHeads.delete(headKey);
          stableHeads.set(headKey, lineHashes(firstUser));
          if (stableHeads.size > STABLE_HEADS_MAX) {
            const oldest = stableHeads.keys().next().value;
            if (oldest !== undefined) stableHeads.delete(oldest);
          }
        }
        const params = refusedShapes.has(plainKey)
          ? plainRequest(request, stableHead)
          : toRequest(request, true, stableHead);
        try {
          const message = await send(params);
          // An empty end_turn -- no text, no tool call -- answers nothing.
          // It is asked once more in the plain shape (thinking at the
          // model's default) before the gateway sees it as an answer.
          if (
            message.stop_reason === "end_turn" &&
            textOf(message).trim() === "" &&
            toToolCalls(message) === undefined
          ) {
            // Live 2026-11-06: rounds after a tool result with thinking
            // switched off came back empty (no blocks, one output token),
            // so the retry always runs at the model's default thinking,
            // continuation or not. If the API refuses that, the refusal is
            // the failure, which is no worse than an empty answer.
            const again = toRequest(request, false, stableHead);
            // A short reply keeps thinking off (it would eat the budget).
            const { thinking: _off, ...retry } = again;
            return result(
              await send(
                request.maxOutputTokens < THINKING_MIN_OUTPUT_TOKENS
                  ? again
                  : retry,
              ),
              structured,
            );
          }
          return result(message, structured);
        } catch (error: unknown) {
          // A 400 for a shape this adapter CHOSE -- a constrained format,
          // or an explicit thinking-off mode -- is sent once more in the
          // plainest shape: the schema stated in the instructions (the
          // gateway validates every answer against the caller's schema
          // either way) and thinking at the model's default, same effort.
          // The pair is remembered, so a shape the API will not take never
          // silences every answer that uses it (live 2026-11-06: every Q
          // turn on Claude published nothing). A 400 is refused before any
          // output, so nothing was streamed and nothing billed.
          const plain = plainRequest(request, stableHead);
          if (
            !(error instanceof APIError) ||
            error.status !== 400 ||
            accountExhausted(error as APIError) ||
            !choseShape(params, plain)
          ) {
            throw error;
          }
          if (refusedShapes.size >= REFUSED_SCHEMAS_MAX) refusedShapes.clear();
          refusedShapes.add(plainKey);
          return result(await send(plain), structured);
        }
      } catch (error: unknown) {
        throw normalizeError(error);
      }
    },
  };
}
