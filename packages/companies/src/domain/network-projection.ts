import type {
  CompanyStatus,
  MarketplaceVisibility,
} from "@capital-q/contracts";

/**
 * The one projection of a company that a viewer across the network gets
 * (CQ-PRE-REC-001 §33, §36).
 *
 * Whoever asks — Q answering an investor, or the founder previewing "what
 * investors will see" — reads the same function over the same declared
 * profile. The preview is therefore never built by rendering founder-private
 * data and hoping a filter hides it: nothing outside this field list exists
 * in the result. Readiness, logo storage keys, slugs, internal identifiers
 * of the organisation and everything a later domain attaches to a company
 * (documents, capital objective, team facts, Q knowledge) are absent by
 * construction.
 */

export type NetworkVisibleCompanyProfile = {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly legalName: string | null;
  readonly websiteUrl: string | null;
  readonly foundedDate: string | null;
  readonly headquartersCountry: string | null;
  readonly headquartersCity: string | null;
  readonly currentStageCode: string | null;
  readonly shortDescription: string | null;
  readonly primaryDescription: string | null;
  readonly companyStatus: CompanyStatus;
};

/** The declared profile fields the projection reads. Nothing else is read. */
export type NetworkProjectionSource = {
  readonly id: string;
  readonly canonicalName: string;
  readonly legalName: string | null;
  readonly websiteUrl: string | null;
  readonly foundedDate: string | null;
  readonly headquartersCountry: string | null;
  readonly headquartersCity: string | null;
  readonly currentStageCode: string | null;
  readonly shortDescription: string | null;
  readonly primaryDescription: string | null;
  readonly companyStatus: CompanyStatus;
};

/** The long description is bounded on the way out; it is prose, not a document. */
export const NETWORK_PROJECTION_DESCRIPTION_MAX = 4000;

export function projectCompanyForNetwork(
  source: NetworkProjectionSource,
  options: { readonly descriptionMax?: number } = {},
): NetworkVisibleCompanyProfile {
  const max = options.descriptionMax ?? NETWORK_PROJECTION_DESCRIPTION_MAX;
  return {
    companyId: source.id,
    canonicalName: source.canonicalName,
    legalName: source.legalName,
    websiteUrl: source.websiteUrl,
    foundedDate: source.foundedDate,
    headquartersCountry: source.headquartersCountry,
    headquartersCity: source.headquartersCity,
    currentStageCode: source.currentStageCode,
    shortDescription: source.shortDescription,
    primaryDescription:
      source.primaryDescription === null
        ? null
        : source.primaryDescription.slice(0, max),
    companyStatus: source.companyStatus,
  };
}

/**
 * The visibilities a founder may choose for the company profile (§32,
 * §34). Private to the organisation, or visible to investors across the
 * network. Public and relationship-specific sharing are not choices here:
 * public exposure is not a V1 product rule, and relationship sharing is
 * the Data Room's grant to make, not a profile switch.
 */
export const COMPANY_VISIBILITY_CHOICES = [
  "organisation_private",
  "network_visible",
] as const satisfies readonly MarketplaceVisibility[];

export type CompanyVisibilityChoice =
  (typeof COMPANY_VISIBILITY_CHOICES)[number];

/** Whether investors across the network may see the declared profile. */
export function isNetworkVisible(visibility: MarketplaceVisibility): boolean {
  return visibility === "network_visible" || visibility === "public_external";
}
