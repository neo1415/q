import type { InteractionRepository } from "../interactions/ports.js";
import type { RerankSignals, RerankSignalsPort } from "../rerank/ports.js";

/**
 * REC-008's interaction state, narrowed to what REC-009 may reorder by
 * (CQ-REC-009 §10).
 *
 * This adapter exists to throw things away. `InteractionState` carries an
 * impression count, a save flag, a save time, a last pass reason and a
 * last interaction time; three fields cross this boundary and the rest
 * stop here. That is the difference between "we agreed not to rank on
 * engagement" and a pipeline in which ranking on engagement is not
 * expressible: a later change that wanted a count would have to widen a
 * port, in a diff, on purpose.
 *
 * `impressionCount > 0` becomes a boolean deliberately. Whether an
 * organisation has seen a company is a fact about exposure; how many times
 * is a magnitude, and a magnitude in a reordering stage is popularity
 * however carefully it is named.
 */
export function createInteractionRerankSignals(dependencies: {
  readonly repository: Pick<InteractionRepository, "stateForCompanies">;
}): RerankSignalsPort {
  const { repository } = dependencies;
  return {
    forCompanies: async (query) => {
      const states = await repository.stateForCompanies(query);
      const out = new Map<string, RerankSignals>();
      for (const [companyId, state] of states) {
        out.set(companyId, {
          exposed: state.impressionCount > 0,
          lastSeenAt: state.lastImpressionAt,
          passed: state.passed,
        });
      }
      return out;
    },
  };
}
