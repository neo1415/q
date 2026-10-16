import { assessInvestability, INVESTABILITY_METHOD_VERSION } from "./assess.js";
import type { InvestabilityDeckPort, InvestabilityStore } from "./postgres.js";

/**
 * Recompute one company's Investability: read its investor-eligible inputs,
 * assess, append a revision only when the basis changed. Idempotent: a
 * redelivered event, a sweep and a backfill over an unchanged company all
 * write nothing. Runs as Capital Q (system); no model call anywhere.
 */

export type InvestabilityRecomputeOutcome =
  | { readonly kind: "RECORDED"; readonly revision: number }
  | { readonly kind: "UNCHANGED"; readonly revision: number }
  | { readonly kind: "NOT_LISTED" }
  | { readonly kind: "NOT_FOUND" };

export type InvestabilityService = {
  readonly recompute: (
    companyId: string,
  ) => Promise<InvestabilityRecomputeOutcome>;
  /** Every listed company, one at a time (backfill and periodic sweep). */
  readonly sweep: (options?: {
    readonly limit?: number | undefined;
    readonly pauseMs?: number | undefined;
  }) => Promise<{ readonly recorded: number; readonly unchanged: number; readonly failed: number }>;
};

export function createInvestabilityService(dependencies: {
  readonly store: InvestabilityStore;
  readonly deck: InvestabilityDeckPort;
  readonly clock?: (() => Date) | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}): InvestabilityService {
  const clock = dependencies.clock ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const recompute = async (
    companyId: string,
  ): Promise<InvestabilityRecomputeOutcome> => {
    const read = await dependencies.store.inputs(companyId);
    if (read === null) return { kind: "NOT_FOUND" };
    if (!read.inputs.profile.listed) return { kind: "NOT_LISTED" };
    const deck = await dependencies.deck(companyId).catch(() => null);
    const result = assessInvestability(
      { ...read.inputs, deck },
      clock().toISOString(),
    );
    const latest = await dependencies.store.latest(
      companyId,
      INVESTABILITY_METHOD_VERSION,
    );
    if (latest !== null && latest.basisHash === result.basisHash) {
      return { kind: "UNCHANGED", revision: latest.revision };
    }
    const recorded = await dependencies.store.record({
      subject: read.subject,
      methodVersion: INVESTABILITY_METHOD_VERSION,
      basisHash: result.basisHash,
      view: result.view,
      assessment: {
        assessment: result.assessment,
        observations: result.observations,
      },
    });
    return recorded.created
      ? { kind: "RECORDED", revision: recorded.revision }
      : { kind: "UNCHANGED", revision: recorded.revision };
  };

  return {
    recompute,
    sweep: async (options = {}) => {
      const ids = await dependencies.store.listedCompanyIds(
        options.limit ?? 2000,
      );
      let recorded = 0;
      let unchanged = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const outcome = await recompute(id);
          if (outcome.kind === "RECORDED") recorded += 1;
          else unchanged += 1;
        } catch {
          failed += 1;
        }
        // Paced: the production database is small and shared.
        if ((options.pauseMs ?? 0) > 0) await sleep(options.pauseMs ?? 0);
      }
      return { recorded, unchanged, failed };
    },
  };
}
