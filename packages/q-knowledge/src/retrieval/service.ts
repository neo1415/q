import type { DatabaseExecutor } from "@capital-q/database";
import { getMeter, type Logger } from "@capital-q/observability";
import type { EmbeddingService } from "@capital-q/q-embeddings";

import type { SemanticSearchPort } from "../application/embedding-ports.js";
import type { SemanticCandidate } from "../contracts/embeddings.js";
import type { ChunkId } from "../contracts/index.js";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  RETRIEVAL_QUERY_MAX_CHARACTERS,
  type AuthorisedRetrievalRequest,
  type AuthorisedRetrievalResult,
  type RetrievalComponentState,
  type RetrievalConfig,
  type RetrievalDegradation,
  type RetrievalHit,
  type RetrievalPermissionEnvelope,
  type RetrievalStrategy,
} from "./contracts.js";
import { envelopeIsCurrent } from "./envelope.js";
import { fuseByReciprocalRank, type FusionInput } from "./fusion.js";
import type {
  ChunkHydrationPort,
  HydratedChunk,
  LexicalCandidate,
  LexicalSearchPort,
} from "./ports.js";

/**
 * The authorised retrieval service (CQ-RAG-004 §6, §8, §23, §41, §65).
 *
 * The order below is the security property, and it is the only order the
 * code can express:
 *
 *   permitted context plan → envelope → lexical ∧ semantic, each already
 *   constrained in SQL → fusion over authorised lists → authorised
 *   hydration → authorised expansion → bounded assembly
 *
 * There is no path through this file that searches first and filters after.
 * Fusion cannot admit anything; hydration re-applies the whole envelope; and
 * expansion resolves a parent on its own authority or not at all. A chunk
 * that no constraint admits is not filtered out of a result — it is never a
 * row, so it cannot be counted, timed or accidentally serialised.
 *
 * What it deliberately does not do: decide permission, rewrite the query
 * with a model, rerank with a second model, cache, call anything external,
 * write anything, or turn a retrieved passage into a claim.
 */

export type AuthorisedRetrievalDependencies = {
  readonly sql: DatabaseExecutor;
  readonly lexical: LexicalSearchPort;
  readonly semantic: SemanticSearchPort;
  readonly hydration: ChunkHydrationPort;
  /**
   * Query embedding through CQ-RAG-002's local provider. Optional: an
   * environment with no embedding runtime retrieves lexically and says so,
   * and never silently reaches for a paid API instead.
   */
  readonly embeddings?: EmbeddingService | undefined;
  readonly config?: RetrievalConfig | undefined;
  readonly logger?: Logger | undefined;
};

export type AuthorisedRetrievalService = {
  readonly config: RetrievalConfig;
  readonly retrieve: (
    request: AuthorisedRetrievalRequest,
  ) => Promise<AuthorisedRetrievalResult>;
};

/** A stale plan is a programming error at this seam, not a public failure. */
export class StaleRetrievalEnvelopeError extends Error {
  constructor() {
    super(
      "the permitted context plan is no longer current; re-plan before retrieving",
    );
    this.name = "StaleRetrievalEnvelopeError";
  }
}

export class RetrievalCancelledError extends Error {
  constructor() {
    super("retrieval was cancelled");
    this.name = "RetrievalCancelledError";
  }
}

function emptyResult(
  config: RetrievalConfig,
  requested: RetrievalStrategy,
  executed: RetrievalStrategy,
  degraded: RetrievalDegradation,
  totalMs: number,
  constraintCount: number,
): AuthorisedRetrievalResult {
  return {
    configVersion: config.configVersion,
    requestedStrategy: requested,
    executedStrategy: executed,
    degraded,
    hits: [],
    diagnostics: {
      lexicalCandidates: 0,
      semanticCandidates: 0,
      fusedCandidates: 0,
      constraintCount,
      queryEmbeddingMs: null,
      lexicalMs: null,
      semanticMs: null,
      fusionMs: 0,
      expansionMs: 0,
      totalMs,
      contextCharacters: 0,
    },
  };
}

export function createAuthorisedRetrievalService(
  dependencies: AuthorisedRetrievalDependencies,
): AuthorisedRetrievalService {
  const { sql, lexical, semantic, hydration, embeddings, logger } =
    dependencies;
  const config = dependencies.config ?? DEFAULT_RETRIEVAL_CONFIG;
  const meter = getMeter("@capital-q/q-knowledge");
  const metrics = {
    requests: meter.createCounter("q.retrieval.requests"),
    empty: meter.createCounter("q.retrieval.empty_results"),
    degraded: meter.createCounter("q.retrieval.degraded"),
    hits: meter.createHistogram("q.retrieval.final_hits"),
    latencyMs: meter.createHistogram("q.retrieval.latency_milliseconds"),
    lexicalMs: meter.createHistogram("q.retrieval.lexical_milliseconds"),
    semanticMs: meter.createHistogram("q.retrieval.semantic_milliseconds"),
    embeddingMs: meter.createHistogram(
      "q.retrieval.query_embedding_milliseconds",
    ),
    contextCharacters: meter.createHistogram("q.retrieval.context_characters"),
  };

  const throwIfCancelled = (signal: AbortSignal | undefined): void => {
    if (signal?.aborted === true) {
      throw new RetrievalCancelledError();
    }
  };

  async function runLexical(
    envelope: RetrievalPermissionEnvelope,
    text: string,
  ): Promise<{
    readonly candidates: readonly LexicalCandidate[];
    readonly state: RetrievalComponentState;
    readonly ms: number;
  }> {
    const started = Date.now();
    try {
      const candidates = await lexical.search(sql, {
        tenantId: envelope.tenantId,
        constraints: envelope.constraints,
        text,
        limit: config.lexicalCandidates,
      });
      return { candidates, state: "OK", ms: Date.now() - started };
    } catch (error: unknown) {
      // A lexical outage is observable internally and invisible publicly:
      // the person is told evidence search is limited, never why.
      logger?.error({ err: error }, "lexical retrieval failed");
      return { candidates: [], state: "UNAVAILABLE", ms: Date.now() - started };
    }
  }

  async function runSemantic(
    envelope: RetrievalPermissionEnvelope,
    text: string,
    signal: AbortSignal | undefined,
  ): Promise<{
    readonly candidates: readonly SemanticCandidate[];
    readonly state: RetrievalComponentState;
    readonly embeddingMs: number | null;
    readonly searchMs: number | null;
    readonly reason: RetrievalDegradation["reason"];
  }> {
    if (embeddings === undefined) {
      return {
        candidates: [],
        state: "UNAVAILABLE",
        embeddingMs: null,
        searchMs: null,
        reason: "EMBEDDING_UNAVAILABLE",
      };
    }
    const embeddingStarted = Date.now();
    let vector: readonly number[];
    let dimension: number;
    let configurationVersion: string;
    try {
      const result = await embeddings.embedQuery(
        text,
        "EVIDENCE_RETRIEVAL",
        signal === undefined ? undefined : { signal },
      );
      vector = result.vector;
      dimension = result.dimension;
      configurationVersion = result.configurationVersion;
    } catch (error: unknown) {
      // The local runtime is unavailable. There is no fallback: sending a
      // private evidence query to an external embedding API to keep search
      // working would trade a privacy guarantee for an availability one.
      logger?.error({ err: error }, "query embedding failed");
      return {
        candidates: [],
        state: "UNAVAILABLE",
        embeddingMs: Date.now() - embeddingStarted,
        searchMs: null,
        reason: "EMBEDDING_UNAVAILABLE",
      };
    }
    const embeddingMs = Date.now() - embeddingStarted;
    const searchStarted = Date.now();
    try {
      const candidates = await semantic.search(sql, {
        tenantId: envelope.tenantId,
        configurationVersion,
        dimension,
        queryVector: [...vector],
        k: config.semanticCandidates,
        authorisedScopes: envelope.constraints.map((constraint) => ({
          subjectIds:
            constraint.subjectIds === null ? null : [...constraint.subjectIds],
          visibilityScopes: [...constraint.visibilityScopes],
          sensitivityCeiling: constraint.sensitivityCeiling,
        })),
        requireCurrentSource: true,
      });
      return {
        candidates,
        state: "OK",
        embeddingMs,
        searchMs: Date.now() - searchStarted,
        reason: null,
      };
    } catch (error: unknown) {
      logger?.error({ err: error }, "semantic retrieval failed");
      return {
        candidates: [],
        state: "UNAVAILABLE",
        embeddingMs,
        searchMs: Date.now() - searchStarted,
        reason: "SEMANTIC_UNAVAILABLE",
      };
    }
  }

  /**
   * Replaces a matched leaf with its parent section where the parent is
   * itself authorised and the substitution buys coherence rather than bulk.
   *
   * Two leaves under one parent collapse to one parent, which is how
   * overlapping chunks stop arriving as near-duplicates (§78). A parent the
   * envelope does not admit simply does not appear, and the leaf stays.
   */
  async function expand(
    envelope: RetrievalPermissionEnvelope,
    ordered: readonly {
      readonly hydrated: HydratedChunk;
      readonly lexicalRank: number | null;
      readonly semanticRank: number | null;
      readonly fusedScore: number;
    }[],
  ): Promise<readonly RetrievalHit[]> {
    const leafIds = ordered
      .filter((entry) => entry.hydrated.parentChunkId !== null)
      .map((entry) => entry.hydrated.chunkId);
    const parents = config.parentExpansion
      ? await hydration.parentsOf(sql, {
          tenantId: envelope.tenantId,
          constraints: envelope.constraints,
          chunkIds: leafIds,
        })
      : new Map<ChunkId, HydratedChunk>();

    const seen = new Set<ChunkId>();
    const hits: RetrievalHit[] = [];
    let characters = 0;
    for (const entry of ordered) {
      if (hits.length >= config.finalHits) {
        break;
      }
      const parent = parents.get(entry.hydrated.chunkId);
      const chosen = parent ?? entry.hydrated;
      const expandedFrom = parent === undefined ? null : entry.hydrated.chunkId;
      if (seen.has(chosen.chunkId)) {
        continue;
      }
      const content = chosen.content.slice(0, config.maxCharactersPerHit);
      if (characters + content.length > config.maxContextCharacters) {
        // The budget is a ceiling on what the model is asked to read, not a
        // reason to drop the rest of the ranking silently mid-hit.
        break;
      }
      seen.add(chosen.chunkId);
      characters += content.length;
      hits.push({
        ...chosen,
        content,
        lexicalRank: entry.lexicalRank,
        semanticRank: entry.semanticRank,
        fusedRank: hits.length + 1,
        fusedScore: entry.fusedScore,
        expandedFromChunkId: expandedFrom,
      });
    }
    return hits;
  }

  return {
    config,

    retrieve: async (request) => {
      const started = Date.now();
      const requested = request.strategy ?? "HYBRID";
      const envelope = request.envelope;
      const now = request.now ?? new Date();
      const text = request.query
        .trim()
        .slice(0, RETRIEVAL_QUERY_MAX_CHARACTERS);
      const labels = { strategy: requested, config: config.configVersion };
      metrics.requests.add(1, labels);

      if (!envelopeIsCurrent(envelope, now)) {
        throw new StaleRetrievalEnvelopeError();
      }
      throwIfCancelled(request.signal);

      if (envelope.constraints.length === 0 || text.length === 0) {
        // No authorised way into the corpus, or nothing to search for. Both
        // are ordinary empty results and are reported identically: a caller
        // able to tell them apart could probe what exists.
        metrics.empty.add(1, labels);
        return emptyResult(
          config,
          requested,
          requested,
          {
            lexical: "NOT_ATTEMPTED",
            semantic: "NOT_ATTEMPTED",
            reason: "NO_AUTHORISED_SCOPE",
          },
          Date.now() - started,
          envelope.constraints.length,
        );
      }

      const wantsLexical = requested !== "SEMANTIC_ONLY";
      const wantsSemantic = requested !== "LEXICAL_ONLY";

      const lexicalOutcome = wantsLexical
        ? await runLexical(envelope, text)
        : { candidates: [], state: "NOT_ATTEMPTED" as const, ms: null };
      throwIfCancelled(request.signal);
      const semanticOutcome = wantsSemantic
        ? await runSemantic(envelope, text, request.signal)
        : {
            candidates: [],
            state: "NOT_ATTEMPTED" as const,
            embeddingMs: null,
            searchMs: null,
            reason: null,
          };
      throwIfCancelled(request.signal);

      const degraded: RetrievalDegradation = {
        lexical: lexicalOutcome.state,
        semantic: semanticOutcome.state,
        reason:
          lexicalOutcome.state === "UNAVAILABLE" &&
          semanticOutcome.state === "UNAVAILABLE"
            ? "LEXICAL_UNAVAILABLE"
            : lexicalOutcome.state === "UNAVAILABLE"
              ? "LEXICAL_UNAVAILABLE"
              : semanticOutcome.state === "UNAVAILABLE"
                ? (semanticOutcome.reason ?? "SEMANTIC_UNAVAILABLE")
                : requested === "HYBRID"
                  ? null
                  : "STRATEGY_REQUESTED",
      };
      const executed: RetrievalStrategy =
        lexicalOutcome.state === "OK" && semanticOutcome.state === "OK"
          ? "HYBRID"
          : lexicalOutcome.state === "OK"
            ? "LEXICAL_ONLY"
            : semanticOutcome.state === "OK"
              ? "SEMANTIC_ONLY"
              : requested;

      if (degraded.reason !== null) {
        metrics.degraded.add(1, { ...labels, reason: degraded.reason });
      }
      if (lexicalOutcome.ms !== null) {
        metrics.lexicalMs.record(lexicalOutcome.ms, labels);
      }
      if (semanticOutcome.embeddingMs !== null) {
        metrics.embeddingMs.record(semanticOutcome.embeddingMs, labels);
      }
      if (semanticOutcome.searchMs !== null) {
        metrics.semanticMs.record(semanticOutcome.searchMs, labels);
      }

      const fusionStarted = Date.now();
      const lexicalInputs: FusionInput<ChunkId>[] =
        lexicalOutcome.candidates.map((candidate) => ({
          key: candidate.chunkId,
          item: candidate.chunkId,
          rank: candidate.rank,
        }));
      const semanticInputs: FusionInput<ChunkId>[] =
        semanticOutcome.candidates.map((candidate) => ({
          key: candidate.chunkId,
          item: candidate.chunkId,
          rank: candidate.rank,
        }));
      const fused = fuseByReciprocalRank(lexicalInputs, semanticInputs, {
        rrfK: config.rrfK,
        limit: config.fusedCandidates,
      });
      const fusionMs = Date.now() - fusionStarted;

      // Hydration re-applies the envelope. Both input lists were already
      // constrained, so this can only ever agree with them — and it is the
      // layer that would also have to fail before anything unauthorised
      // could be assembled into a model's context.
      const hydrated = await hydration.hydrate(sql, {
        tenantId: envelope.tenantId,
        constraints: envelope.constraints,
        chunkIds: fused.map((entry) => entry.item),
      });
      throwIfCancelled(request.signal);
      const byId = new Map(hydrated.map((row) => [row.chunkId, row]));

      const expansionStarted = Date.now();
      const hits = await expand(
        envelope,
        fused.flatMap((entry) => {
          const row = byId.get(entry.item);
          return row === undefined
            ? []
            : [
                {
                  hydrated: row,
                  lexicalRank: entry.lexicalRank,
                  semanticRank: entry.semanticRank,
                  fusedScore: entry.fusedScore,
                },
              ];
        }),
      );
      const expansionMs = Date.now() - expansionStarted;
      const contextCharacters = hits.reduce(
        (total, hit) => total + hit.content.length,
        0,
      );
      const totalMs = Date.now() - started;

      metrics.hits.record(hits.length, labels);
      metrics.latencyMs.record(totalMs, labels);
      metrics.contextCharacters.record(contextCharacters, labels);
      if (hits.length === 0) {
        metrics.empty.add(1, labels);
      }
      // Counts and codes only: no query text, no chunk text, no title, and
      // no count of what was excluded — "3 results were withheld" discloses
      // existence as surely as naming the file would.
      logger?.debug(
        {
          planId: envelope.planId,
          configVersion: config.configVersion,
          strategy: executed,
          lexicalCandidates: lexicalOutcome.candidates.length,
          semanticCandidates: semanticOutcome.candidates.length,
          fusedCandidates: fused.length,
          hits: hits.length,
          totalMs,
        },
        "authorised retrieval completed",
      );

      return {
        configVersion: config.configVersion,
        requestedStrategy: requested,
        executedStrategy: executed,
        degraded,
        hits,
        diagnostics: {
          lexicalCandidates: lexicalOutcome.candidates.length,
          semanticCandidates: semanticOutcome.candidates.length,
          fusedCandidates: fused.length,
          constraintCount: envelope.constraints.length,
          queryEmbeddingMs: semanticOutcome.embeddingMs,
          lexicalMs: lexicalOutcome.ms,
          semanticMs: semanticOutcome.searchMs,
          fusionMs,
          expansionMs,
          totalMs,
          contextCharacters,
        },
      };
    },
  };
}
