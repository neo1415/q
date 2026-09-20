import { z } from "zod";

import { PassReintroductionReasonSchema } from "./policy.js";

/**
 * Bounded slate reranking (doc 19 §49, §80–§82; CQ-REC-009).
 *
 *   base rank ≠ final position
 *   reordering ≠ scoring
 *   exposure ≠ popularity
 *   observed behaviour ≠ declared mandate
 *
 * REC-005 answers "how well does this company fit this mandate" and REC-009
 * answers "in what order should one page of those be shown". The second
 * never edits the first: a reranked candidate carries REC-005's rank and
 * REC-005's score unchanged, next to the position it ended up in, so the
 * two are always separable after the fact.
 */

/** Doc 19 §108's shape, for the rerank stage: identity, separate from policy. */
export const RERANKER_ID = "BOUNDED_DETERMINISTIC" as const;
/** Bumped when the reordering algorithm (not its policy) changes. */
export const RERANKER_VERSION = "bounded-reranker.v1" as const;

/**
 * Why an item is not where REC-005 put it.
 *
 * Factual and bounded. Nothing here is prose and nothing here is shown to
 * anyone: REC-007 owns what an investor reads, and these are the inputs it
 * may one day be given, not sentences.
 */
export const RERANK_REASON_CODES = [
  /** Moved up because the page already held enough of the other's cluster. */
  "DIVERSITY_ADJUSTMENT",
  /** Moved because this organisation was shown the other one very recently. */
  "RECENTLY_SEEN_SUPPRESSION",
  /** Behind everything unsuppressed: this organisation passed on it. */
  "PASS_SUPPRESSION",
  /** Passed, but offered again under a proven reason. */
  "PASS_REINTRODUCED",
  /** Took the window's exploration position: eligible, in range, never shown. */
  "EXPLORATION_SLOT",
] as const;
export const RerankReasonCodeSchema = z.enum(RERANK_REASON_CODES);
export type RerankReasonCode = (typeof RERANK_REASON_CODES)[number];

/**
 * What REC-009 is allowed to know about a candidate, and nothing else.
 *
 * Note what is absent: no watch seconds, no view total, no save count, no
 * Ask-Q count, no score of any kind. Exposure is a boolean-ish recency
 * fact, not a magnitude, because a magnitude is how "shown often" quietly
 * becomes "good" (§10, §14; doc 19 §83).
 */
export const RerankFactsSchema = z
  .object({
    companyId: z.string().uuid(),
    /**
     * Which of the investor's own declared taxonomy preferences this
     * company matched, as one comparable key. Null when the structured
     * generator did not find it — unknown is unknown, and an unknown
     * cluster is never capped, never penalised and never counted against
     * another candidate.
     */
    cluster: z.string().min(1).max(512).nullable(),
    /** This organisation has been shown it at least once. */
    exposed: z.boolean(),
    /** When it was last shown, if ever. Compared to one instant, never accumulated. */
    lastSeenAt: z.string().datetime({ offset: true }).nullable(),
    /** This organisation passed on it. */
    passed: z.boolean(),
    /**
     * A proven reason to offer a passed company again. The reranker
     * accepts one; it never derives one, because the evidence for every
     * member of that union lives outside this stage.
     */
    reintroduction: PassReintroductionReasonSchema.nullable(),
  })
  .strict();
export type RerankFacts = z.infer<typeof RerankFactsSchema>;

/**
 * One candidate as REC-005 left it, with the position REC-009 gave it.
 *
 * `baseRank` and `internalScore` are REC-005's, carried verbatim. A
 * consumer that wants the ranking answer reads those; a consumer that
 * wants the slate reads `rank`.
 */
export const RerankedCandidateSchema = z
  .object({
    companyId: z.string().uuid(),
    /** REC-005's 1-based position. Never recomputed here. */
    baseRank: z.number().int().min(1),
    /** The final 1-based slate position. */
    rank: z.number().int().min(1),
    /** REC-005's score, untouched; null when it could not score the candidate. */
    internalScore: z.number().finite().min(0).max(1).nullable(),
    /** baseRank − rank. Positive means promoted; zero means REC-005's order stood. */
    movement: z.number().int(),
    /** Distinct, in RERANK_REASON_CODES order; empty when the item did not move. */
    rerankReasonCodes: z.array(RerankReasonCodeSchema).max(8),
  })
  .strict();
export type RerankedCandidate = z.infer<typeof RerankedCandidateSchema>;

/** Safe counts only: never a company, a cluster or a mandate value. */
export const RerankDiagnosticsSchema = z
  .object({
    candidates: z.number().int().min(0),
    moved: z.number().int().min(0),
    suppressed: z.number().int().min(0),
    reintroduced: z.number().int().min(0),
    explorationSlots: z.number().int().min(0),
    diversityAdjustments: z.number().int().min(0),
    recentlySeenAdjustments: z.number().int().min(0),
    /** The largest promotion this run made, for comparison with the policy bound. */
    maxPromotion: z.number().int().min(0),
    durationMs: z.number().finite().min(0),
  })
  .strict();
export type RerankDiagnostics = z.infer<typeof RerankDiagnosticsSchema>;

/** Why a rerank input was refused. Fail closed; nothing is partially reordered. */
export const RERANK_INPUT_ERRORS = [
  "CONTEXT_MISMATCH",
  "RANKER_VERSION_MISMATCH",
  "DUPLICATE_COMPANY",
  "FACTS_MISSING",
  "BASE_ORDER_INVALID",
  "REINTRODUCTION_NOT_ALLOWED",
] as const;
export type RerankInputErrorCode = (typeof RERANK_INPUT_ERRORS)[number];

export class RerankInputError extends Error {
  readonly code: RerankInputErrorCode;
  readonly companyId: string | null;
  constructor(
    code: RerankInputErrorCode,
    companyId: string | null,
    detail: string,
  ) {
    // Codes, ids and versions only: never a cluster, a score or a mandate field.
    super(`${code}${companyId === null ? "" : ` (${companyId})`}: ${detail}`);
    this.name = "RerankInputError";
    this.code = code;
    this.companyId = companyId;
  }
}
