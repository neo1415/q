import type { TaxonomyMatchType } from "@capital-q/contracts";

import { TAXONOMY_CLASSIFIER_VERSION } from "../contracts/index.js";

/**
 * The one versioned classification policy: every threshold, weight and
 * tier the deterministic classifier uses. Handlers never carry their own
 * confidence comparisons. Changing any value is a new classifier version
 * and must re-run the taxonomy eval.
 *
 * Confidence semantics -- deterministic indicators, NOT calibrated
 * probabilities: "1.0000" means the identifier matched exactly; it says
 * nothing about whether the company truly belongs to the category.
 */
export type TaxonomyClassificationPolicy = {
  readonly version: string;
  readonly exactConfidence: Readonly<
    Record<Exclude<TaxonomyMatchType, "LEXICAL">, string>
  >;
  readonly lexical: {
    /** Weight of token coverage in the lexical score. */
    readonly tokenWeight: number;
    /** Weight of pg_trgm word similarity in the lexical score. */
    readonly similarityWeight: number;
    /** Aliases count slightly less than the canonical label / code. */
    readonly aliasFieldWeight: number;
    /** Credit for a prefix token match (e.g. "apis" ~ "api"). */
    readonly prefixTokenCredit: number;
    readonly minPrefixLength: number;
    readonly minTokenLength: number;
    /** Retrieval floor for pg_trgm word similarity (SQL predicate). */
    readonly retrievalSimilarityFloor: number;
    /**
     * Trigram similarity is only meaningful against candidate texts at least
     * this long; abbreviations and ISO codes ("ai", "ng", "saas") match by
     * exact token only, otherwise nonsense input collides with them.
     */
    readonly similarityMinCandidateLength: number;
    /** Below this score a lexical hit is not offered (LOW_CONFIDENCE). */
    readonly candidateMinimumScore: number;
    /** Two same-vocabulary hits at/above this and within the margin are AMBIGUOUS. */
    readonly strongScore: number;
    readonly ambiguityMargin: number;
    /** Lexical confidence never reaches the exact tiers. */
    readonly confidenceCeiling: number;
    readonly retrievalRowLimit: number;
  };
  /** Bounded English function words ignored for token overlap only. */
  readonly stopWords: readonly string[];
};

export const TAXONOMY_CLASSIFICATION_POLICY_V1: TaxonomyClassificationPolicy = {
  version: TAXONOMY_CLASSIFIER_VERSION,
  exactConfidence: {
    CANONICAL_CODE_EXACT: "1.0000",
    ALIAS_EXACT: "0.9500",
    DISPLAY_NAME_EXACT: "0.9500",
  },
  lexical: {
    tokenWeight: 0.55,
    similarityWeight: 0.45,
    aliasFieldWeight: 0.95,
    prefixTokenCredit: 0.75,
    minPrefixLength: 3,
    minTokenLength: 2,
    retrievalSimilarityFloor: 0.3,
    similarityMinCandidateLength: 6,
    candidateMinimumScore: 0.35,
    strongScore: 0.6,
    ambiguityMargin: 0.02,
    confidenceCeiling: 0.85,
    retrievalRowLimit: 200,
  },
  stopWords: [
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "their",
    "these",
    "this",
    "to",
    "we",
    "with",
    "you",
    "your",
  ],
};
