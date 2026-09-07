import {
  EmbeddingProviderFailure,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  instructionFor,
  type EmbedDocumentsRequest,
  type EmbeddingBatchResult,
  type EmbeddingConfiguration,
  type EmbeddingFailureClass,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderHealth,
  type EmbeddingResult,
  type EmbedQueryRequest,
} from "../contracts/index.js";
import type {
  EmbeddingExecutionContext,
  EmbeddingProvider,
} from "../application/ports.js";
import { assertValidVector, inputHash } from "../domain/vector.js";

/**
 * The local Text Embeddings Inference adapter (CQ-RAG-002 §11-§12, §19-§20).
 *
 * This is the only file in Capital Q that knows TEI's HTTP shape. It speaks
 * `POST /embed`, `GET /info` and `GET /health` to a server on a private
 * network and returns Capital Q's own result and failures; no TEI field, no
 * TEI status code and no TEI error string escapes it.
 *
 * Two behaviours are deliberate. Truncation is off, so an oversized input is
 * a reported refusal rather than a silently shortened piece of financial
 * evidence. Normalisation is requested from the runtime and never repeated
 * here, so a vector is normalised exactly once and the configuration says
 * where.
 *
 * The runtime holds the text while it embeds it, and nothing else does: no
 * request body, no error and no log line built here contains the input.
 */

export const LOCAL_TEI_PROVIDER_CODE = "local-tei" as const;

const PROVIDER = LOCAL_TEI_PROVIDER_CODE;

export type LocalTeiProviderOptions = {
  /** Private-network origin, e.g. `http://127.0.0.1:8080`. */
  readonly baseUrl: string;
  readonly configuration: EmbeddingConfiguration;
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the platform fetch. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Injectable for tests. */
  readonly now?: (() => number) | undefined;
};

type TeiInfo = {
  readonly model_id?: unknown;
  readonly model_sha?: unknown;
  readonly max_input_length?: unknown;
  readonly version?: unknown;
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * TEI's documented status codes, mapped to Capital Q's classes. 413 and 422
 * both mean "this input does not fit", which is a caller problem and never
 * worth retrying; 429 and 424 are the runtime being busy or unwell, which
 * is.
 */
function classifyStatus(status: number): EmbeddingFailureClass {
  if (status === 413 || status === 422) return "INPUT_TOO_LARGE";
  if (status === 429 || status === 424 || status === 503) return "UNAVAILABLE";
  if (status >= 500) return "UNAVAILABLE";
  return "INVALID_RESPONSE";
}

/** The runtime's stable error token, if it sent one. Never its message. */
function errorTypeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as { error_type?: unknown }).error_type;
  return typeof value === "string" ? value.slice(0, 64) : undefined;
}

export function createLocalTeiEmbeddingProvider(
  options: LocalTeiProviderOptions,
): EmbeddingProvider {
  const { configuration } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const origin = options.baseUrl.replace(/\/+$/, "");

  const fail = (
    message: string,
    failureClass: EmbeddingFailureClass,
    extra: {
      readonly status?: number | undefined;
      readonly runtimeErrorType?: string | undefined;
      readonly cause?: unknown;
    } = {},
  ): never => {
    throw new EmbeddingProviderFailure(message, {
      failureClass,
      providerCode: PROVIDER,
      ...extra,
    });
  };

  /**
   * One HTTP call under a composed signal: the caller's cancellation and our
   * own timeout both abort it, and the two are reported differently because
   * a cancelled request is not a broken runtime.
   */
  async function call(
    path: string,
    init: RequestInit,
    context: EmbeddingExecutionContext,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const timeoutMs = context.timeoutMs ?? options.timeoutMs;
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, timeoutMs);
    const signals = [
      timeout.signal,
      ...(context.signal ? [context.signal] : []),
    ];
    try {
      const response = await doFetch(`${origin}${path}`, {
        ...init,
        signal: AbortSignal.any(signals),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch (error: unknown) {
          return fail(
            "the embedding runtime returned a response that is not JSON",
            "INVALID_RESPONSE",
            { status: response.status, cause: error },
          );
        }
      }
      return { status: response.status, body };
    } catch (error: unknown) {
      if (error instanceof EmbeddingProviderFailure) throw error;
      if (context.signal?.aborted === true) {
        return fail("the embedding request was cancelled", "CANCELLED", {
          cause: error,
        });
      }
      if (timeout.signal.aborted) {
        return fail(
          `the embedding runtime did not answer within ${String(timeoutMs)} ms`,
          "TIMEOUT",
          { cause: error },
        );
      }
      // A connection refused, a DNS failure, a socket reset: the runtime is
      // not there. Never a reason to send private text anywhere else.
      return fail("the embedding runtime could not be reached", "UNAVAILABLE", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Guards the batch before a byte is sent; the runtime is not a validator. */
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
    assertInputsFit(inputs);
    const startedAt = now();
    const { status, body } = await call(
      "/embed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputs,
          // Asked for explicitly rather than relied on: the configuration,
          // not the runtime's default, decides that vectors are unit length.
          normalize: configuration.normalization === "L2_UNIT",
          // Never truncate. Losing the end of a document silently is worse
          // than refusing to embed it.
          truncate: false,
        }),
      },
      context,
    );
    const latencyMs = now() - startedAt;
    if (status !== 200) {
      fail(
        "the embedding runtime refused the request",
        classifyStatus(status),
        { status, runtimeErrorType: errorTypeOf(body) },
      );
    }
    if (!Array.isArray(body) || body.length !== inputs.length) {
      // A count mismatch would silently mis-assign vectors to chunks.
      fail(
        "the embedding runtime returned a different number of vectors than inputs",
        "INVALID_RESPONSE",
        { status },
      );
    }
    const vectors = (body as unknown[]).map((vector) =>
      assertValidVector(vector, configuration, PROVIDER),
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
    endpoint: origin,
  });

  return {
    code: PROVIDER,
    describe,

    embedDocuments: async (
      request: EmbedDocumentsRequest,
      context: EmbeddingExecutionContext = {},
    ): Promise<EmbeddingBatchResult> => {
      // Documents are embedded exactly as they are: Qwen3 asks for no
      // retrieval instruction on passages, and adding one would change what
      // every stored vector means.
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

    embedQuery: async (
      request: EmbedQueryRequest,
      context: EmbeddingExecutionContext = {},
    ): Promise<EmbeddingResult> => {
      const profile = instructionFor(request.task);
      // The model's documented instruction format. It is built here and
      // nowhere else: application code passes a task, never a prompt.
      const input =
        configuration.instructionStrategy === "QUERY_ONLY"
          ? `Instruct: ${profile.instruction}\nQuery:${request.query}`
          : request.query;
      const { vectors, latencyMs } = await embed([input], context);
      const vector = vectors[0];
      if (vector === undefined) {
        return fail(
          "the embedding runtime returned no vector for the query",
          "INVALID_RESPONSE",
        );
      }
      return toResult(vector, input, profile.instructionVersion, latencyMs);
    },

    health: async (
      context: EmbeddingExecutionContext = {},
    ): Promise<EmbeddingProviderHealth> => {
      const startedAt = now();
      const base = {
        providerCode: PROVIDER,
        endpoint: origin,
        expectedModelCode: configuration.modelCode,
        expectedDimension: configuration.dimension,
      } as const;
      let info: { readonly status: number; readonly body: unknown };
      try {
        info = await call("/info", { method: "GET" }, context);
      } catch (error: unknown) {
        const failure =
          error instanceof EmbeddingProviderFailure ? error.failureClass : null;
        return {
          ...base,
          // Health never throws: an unreachable runtime is a state the
          // caller reports, not an exception it has to catch.
          state: "UNAVAILABLE",
          reportedModelCode: null,
          reportedModelRevision: null,
          reportedMaxInputTokens: null,
          runtimeVersion: null,
          latencyMs: now() - startedAt,
          detail:
            failure === "TIMEOUT"
              ? "the embedding runtime did not answer in time"
              : "the embedding runtime is not reachable",
        };
      }
      const latencyMs = now() - startedAt;
      if (
        info.status !== 200 ||
        typeof info.body !== "object" ||
        info.body === null
      ) {
        return {
          ...base,
          state: "UNAVAILABLE",
          reportedModelCode: null,
          reportedModelRevision: null,
          reportedMaxInputTokens: null,
          runtimeVersion: null,
          latencyMs,
          detail: "the embedding runtime is not ready",
        };
      }
      const body = info.body as TeiInfo;
      const reportedModelCode = stringOrNull(body.model_id);
      const reportedModelRevision = stringOrNull(body.model_sha);
      const modelMatches =
        reportedModelCode === null ||
        reportedModelCode === configuration.modelCode;
      const reportedMaxInputTokens = numberOrNull(body.max_input_length);
      // The one relationship that keeps "never truncate silently" true: a
      // token is never shorter than a character, so as long as Capital Q
      // refuses inputs longer than the runtime's token ceiling, no input can
      // reach the length at which the runtime would shorten it. If a
      // configuration or a runtime setting ever breaks that, it is a
      // misconfiguration, not a quiet loss of the end of a document.
      const inputBoundSafe =
        reportedMaxInputTokens === null ||
        configuration.maxInputCharacters <= reportedMaxInputTokens;
      // A pinned revision that the runtime contradicts is a different model
      // wearing the same name; vectors from it are not comparable.
      const revisionMatches =
        configuration.modelRevision === null ||
        reportedModelRevision === null ||
        reportedModelRevision === configuration.modelRevision;
      return {
        ...base,
        state:
          modelMatches && revisionMatches && inputBoundSafe
            ? "READY"
            : "MISCONFIGURED",
        reportedModelCode,
        reportedModelRevision,
        reportedMaxInputTokens,
        runtimeVersion: stringOrNull(body.version),
        latencyMs,
        detail: !modelMatches
          ? "the embedding runtime is serving another model"
          : !revisionMatches
            ? "the embedding runtime is serving another revision of the model"
            : !inputBoundSafe
              ? "the configured input bound exceeds what the runtime accepts, so an input could be truncated"
              : "the embedding runtime is serving the configured model",
      };
    },
  };
}
