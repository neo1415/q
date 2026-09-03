import {
  IDEMPOTENCY_KEY_HEADER,
  INVESTOR_REPRESENTATIVE_ME_SUFFIX,
  INVESTORS_CURRENT_PATH,
  INVESTORS_PATH,
  InvestorOrganisationDtoSchema,
  InvestorRepresentativeDtoSchema,
  type CreateInvestorOrganisationRequest,
  type UpdateInvestorOrganisationRequest,
  type UpsertMyInvestorRepresentativeRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

function investorPath(investorOrganisationId: string, suffix = ""): string {
  return `${INVESTORS_PATH}/${encodeURIComponent(investorOrganisationId)}${suffix}`;
}

/**
 * `POST /v1/investors` -- establish the canonical investor organisation of
 * the session's active organisation. The idempotency key is generated once
 * per intended creation and reused on retry.
 */
export function createInvestorOrganisation(
  session: ApiSession,
  input: CreateInvestorOrganisationRequest,
  idempotencyKey: string,
) {
  return call(session, "POST", INVESTORS_PATH, InvestorOrganisationDtoSchema, {
    body: input,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/** `GET /v1/investors/:id` -- organisation-internal canonical read. */
export function getInvestorOrganisation(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    investorPath(investorOrganisationId),
    InvestorOrganisationDtoSchema,
  );
}

/** `GET /v1/investors/current` -- the investor organisation of the active organisation. */
export function getCurrentInvestorOrganisation(session: ApiSession) {
  return call(
    session,
    "GET",
    INVESTORS_CURRENT_PATH,
    InvestorOrganisationDtoSchema,
  );
}

/** `PATCH /v1/investors/:id` with the version the client read. */
export function updateInvestorOrganisation(
  session: ApiSession,
  investorOrganisationId: string,
  input: UpdateInvestorOrganisationRequest,
) {
  return call(
    session,
    "PATCH",
    investorPath(investorOrganisationId),
    InvestorOrganisationDtoSchema,
    { body: input },
  );
}

/** `GET /v1/investors/:id/representatives/me` -- the caller's own current representation. */
export function getMyInvestorRepresentative(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    investorPath(investorOrganisationId, INVESTOR_REPRESENTATIVE_ME_SUFFIX),
    InvestorRepresentativeDtoSchema,
  );
}

/** `PUT /v1/investors/:id/representatives/me` -- idempotent desired state of the caller's representation. */
export function upsertMyInvestorRepresentative(
  session: ApiSession,
  investorOrganisationId: string,
  input: UpsertMyInvestorRepresentativeRequest,
) {
  return call(
    session,
    "PUT",
    investorPath(investorOrganisationId, INVESTOR_REPRESENTATIVE_ME_SUFFIX),
    InvestorRepresentativeDtoSchema,
    { body: input },
  );
}
