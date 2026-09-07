import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";

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
 * Google Gemini Developer API adapter (packet §28), behind the official
 * `@google/genai` SDK. The only file in Capital Q that imports it.
 *
 * What it does: maps a provider-neutral request to `generateContent`,
 * normalizes text, structured output, function calls, usage, finish
 * reason, a safe reference id, and errors. What it never does: retry (the
 * gateway owns retry; SDK retries are disabled), enable Google Search
 * grounding, code execution or any provider-side tool (packet §70-72),
 * surface thoughts (packet §33), keep a session, or let a vendor type
 * escape. The only functions it declares are the canonical tool
 * definitions the Capital Q Tool Registry offered for this request
 * (CQ-Q-007): a projection, never an addition.
 *
 * The API key is captured in the closure at composition and appears in
 * no field, log, error or result.
 */

export const GOOGLE_PROVIDER_CODE = "google" as const;

export type GoogleModelProviderOptions = {
  readonly apiKey: string;
};

/**
 * Gemini may omit a function-call id. The adapter then assigns one with
 * this prefix so the gateway and registry can still correlate the call
 * with its result; such ids are never echoed back to the API.
 */
export const GENERATED_CALL_ID_PREFIX = "gen_";

function thinkingLevel(level: ModelReasoningLevel): ThinkingLevel | undefined {
  switch (level) {
    case "NONE":
      return undefined;
    case "LOW":
      return ThinkingLevel.LOW;
    case "MEDIUM":
      return ThinkingLevel.MEDIUM;
    case "HIGH":
      return ThinkingLevel.HIGH;
  }
}

/** A tool result is JSON text; Gemini wants an object. Anything else is wrapped. */
function functionResponseValue(content: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(content);
    if (
      decoded !== null &&
      typeof decoded === "object" &&
      !Array.isArray(decoded)
    ) {
      return decoded as Record<string, unknown>;
    }
    return { result: decoded };
  } catch {
    return { result: content };
  }
}

function assistantParts(
  message: Extract<ModelMessage, { role: "ASSISTANT" }>,
): Part[] {
  const parts: Part[] = [];
  if (message.content.length > 0) {
    parts.push({ text: message.content });
  }
  for (const call of message.toolCalls ?? []) {
    parts.push({
      functionCall: {
        name: call.name,
        args: call.arguments,
        ...(call.callId.startsWith(GENERATED_CALL_ID_PREFIX)
          ? {}
          : { id: call.callId }),
      },
    });
  }
  return parts;
}

/**
 * Provider-neutral messages → Gemini contents. Consecutive TOOL results
 * are merged into one user content so every function call of a model
 * turn is answered in the same turn, as the API requires.
 */
export function toContents(messages: readonly ModelMessage[]): {
  readonly systemInstruction: string | undefined;
  readonly contents: Content[];
} {
  const system = messages
    .filter((m) => m.role === "SYSTEM")
    .map((m) => m.content)
    .join("\n\n");
  const contents: Content[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "SYSTEM":
        break;
      case "USER":
        contents.push({ role: "user", parts: [{ text: message.content }] });
        break;
      case "ASSISTANT":
        contents.push({ role: "model", parts: assistantParts(message) });
        break;
      case "TOOL": {
        const part: Part = {
          functionResponse: {
            name: message.name,
            response: functionResponseValue(message.content),
            ...(message.callId.startsWith(GENERATED_CALL_ID_PREFIX)
              ? {}
              : { id: message.callId }),
          },
        };
        const last = contents.at(-1);
        if (
          last !== undefined &&
          last.role === "user" &&
          last.parts?.every((p) => p.functionResponse !== undefined) === true
        ) {
          last.parts.push(part);
        } else {
          contents.push({ role: "user", parts: [part] });
        }
        break;
      }
    }
  }
  return {
    systemInstruction: system.length > 0 ? system : undefined,
    contents,
  };
}

/** Canonical tool definitions → Gemini function declarations. Nothing else is declared. */
export function toolsForGemini(
  tools: readonly ModelToolDefinition[],
): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: schemaForGemini(tool.inputJsonSchema),
  }));
}

const FILTERED_FINISH: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

function finishStatus(
  response: GenerateContentResponse,
  toolCalls: readonly ModelToolCall[],
): ModelFinishStatus {
  if (toolCalls.length > 0) {
    return "TOOL_CALLS";
  }
  const reason = response.candidates?.[0]?.finishReason;
  if (reason === undefined || reason === FinishReason.STOP) {
    return "COMPLETE";
  }
  if (reason === FinishReason.MAX_TOKENS) {
    return "MAX_OUTPUT_TOKENS";
  }
  if (FILTERED_FINISH.has(reason)) {
    return "CONTENT_FILTERED";
  }
  return "OTHER";
}

function usageOf(response: GenerateContentResponse): ModelUsage | undefined {
  const meta = response.usageMetadata;
  if (meta === undefined || meta.promptTokenCount === undefined) {
    return undefined;
  }
  return {
    inputTokens: meta.promptTokenCount,
    cachedInputTokens: meta.cachedContentTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
    ...(meta.thoughtsTokenCount === undefined
      ? {}
      : { reasoningTokens: meta.thoughtsTokenCount }),
  };
}

/** Text parts only; thoughts are never requested and never read. */
function textOf(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function toolCallsOf(response: GenerateContentResponse): ModelToolCall[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const calls: ModelToolCall[] = [];
  parts.forEach((part, index) => {
    const call = part.functionCall;
    if (call === undefined) {
      return;
    }
    const name = ModelToolNameSchema.safeParse(call.name);
    if (!name.success) {
      throw new ModelProviderFailure("gemini proposed a malformed tool call", {
        failureClass: "INVALID_MODEL_OUTPUT",
        providerCode: GOOGLE_PROVIDER_CODE,
      });
    }
    calls.push({
      callId:
        call.id !== undefined && call.id.length > 0
          ? call.id
          : `${GENERATED_CALL_ID_PREFIX}${String(index)}`,
      name: name.data,
      arguments: call.args ?? {},
    });
  });
  return calls;
}

function classify(status: number): ModelFailureClass {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 404 || status === 422)
    return "INVALID_REQUEST";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "PROVIDER_OUTAGE";
  return "PERMANENT";
}

function normalizeError(error: unknown): ModelProviderFailure {
  if (error instanceof ModelProviderFailure) {
    return error;
  }
  if (error instanceof ApiError) {
    // The vendor's message is diagnostic material only; it stays on cause.
    const failureClass =
      error.status === 400 &&
      /token|context|too long|exceeds/i.test(error.message)
        ? "CONTEXT_LIMIT"
        : classify(error.status);
    return new ModelProviderFailure(
      `gemini request refused (${error.status})`,
      {
        failureClass,
        providerCode: GOOGLE_PROVIDER_CODE,
        providerStatus: error.status,
        cause: error,
      },
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelProviderFailure("gemini request aborted", {
      failureClass: "CANCELLED",
      providerCode: GOOGLE_PROVIDER_CODE,
      cause: error,
    });
  }
  if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
    return new ModelProviderFailure("gemini request timed out", {
      failureClass: "TIMEOUT",
      providerCode: GOOGLE_PROVIDER_CODE,
      cause: error,
    });
  }
  return new ModelProviderFailure("gemini request failed", {
    failureClass: "TRANSIENT",
    providerCode: GOOGLE_PROVIDER_CODE,
    cause: error,
  });
}

/**
 * JSON Schema keywords the Gemini API rejects with a bare "invalid
 * argument" (verified 2026-09-06 against gemini-3.5-flash-lite): string and
 * array bounds and patterns. Transport-level adaptation only (packet §28):
 * Capital Q's own Zod schema still enforces every bound on the way back,
 * so nothing is lost by not asking the provider to enforce them. The same
 * adaptation applies to tool parameter schemas: the registry validates
 * every argument again before anything runs.
 */
const GEMINI_UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

export function schemaForGemini(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(schemaForGemini);
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!GEMINI_UNSUPPORTED_KEYWORDS.has(key)) {
        out[key] = schemaForGemini(value);
      }
    }
    return out;
  }
  return node;
}

export function createGoogleModelProvider(
  options: GoogleModelProviderOptions,
): ModelProvider {
  const client = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    code: GOOGLE_PROVIDER_CODE,
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
      const { systemInstruction, contents } = toContents(request.messages);
      const level = thinkingLevel(request.reasoning);
      const config: GenerateContentConfig = {
        abortSignal: context.signal,
        // The gateway owns retry and its own timeout; the SDK gets one shot.
        httpOptions: {
          timeout: context.attemptTimeoutMs,
          retryOptions: { attempts: 1 },
        },
        maxOutputTokens: request.maxOutputTokens,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        ...(systemInstruction === undefined ? {} : { systemInstruction }),
        ...(request.output.kind === "STRUCTURED"
          ? {
              responseMimeType: "application/json",
              responseJsonSchema: schemaForGemini(request.output.jsonSchema),
            }
          : {}),
        ...(level === undefined
          ? {}
          : {
              thinkingConfig: { thinkingLevel: level, includeThoughts: false },
            }),
        // Only the registry's function declarations: no search grounding,
        // no code execution, no URL context, no provider-side tool.
        tools:
          request.tools.length === 0
            ? []
            : [{ functionDeclarations: toolsForGemini(request.tools) }],
      };

      let response: GenerateContentResponse;
      try {
        response = await client.models.generateContent({
          model: request.modelCode,
          contents,
          config,
        });
      } catch (error: unknown) {
        throw normalizeError(error);
      }

      const toolCalls = toolCallsOf(response);
      const text = textOf(response);
      if (text.length === 0 && toolCalls.length === 0) {
        throw new ModelProviderFailure("gemini returned no text candidate", {
          failureClass:
            finishStatus(response, toolCalls) === "CONTENT_FILTERED"
              ? "PERMANENT"
              : "INVALID_MODEL_OUTPUT",
          providerCode: GOOGLE_PROVIDER_CODE,
        });
      }
      return {
        text,
        toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
        usage: usageOf(response),
        finish: finishStatus(response, toolCalls),
        modelCode: response.modelVersion ?? request.modelCode,
        providerReference: response.responseId,
      };
    },
  };
}
