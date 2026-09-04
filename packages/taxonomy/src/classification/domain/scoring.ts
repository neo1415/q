import type { TaxonomyClassificationPolicy } from "./policy.js";

/**
 * The lexical scoring formula of taxonomy-lexical-v1, in one place.
 *
 *   coverage = credited candidate tokens / candidate tokens
 *              (exact token = 1; prefix of length >= minPrefixLength either
 *               way = prefixTokenCredit)
 *   blend    = tokenWeight * coverage + similarityWeight * wordSimilarity
 *   score    = fieldWeight * max(blend, wordSimilarity)
 *
 * wordSimilarity is pg_trgm word_similarity(candidate, query): how well the
 * candidate label appears anywhere in the query, typo-tolerant. Taking the
 * max lets a misspelt label ("paymnt infrastucture") stand on similarity
 * alone while token overlap still lifts well-spelt matches. Similarity is
 * ignored for candidate texts shorter than similarityMinCandidateLength:
 * two- and three-letter codes collide with anything. The result is a
 * deterministic relevance indicator in [0, 1]. It is not a probability and
 * is never presented as one.
 */
export type LexicalScoreInput = {
  readonly queryTokens: readonly string[];
  readonly candidateTokens: readonly string[];
  /** The normalised candidate text (for the similarity length rule). */
  readonly candidateText: string;
  readonly wordSimilarity: number;
  readonly field: "canonical_code" | "display_name" | "alias";
};

export type LexicalScore = {
  readonly score: number;
  readonly matchedTokens: number;
  readonly candidateTokens: number;
};

export function tokenCoverage(
  queryTokens: readonly string[],
  candidateTokens: readonly string[],
  policy: TaxonomyClassificationPolicy,
): { readonly coverage: number; readonly matched: number } {
  if (candidateTokens.length === 0) {
    return { coverage: 0, matched: 0 };
  }
  let credit = 0;
  let matched = 0;
  for (const candidate of candidateTokens) {
    let best = 0;
    for (const query of queryTokens) {
      if (query === candidate) {
        best = 1;
        break;
      }
      const shorter = query.length <= candidate.length ? query : candidate;
      const longer = shorter === query ? candidate : query;
      if (
        shorter.length >= policy.lexical.minPrefixLength &&
        longer.startsWith(shorter)
      ) {
        best = Math.max(best, policy.lexical.prefixTokenCredit);
      }
    }
    if (best > 0) {
      matched += 1;
    }
    credit += best;
  }
  return { coverage: credit / candidateTokens.length, matched };
}

export function lexicalScore(
  input: LexicalScoreInput,
  policy: TaxonomyClassificationPolicy,
): LexicalScore {
  const { coverage, matched } = tokenCoverage(
    input.queryTokens,
    input.candidateTokens,
    policy,
  );
  const similarity =
    input.candidateText.length >= policy.lexical.similarityMinCandidateLength
      ? clamp01(input.wordSimilarity)
      : 0;
  const fieldWeight =
    input.field === "alias" ? policy.lexical.aliasFieldWeight : 1;
  const blend =
    policy.lexical.tokenWeight * coverage +
    policy.lexical.similarityWeight * similarity;
  const score = fieldWeight * Math.max(blend, similarity);
  return {
    score: round4(clamp01(score)),
    matchedTokens: matched,
    candidateTokens: input.candidateTokens.length,
  };
}

/** Lexical confidence: the score scaled under the ceiling, four exact places. */
export function lexicalConfidence(
  score: number,
  policy: TaxonomyClassificationPolicy,
): string {
  return formatConfidence(clamp01(score) * policy.lexical.confidenceCeiling);
}

export function formatConfidence(value: number): string {
  return clamp01(value).toFixed(4);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
