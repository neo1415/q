import { actorPrincipal } from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

import type { QToolPorts } from "../ports.js";

/**
 * Companies visible across the network to this actor (ADR-001: both
 * network_visible and public_external are discoverable to an authenticated
 * participant). Classification selects the candidates; the Permissions
 * context decides each one, and only a NETWORK_VISIBLE or PUBLIC_EXTERNAL
 * disclosure lets it through. The actor's own organisation-private
 * companies are never candidates (no viewer organisation), so nothing
 * founder-private can reach an investor this way.
 */
export async function networkVisibleCompanies(
  ports: Pick<QToolPorts, "companies" | "disclosure">,
  actor: ActorContext,
  query: {
    readonly text?: string | undefined;
    readonly stageCode?: string | undefined;
    readonly headquartersCountry?: string | undefined;
    readonly limit: number;
    readonly cursor?: string | undefined;
  },
) {
  const page = await ports.companies.searchCompanies({
    viewer: { tenantId: actor.tenantId, organisationId: undefined },
    text: query.text,
    stageCode: query.stageCode,
    headquartersCountry: query.headquartersCountry,
    limit: query.limit,
    cursor: query.cursor,
  });
  const decisions =
    page.items.length === 0
      ? []
      : await ports.disclosure.evaluateMany(
          page.items.map((item) => ({
            principal: actorPrincipal(actor),
            resource: { type: "company" as const, id: item.id },
            requestedAccess: "view" as const,
          })),
        );
  return {
    items: page.items.filter((_item, index) => {
      const decision = decisions[index];
      return (
        decision !== undefined &&
        decision.outcome === "ALLOW" &&
        (decision.reasonCode === "NETWORK_VISIBLE" ||
          decision.reasonCode === "PUBLIC_EXTERNAL")
      );
    }),
    nextCursor: page.nextCursor,
  };
}
