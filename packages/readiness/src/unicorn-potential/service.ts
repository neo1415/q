import type { InvestabilityInputs } from "../investability/inputs.js";
import type { InvestabilityDeckPort } from "../investability/postgres.js";
import type {
  UnicornPotentialStore,
  UnicornPotentialView,
} from "./postgres.js";

export type UnicornPotentialEngine = (
  inputs: InvestabilityInputs,
  asOf: string,
) => {
  readonly view: UnicornPotentialView;
  readonly basisHash: string;
  readonly observations: unknown;
};
export type UnicornPotentialOutcome =
  | { readonly kind: "RECORDED" | "UNCHANGED"; readonly revision: number }
  | { readonly kind: "NOT_FOUND" | "NOT_LISTED" };
export function createUnicornPotentialService(dependencies: {
  readonly store: UnicornPotentialStore;
  readonly deck: InvestabilityDeckPort;
  readonly assess: UnicornPotentialEngine;
  readonly methodVersion: string;
  readonly clock?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}) {
  const clock = dependencies.clock ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const recompute = async (
    companyId: string,
  ): Promise<UnicornPotentialOutcome> => {
    const sourcesReadAt = clock().toISOString();
    const read = await dependencies.store.inputs(companyId);
    if (read === null) return { kind: "NOT_FOUND" };
    if (!read.inputs.profile.listed) return { kind: "NOT_LISTED" };
    // Failed input retrieval must not create a false evidence-loss revision.
    const deck = await dependencies.deck(companyId);
    const result = dependencies.assess(
      { ...read.inputs, deck },
      clock().toISOString(),
    );
    const recorded = await dependencies.store.record({
      subject: read.subject,
      methodVersion: dependencies.methodVersion,
      basisHash: result.basisHash,
      cohortKey: JSON.stringify({
        stage: result.view.stage,
        sectors: [...new Set(read.inputs.sectorCodes)].sort(),
      }),
      view: result.view,
      observations: result.observations,
      sourcesReadAt,
    });
    return {
      kind: recorded.created ? "RECORDED" : "UNCHANGED",
      revision: recorded.revision,
    };
  };
  let sweepAfter: string | undefined;
  return {
    recompute,
    sweep: async (
      options: { readonly limit?: number; readonly pauseMs?: number } = {},
    ) => {
      const limit = Math.max(
        1,
        Math.min(500, Math.trunc(options.limit ?? 100)),
      );
      const pause = Math.max(100, Math.min(10_000, options.pauseMs ?? 100));
      let ids =
        sweepAfter === undefined
          ? await dependencies.store.listedCompanyIds(limit)
          : await dependencies.store.listedCompanyIds(limit, sweepAfter);
      if (ids.length === 0 && sweepAfter !== undefined) {
        sweepAfter = undefined;
        ids = await dependencies.store.listedCompanyIds(limit);
      }
      // Advance even on a failed company: one poisoned record cannot starve later IDs.
      sweepAfter = ids.at(-1);
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
        await sleep(pause);
      }
      return { recorded, unchanged, failed };
    },
  };
}
