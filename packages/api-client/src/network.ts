import {
  CompanyInterestStatusDtoSchema,
  ExpressInterestResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
  NETWORK_COMPANY_INTEREST_PATH,
  type ExpressInterestRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Network (CQ-NET-010): Express Interest, keyed by company. */

function companyPath(template: string, companyId: string): string {
  return template.replace(":companyId", encodeURIComponent(companyId));
}

/**
 * `POST /v1/network/companies/:companyId/express-interest`.
 *
 * Server-confirmed, never optimistic. The key is generated once per
 * intended expression and reused on retry, so a retry after a lost
 * response returns the original interest rather than a second one.
 */
export function expressInterest(
  session: ApiSession,
  companyId: string,
  body: ExpressInterestRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    companyPath(NETWORK_COMPANY_EXPRESS_INTEREST_PATH, companyId),
    ExpressInterestResultDtoSchema,
    { body, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** `GET /v1/network/companies/:companyId/interest` — the caller's organisation's own interest, if any. */
export function getOwnInterest(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyPath(NETWORK_COMPANY_INTEREST_PATH, companyId),
    CompanyInterestStatusDtoSchema,
  );
}
