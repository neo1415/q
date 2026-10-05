import {
  isMatchedRelationshipState,
  type YourCompanyLabel,
} from "@capital-q/contracts";

/** The fields of an investor's relationship listing this list reads. */
export type YourCompaniesListing = {
  readonly relationship: { readonly companyId: string };
  readonly projection: { readonly state: string; readonly stateSince: string };
};

export type YourCompanyEntry = {
  readonly companyId: string;
  readonly label: YourCompanyLabel;
  readonly activityAt: string | null;
};

/**
 * "Your companies" (founder decision 2026-10-05: "my companies should be
 * the ones we have established a connection with"): only relationships
 * that reached CONNECTED and are still open -- CONNECTED, MEETING_HELD,
 * IN_DILIGENCE, PAUSED, INVESTED. An expressed interest, a save or a pass
 * is not a connection, so none of those lists a company here. Each
 * company's time is when its relationship last moved, the list's
 * "latest first" order.
 */
export function connectedCompanies(
  listings: readonly YourCompaniesListing[],
): YourCompanyEntry[] {
  const latest = new Map<string, string>();
  for (const listing of listings) {
    const { state, stateSince } = listing.projection;
    if (state === "PASSED" || !isMatchedRelationshipState(state)) continue;
    const companyId = listing.relationship.companyId;
    const known = latest.get(companyId);
    if (known === undefined || known < stateSince) {
      latest.set(companyId, stateSince);
    }
  }
  return [...latest].map(([companyId, activityAt]) => ({
    companyId,
    label: "CONNECTED",
    activityAt,
  }));
}
