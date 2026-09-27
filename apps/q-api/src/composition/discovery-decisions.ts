import type { InteractionSignalService } from "@capital-q/discovery";
import type { DiscoveryDecisionPort } from "@capital-q/q-tools";

/**
 * R33: an investor's Save, Unsave and Pass from a conversation, recorded by
 * the same interaction service the Discover buttons call. The surface says
 * where it came from (Q_CONVERSATION); the service resolves the investor
 * organisation from the actor and re-runs the feed's REC-001 eligibility
 * for the company, so Q can act only on a company the person could act on
 * in Discover. Any refusal is one answer: NOT_AVAILABLE.
 */
export function createDiscoveryDecisionPort(
  interactions: Pick<InteractionSignalService, "decide">,
): DiscoveryDecisionPort {
  return {
    decide: async (actor, decision) => {
      const outcome = await interactions.decide(decision.type, {
        actor,
        companyId: decision.companyId,
        surface: "Q_CONVERSATION",
        clientEventId: decision.clientEventId,
      });
      if (outcome.kind !== "RECORDED") return { status: "NOT_AVAILABLE" };
      return {
        status: "RECORDED",
        deduplicated: outcome.deduplicated,
        saved: outcome.state?.saved ?? null,
        passed: outcome.state?.passed ?? null,
      };
    },
  };
}
