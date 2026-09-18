import {
  COMPANIES_PATH,
  COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT,
  COMPANY_MARKETPLACE_READINESS_SEGMENT,
  COMPANY_NETWORK_PREVIEW_SEGMENT,
  COMPANY_VISIBILITY_SEGMENT,
  CompanyNetworkPreviewSchema,
  MarketplaceReadinessAssessmentSchema,
  type SetCompanyVisibilityRequest,
  CompanyDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  type CreateCompanyRequest,
  type UpdateCompanyRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * `POST /v1/companies`. Requires an active organisation context on the
 * session (the API resolves it server-side; `organisationId` on the session
 * is only a selector). The idempotency key is generated once per intended
 * creation and reused on retry.
 */
export function createCompany(
  session: ApiSession,
  input: CreateCompanyRequest,
  idempotencyKey: string,
) {
  return call(session, "POST", COMPANIES_PATH, CompanyDtoSchema, {
    body: input,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/** `GET /v1/companies/:id` -- organisation-internal canonical read. */
export function getCompany(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}`,
    CompanyDtoSchema,
  );
}

/** `PATCH /v1/companies/:id` with the version the client read. */
export function updateCompany(
  session: ApiSession,
  companyId: string,
  input: UpdateCompanyRequest,
) {
  return call(
    session,
    "PATCH",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}`,
    CompanyDtoSchema,
    { body: input },
  );
}

/** `POST /v1/companies/:companyId/visibility` (CQ-PRE-REC-001 §31-§35). */
export function setCompanyVisibility(
  session: ApiSession,
  companyId: string,
  request: SetCompanyVisibilityRequest,
) {
  return call(
    session,
    "POST",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_VISIBILITY_SEGMENT}`,
    CompanyDtoSchema,
    { body: request },
  );
}

/** `GET /v1/companies/:companyId/network-preview` — what investors will see (§33). */
export function getCompanyNetworkPreview(
  session: ApiSession,
  companyId: string,
) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_NETWORK_PREVIEW_SEGMENT}`,
    CompanyNetworkPreviewSchema,
  );
}

/** `GET /v1/companies/:companyId/marketplace-readiness` — the policy's answer now (CQ-MKT-001). */
export function getMarketplaceReadiness(
  session: ApiSession,
  companyId: string,
) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_MARKETPLACE_READINESS_SEGMENT}`,
    MarketplaceReadinessAssessmentSchema,
  );
}

/** `POST /v1/companies/:companyId/marketplace-readiness/assess` — ask for a reconciliation; no body, no state. */
export function assessMarketplaceReadiness(
  session: ApiSession,
  companyId: string,
) {
  return call(
    session,
    "POST",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT}`,
    MarketplaceReadinessAssessmentSchema,
  );
}
