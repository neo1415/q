import type { ChunkId } from "../contracts/index.js";
import type { RetrievalFocusHint, RetrievalRerankerCode } from "./contracts.js";
import { distinctTerms } from "./terms.js";

/**
 * The reranker seam (Q intelligence step 5; doc 14 §27).
 *
 * A reranker REORDERS candidates that were already authorised: searched
 * under the envelope in SQL, fused, and hydrated under the envelope again.
 * It receives nothing else and cannot add anything — the service keeps
 * only ids it was given, so a reranker that returned a foreign id would
 * have that id ignored, not retrieved. It writes nothing and decides no
 * permission.
 *
 * The default is deterministic local code. A model reranker, when one is
 * worth its latency, implements the same port through the Model Gateway
 * by task class (a cross-encoder adapter), never a provider SDK here.
 */

export type RerankCandidate = {
  readonly chunkId: ChunkId;
  readonly subjectId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly content: string;
  /** 1-based position after fusion. */
  readonly fusedRank: number;
};

export type RerankRequest = {
  /** The searches this retrieval ran (the person's words, rewritten). */
  readonly queries: readonly {
    readonly text: string;
    /** 0-1; how much its words count. */
    readonly weight: number;
  }[];
  readonly focus: RetrievalFocusHint | null;
  readonly candidates: readonly RerankCandidate[];
  readonly signal?: AbortSignal | undefined;
};

export type RetrievalReranker = {
  readonly code: RetrievalRerankerCode;
  /** The candidates' ids, best first. */
  readonly rerank: (request: RerankRequest) => Promise<readonly ChunkId[]>;
};

/** Fused order, unchanged: `reranker: "NONE"`. */
export const NO_RERANKER: RetrievalReranker = {
  code: "NONE",
  rerank: (request) =>
    Promise.resolve(
      [...request.candidates]
        .sort((a, b) => a.fusedRank - b.fusedRank)
        .map((candidate) => candidate.chunkId),
    ),
};

/**
 * Weights of the local reranker, versioned with it. Changing one is a new
 * reranker code and a new measured baseline.
 */
export const LOCAL_RERANKER_WEIGHTS = {
  /** Share of the query's (idf-weighted) terms the chunk contains. */
  termOverlap: 1,
  /**
   * The chunk is about an entity the conversation bound this turn to: filed
   * under its subject, or naming it. Either, not both, so an entity known
   * only by name (no record yet) weighs the same as one with an id.
   */
  entityMatch: 0.6,
  /** The chunk is from a document the conversation bound this turn to. */
  documentMatch: 0.5,
  /** The fused order, as a tie-breaker that never outvotes evidence. */
  fusedPrior: 0.1,
  /**
   * With two or more entities in focus, each further pick from a subject
   * already picked costs this much, so "one line on each" of three
   * companies does not give all eight places to the first.
   */
  sameSubjectPenalty: 0.15,
} as const;

function contains(haystack: string, needle: string): boolean {
  return (
    needle.length >= 3 && haystack.toLowerCase().includes(needle.toLowerCase())
  );
}

/**
 * Field overlap plus entity match, computed over the candidates alone.
 *
 * Terms are weighted by how rare they are AMONG THE CANDIDATES (idf over
 * this set), so "burn" outweighs "company" when every candidate is about
 * the company. Names of the focus entities are scored by `nameMatch`, not
 * as terms, so a subject's own name does not drown the field asked about.
 */
export function createLocalReranker(): RetrievalReranker {
  const weights = LOCAL_RERANKER_WEIGHTS;
  return {
    code: "LOCAL_FIELD_OVERLAP_V1",
    rerank: (request) => {
      const { candidates, focus } = request;
      const nameTerms = new Set<string>();
      for (const name of focus?.names ?? []) {
        for (const term of distinctTerms(name)) nameTerms.add(term);
      }
      // Each term counts as much as the strongest search that used it.
      const queryTerms = new Map<string, number>();
      for (const query of request.queries) {
        const weight = Math.min(1, Math.max(0, query.weight));
        for (const term of distinctTerms(query.text)) {
          if (nameTerms.has(term)) continue;
          queryTerms.set(term, Math.max(queryTerms.get(term) ?? 0, weight));
        }
      }
      const candidateTerms = candidates.map((candidate) =>
        distinctTerms(`${candidate.documentTitle} ${candidate.content}`),
      );
      const n = candidates.length;
      const idf = new Map<string, number>();
      for (const [term, weight] of queryTerms) {
        const df = candidateTerms.filter((terms) => terms.has(term)).length;
        idf.set(term, weight * Math.log(1 + (n + 1) / (df + 1)));
      }
      const totalWeight = [...idf.values()].reduce((a, b) => a + b, 0);
      const subjects = new Set(focus?.subjectIds ?? []);
      const documents = new Set(focus?.documentIds ?? []);
      const scored = candidates.map((candidate, at) => {
        const terms = candidateTerms[at] ?? new Set<string>();
        let matched = 0;
        for (const [term, weight] of idf) {
          if (terms.has(term)) matched += weight;
        }
        const overlap = totalWeight === 0 ? 0 : matched / totalWeight;
        const named = (focus?.names ?? []).some((name) =>
          contains(`${candidate.documentTitle} ${candidate.content}`, name),
        );
        const score =
          weights.termOverlap * overlap +
          (subjects.has(candidate.subjectId) || named
            ? weights.entityMatch
            : 0) +
          (documents.has(candidate.documentId) ? weights.documentMatch : 0) +
          weights.fusedPrior / candidate.fusedRank;
        return { candidate, score };
      });
      const order = (
        a: { candidate: RerankCandidate; score: number },
        b: { candidate: RerankCandidate; score: number },
      ): number => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.candidate.fusedRank !== b.candidate.fusedRank)
          return a.candidate.fusedRank - b.candidate.fusedRank;
        return a.candidate.chunkId < b.candidate.chunkId ? -1 : 1;
      };
      const several =
        new Set([...(focus?.subjectIds ?? []), ...(focus?.names ?? [])]).size >=
        2;
      if (!several) {
        scored.sort(order);
      } else {
        // Greedy: the best remaining after the penalty for its subject.
        const picked = new Map<string, number>();
        const pool = [...scored];
        const out: typeof scored = [];
        while (pool.length > 0) {
          const adjusted = pool.map((entry) => ({
            ...entry,
            score:
              entry.score -
              weights.sameSubjectPenalty *
                (picked.get(entry.candidate.subjectId) ?? 0),
          }));
          adjusted.sort(order);
          const best = adjusted[0];
          if (best === undefined) break;
          out.push(best);
          picked.set(
            best.candidate.subjectId,
            (picked.get(best.candidate.subjectId) ?? 0) + 1,
          );
          pool.splice(
            pool.findIndex((entry) => entry.candidate === best.candidate),
            1,
          );
        }
        scored.splice(0, scored.length, ...out);
      }
      return Promise.resolve(scored.map((entry) => entry.candidate.chunkId));
    },
  };
}

/** The reranker a config names. */
export function rerankerFor(code: RetrievalRerankerCode): RetrievalReranker {
  switch (code) {
    case "NONE":
      return NO_RERANKER;
    case "LOCAL_FIELD_OVERLAP_V1":
      return createLocalReranker();
  }
}
