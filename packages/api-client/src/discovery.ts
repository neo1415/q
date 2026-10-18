import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_COMPANY_PASS_PATH,
  DISCOVERY_COMPANY_SAVE_PATH,
  DISCOVERY_COMPANY_UNSAVE_PATH,
  DISCOVERY_COMPANY_UNPASS_PATH,
  DISCOVERY_PASSED_PATH,
  DISCOVERY_EXPLANATION_PATH,
  DISCOVERY_INVESTOR_PATH,
  DISCOVERY_INVESTOR_PHOTO_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveredInvestorPhotoDtoSchema,
  DiscoveredInvestorProfileDtoSchema,
  DISCOVERY_NETWORK_PITCHES_PATH,
  DISCOVERY_SAVED_PATH,
  DISCOVERY_YOUR_COMPANIES_PATH,
  YourCompaniesPageDtoSchema,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
  NetworkPitchPageDtoSchema,
  InteractionRecordedDtoSchema,
  RecommendationExplanationDtoSchema,
  SavedCompaniesDtoSchema,
  discoverFiltersToQuery,
  type DiscoverFilters,
  type PassCompanyRequest,
  type SaveCompanyRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Discovery (doc 19): the slate, cursor-paged. */

type Page = {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  /** Discover filters; the same filters must accompany every page's cursor. */
  readonly filters?: DiscoverFilters | undefined;
};

function query(page: Page): string {
  const params = new URLSearchParams();
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  if (page.cursor !== undefined) params.set("cursor", page.cursor);
  if (page.filters !== undefined) {
    for (const [key, value] of Object.entries(
      discoverFiltersToQuery(page.filters),
    )) {
      params.set(key, value);
    }
  }
  return params.size === 0 ? "" : `?${params.toString()}`;
}

/** `GET /v1/discovery/companies` — what an investor could look at. */
export function discoverCompanies(session: ApiSession, page: Page = {}) {
  return call(
    session,
    "GET",
    `${DISCOVERY_COMPANIES_PATH}${query(page)}`,
    DiscoveryCompanySlateDtoSchema,
  );
}

/** `GET /v1/discovery/investors` — what a founder could look at. */
export function discoverInvestors(session: ApiSession, page: Page = {}) {
  return call(
    session,
    "GET",
    `${DISCOVERY_INVESTORS_PATH}${query(page)}`,
    DiscoveryInvestorSlateDtoSchema,
  );
}

/** `GET /v1/discovery/investors/:investorOrganisationId` — one investor, as this founder may see them. */
export function getDiscoveredInvestor(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    DISCOVERY_INVESTOR_PATH.replace(
      ":investorOrganisationId",
      encodeURIComponent(investorOrganisationId),
    ),
    DiscoveredInvestorProfileDtoSchema,
  );
}

/** `GET /v1/discovery/investors/:investorOrganisationId/photo` — the logo's signed URL, or null. */
export function getDiscoveredInvestorPhoto(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    DISCOVERY_INVESTOR_PHOTO_PATH.replace(
      ":investorOrganisationId",
      encodeURIComponent(investorOrganisationId),
    ),
    DiscoveredInvestorPhotoDtoSchema,
  );
}

/**
 * `GET /v1/discovery/your-companies` — pitches from the investor's own
 * connected, interested and saved companies, newest first (2026-10-02).
 */
export function listYourCompanies(session: ApiSession, page: Page = {}) {
  return call(
    session,
    "GET",
    `${DISCOVERY_YOUR_COMPANIES_PATH}${query(page)}`,
    YourCompaniesPageDtoSchema,
  );
}

/** `GET /v1/discovery/network-pitches` — videos opened to everyone (ADR 0021). */
export function listNetworkPitches(
  session: ApiSession,
  page: Page & { readonly text?: string | undefined } = {},
) {
  const search =
    page.text === undefined || page.text.trim().length === 0
      ? ""
      : `${query(page).length === 0 ? "?" : "&"}q=${encodeURIComponent(page.text.trim())}`;
  return call(
    session,
    "GET",
    `${DISCOVERY_NETWORK_PITCHES_PATH}${query(page)}${search}`,
    NetworkPitchPageDtoSchema,
  );
}

/**
 * Save, unsave and pass (CQ-REC-008; doc 19 §66–§69).
 *
 * Three functions rather than one taking a verb, because the contract is
 * three paths rather than one taking a verb: the URL says which decision
 * this is, so a request cannot change its own meaning in flight. The body
 * carries only the caller's own context — `clientEventId` for idempotent
 * retries, the surface, and the slate the person was looking at. Rank,
 * ranking version, organisation and tenant are absent by design: the
 * server resolves those, and a field for them would be a field to forge.
 */
function companyPath(template: string, companyId: string): string {
  return template.replace(":companyId", encodeURIComponent(companyId));
}

export function saveCompany(
  session: ApiSession,
  companyId: string,
  body: SaveCompanyRequest,
) {
  return call(
    session,
    "POST",
    companyPath(DISCOVERY_COMPANY_SAVE_PATH, companyId),
    InteractionRecordedDtoSchema,
    { body },
  );
}

/**
 * `GET /v1/discovery/saved` — the investor's Saved section: company ids
 * only, newest first. Each is read back through the ordinary company path,
 * which re-checks disclosure.
 */
export function listSavedCompanies(session: ApiSession) {
  return call(session, "GET", DISCOVERY_SAVED_PATH, SavedCompaniesDtoSchema);
}

/** `GET /v1/discovery/passed` — the investor's passed companies, newest first. */
export function listPassedCompanies(session: ApiSession) {
  return call(session, "GET", DISCOVERY_PASSED_PATH, SavedCompaniesDtoSchema);
}

/** `POST …/unpass` — undo a pass; idempotent by `clientEventId`. */
export function unpassCompany(
  session: ApiSession,
  companyId: string,
  body: SaveCompanyRequest,
) {
  return call(
    session,
    "POST",
    companyPath(DISCOVERY_COMPANY_UNPASS_PATH, companyId),
    InteractionRecordedDtoSchema,
    { body },
  );
}

export function unsaveCompany(
  session: ApiSession,
  companyId: string,
  body: SaveCompanyRequest,
) {
  return call(
    session,
    "POST",
    companyPath(DISCOVERY_COMPANY_UNSAVE_PATH, companyId),
    InteractionRecordedDtoSchema,
    { body },
  );
}

/**
 * `GET /v1/discovery/slates/:slateId/companies/:companyId/explanation`
 * (CQ-REC-007) — why this company is in this investor's slate.
 *
 * Served by the Q API, so the session's `baseUrl` is the Q API's. Neither
 * id is authority: the server answers not-found for a slate the caller's
 * own investor organisation does not own.
 */
export function getRecommendationExplanation(
  session: ApiSession,
  slateId: string,
  companyId: string,
) {
  return call(
    session,
    "GET",
    DISCOVERY_EXPLANATION_PATH.replace(
      ":slateId",
      encodeURIComponent(slateId),
    ).replace(":companyId", encodeURIComponent(companyId)),
    RecommendationExplanationDtoSchema,
  );
}

export function passCompany(
  session: ApiSession,
  companyId: string,
  body: PassCompanyRequest,
) {
  return call(
    session,
    "POST",
    companyPath(DISCOVERY_COMPANY_PASS_PATH, companyId),
    InteractionRecordedDtoSchema,
    { body },
  );
}
