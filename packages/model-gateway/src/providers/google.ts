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
  /**
   * Further Gemini keys, tried in turn when one is rate-limited.
   *
   * The same shape the GroqCloud adapter already has, and for the same
   * reason: a free tier that is spent should move Q to the next key
   * rather than stop it. A key is set aside only for a rate limit —
   * every other failure is the request's, and trying it again on another
   * key would just spend that one too.
   */
  readonly additionalApiKeys?: readonly string[] | undefined;
};

/**
 * Gemini may omit a function-call id. The adapter then assigns one with
 * this prefix so the gateway and registry can still correlate the call
 * with its result; such ids are never echoed back to the API.
 */
export const GENERATED_CALL_ID_PREFIX = "gen_";

/**
 * Gemini 3 cannot switch thinking off, and left unset it thinks at its
 * default (dynamic) level before a one-line answer. NONE is the caller
 * asking for no thought, so it gets the least Gemini allows (L1 latency
 * sweep: FAST_CLASSIFICATION readers that never asked for reasoning were
 * paying for it on every call).
 */
export function thinkingLevel(
  level: ModelReasoningLevel,
): ThinkingLevel | undefined {
  switch (level) {
    case "NONE":
      return ThinkingLevel.MINIMAL;
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
      // Gemini 3 signs its function calls and rejects the follow-up that
      // does not echo the signature.
      ...(call.providerState === undefined
        ? {}
        : { thoughtSignature: call.providerState }),
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
  // Only the leading system messages are the system instruction. A
  // trusted note added later in the turn (the seam's "do it, don't say
  // it" round, a source change, an own-mandate note) is said where it
  // was added. Live 2026-10-01: lifted into the instruction, it left
  // the contents ending on the model's own reply; flash-lite refused
  // that with 400 and flash hung to the 45 s deadline.
  const leading = messages.findIndex((m) => m.role !== "SYSTEM");
  const head = leading === -1 ? messages : messages.slice(0, leading);
  const system = head.map((m) => m.content).join("\n\n");
  const contents: Content[] = [];
  for (const [index, message] of messages.entries()) {
    switch (message.role) {
      case "SYSTEM": {
        if (leading === -1 || index < leading) break;
        const note: Part = { text: `[Capital Q note] ${message.content}` };
        const last = contents.at(-1);
        if (
          last !== undefined &&
          last.role === "user" &&
          last.parts?.every((p) => p.functionResponse === undefined) === true
        ) {
          last.parts.push(note);
        } else {
          contents.push({ role: "user", parts: [note] });
        }
        break;
      }
      case "USER":
        contents.push({
          role: "user",
          parts: [
            { text: message.content },
            // A shared screen in a rehearsal (REHEARSE): inline only.
            ...(message.images ?? []).map((image) => ({
              inlineData: {
                mimeType: image.mediaType,
                data: image.dataBase64,
              },
            })),
          ],
        });
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

/**
 * `offset` numbers a synthesised call id from where this response sits in
 * a longer stream, so two chunks cannot both produce "gen_0". It is 0 for
 * a single response, which is every non-streamed call.
 */
function toolCallsOf(
  response: GenerateContentResponse,
  offset = 0,
): ModelToolCall[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const calls: ModelToolCall[] = [];
  parts.forEach((part) => {
    const call = part.functionCall;
    if (call === undefined) {
      return;
    }
    const index = offset + calls.length;
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
      ...(typeof part.thoughtSignature === "string" &&
      part.thoughtSignature.length > 0
        ? { providerState: part.thoughtSignature }
        : {}),
    });
  });
  return calls;
}

/**
 * One result from one response, however it was read. The empty-candidate
 * guard belongs here because it can only be judged once: an early chunk
 * with no text is ordinary, an entire answer with none is not.
 */
function finished(
  request: ModelProviderRequest,
  response: GenerateContentResponse,
  text: string,
  toolCalls: readonly ModelToolCall[],
): ModelProviderResult {
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
    toolCalls: toolCalls.length === 0 ? undefined : [...toolCalls],
    usage: usageOf(response),
    finish: finishStatus(response, toolCalls),
    modelCode: response.modelVersion ?? request.modelCode,
    providerReference: response.responseId,
  };
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

/** How long a rate-limited key is set aside when the provider says nothing. */
const KEY_COOLDOWN_MS = 60_000;
/**
 * How long a key the provider refused (401/403) is set aside. A refused
 * key is the key's fault, not the request's: hosted 2026-10-05 12:12, one
 * Gemini key answered AUTHENTICATION six times in thirty seconds, and each
 * turn fell back to another provider's model at 3.5-5 s instead of asking
 * the second key, which answered in ~1.2 s. Long, because a revoked or
 * mis-scoped key does not heal by itself; the next deploy re-reads it.
 */
const REFUSED_KEY_COOLDOWN_MS = 10 * 60_000;

/** Gemini refuses a request deadline below this and returns HTTP 400. */
export const GEMINI_MIN_DEADLINE_MS = 10_000;

/**
 * The deadline to send Gemini for a caller who will wait `budgetMs`.
 *
 * Floored, because Gemini refuses anything under ten seconds outright —
 * "Manually set deadline 8s is too short. Minimum allowed deadline is
 * 10s", HTTP 400, every call. A caller with a shorter budget is not
 * asking for something invalid; it is asking to stop waiting sooner, and
 * the abort signal is what enforces that. Sending a number the vendor
 * rejects turns a short budget into a broken conversation, which is what
 * it did (local, 2026-09-22).
 */
export function geminiDeadlineMs(budgetMs: number): number {
  return Math.max(GEMINI_MIN_DEADLINE_MS, budgetMs);
}

export function createGoogleModelProvider(
  options: GoogleModelProviderOptions,
): ModelProvider {
  const clients = [options.apiKey, ...(options.additionalApiKeys ?? [])].map(
    (apiKey) => new GoogleGenAI({ apiKey }),
  );
  /** Per key: when it may be tried again. Index into `clients`. */
  const blockedUntil = clients.map(() => 0);
  let cursor = 0;

  /** Keys to try for one request: from the cursor, unblocked first. */
  const keyOrder = (now: number): number[] => {
    const all = clients.map((_, index) => (cursor + index) % clients.length);
    const until = (index: number) => blockedUntil[index] ?? 0;
    return [
      ...all.filter((index) => until(index) <= now),
      ...all.filter((index) => until(index) > now),
    ];
  };

  /**
   * Run one call against the keys in turn.
   *
   * `spoke` is whether anything has already been streamed to the person:
   * once a word has left, the same answer cannot be started again on
   * another key, so the failure stands.
   */
  const withKey = async <T>(
    run: (client: GoogleGenAI) => Promise<T>,
    spoke: () => boolean,
  ): Promise<T> => {
    let lastFailure: ModelProviderFailure | undefined;
    for (const index of keyOrder(Date.now())) {
      const client = clients[index];
      if (client === undefined) continue;
      try {
        const value = await run(client);
        cursor = index;
        return value;
      } catch (error: unknown) {
        const failure = normalizeError(error);
        const keyScoped =
          failure.failureClass === "RATE_LIMIT" ||
          failure.failureClass === "AUTHENTICATION";
        if (spoke() || !keyScoped || clients.length === 1) {
          throw failure;
        }
        // This key is spent or refused for now; the next one takes the
        // same request.
        blockedUntil[index] =
          Date.now() +
          (failure.failureClass === "AUTHENTICATION"
            ? REFUSED_KEY_COOLDOWN_MS
            : KEY_COOLDOWN_MS);
        lastFailure = failure;
      }
    }
    throw (
      lastFailure ??
      new ModelProviderFailure("gemini request failed", {
        failureClass: "TRANSIENT",
        providerCode: GOOGLE_PROVIDER_CODE,
      })
    );
  };

  return {
    code: GOOGLE_PROVIDER_CODE,
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
      const { systemInstruction, contents } = toContents(request.messages);
      // Thinking levels are Gemini 3's; a 2.x model refuses the field.
      const level = /^gemini-2\./.test(request.modelCode)
        ? undefined
        : thinkingLevel(request.reasoning);
      const config: GenerateContentConfig = {
        abortSignal: context.signal,
        // The gateway owns retry and its own timeout; the SDK gets one shot.
        //
        // Floored: see geminiDeadlineMs. The abort signal above is what
        // actually enforces a caller's shorter budget.
        httpOptions: {
          timeout: geminiDeadlineMs(context.attemptTimeoutMs),
          retryOptions: { attempts: 1 },
        },
        maxOutputTokens: request.maxOutputTokens,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        ...(systemInstruction === undefined ? {} : { systemInstruction }),
        // A response schema beside function declarations is refused by
        // Gemini, so with tools the shape is the prompt's and Capital Q's
        // own Zod acceptance decides, as for any text answer.
        ...(request.output.kind === "STRUCTURED" && request.tools.length === 0
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

      const params = {
        model: request.modelCode,
        contents,
        config,
      };

      /**
       * Streamed only when somebody is listening. The same parameters
       * either way: for this SDK the only difference between the two
       * calls is which method is named, so a caller that wants the answer
       * as it is written gets it, and one that does not pays nothing for
       * the machinery.
       */
      if (context.onTextDelta === undefined) {
        const response: GenerateContentResponse = await withKey(
          (client) => client.models.generateContent(params),
          () => false,
        );
        const toolCalls = toolCallsOf(response);
        const text = textOf(response);
        return finished(request, response, text, toolCalls);
      }

      let text = "";
      const toolCalls: ModelToolCall[] = [];
      let last: GenerateContentResponse | undefined;
      // Gemini numbers a synthesised call id by its position among the
      // parts it arrived with, so in a stream the numbering has to be
      // ours: two chunks each holding their first part would otherwise
      // both be "gen_0".
      let callsSoFar = 0;
      let spoke = false;
      // Captured before the closure: the narrowing from the check above
      // does not survive into a callback.
      const onTextDelta = context.onTextDelta;
      await withKey(
        async (client) => {
          const stream = await client.models.generateContentStream(params);
          for await (const chunk of stream) {
            last = chunk;
            const fragment = textOf(chunk);
            if (fragment.length > 0) {
              text += fragment;
              spoke = true;
              onTextDelta(fragment);
            }
            for (const call of toolCallsOf(chunk, callsSoFar)) {
              toolCalls.push(call);
              callsSoFar += 1;
            }
          }
          return null;
        },
        () => spoke,
      );
      if (last === undefined) {
        throw new ModelProviderFailure("gemini streamed nothing at all", {
          failureClass: "INVALID_MODEL_OUTPUT",
          providerCode: GOOGLE_PROVIDER_CODE,
        });
      }
      return finished(request, last, text, toolCalls);
    },
  };
}
