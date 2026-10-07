import type { EmbeddingConfig } from "@capital-q/config/embeddings";
import type { SemanticCandidateService } from "@capital-q/discovery";
import {
  createEmbeddingService,
  createLocalTeiEmbeddingProvider,
  createOpenAIEmbeddingProvider,
  EmbeddingProviderFailure,
  QWEN3_EMBEDDING_CONFIGURATION,
  type EmbeddingService,
} from "@capital-q/q-embeddings";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Semantic fit for Discover (Q.02, audit 2026-10-07).
 *
 * Root cause of 0 company and 0 mandate embeddings in production, two
 * parts: (1) the only adapter was the self-hosted TEI runtime, which was
 * removed from Railway on 2026-09-24 (it needs ~3-4 GB; the plan caps a
 * service at 1 GB), so Q_EMBEDDING_BASE_URL is unset and every embed is
 * UNAVAILABLE ("embedding runtime not configured" at every start); and
 * (2) nothing ever called `refreshCompanyRepresentations`, so even with a
 * runtime no company would have had a vector (0 company representations).
 *
 * The fix: Q_EMBEDDING_PROVIDER=openai selects the hosted adapter over the
 * reviewed OpenAI key the worker already holds, and the worker refreshes
 * company representations at start (before slates rebuild) and on an
 * interval. A refresh embeds only what is new or changed, so it costs
 * nothing when nothing changed. Mandate vectors are made on demand by the
 * slate build's semantic generator.
 */

export function composeRecommendationEmbedder(input: {
  readonly config: EmbeddingConfig;
  /** The worker's OpenAI model-provider key, if configured. */
  readonly openaiApiKey: string | undefined;
}): {
  readonly embedder: EmbeddingService;
  /** Names still needed for semantic fit to work. Never a value. */
  readonly missing: readonly string[];
} {
  const { config } = input;
  if (config.provider === "openai") {
    return {
      embedder: createEmbeddingService({
        provider: createOpenAIEmbeddingProvider({
          apiKey: input.openaiApiKey,
          timeoutMs: config.timeoutMs,
        }),
      }),
      missing: input.openaiApiKey === undefined ? ["OPENAI_API_KEY"] : [],
    };
  }
  return {
    embedder: createEmbeddingService({
      provider: createLocalTeiEmbeddingProvider({
        baseUrl: config.baseUrl,
        configuration: {
          ...QWEN3_EMBEDDING_CONFIGURATION,
          maxBatchItems: config.maxBatchItems,
        },
        timeoutMs: config.timeoutMs,
      }),
    }),
    missing: config.missing,
  };
}

/** One bounded refresh; failures are error lines with an alert code. */
export async function refreshCompanyEmbeddings(options: {
  readonly semantic: Pick<
    SemanticCandidateService,
    "refreshCompanyRepresentations"
  >;
  readonly logger: RunnerLogger;
  readonly limit: number;
}): Promise<boolean> {
  try {
    const report = await options.semantic.refreshCompanyRepresentations({
      limit: options.limit,
    });
    options.logger.info(
      { ...report },
      "company representations refreshed for semantic fit",
    );
    return true;
  } catch (error: unknown) {
    options.logger.error(
      {
        alert: "SEMANTIC_EMBEDDING_FAILED",
        failure:
          error instanceof EmbeddingProviderFailure
            ? error.failureClass
            : "UNKNOWN",
      },
      "company representations could not be embedded; semantic fit stays unknown",
    );
    return false;
  }
}

/** The refresh every `intervalMs` until shutdown (the first run is the caller's). */
export async function runCompanyEmbeddingRefresh(options: {
  readonly semantic: Pick<
    SemanticCandidateService,
    "refreshCompanyRepresentations"
  >;
  readonly logger: RunnerLogger;
  readonly limit: number;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  for (;;) {
    await abortableSleep(options.intervalMs, options.signal);
    if (options.signal.aborted) return;
    await refreshCompanyEmbeddings(options);
  }
}
