/**
 * Reciprocal Rank Fusion (CQ-RAG-004 §24, §27-§28; doc 14 §26).
 *
 * A pure function over two already-authorised ranked lists. It has no
 * database, no clock, no randomness and no access to anything it could ask
 * about permission — which is deliberate: fusion must be incapable of
 * admitting a candidate, so the only way a chunk reaches the output is by
 * having been in an input list that was already constrained in SQL.
 *
 *   score(item) = Σ over lists  1 / (k + rank_in_that_list)
 *
 * Rank fusion rather than score fusion because a `ts_rank` and a cosine
 * distance share no units, no range and no distribution; averaging them
 * produces a number that looks meaningful and is not. Ranks are ordinal in
 * both lists, so they are comparable by construction.
 *
 * Ranks are 1-BASED in both inputs and the output. The constant k damps the
 * top of each list, so one confident lexical match cannot outvote a broad
 * semantic consensus; it is not a candidate count and shares nothing with
 * the K values in the retrieval configuration.
 */

export type FusionInput<T> = {
  readonly key: string;
  readonly item: T;
  /** 1-based position in its own list. */
  readonly rank: number;
};

export type FusedItem<T> = {
  readonly key: string;
  readonly item: T;
  readonly lexicalRank: number | null;
  readonly semanticRank: number | null;
  readonly fusedRank: number;
  readonly fusedScore: number;
};

export type FuseOptions = {
  readonly rrfK: number;
  readonly limit: number;
};

/**
 * Fuses a lexical and a semantic list into one ranked list.
 *
 * Where both lists contain the same chunk it appears once, carrying both
 * ranks: the same chunk retrieved twice is one piece of evidence, and
 * showing it twice would inflate a document's apparent support (§28).
 *
 * Ordering is fully deterministic — score descending, then the better of the
 * two ranks, then the key — so the same two lists always fuse to the same
 * output. A retrieval result that reordered itself between runs could not be
 * evaluated, reproduced or audited.
 */
export function fuseByReciprocalRank<T>(
  lexical: readonly FusionInput<T>[],
  semantic: readonly FusionInput<T>[],
  options: FuseOptions,
): readonly FusedItem<T>[] {
  const { rrfK, limit } = options;
  const merged = new Map<
    string,
    {
      item: T;
      lexicalRank: number | null;
      semanticRank: number | null;
      score: number;
    }
  >();

  const absorb = (
    entries: readonly FusionInput<T>[],
    side: "lexical" | "semantic",
  ): void => {
    for (const entry of entries) {
      const contribution = 1 / (rrfK + entry.rank);
      const existing = merged.get(entry.key);
      if (existing === undefined) {
        merged.set(entry.key, {
          item: entry.item,
          lexicalRank: side === "lexical" ? entry.rank : null,
          semanticRank: side === "semantic" ? entry.rank : null,
          score: contribution,
        });
        continue;
      }
      // The item is kept from whichever list saw it first; both carry the
      // same chunk, and the fields that differ between them are the ranks,
      // which are recorded separately rather than overwritten.
      if (side === "lexical") {
        existing.lexicalRank = entry.rank;
      } else {
        existing.semanticRank = entry.rank;
      }
      existing.score += contribution;
    }
  };

  absorb(lexical, "lexical");
  absorb(semantic, "semantic");

  const best = (entry: {
    lexicalRank: number | null;
    semanticRank: number | null;
  }): number =>
    Math.min(
      entry.lexicalRank ?? Number.MAX_SAFE_INTEGER,
      entry.semanticRank ?? Number.MAX_SAFE_INTEGER,
    );

  return [...merged.entries()]
    .sort(([keyA, a], [keyB, b]) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const rankDelta = best(a) - best(b);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    })
    .slice(0, limit)
    .map(([key, entry], at): FusedItem<T> => {
      return {
        key,
        item: entry.item,
        lexicalRank: entry.lexicalRank,
        semanticRank: entry.semanticRank,
        fusedRank: at + 1,
        fusedScore: entry.score,
      };
    });
}
