import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_COMPANY_PASS_PATH,
  DISCOVERY_COMPANY_SAVE_PATH,
  DISCOVERY_COMPANY_UNSAVE_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
  InteractionRecordedDtoSchema,
  type PassCompanyRequest,
  type SaveCompanyRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Discovery (doc 19): the slate, cursor-paged. */

type Page = {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
};

function query(page: Page): string {
  const params = new URLSearchParams();
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  if (page.cursor !== undefined) params.set("cursor", page.cursor);
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
