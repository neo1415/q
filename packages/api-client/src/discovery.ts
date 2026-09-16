import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
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
