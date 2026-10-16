import {
  fitScoreOutOf10,
  suitabilityFromFit,
  type SuitabilityDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityReasonCode } from "../eligibility/contracts.js";
import { RANKING_CONFIG_CURRENT } from "../ranking/config.js";

import { FIT_CONFIG_CURRENT, type FitConfig } from "./config.js";
import {
  assessFit,
  compareAssessmentMerit,
  type FitAssessment,
} from "./model.js";
import { observeFit } from "./observe.js";
import type { FitInputSource } from "./service.js";

/**
 * Fit order (Q.06, 2026-10-07): the Discover feed is ordered by the same
 * fit an investor reads as "x/10", so the two can never contradict.
 *
 * Before this, the slate was ordered by `ranking-config.v3` (stage,
 * geography, sector, thesis; equal weights) while the fit panel scored
 * `ranking-config.v4`'s nine parameters, so a 6/10 company could sit
 * above an 8/10 one. Cheque size, declared on the mandate, now counts in
 * the order exactly as it counts in the fit (Q.02).
 *
 * `fit-order.v1` is a frozen, versioned policy the slate records as its
 * ranking version:
 *
 *   1. the v3 ranker still produces the base order and its reason codes;
 *   2. every candidate is assessed by the fit model under `fitConfig`
 *      from the same snapshot and declared facts the fit panel reads;
 *   3. positions held by candidates WITH a score out of 10 are refilled
 *      by score (desc), then the fit config's own tie-break, then the base
 *      rank. Candidates WITHOUT a score (too little known) keep their base
 *      positions: unknown is never read as low, so it is neither buried
 *      nor promoted, and it shows no number to contradict;
 *   4. REC-009 exploration/diversity then reorders within its bounded
 *      policy; an item it moves carries a rerank reason code and the feed
 *      labels it "exploring".
 *
 * Deterministic and model-free: no clock beyond the `now` passed in, no
 * I/O but the injected input source, no LLM.
 */

export const FIT_ORDER_V1 = Object.freeze({
  version: "fit-order.v1",
  /** The fit model and score the order agrees with. */
  fitConfigVersion: FIT_CONFIG_CURRENT.version,
  /** The base order unscored candidates keep. */
  baseRankingConfigVersion: RANKING_CONFIG_CURRENT.version,
  description:
    "Discover order agrees with the fit shown out of 10: scored candidates ordered by score, then the fit tie-break, then the base rank; unscored candidates keep their base positions; exploration and diversity moves are labelled.",
} as const);
/**
 * `fit-order.v2` (owner 2026-10-16): the same policy as v1, with
 * Investability (FDN InvestIQ, investor-eligible evidence only) as a
 * weighted component AFTER explicit fit:
 *
 *   order value = (w_s × Suitability + w_i × Investability) / (w_s + w_i)
 *
 * on a 0-100 scale, where Suitability is the fit out of 10 × 10 (exactly
 * the number the reader sees). Rules kept from v1, unchanged:
 *   - hard eligibility first (only admitted candidates are ordered);
 *   - a candidate with no fit score keeps its base position: Investability
 *     never promotes or buries a company the fit cannot score;
 *   - Investability unknown (not assessed, or insufficient evidence) is
 *     simply absent: the order value is the fit alone, never a low number;
 *   - exploration and diversity reorder afterwards and are labelled.
 * The two scores are shown separately and never as this blend; the blend
 * is an ordering key only. No pay-to-rank, no engagement signal, no model.
 */
export const FIT_ORDER_V2 = Object.freeze({
  version: "fit-order.v2",
  fitConfigVersion: FIT_CONFIG_CURRENT.version,
  baseRankingConfigVersion: RANKING_CONFIG_CURRENT.version,
  weights: Object.freeze({ suitability: 0.75, investability: 0.25 }),
  description:
    "Discover order: candidates the fit can score are ordered by 0.75 × Suitability (fit out of 10 × 10) + 0.25 × Investability (InvestIQ, when scored), then the fit tie-break, then the base rank; unscored candidates keep their base positions; unknown Investability is left out, never read as low; exploration and diversity moves are labelled.",
} as const);
export const FIT_ORDER_CURRENT = FIT_ORDER_V2;

export type FitOrderWeights = {
  readonly suitability: number;
  readonly investability: number;
};

/**
 * The ordering value under fit-order.v2: null when the fit shows no score.
 * Investability enters only when it is a scored number.
 */
export function discoverOrderValue(
  fitScoreOutOf10: number | null,
  investability: number | null,
  weights: FitOrderWeights = FIT_ORDER_V2.weights,
): number | null {
  if (fitScoreOutOf10 === null) return null;
  const suitability = fitScoreOutOf10 * 10;
  if (investability === null) return suitability;
  return (
    (weights.suitability * suitability +
      weights.investability * investability) /
    (weights.suitability + weights.investability)
  );
}

export type FitOrderEntry = {
  readonly companyId: string;
  /** The ranker's 1-based base rank. */
  readonly baseRank: number;
};

export type FitOrderKey = {
  readonly assessment: FitAssessment | null;
  /** The number the reader sees out of 10, or null when none is shown. */
  readonly score: number | null;
  /**
   * fit-order.v2: the 0-100 ordering value (discoverOrderValue). Absent:
   * the fit score alone orders (Q's side-by-side top N).
   */
  readonly orderValue?: number | null | undefined;
};

export type FitOrderedCandidate = {
  readonly companyId: string;
  readonly rank: number;
  /** score / 10 in [0, 1]; null when no score is shown. Internal only. */
  readonly internalScore: number | null;
  readonly score: number | null;
};

/** The score a reader sees for this assessment, as a number. */
export function fitOrderScore(assessment: FitAssessment | null): number | null {
  if (assessment === null) return null;
  const shown = fitScoreOutOf10(assessment.profile);
  return shown === null ? null : Number(shown);
}

/**
 * The one comparator for "better fit first": score shown, then the fit
 * config's tie-break on merit (value, confidence). Equal fits compare 0 so
 * the slate's next key, the base rank, decides them (step 3); callers
 * that need a total order without a base rank add their own fallback.
 * Used by the slate order and Q's side-by-side top N.
 */
export function compareFitOrder(a: FitOrderKey, b: FitOrderKey): number {
  const valueOf = (k: FitOrderKey) =>
    k.orderValue ?? (k.score === null ? -1 : k.score * 10);
  const sa = valueOf(a);
  const sb = valueOf(b);
  if (sa !== sb) return sb - sa;
  if (a.assessment !== null && b.assessment !== null) {
    return compareAssessmentMerit(a.assessment, b.assessment);
  }
  return (a.assessment === null ? 1 : 0) - (b.assessment === null ? 1 : 0);
}

/** Pure: the fit order of a base-ranked list (see step 3 above). */
export function orderByFit(
  base: readonly FitOrderEntry[],
  keys: ReadonlyMap<string, FitOrderKey>,
): readonly FitOrderedCandidate[] {
  const ordered = [...base].sort((a, b) => a.baseRank - b.baseRank);
  const keyOf = (companyId: string): FitOrderKey =>
    keys.get(companyId) ?? { assessment: null, score: null };
  const scored = ordered
    .filter((entry) => keyOf(entry.companyId).score !== null)
    .sort(
      (a, b) =>
        compareFitOrder(keyOf(a.companyId), keyOf(b.companyId)) ||
        a.baseRank - b.baseRank,
    );
  let next = 0;
  return ordered.map((entry, index) => {
    const placed =
      keyOf(entry.companyId).score === null ? entry : scored[next++];
    if (placed === undefined) {
      throw new Error("fit order lost a candidate");
    }
    const key = keyOf(placed.companyId);
    const score = key.score;
    const value = key.orderValue ?? (score === null ? null : score * 10);
    return {
      companyId: placed.companyId,
      rank: index + 1,
      internalScore: value === null ? null : value / 100,
      score,
    };
  });
}

export type FitOrdering = {
  readonly version: string;
  readonly order: (input: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly candidates: readonly (FitOrderEntry & {
      readonly eligibilityReasons: readonly EligibilityReasonCode[];
    })[];
  }) => Promise<readonly FitOrderedCandidate[]>;
};

/**
 * The slate builder's fit order over an input source that reads exactly
 * what the fit panel reads. The source must answer for the organisation
 * (never a member's private view), so the order does not depend on which
 * member the worker built as.
 */
export type SuitabilityRecord = {
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  /** The investor's identity organisation (the members who may read it). */
  readonly organisationId: string;
  readonly mandateId: string;
  readonly companyId: string;
  readonly suitability: SuitabilityDto;
  readonly computedAt: string;
};

export function createFitOrdering(dependencies: {
  readonly inputs: FitInputSource;
  /**
   * fit-order.v2: each company's scored Investability (0-100), from the
   * investor-eligible projection. Absent or failing: none is known.
   */
  readonly investability?:
    | ((companyIds: readonly string[]) => Promise<ReadonlyMap<string, number>>)
    | undefined;
  /** The Suitability each candidate was ordered with (investor-private projection). */
  readonly recordSuitability?:
    ((rows: readonly SuitabilityRecord[]) => Promise<void>) | undefined;
  readonly config?: FitConfig | undefined;
  readonly clock?: (() => Date) | undefined;
}): FitOrdering {
  const config = dependencies.config ?? FIT_CONFIG_CURRENT;
  const clock = dependencies.clock ?? (() => new Date());
  return {
    version: FIT_ORDER_CURRENT.version,
    order: async (input) => {
      if (input.candidates.length === 0) return [];
      const companyIds = input.candidates.map((c) => c.companyId);
      const [inputs, investability] = await Promise.all([
        dependencies.inputs.read({
          actor: input.actor,
          investorOrganisationId: input.investorOrganisationId,
          mandateId: input.mandateId,
          companyIds,
        }),
        dependencies.investability === undefined
          ? Promise.resolve(new Map<string, number>())
          : dependencies
              .investability(companyIds)
              .catch(() => new Map<string, number>()),
      ]);
      const now = clock();
      const keys = new Map<string, FitOrderKey>();
      for (const candidate of input.candidates) {
        const found = inputs.get(candidate.companyId);
        const assessment =
          found === undefined
            ? null
            : assessFit(
                observeFit({
                  companyId: candidate.companyId,
                  snapshot: found.snapshot,
                  declared: found.declared,
                  eligibilityReasons: candidate.eligibilityReasons,
                  config,
                  now,
                }),
                config,
                now.toISOString(),
              );
        const score = fitOrderScore(assessment);
        keys.set(candidate.companyId, {
          assessment,
          score,
          orderValue: discoverOrderValue(
            score,
            investability.get(candidate.companyId) ?? null,
          ),
        });
      }
      const ordered = orderByFit(input.candidates, keys);
      if (
        dependencies.recordSuitability !== undefined &&
        input.actor.organisationId !== undefined
      ) {
        const organisationId = input.actor.organisationId;
        const computedAt = now.toISOString();
        const rows: SuitabilityRecord[] = [];
        for (const [companyId, key] of keys) {
          if (key.assessment === null) continue;
          rows.push({
            tenantId: input.actor.tenantId,
            investorOrganisationId: input.investorOrganisationId,
            organisationId,
            mandateId: input.mandateId,
            companyId,
            suitability: suitabilityFromFit(key.assessment.profile),
            computedAt,
          });
        }
        // A projection of what was used; never fails the build.
        await dependencies.recordSuitability(rows).catch(() => undefined);
      }
      return ordered;
    },
  };
}
