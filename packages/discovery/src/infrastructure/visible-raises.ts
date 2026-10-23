import {
  organisationPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

/**
 * Each company's current raise as the acting investor ORGANISATION may see
 * it (owner 23 Oct 2026): published on the company's Q Card (its
 * `currentRaise` scope reaches every signed-in investor), or the capital
 * objective disclosed to the organisation by the disclosure evaluator.
 * Nothing else: a founder_private raise never moves a company in an
 * investor's feed or fit (Context Firewall), an actor with no organisation
 * sees none, and a failed read is the private answer.
 */

export type CurrentRaise = {
  readonly objectiveId: string;
  readonly companyId: string;
  /** Exact decimal string. */
  readonly amount: string;
  /** ISO 4217. */
  readonly currency: string;
  /** The company put `currentRaise` on its Q Card. */
  readonly publishedOnCard?: boolean | undefined;
};

export type VisibleRaises = (
  actor: ActorContext,
  companyIds: readonly string[],
) => Promise<
  ReadonlyMap<string, { readonly amount: string; readonly currency: string }>
>;

export function createVisibleRaises(dependencies: {
  readonly currentRaises?:
    | ((companyIds: readonly string[]) => Promise<readonly CurrentRaise[]>)
    | undefined;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
}): VisibleRaises {
  const { currentRaises, disclosure } = dependencies;
  return async (actor, companyIds) => {
    const out = new Map<string, { amount: string; currency: string }>();
    if (currentRaises === undefined || actor.organisationId === undefined) {
      return out;
    }
    const raises = await currentRaises(companyIds).catch(() => []);
    if (raises.length === 0) return out;
    const principal = organisationPrincipal({
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
    });
    const undisclosed = raises.filter(
      (raise) => raise.publishedOnCard !== true,
    );
    const decisions =
      undisclosed.length === 0
        ? []
        : await disclosure
            .evaluateMany(
              undisclosed.map((raise) => ({
                principal,
                resource: {
                  type: "capital_objective" as const,
                  id: raise.objectiveId,
                },
                requestedAccess: "view" as const,
              })),
            )
            .catch(() => []);
    const allowed = new Set(
      undisclosed
        .filter((_, index) => decisions[index]?.outcome === "ALLOW")
        .map((raise) => raise.objectiveId),
    );
    for (const raise of raises) {
      if (raise.publishedOnCard === true || allowed.has(raise.objectiveId)) {
        out.set(raise.companyId, {
          amount: raise.amount,
          currency: raise.currency,
        });
      }
    }
    return out;
  };
}
