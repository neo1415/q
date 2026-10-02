import type { InteractionRepository } from "../interactions/ports.js";
import type { PassReintroduction, PassReintroductionPort } from "./ports.js";

/**
 * A passed company is offered again when it has something new to show
 * (doc 19 §67; founder report 2026-10-02): a pitch that became playable
 * after the pass. That is evidence, not a row timestamp (§12): the pitch's
 * own READY time, read from the media context's publishable pitches, and
 * the pass's own time, from this organisation's interaction state.
 *
 * A pitch that was already there when they passed reintroduces nothing.
 * Nothing here touches the mandate, ranks anything or is paid for: it only
 * stops withholding one company from one organisation's next page.
 */
export const NEW_PITCH_CHANGE = "NEW_PITCH" as const;

export type PublishablePitchTimesPort = {
  /** Each company's newest publishable pitch's READY time, ISO; absent when none. */
  readonly latestReadyAt: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
};

export function createPitchReintroductions(dependencies: {
  readonly repository: Pick<InteractionRepository, "stateForCompanies">;
  readonly pitches: PublishablePitchTimesPort;
}): PassReintroductionPort {
  const { repository, pitches } = dependencies;
  return {
    reasonsFor: async (query) => {
      const out = new Map<string, PassReintroduction>();
      if (query.companyIds.length === 0) return out;
      const [states, readyAt] = await Promise.all([
        repository.stateForCompanies({
          tenantId: query.tenantId,
          investorOrganisationId: query.investorOrganisationId,
          companyIds: query.companyIds,
        }),
        pitches.latestReadyAt(query.companyIds),
      ]);
      for (const companyId of query.companyIds) {
        const state = states.get(companyId);
        const ready = readyAt.get(companyId);
        if (
          state === undefined ||
          !state.passed ||
          state.passedAt === null ||
          ready === undefined
        ) {
          continue;
        }
        if (Date.parse(ready) > Date.parse(state.passedAt)) {
          out.set(companyId, {
            reason: "MATERIAL_COMPANY_UPDATE",
            change: NEW_PITCH_CHANGE,
          });
        }
      }
      return out;
    },
  };
}
