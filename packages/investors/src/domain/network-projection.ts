import type { InvestorOrganisation } from "../contracts/index.js";

/**
 * What a founder across the network sees of an investor organisation
 * (doc 19 §44; doc 17 §71), and the two visibilities an investor may choose.
 *
 * The projection is an allowlist, not a filter: the field list below is
 * everything that can leave, so a column added to the canonical row later
 * cannot appear here by accident. Declared profile only — no mandate, no
 * portfolio, no observed behaviour, no browsing, no GateQ state and no
 * score. Doc 19 §204.9 is explicit that private investor behaviour must
 * never reach a founder through discovery, and the way to guarantee that
 * is for this type to have nowhere to put it.
 */

export const INVESTOR_VISIBILITY_CHOICES = [
  "organisation_private",
  "network_visible",
] as const;

export type InvestorVisibilityChoice =
  (typeof INVESTOR_VISIBILITY_CHOICES)[number];

/** Whether founders across the network may see the declared profile. */
export function isInvestorNetworkVisible(visibility: string): boolean {
  return visibility === "network_visible";
}

export type NetworkVisibleInvestorProfile = {
  readonly investorOrganisationId: string;
  readonly displayName: string;
  readonly investorType: string;
  readonly websiteUrl: string | null;
  readonly hqCountry: string | null;
  readonly publicDescription: string | null;
  /** Declared, not observed: whether they say they are deploying. */
  readonly deploymentState: string | null;
};

export function toNetworkVisibleInvestorProfile(
  investor: InvestorOrganisation,
  options: { readonly descriptionMax?: number } = {},
): NetworkVisibleInvestorProfile {
  const max = options.descriptionMax ?? 2_000;
  return {
    investorOrganisationId: investor.id,
    displayName: investor.displayName,
    investorType: investor.investorType,
    websiteUrl: investor.websiteUrl,
    hqCountry: investor.hqCountry,
    publicDescription:
      investor.publicDescription === null
        ? null
        : investor.publicDescription.slice(0, max),
    deploymentState: investor.deploymentState,
  };
}
