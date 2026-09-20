import { z } from "zod";

import { RecommendationModeSchema } from "../eligibility/contracts.js";

/**
 * Bounded diversity and exploration policy (doc 19 §35, §54, §80–§82,
 * §185, §190; CQ-REC-009).
 *
 * Every number REC-009 applies lives here, in one frozen, versioned
 * object, for the same reason `ranking-config.v1` exists: a persisted
 * slate records the policy it was built under, and a published version is
 * never edited. The reranker itself holds no constant of its own.
 *
 * This is a *reordering* policy, not a scoring one. It never computes a
 * score, never touches REC-005's, and can only permute a list REC-001
 * already declared eligible and REC-005 already ordered. Doc 19 §82 is the
 * rule it is written around: diversity operates within credible
 * candidates and never trades away relevance to fill a quota.
 */

export const RERANK_POLICY_STATUSES = [
  /** Hand-set, not fitted to outcomes. The only status V1 has. */
  "INITIAL_HEURISTIC_UNCALIBRATED",
  /** Reserved for a policy fitted against observed outcomes (doc 19 Phase 2). */
  "CALIBRATED",
] as const;

/**
 * Why a passed company may be offered again (§12).
 *
 * Passing something is a decision, and proactively showing it again
 * without a reason would make the decision meaningless. Each member of
 * this union names evidence the product could hold; none of it is
 * inferred. In particular a changed `updated_at` is NOT a material
 * update — a typo fix would resurface everything an investor had
 * dismissed.
 */
export const PASS_REINTRODUCTION_REASONS = [
  /** The investor asked for it back. No surface issues one yet. */
  "EXPLICIT_PASS_RESET",
  /** The mandate the pass was made under is no longer the mandate. */
  "MANDATE_VERSION_CHANGED",
  /** A material, evidenced change to the company, never a row timestamp. */
  "MATERIAL_COMPANY_UPDATE",
] as const;
export const PassReintroductionReasonSchema = z.enum(
  PASS_REINTRODUCTION_REASONS,
);
export type PassReintroductionReason =
  (typeof PASS_REINTRODUCTION_REASONS)[number];

/**
 * Which of those reasons V1 can actually prove, and therefore act on.
 *
 * Empty, deliberately. `interaction_state` records that a pass happened
 * and when, not the mandate version it was made under, and no surface
 * issues a reset. Rather than guess, REC-009 keeps a passed company
 * suppressed and leaves the mechanism ready: a later packet supplies the
 * evidence, not the concept.
 */
export const PROVABLE_PASS_REINTRODUCTION_REASONS: readonly PassReintroductionReason[] =
  [];

export const RerankPolicySchema = z
  .object({
    version: z.string().regex(/^exploration-policy\.[a-z0-9-]+$/),
    status: z.enum(RERANK_POLICY_STATUSES),
    /** The only context this policy reorders. */
    context: RecommendationModeSchema,
    /**
     * How many consecutive positions the diversity rule looks at. Set to
     * the slate page size: concentration is something a person experiences
     * on a page, not a property of a 200-row list they never reach the end
     * of.
     */
    window: z.number().int().min(2).max(50),
    /**
     * How many companies in one window may share a cluster. Three of ten
     * leaves an investor with a clear read on a cluster without the page
     * becoming that cluster.
     */
    maxSameClusterInWindow: z.number().int().min(1).max(50),
    /**
     * The relevance floor (§7; doc 19 §82). A candidate may only be moved
     * ahead of another when REC-005 scored the two within this distance.
     * Nothing below the floor moves for any reason, so a weak-but-different
     * company can never displace a strongly relevant one.
     */
    maxScoreDistance: z.number().finite().min(0).max(1),
    /** A hard cap on rank distance, so movement is a stated bound and not an emergent one. */
    maxPromotion: z.number().int().min(0).max(100),
    /**
     * How recently an impression makes a company "just seen". A day covers
     * a session and the return to it; it is not a ban, and nothing here
     * grows with how often something was seen.
     */
    recentlySeenWindowMs: z.number().int().min(0),
    exploration: z
      .object({
        /**
         * The last position of each window is offered to the best
         * candidate this organisation has never been shown. Doc 19 §80:
         * without it, no exposure means no engagement means no exposure.
         * It is not randomness (§35) and not a boost — an unexposed
         * company is not better, it is unseen.
         */
        mode: z.literal("UNEXPOSED_SLOT"),
        /** At most this many positions per window. One in ten. */
        maxSlotsPerWindow: z.literal(1),
        /** Deterministic: no seed, no probability, nothing to reproduce. */
        deterministic: z.literal(true),
      })
      .strict(),
    passSuppression: z
      .object({
        /** Moved behind every unsuppressed candidate; never dropped, never banned. */
        mode: z.literal("DEMOTE_TO_TAIL"),
        reintroductionReasons: z.array(PassReintroductionReasonSchema).max(8),
      })
      .strict(),
    description: z.string().min(1).max(800),
  })
  .strict();
export type RerankPolicy = z.infer<typeof RerankPolicySchema>;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

export const EXPLORATION_POLICY_V1: RerankPolicy = deepFreeze(
  RerankPolicySchema.parse({
    version: "exploration-policy.v1",
    status: "INITIAL_HEURISTIC_UNCALIBRATED",
    context: "INVESTOR_DISCOVER",
    window: 10,
    maxSameClusterInWindow: 3,
    maxScoreDistance: 0.15,
    maxPromotion: 20,
    recentlySeenWindowMs: 24 * 60 * 60 * 1000,
    exploration: {
      mode: "UNEXPOSED_SLOT",
      maxSlotsPerWindow: 1,
      deterministic: true,
    },
    passSuppression: {
      mode: "DEMOTE_TO_TAIL",
      reintroductionReasons: [...PASS_REINTRODUCTION_REASONS],
    },
    description:
      "Initial heuristic reordering of one eligible, ranked pool: at most three of a " +
      "cluster per page, one page position offered to a company this organisation has " +
      "never been shown, passed companies behind everything else, and nothing moved " +
      "past a candidate REC-005 scored more than 0.15 higher. Uncalibrated: no outcome " +
      "data fixes these numbers, and doc 19 §53 leaves them open until it exists.",
  }),
);
