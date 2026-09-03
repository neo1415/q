import {
  COMPANIES_PATH,
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
