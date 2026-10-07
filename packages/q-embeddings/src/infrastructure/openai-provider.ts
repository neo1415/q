import {
  EmbeddingConfigurationSchema,
  EmbeddingProviderFailure,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  instructionFor,
  type EmbeddingBatchResult,
  type EmbeddingConfiguration,
  type EmbeddingFailureClass,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderHealth,
  type EmbeddingResult,
} from "../contracts/index.js";
import type {
  EmbeddingExecutionContext,
  EmbeddingProvider,
} from "../application/ports.js";
import { assertValidVector, inputHash } from "../domain/vector.js";

/**
 * The hosted OpenAI embeddings adapter (Q.02, 2026-10-07).
 *
 * Why it exists: the self-hosted TEI runtime (Qwen3-Embedding-0.6B) needs
 * ~3-4 GB and the Railway plan caps a service at 1 GB, so it was removed
 * on 2026-09-24 and every hosted company and mandate stayed vectorless
 * (0 embeddings): semantic fit was silently absent from every slate. The
 * lead's note then named this as the option: OpenAI embeddings at the
 * table's fixed 1024 dimensions.
 *
 * Provider eligibility: OpenAI is already the Model Gateway's primary
 * reviewed provider for CONFIDENTIAL work (deck reading). What is sent is
 * (a) a company's investor-visible representation and (b) an investor's
 * own mandate representation, never a founder-private field (the
 * representation builders' contract). Like TEI, nothing here logs or
 * echoes the input; only failure classes and counts leave this file.
 *
 * A different provider is a different configuration version, so vectors
 * from the two never mix in one search (the store keys every vector by
 * configuration and instruction version).
 */

export const OPENAI_EMBEDDING_PROVIDER_CODE = "openai" as const;
const PROVIDER = OPENAI_EMBEDDING_PROVIDER_CODE;
const ENDPOINT = "https://api.openai.com/v1/embeddings";

export const OPENAI_TE3_SMALL_1024_CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-openai-te3-small-1024-v1",
    providerCode: PROVIDER,
    runtime: "HOSTED_API",
    modelCode: "text-embedding-3-small",
    modelFamily: "openai-text-embedding-3",
    // A hosted model reports no weights revision.
    modelRevision: null,
    // The recommendation tables hold vector(1024); the model's native size
    // is 1536 and the API shortens (and re-normalises) on request.
    dimension: 1024,
    maxDimension: 1536,
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    // Far under the model's 8,191-token limit (a token is never shorter
    // than a character), so the API never truncates an input.
    maxInputCharacters: 4_000,
    maxBatchItems: 64,
    maxBatchCharacters: 256_000,
  });

export type OpenAIEmbeddingProviderOptions = {
  /** Undefined or a disabled placeholder: every call is UNAVAILABLE, no request. */
  readonly apiKey: string | undefined;
  readonly configuration?: EmbeddingConfiguration | undefined;
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the platform fetch. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly now?: (() => number) | undefined;
};

function classifyStatus(status: number): EmbeddingFailureClass {
  if (status === 400 || status === 413) return "INPUT_TOO_LARGE";
  if (status === 401 || status === 403 || status === 404)
    return "CONFIGURATION_ERROR";
  if (status === 429 || status >= 500) return "UNAVAILABLE";
  return "INVALID_RESPONSE";
}

export function createOpenAIEmbeddingProvider(
  options: OpenAIEmbeddingProviderOptions,
): EmbeddingProvider {
  const configuration =
    options.configuration ?? OPENAI_TE3_SMALL_1024_CONFIGURATION;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const apiKey =
    options.apiKey === undefined ||
    options.apiKey.trim() === "" ||
    options.apiKey.startsWith("disabled-")
      ? null
      : options.apiKey;

  const fail = (
    message: string,
    failureClass: EmbeddingFailureClass,
    extra: {
      readonly status?: number | undefined;
      readonly cause?: unknown;
    } = {},
  ): never => {
    throw new EmbeddingProviderFailure(message, {
      failureClass,
      providerCode: PROVIDER,
      ...extra,
    });
  };

  function assertInputsFit(inputs: readonly string[]): void {
    if (inputs.length === 0) {
      fail(
        "an embedding batch must have at least one input",
        "CONFIGURATION_ERROR",
      );
    }
    if (inputs.length > configuration.maxBatchItems) {
      fail(
        `an embedding batch may carry at most ${String(configuration.maxBatchItems)} inputs`,
        "INPUT_TOO_LARGE",
      );
    }
    let total = 0;
    for (const input of inputs) {
      if (input.length > configuration.maxInputCharacters) {
        fail(
          `an embedding input may be at most ${String(configuration.maxInputCharacters)} characters`,
          "INPUT_TOO_LARGE",
        );
      }
      total += input.length;
    }
    if (total > configuration.maxBatchCharacters) {
      fail(
        `an embedding batch may carry at most ${String(configuration.maxBatchCharacters)} characters`,
        "INPUT_TOO_LARGE",
      );
    }
  }

  async function embed(
    inputs: readonly string[],
    context: EmbeddingExecutionContext,
  ): Promise<{
    readonly vectors: readonly (readonly number[])[];
    readonly latencyMs: number;
  }> {
    if (apiKey === null) {
      return fail("the embedding provider is not configured", "UNAVAILABLE");
    }
    assertInputsFit(inputs);
    const startedAt = now();
    const timeoutMs = context.timeoutMs ?? options.timeoutMs;
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, timeoutMs);
    let status = 0;
    let body: unknown;
    try {
      const response = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: configuration.modelCode,
          input: inputs,
          dimensions: configuration.dimension,
          encoding_format: "float",
        }),
        signal: AbortSignal.any([
          timeout.signal,
          ...(context.signal ? [context.signal] : []),
        ]),
      });
      status = response.status;
      const text = await response.text();
      body = text.length === 0 ? null : (JSON.parse(text) as unknown);
    } catch (error: unknown) {
      if (context.signal?.aborted === true) {
        return fail("the embedding request was cancelled", "CANCELLED", {
          cause: error,
        });
      }
      if (timeout.signal.aborted) {
        return fail(
          `the embedding provider did not answer within ${String(timeoutMs)} ms`,
          "TIMEOUT",
          { cause: error },
        );
      }
      return fail(
        status === 0
          ? "the embedding provider could not be reached"
          : "the embedding provider returned a response that is not JSON",
        status === 0 ? "UNAVAILABLE" : "INVALID_RESPONSE",
        { status, cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = now() - startedAt;
    if (status !== 200) {
      // Never the provider's message: it can quote the input.
      return fail(
        "the embedding provider refused the request",
        classifyStatus(status),
        {
          status,
        },
      );
    }
    const data =
      typeof body === "object" && body !== null
        ? (body as { data?: unknown }).data
        : undefined;
    if (!Array.isArray(data) || data.length !== inputs.length) {
      return fail(
        "the embedding provider returned a different number of vectors than inputs",
        "INVALID_RESPONSE",
        { status },
      );
    }
    // The API answers with an index per item; order by it, never by arrival.
    const byIndex = new Map<number, unknown>();
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const { index, embedding } = item as {
        index?: unknown;
        embedding?: unknown;
      };
      if (typeof index === "number") byIndex.set(index, embedding);
    }
    const vectors = inputs.map((_input, at) =>
      assertValidVector(byIndex.get(at), configuration, PROVIDER),
    );
    return { vectors, latencyMs };
  }

  function toResult(
    vector: readonly number[],
    input: string,
    instructionVersion: string,
    latencyMs: number,
  ): EmbeddingResult {
    return {
      vector,
      dimension: vector.length,
      providerCode: PROVIDER,
      modelCode: configuration.modelCode,
      modelRevision: configuration.modelRevision,
      configurationVersion: configuration.configurationVersion,
      instructionVersion,
      inputSha256: inputHash(input),
      inputCharacters: input.length,
      latencyMs,
    };
  }

  const describe = (): EmbeddingProviderDescriptor => ({
    providerCode: PROVIDER,
    configuration,
    endpoint: ENDPOINT,
  });

  return {
    code: PROVIDER,
    describe,
    embedDocuments: async (
      request,
      context = {},
    ): Promise<EmbeddingBatchResult> => {
      const { vectors, latencyMs } = await embed(request.inputs, context);
      return {
        embeddings: vectors.map((vector, at) =>
          toResult(
            vector,
            request.inputs[at] ?? "",
            EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
            latencyMs,
          ),
        ),
        batchSize: request.inputs.length,
        latencyMs,
      };
    },
    embedQuery: async (request, context = {}): Promise<EmbeddingResult> => {
      const profile = instructionFor(request.task);
      const input =
        configuration.instructionStrategy === "QUERY_ONLY"
          ? `Instruct: ${profile.instruction}\nQuery:${request.query}`
          : request.query;
      const { vectors, latencyMs } = await embed([input], context);
      const vector = vectors[0];
      if (vector === undefined) {
        return fail(
          "the embedding provider returned no vector",
          "INVALID_RESPONSE",
        );
      }
      return toResult(vector, input, profile.instructionVersion, latencyMs);
    },
    // No request: a health probe that spends money on every start is not
    // worth it. Configured-or-not is what the caller needs to report.
    health: (): Promise<EmbeddingProviderHealth> =>
      Promise.resolve({
        state: apiKey === null ? "UNAVAILABLE" : "READY",
        providerCode: PROVIDER,
        endpoint: ENDPOINT,
        reportedModelCode: null,
        reportedModelRevision: null,
        reportedMaxInputTokens: null,
        runtimeVersion: null,
        expectedModelCode: configuration.modelCode,
        expectedDimension: configuration.dimension,
        latencyMs: 0,
        detail:
          apiKey === null
            ? "the embedding provider is not configured"
            : "the embedding provider is configured",
      }),
  };
}
