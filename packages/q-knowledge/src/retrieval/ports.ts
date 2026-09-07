import type { DatabaseExecutor } from "@capital-q/database";

import type { ChunkId } from "../contracts/index.js";
import type { RetrievalHit, RetrievalScopeConstraint } from "./contracts.js";

/**
 * The database seam for authorised retrieval (CQ-RAG-004 §59, §61).
 *
 * Every port here takes the envelope's constraints and applies them IN the
 * query, before any ranking happens. There is no port that returns
 * candidates and expects the caller to filter them afterwards, because that
 * shape is the filter-after-retrieval security model this packet exists to
 * avoid: it leaks through result counts, through timing, and through the
 * first bug in the filtering code.
 */

export type AuthorisedCorpusScope = {
  readonly tenantId: string;
  /** A disjunction. Empty means no authorised way in, and must return nothing. */
  readonly constraints: readonly RetrievalScopeConstraint[];
};

export type LexicalSearchQuery = AuthorisedCorpusScope & {
  /**
   * The person's words. Parsed by Postgres's own websearch parser inside the
   * database; never concatenated into SQL, and never accepted as tsquery
   * operator syntax from a caller or a model.
   */
  readonly text: string;
  readonly limit: number;
};

/** A lexical candidate: identity and position only. Content is hydrated later. */
export type LexicalCandidate = {
  readonly chunkId: ChunkId;
  /** 1-based position by descending ts_rank. */
  readonly rank: number;
  /**
   * Postgres's `ts_rank` for this row. Diagnostics only: it is not
   * comparable across queries, is not a probability, and is never called a
   * confidence or shown to anyone.
   */
  readonly lexicalScore: number;
};

export type LexicalSearchPort = {
  readonly search: (
    executor: DatabaseExecutor,
    query: LexicalSearchQuery,
  ) => Promise<readonly LexicalCandidate[]>;
};

export type HydrationQuery = AuthorisedCorpusScope & {
  /** Fused candidates, in fused order. Bounded by the retrieval config. */
  readonly chunkIds: readonly ChunkId[];
};

/**
 * A hydrated row: the chunk with its document provenance, and the constraint
 * that admitted it.
 *
 * Hydration re-applies the whole envelope rather than trusting the candidate
 * lists (§27, §100). Both lists were already constrained, so this can only
 * ever be redundant — which is the intent. It is the layer that would have
 * to fail silently as well, and it is the layer that decides which scope a
 * hit is attributable to, so a hit can always say why it was allowed.
 */
export type HydratedChunk = Omit<
  RetrievalHit,
  | "lexicalRank"
  | "semanticRank"
  | "fusedRank"
  | "fusedScore"
  | "expandedFromChunkId"
>;

export type ChunkHydrationPort = {
  readonly hydrate: (
    executor: DatabaseExecutor,
    query: HydrationQuery,
  ) => Promise<readonly HydratedChunk[]>;
  /**
   * The parent sections of the given leaves, subject to the same envelope.
   *
   * A parent is authorised on its own terms or not at all: expanding from an
   * authorised child into a parent nobody granted would be a privilege
   * escalation dressed as context assembly (§29).
   */
  readonly parentsOf: (
    executor: DatabaseExecutor,
    query: HydrationQuery,
  ) => Promise<ReadonlyMap<ChunkId, HydratedChunk>>;
  /**
   * How many chunks this envelope can reach at all, capped at `limit`.
   *
   * The retrieval seam of the Q graph receives identifiers and no message
   * text by design, so it cannot search; what it can honestly establish is
   * whether an authorised way into the corpus exists for the plan that was
   * just revalidated. The number never leaves the server — the graph
   * checkpoints only the outcome's kind — and it is capped so the question
   * stays cheap on a large corpus.
   */
  readonly countAuthorised: (
    executor: DatabaseExecutor,
    scope: AuthorisedCorpusScope & { readonly limit: number },
  ) => Promise<number>;
};
