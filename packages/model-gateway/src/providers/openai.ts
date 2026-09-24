import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInput,
  Tool as OpenAITool,
} from "openai/resources/responses/responses";

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
 * OpenAI adapter, behind the official SDK's Responses API. The only file
 * in Capital Q that imports it.
 *
 * Added as DIAGNOSTIC INFRASTRUCTURE, not as a provider strategy. Gemini
 * spent a day answering "this model is currently experiencing high
 * demand" and Groq's free tier spent it rate-limited, and with both
 * unreliable there was no way to tell a Capital Q defect from a vendor
 * outage — every failing journey had the same symptom. A provider that
 * answers reliably makes the core acceptance suite executable, which is
 * the whole reason it is here.
 *
 * It is reachable only where the catalogue lists it AND the deployment
 * has turned the test route on (see `createTestRoutingCatalog`). It is
 * not in any routing policy's own lists, so ordinary traffic cannot
 * reach it, and no browser can ask for it.
 *
 * Everything the other adapters are held to holds here. The OpenAI shape
 * is mapped in this file and stops here; the only functions declared are
 * the canonical tool definitions the Tool Registry offered; SDK retries
 * are off because the gateway owns them; no reasoning summary is
 * requested and none is surfaced, so no chain of thought reaches a
 * result; and the key never leaves this process.
 */

export const OPENAI_PROVIDER_CODE = "openai";

/** The one model this adapter is permitted to run. */
export const OPENAI_TEST_MODEL = "gpt-5.6-luna";

/**
 * The caller's requested effort, as this vendor spells it (CQ-VOICE-010).
 *
 * It used to be "low" whatever was asked. On the interview turn, which
 * asks for NONE, that cost about a second at the median and three at the
 * tail. Measured on the real rendered INTERVIEW_CONDUCTOR request, 5
 * interleaved runs: "none" p50 3.76 s / p95 4.31 s against "low" p50
 * 4.61 s / p95 7.51 s, all fifteen outputs valid. "minimal" is refused by
 * this model, so nothing maps to it.
 */
const OPENAI_REASONING_EFFORT: Readonly<
  Record<ModelReasoningLevel, "none" | "low" | "medium" | "high">
> = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export type OpenAIProviderOptions = {
  readonly apiKey: string;
  /** For tests: a client already built. */
  readonly client?: OpenAI | undefined;
};

function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

function classify(status: number | undefined): ModelFailureClass {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408) return "TIMEOUT";
  if (status === 400 || status === 404 || status === 422) {
    return "INVALID_REQUEST";
  }
  if (status !== undefined && status >= 500) return "PROVIDER_OUTAGE";
  return "TRANSIENT";
}

/** Capital Q's messages as Responses input. Nothing else travels. */
export function toInput(messages: readonly ModelMessage[]): {
  readonly instructions: string | undefined;
  readonly input: ResponseInput;
} {
  const instructions = messages
    .filter((message) => message.role === "SYSTEM")
    .map((message) => message.content)
    .join("\n\n");
  const input: ResponseInput = [];
  for (const message of messages) {
    if (message.role === "SYSTEM") continue;
    if (message.role === "USER") {
      input.push({
        role: "user",
        content: [{ type: "input_text", text: message.content }],
      });
      continue;
    }
    if (message.role === "ASSISTANT") {
      // A tool call the model made, and the text it said around it.
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.callId,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        });
      }
      if (message.content.length > 0) {
        input.push({ role: "assistant", content: message.content });
      }
      continue;
    }
    // A tool's result, returned against the call it answers.
    if (message.role === "TOOL") {
      input.push({
        type: "function_call_output",
        call_id: message.callId,
        output: message.content,
      });
    }
  }
  return {
    instructions: instructions.length === 0 ? undefined : instructions,
    input,
  };
}

/** The canonical tool definitions, and nothing provider-side. */
function toTools(
  tools: readonly ModelToolDefinition[],
): readonly OpenAITool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputJsonSchema,
    strict: false,
  }));
}

function toUsage(response: OpenAIResponse): ModelUsage | undefined {
  const usage = response.usage;
  if (usage === undefined) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
  };
}

function finishOf(response: OpenAIResponse): ModelFinishStatus {
  if (response.status === "incomplete") {
    return response.incomplete_details?.reason === "max_output_tokens"
      ? "MAX_OUTPUT_TOKENS"
      : "OTHER";
  }
  if (response.output.some((item) => item.type === "function_call")) {
    return "TOOL_CALLS";
  }
  return "COMPLETE";
}

/**
 * The tool calls the model proposed, decoded.
 *
 * A name the Tool Registry would not recognise is dropped rather than
 * passed on: the executor would refuse it anyway, and a call that cannot
 * be authorised has no business travelling any further.
 */
function toToolCalls(
  response: OpenAIResponse,
): readonly ModelToolCall[] | undefined {
  const calls: ModelToolCall[] = [];
  for (const item of response.output) {
    if (item.type !== "function_call") continue;
    const name = ModelToolNameSchema.safeParse(item.name);
    if (!name.success) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.arguments);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    calls.push({
      callId: item.call_id,
      name: name.data,
      arguments: parsed as Record<string, unknown>,
    });
  }
  return calls.length === 0 ? undefined : calls;
}

function normalizeError(error: unknown): ModelProviderFailure {
  if (error instanceof ModelProviderFailure) return error;
  if (error instanceof APIUserAbortError) {
    return new ModelProviderFailure("openai request aborted", {
      failureClass: "CANCELLED",
      providerCode: OPENAI_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderFailure("openai request timed out", {
      failureClass: "TIMEOUT",
      providerCode: OPENAI_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new ModelProviderFailure("openai connection failed", {
      failureClass: "TRANSIENT",
      providerCode: OPENAI_PROVIDER_CODE,
      cause: error,
    });
  }
  if (isApiError(error)) {
    const status = error.status;
    return new ModelProviderFailure(
      `openai request refused (${status ?? "no status"})`,
      {
        failureClass: classify(status),
        providerCode: OPENAI_PROVIDER_CODE,
        ...(status === undefined ? {} : { providerStatus: status }),
        ...(typeof error.code === "string"
          ? { vendorErrorCode: error.code }
          : {}),
        cause: error,
      },
    );
  }
  return new ModelProviderFailure("openai request failed", {
    failureClass: "TRANSIENT",
    providerCode: OPENAI_PROVIDER_CODE,
    cause: error,
  });
}

export function createOpenAIModelProvider(
  options: OpenAIProviderOptions,
): ModelProvider {
  const client =
    options.client ??
    new OpenAI({
      apiKey: options.apiKey,
      // The gateway owns retry; the SDK gets one shot.
      maxRetries: 0,
    });

  return {
    code: OPENAI_PROVIDER_CODE,
    capabilities: () => ({
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      cancellation: true,
    }),
    generate: async (
      request: ModelProviderRequest,
      context: ModelExecutionContext,
    ): Promise<ModelProviderResult> => {
      if (request.modelCode !== OPENAI_TEST_MODEL) {
        // The adapter is here to run one model. Anything else is a
        // configuration fault, and a loud one: this account has a few
        // dollars on it and an expensive model would eat them silently.
        throw new ModelProviderFailure(
          `openai adapter refuses model ${request.modelCode}`,
          {
            failureClass: "INVALID_REQUEST",
            providerCode: OPENAI_PROVIDER_CODE,
          },
        );
      }
      const { instructions, input } = toInput(request.messages);
      const tools = toTools(request.tools);
      const shared = {
        model: request.modelCode,
        input,
        ...(instructions === undefined ? {} : { instructions }),
        max_output_tokens: request.maxOutputTokens,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        ...(tools === undefined ? {} : { tools: [...tools] }),
        // No summary is asked for and none is read: a reasoning trace is
        // not something Capital Q surfaces or stores (doc 12).
        reasoning: { effort: OPENAI_REASONING_EFFORT[request.reasoning] },
        // Nothing is kept on the vendor's side between calls.
        store: false,
        ...(request.output.kind === "STRUCTURED"
          ? {
              text: {
                format: {
                  type: "json_schema" as const,
                  name: request.output.schemaName,
                  schema: request.output.jsonSchema,
                  strict: false,
                },
              },
            }
          : {}),
      };

      try {
        if (context.onTextDelta === undefined) {
          const params: ResponseCreateParamsNonStreaming = {
            ...shared,
            stream: false,
          };
          const response = await client.responses.create(params, {
            signal: context.signal,
            timeout: context.attemptTimeoutMs,
          });
          return {
            text: response.output_text,
            toolCalls: toToolCalls(response),
            usage: toUsage(response),
            finish: finishOf(response),
            modelCode: response.model,
            providerReference: response.id,
          };
        }

        const params: ResponseCreateParamsStreaming = {
          ...shared,
          stream: true,
        };
        const stream = await client.responses.create(params, {
          signal: context.signal,
          timeout: context.attemptTimeoutMs,
        });
        let completed: OpenAIResponse | undefined;
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            context.onTextDelta(event.delta);
            continue;
          }
          if (
            event.type === "response.completed" ||
            event.type === "response.incomplete"
          ) {
            completed = event.response;
          }
        }
        if (completed === undefined) {
          throw new ModelProviderFailure("openai stream ended with no result", {
            failureClass: "TRANSIENT",
            providerCode: OPENAI_PROVIDER_CODE,
          });
        }
        return {
          text: completed.output_text,
          toolCalls: toToolCalls(completed),
          usage: toUsage(completed),
          finish: finishOf(completed),
          modelCode: completed.model,
          providerReference: completed.id,
        };
      } catch (error: unknown) {
        throw normalizeError(error);
      }
    },
  };
}
