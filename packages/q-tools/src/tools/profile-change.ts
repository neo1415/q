import type { PermittedContextPlan } from "@capital-q/contracts";

import { scopesOfKind } from "../plan.js";

/**
 * The company or investor organisation ids this conversation's plan binds
 * as subjects. `propose_profile_change` (BIZ-002) was retired by ADR 0040's
 * profile area: the profile tools are generated from the app's action
 * registry. Filling a profile's gaps from research still resolves the
 * bound subject this way.
 */
export function boundIds(
  plan: PermittedContextPlan,
  kind: "COMPANY_PROFILE" | "INVESTOR_PROFILE",
): readonly string[] {
  const ids = new Set<string>();
  for (const scope of scopesOfKind(plan, kind)) {
    if (scope.subject === undefined) continue;
    const id =
      kind === "COMPANY_PROFILE"
        ? scope.filter.companyId
        : scope.filter.investorOrganisationId;
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}
