import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";

import {
  ModelToolNameSchema,
  type ModelFailureClass,
  type ModelFinishStatus,
  type ModelMessage,
  type ModelReasoningLevel,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelUsage,
} from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import type {
  ModelExecutionContext,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResult,
} from "../ports.js";

/**
 * GroqCloud adapter (packet §29), behind the official `groq-sdk`. The only
 * file in Capital Q that imports it.
 *
 * Groq speaks an OpenAI-compatible chat shape; that shape is mapped here
 * and stops here — Capital Q's request and result are its own. Reasoning
 * is requested as `hidden` so no chain of thought reaches the response
 * (packet §33); no search settings, documents or provider-side tools are
 * ever passed (packet §70-72); the only functions declared are the
 * canonical tool definitions the Tool Registry offered (CQ-Q-007); SDK
 * retries are disabled because the gateway owns them.
 *
 * The API key is captured in the closure at composition and appears in
 * no field, log, error or result.
 */

export const GROQ_PROVIDER_CODE = "groq" as const;

export type GroqModelProviderOptions = {
  readonly apiKey: string;
  /**
   * Further keys for the same account tier. When a request is rate-limited
   * on one key it is retried at once on the next, and later requests start
   * from the key that last succeeded. A key that was limited is left alone
   * for a short while. Nothing about which key served a request is
   * returned, logged or stored.
   */
  readonly additionalApiKeys?: readonly string[] | undefined;
  /** Injected for tests; defaults to the real SDK client. */
  readonly clientFactory?: ((apiKey: string) => GroqLikeClient) | undefined;
};

/** The slice of the SDK the adapter calls; a test supplies a fake. */
export type GroqLikeClient = {
  readonly chat: {
    readonly completions: {
      create(
        params: ChatCompletionCreateParamsNonStreaming,
        options: {
          readonly signal?: AbortSignal | undefined;
          readonly timeout?: number | undefined;
          readonly maxRetries?: number | undefined;
        },
      ): Promise<ChatCompletion>;
    };
  };
};

/** A rate-limited key is not retried before this, unless the vendor said sooner. */
const KEY_COOLDOWN_MS = 30_000;

function reasoningEffort(
  level: ModelReasoningLevel,
): "low" | "medium" | "high" | null {
  switch (level) {
    case "NONE":
      return null;
    case "LOW":
      return "low";
    case "MEDIUM":
      return "medium";
    case "HIGH":
      return "high";
  }
}

/** Provider-neutral messages → OpenAI-style chat messages, tool turns included. */
export function toMessages(
  messages: readonly ModelMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    switch (m.role) {
      case "SYSTEM":
        return { role: "system", content: m.content };
      case "USER":
        return { role: "user", content: m.content };
      case "ASSISTANT":
        return {
          role: "assistant",
          content: m.content.length === 0 ? null : m.content,
          ...(m.toolCalls === undefined || m.toolCalls.length === 0
            ? {}
            : {
                tool_calls: m.toolCalls.map((call) => ({
                  id: call.callId,
                  type: "function" as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }),
        };
      case "TOOL":
        return { role: "tool", tool_call_id: m.callId, content: m.content };
    }
  });
}

/** Canonical tool definitions → OpenAI-style function tools. Nothing else is declared. */
export function toolsForGroq(
  tools: readonly ModelToolDefinition[],
): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputJsonSchema,
    },
  }));
}

function finishStatus(
  completion: ChatCompletion,
  toolCalls: readonly ModelToolCall[],
): ModelFinishStatus {
  if (toolCalls.length > 0) {
    return "TOOL_CALLS";
  }
  switch (completion.choices[0]?.finish_reason) {
    case "stop":
    case undefined:
      return "COMPLETE";
    case "length":
      return "MAX_OUTPUT_TOKENS";
    case "tool_calls":
    case "function_call":
      // The model stopped for a tool yet proposed none: not a usable answer.
      return "OTHER";
  }
}

function toolCallsOf(completion: ChatCompletion): ModelToolCall[] {
  const raw = completion.choices[0]?.message.tool_calls ?? [];
  return raw.map((call) => {
    const name = ModelToolNameSchema.safeParse(call.function.name);
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        call.function.arguments.length === 0 ? "{}" : call.function.arguments,
      );
    } catch {
      decoded = undefined;
    }
    if (
      !name.success ||
      decoded === null ||
      typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      throw new ModelProviderFailure("groq proposed a malformed tool call", {
        failureClass: "INVALID_MODEL_OUTPUT",
        providerCode: GROQ_PROVIDER_CODE,
      });
    }
    return {
      callId: call.id,
      name: name.data,
      arguments: decoded as Record<string, unknown>,
    };
  });
}

function usageOf(completion: ChatCompletion): ModelUsage | undefined {
  const usage = completion.usage;
  if (usage === undefined) {
    return undefined;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.prompt_tokens,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    // Groq bills reasoning inside completion tokens; keep the total there
    // and report the reasoning share separately for observability only.
    outputTokens: usage.completion_tokens,
    ...(reasoning === undefined || reasoning === null || reasoning === 0
      ? {}
      : { reasoningTokens: reasoning }),
  };
}

type NormalizedApiError = APIError<
  number | undefined,
  Headers | undefined,
  object | undefined
>;

function isApiError(error: unknown): error is NormalizedApiError {
  // The SDK error, or anything shaped like one (an injected client in tests).
  return (
    error instanceof APIError ||
    (error instanceof Error &&
      typeof (error as { status?: unknown }).status === "number")
  );
}

/** The vendor's bounded error code token from the body, if it carries one. */
function vendorErrorCode(error: NormalizedApiError): string | undefined {
  const body = error.error as { error?: { code?: unknown } } | undefined;
  const code = body?.error?.code;
  return typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code)
    ? code
    : undefined;
}

function retryAfterMs(error: NormalizedApiError): number | undefined {
  const header = error.headers?.get("retry-after");
  if (header === null || header === undefined) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : undefined;
}

function classify(
  status: number | undefined,
  message: string,
): ModelFailureClass {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  // Groq answers 413 for two different things: a request that genuinely
  // exceeds the model's window, and its tokens-per-minute cap ("Request too
  // large for ... on tokens per minute (TPM)", code rate_limit_exceeded).
  // Only the first is permanent; the second clears within the minute and
  // is a rate limit, so it is retried and worded as one, never as "too big".
  if (status === 413) {
    return /rate[_ ]limit|per minute|(?:^|[^A-Za-z])TPM(?:[^A-Za-z]|$)/i.test(
      message,
    )
      ? "RATE_LIMIT"
      : "CONTEXT_LIMIT";
  }
  // Groq validates a model's generated tool call against the declared
  // schema and refuses the request when the model got it wrong: that is
  // the model's output failing, retryable like any invalid output.
  if (
    status === 400 &&
    /tool_use_failed|failed to call a function/i.test(message)
  ) {
    return "INVALID_MODEL_OUTPUT";
  }
  if (status === 400 || status === 404 || status === 422) {
    return /context|too large|token|maximum/i.test(message)
      ? "CONTEXT_LIMIT"
      : "INVALID_REQUEST";
  }
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status !== undefined && status >= 500) return "PROVIDER_OUTAGE";
  return "PERMANENT";
}

function normalizeError(error: unknown): ModelProviderFailure {
  if (error instanceof ModelProviderFailure) {
    return error;
  }
  if (error instanceof APIUserAbortError) {
    return new ModelProviderFailure("groq request aborted", {
      failureClass: "CANCELLED",
      providerCode: GROQ_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderFailure("groq request timed out", {
      failureClass: "TIMEOUT",
      providerCode: GROQ_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new ModelProviderFailure("groq connection failed", {
      failureClass: "TRANSIENT",
      providerCode: GROQ_PROVIDER_CODE,
      cause: error,
    });
  }
  if (isApiError(error)) {
    // The vendor's message and body are diagnostic material only.
    const status = error.status;
    return new ModelProviderFailure(
      `groq request refused (${status ?? "no status"})`,
      {
        failureClass: classify(
          status,
          `${error.message} ${JSON.stringify(error.error ?? "")}`,
        ),
        providerCode: GROQ_PROVIDER_CODE,
        providerStatus: status,
        retryAfterMs: retryAfterMs(error),
        vendorErrorCode: vendorErrorCode(error),
        cause: error,
      },
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelProviderFailure("groq request aborted", {
      failureClass: "CANCELLED",
      providerCode: GROQ_PROVIDER_CODE,
      cause: error,
    });
  }
  return new ModelProviderFailure("groq request failed", {
    failureClass: "TRANSIENT",
    providerCode: GROQ_PROVIDER_CODE,
    cause: error,
  });
}

export function createGroqModelProvider(
  options: GroqModelProviderOptions,
): ModelProvider {
  const factory =
    options.clientFactory ??
    ((apiKey: string): GroqLikeClient =>
      new Groq({ apiKey, maxRetries: 0 }) as unknown as GroqLikeClient);
  const clients = [options.apiKey, ...(options.additionalApiKeys ?? [])].map(
    (apiKey) => factory(apiKey),
  );
  // Per key: when it may be tried again. Index into `clients`.
  const blockedUntil = clients.map(() => 0);
  let cursor = 0;

  /** Keys to try for one request: from the cursor, unblocked first. */
  const order = (now: number): number[] => {
    const all = clients.map((_, index) => (cursor + index) % clients.length);
    const until = (index: number) => blockedUntil[index] ?? 0;
    const open = all.filter((index) => until(index) <= now);
    const blocked = all.filter((index) => until(index) > now);
    return [...open, ...blocked];
  };

  return {
    code: GROQ_PROVIDER_CODE,
    capabilities: () => ({
      structuredOutput: true,
      toolCalling: true,
      streaming: false,
      cancellation: true,
    }),
    generate: async (
      request: ModelProviderRequest,
      context: ModelExecutionContext,
    ): Promise<ModelProviderResult> => {
      const params: ChatCompletionCreateParamsNonStreaming = {
        model: request.modelCode,
        messages: toMessages(request.messages),
        max_completion_tokens: request.maxOutputTokens,
        stream: false,
        // Reasoning stays with the provider: never returned, never stored.
        reasoning_effort: reasoningEffort(request.reasoning),
        reasoning_format: "hidden",
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        ...(request.output.kind === "STRUCTURED"
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: request.output.schemaName,
                  schema: request.output.jsonSchema,
                  // Acceptance is decided by Capital Q's own Zod schema; the
                  // provider's strict mode is not relied on.
                  strict: false,
                },
              },
            }
          : {}),
        ...(request.tools.length === 0
          ? {}
          : { tools: toolsForGroq(request.tools), tool_choice: "auto" }),
      };

      let completion: ChatCompletion | undefined;
      let lastFailure: ModelProviderFailure | undefined;
      for (const index of order(Date.now())) {
        const client = clients[index];
        if (client === undefined) {
          continue;
        }
        try {
          completion = await client.chat.completions.create(params, {
            signal: context.signal,
            timeout: context.attemptTimeoutMs,
            maxRetries: 0,
          });
          cursor = index;
          break;
        } catch (error: unknown) {
          const failure = normalizeError(error);
          if (failure.failureClass !== "RATE_LIMIT" || clients.length === 1) {
            throw failure;
          }
          // This key is spent for now; the next one takes the same request.
          blockedUntil[index] =
            Date.now() + (failure.retryAfterMs ?? KEY_COOLDOWN_MS);
          lastFailure = failure;
        }
      }
      if (completion === undefined) {
        throw (
          lastFailure ??
          new ModelProviderFailure("groq request failed", {
            failureClass: "TRANSIENT",
            providerCode: GROQ_PROVIDER_CODE,
          })
        );
      }

      const toolCalls = toolCallsOf(completion);
      const text = completion.choices[0]?.message.content ?? "";
      if (text.length === 0 && toolCalls.length === 0) {
        throw new ModelProviderFailure("groq returned no message content", {
          failureClass: "INVALID_MODEL_OUTPUT",
          providerCode: GROQ_PROVIDER_CODE,
        });
      }
      return {
        text,
        toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
        usage: usageOf(completion),
        finish: finishStatus(completion, toolCalls),
        modelCode: completion.model || request.modelCode,
        providerReference: completion.x_groq?.id ?? completion.id,
      };
    },
  };
}
