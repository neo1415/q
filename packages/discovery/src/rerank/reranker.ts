import { RANKER_VERSION } from "../ranking/contracts.js";
import {
  RERANK_REASON_CODES,
  RerankInputError,
  RERANKER_ID,
  RERANKER_VERSION,
  type RerankDiagnostics,
  type RerankedCandidate,
  type RerankFacts,
  type RerankReasonCode,
} from "./contracts.js";
import { EXPLORATION_POLICY_V1, type RerankPolicy } from "./policy.js";

/**
 * The bounded deterministic reranker (CQ-REC-009).
 *
 *   REC-005 order in → one permutation of it out.
 *
 * It adds nothing and removes nothing. Every candidate it is given was
 * already declared ELIGIBLE by REC-001 and ordered by REC-005, and every
 * one of them comes back: exploration cannot introduce a company, because
 * there is nowhere for a company to come from, and suppression cannot drop
 * one, because the output is a permutation by construction. That is the
 * cheapest possible guarantee for doc 19's rule that safety outranks
 * diversity, and it is why this stage is a reordering rather than a
 * selection.
 *
 * It reads no database, calls no model, draws no random number and reads
 * no clock: the instant to compare recency against arrives as an argument.
 * Same candidates, same facts, same policy, same instant, same order —
 * every time, with nothing to persist in order to reproduce it (doc 19
 * §190 asks for a seed only where randomness exists, and none does).
 */

export type BaseRankedCandidate = {
  readonly companyId: string;
  /** REC-005's 1-based rank. */
  readonly rank: number;
  readonly internalScore: number | null;
};

export type RerankInput = {
  readonly context: string;
  /** The ranker that produced the base order; a bump must be reviewed here. */
  readonly rankerVersion: string;
  /** The instant recency is measured against. Supplied, never read. */
  readonly evaluatedAt: string;
  /** REC-005's output, in its order. */
  readonly candidates: readonly BaseRankedCandidate[];
  readonly facts: ReadonlyMap<string, RerankFacts>;
};

export type RerankResult = {
  readonly rerankerId: typeof RERANKER_ID;
  readonly rerankerVersion: typeof RERANKER_VERSION;
  readonly rerankPolicyVersion: string;
  readonly candidates: readonly RerankedCandidate[];
  readonly diagnostics: RerankDiagnostics;
};

export type Reranker = {
  readonly id: typeof RERANKER_ID;
  readonly version: typeof RERANKER_VERSION;
  readonly policyVersion: string;
  readonly rerank: (input: RerankInput) => RerankResult;
};

type Working = {
  readonly candidate: BaseRankedCandidate;
  readonly facts: RerankFacts;
  readonly codes: Set<RerankReasonCode>;
};

/** Reported in one fixed order so two equal results are byte-identical. */
function orderedCodes(
  codes: ReadonlySet<RerankReasonCode>,
): RerankReasonCode[] {
  return RERANK_REASON_CODES.filter((code) => codes.has(code));
}

export function createReranker(dependencies?: {
  readonly policy?: RerankPolicy | undefined;
}): Reranker {
  const policy = dependencies?.policy ?? EXPLORATION_POLICY_V1;

  /**
   * The relevance floor (§7; doc 19 §82). `ahead` is the candidate that
   * would otherwise take this position; `mover` may only pass it when
   * REC-005 scored them this close. An unscored candidate can never pass a
   * scored one, because "no scoreable feature" is not evidence of fit.
   */
  const withinFloor = (
    ahead: BaseRankedCandidate,
    mover: BaseRankedCandidate,
  ): boolean => {
    if (ahead.internalScore === null) return true;
    if (mover.internalScore === null) return false;
    return ahead.internalScore - mover.internalScore <= policy.maxScoreDistance;
  };

  return {
    id: RERANKER_ID,
    version: RERANKER_VERSION,
    policyVersion: policy.version,
    rerank: (input) => {
      const started = performance.now();
      if (input.context !== policy.context) {
        throw new RerankInputError(
          "CONTEXT_MISMATCH",
          null,
          `policy ${policy.version} reorders ${policy.context}`,
        );
      }
      if (input.rankerVersion !== RANKER_VERSION) {
        throw new RerankInputError(
          "RANKER_VERSION_MISMATCH",
          null,
          `policy ${policy.version} was written for ${RANKER_VERSION}`,
        );
      }
      const evaluatedAt = Date.parse(input.evaluatedAt);
      if (Number.isNaN(evaluatedAt)) {
        throw new RerankInputError(
          "BASE_ORDER_INVALID",
          null,
          "evaluatedAt is not a timestamp",
        );
      }

      const seen = new Set<string>();
      const working: Working[] = input.candidates.map((candidate, index) => {
        if (seen.has(candidate.companyId)) {
          throw new RerankInputError(
            "DUPLICATE_COMPANY",
            candidate.companyId,
            "one company cannot hold two positions",
          );
        }
        seen.add(candidate.companyId);
        if (candidate.rank !== index + 1) {
          throw new RerankInputError(
            "BASE_ORDER_INVALID",
            candidate.companyId,
            "the base order must arrive as ranks 1..n, ascending",
          );
        }
        const facts = input.facts.get(candidate.companyId);
        if (facts === undefined) {
          // Fail closed: guessing at a company's state is how a passed
          // company quietly comes back.
          throw new RerankInputError(
            "FACTS_MISSING",
            candidate.companyId,
            "every candidate needs its interaction facts",
          );
        }
        if (
          facts.reintroduction !== null &&
          !policy.passSuppression.reintroductionReasons.includes(
            facts.reintroduction,
          )
        ) {
          throw new RerankInputError(
            "REINTRODUCTION_NOT_ALLOWED",
            candidate.companyId,
            "that is not a reason this policy accepts",
          );
        }
        return { candidate, facts, codes: new Set<RerankReasonCode>() };
      });

      // Phase 1 -- suppression (§12). A passed company goes behind
      // everything the investor has not dismissed, in its own order. It is
      // not dropped and not banned: the slate stays a complete permutation
      // of the eligible pool, and a proven reintroduction reason puts one
      // straight back among the rest.
      const active: Working[] = [];
      const suppressed: Working[] = [];
      for (const item of working) {
        if (!item.facts.passed) {
          active.push(item);
          continue;
        }
        if (item.facts.reintroduction !== null) {
          item.codes.add("PASS_REINTRODUCED");
          active.push(item);
          continue;
        }
        item.codes.add("PASS_SUPPRESSION");
        suppressed.push(item);
      }

      // Phase 2 -- bounded reordering of the unsuppressed candidates.
      const recentlySeen = (item: Working): boolean =>
        item.facts.lastSeenAt !== null &&
        evaluatedAt - Date.parse(item.facts.lastSeenAt) <=
          policy.recentlySeenWindowMs;

      const remaining = [...active];
      const chosen: Working[] = [];
      let explorationSlots = 0;
      let diversityAdjustments = 0;
      let recentlySeenAdjustments = 0;

      while (remaining.length > 0) {
        const position = chosen.length + 1;
        const head = remaining[0] as Working;

        // Only the last `window - 1` positions can make a page feel
        // concentrated, so only they are counted.
        const clusterCounts = new Map<string, number>();
        for (const item of chosen.slice(-(policy.window - 1))) {
          const cluster = item.facts.cluster;
          if (cluster === null) continue;
          clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
        }
        // An unknown cluster is never capped: absence of a classification
        // is not evidence of sameness, and treating it as one would
        // penalise exactly the companies nobody has classified yet.
        const clusterHasRoom = (item: Working): boolean =>
          item.facts.cluster === null ||
          (clusterCounts.get(item.facts.cluster) ?? 0) <
            policy.maxSameClusterInWindow;

        const movable = (index: number): boolean => {
          const item = remaining[index] as Working;
          return (
            withinFloor(head.candidate, item.candidate) &&
            item.candidate.rank - position <= policy.maxPromotion
          );
        };
        const firstMovable = (
          predicate: (item: Working) => boolean,
        ): number => {
          for (let index = 1; index < remaining.length; index += 1) {
            if (movable(index) && predicate(remaining[index] as Working)) {
              return index;
            }
          }
          return -1;
        };

        let pickedIndex = -1;
        const reasons = new Set<RerankReasonCode>();

        // The exploration position (§8; doc 19 §80). One per window, and
        // only ever filled by a candidate already close enough in score to
        // take the position on merit. Never shown is not the same as good:
        // this buys exposure, not rank.
        if (
          position % policy.window === 0 &&
          policy.exploration.mode === "UNEXPOSED_SLOT" &&
          head.facts.exposed
        ) {
          // The cap is a reason to refuse the explorer only when the
          // incumbent satisfies it; a page that is already concentrated is
          // not made worse by giving one seat to something unseen.
          const headHasRoom = clusterHasRoom(head);
          const index = firstMovable(
            (item) =>
              !item.facts.exposed && (clusterHasRoom(item) || !headHasRoom),
          );
          if (index > 0) {
            pickedIndex = index;
            reasons.add("EXPLORATION_SLOT");
            explorationSlots += 1;
          }
        }

        if (pickedIndex < 0) {
          const headCrowded = !clusterHasRoom(head);
          const headJustSeen = recentlySeen(head);
          if (headCrowded || headJustSeen) {
            // Prefer a candidate that fixes both; settle for one that
            // fixes the concentration, which is the one an investor
            // actually experiences.
            let index = firstMovable(
              (item) => clusterHasRoom(item) && !recentlySeen(item),
            );
            if (index < 0 && headCrowded) {
              index = firstMovable((item) => clusterHasRoom(item));
            }
            if (index > 0) {
              pickedIndex = index;
              const picked = remaining[index] as Working;
              if (headCrowded) {
                reasons.add("DIVERSITY_ADJUSTMENT");
                diversityAdjustments += 1;
              }
              if (headJustSeen && !recentlySeen(picked)) {
                reasons.add("RECENTLY_SEEN_SUPPRESSION");
                recentlySeenAdjustments += 1;
              }
            }
          }
        }

        // Nothing admissible within the floor: relevance wins, every time
        // (doc 19 §82). Diversity is never worth a worse recommendation.
        if (pickedIndex < 0) pickedIndex = 0;

        const [picked] = remaining.splice(pickedIndex, 1);
        if (picked === undefined) break;
        if (pickedIndex > 0) {
          // The promoted candidate and the ones it stepped past: each of
          // them is where it is because of this decision, and each says so.
          for (const reason of reasons) picked.codes.add(reason);
          for (let i = 0; i < pickedIndex; i += 1) {
            const displaced = remaining[i] as Working;
            for (const reason of reasons) displaced.codes.add(reason);
          }
        }
        chosen.push(picked);
      }

      const finalOrder = [...chosen, ...suppressed];
      const candidates: RerankedCandidate[] = finalOrder.map((item, index) => ({
        companyId: item.candidate.companyId,
        baseRank: item.candidate.rank,
        rank: index + 1,
        internalScore: item.candidate.internalScore,
        movement: item.candidate.rank - (index + 1),
        rerankReasonCodes: orderedCodes(item.codes),
      }));

      const moved = candidates.filter((c) => c.movement !== 0).length;
      const maxPromotion = candidates.reduce(
        (most, c) => Math.max(most, c.movement),
        0,
      );
      const diagnostics: RerankDiagnostics = {
        candidates: candidates.length,
        moved,
        suppressed: suppressed.length,
        reintroduced: active.filter((i) => i.facts.reintroduction !== null)
          .length,
        explorationSlots,
        diversityAdjustments,
        recentlySeenAdjustments,
        maxPromotion,
        durationMs: Math.round((performance.now() - started) * 1000) / 1000,
      };

      return {
        rerankerId: RERANKER_ID,
        rerankerVersion: RERANKER_VERSION,
        rerankPolicyVersion: policy.version,
        candidates,
        diagnostics,
      };
    },
  };
}
