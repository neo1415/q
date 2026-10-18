import {
  COMPANIES_PATH,
  COMPANY_VERIFICATION_REQUESTS_SEGMENT,
  COMPANY_VERIFICATION_SEGMENT,
  CompanyVerificationDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** `GET /v1/companies/:companyId/verification` (CQ-VERIFY-001). */
export function getCompanyVerification(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_VERIFICATION_SEGMENT}`,
    CompanyVerificationDtoSchema,
  );
}

/**
 * `POST /v1/companies/:companyId/verification/requests`. Body-less: the
 * founder asks, Capital Q decides. The key is generated once per intended
 * request and reused on retry.
 */
export function requestCompanyVerification(
  session: ApiSession,
  companyId: string,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_VERIFICATION_REQUESTS_SEGMENT}`,
    CompanyVerificationDtoSchema,
    { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}
