import {
  IDEMPOTENCY_KEY_HEADER,
  INVESTOR_MANDATE_ACTIVATE_SUFFIX,
  INVESTOR_MANDATE_CLOSE_SUFFIX,
  INVESTOR_MANDATES_SUFFIX,
  INVESTORS_PATH,
  InvestorMandateDtoSchema,
  ListInvestorMandatesResponseSchema,
  type CreateInvestorMandateRequest,
  type InvestorMandateStatus,
  type InvestorMandateTransitionRequest,
  type UpdateInvestorMandateRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

function mandatesPath(investorOrganisationId: string, suffix = ""): string {
  return `${INVESTORS_PATH}/${encodeURIComponent(investorOrganisationId)}${INVESTOR_MANDATES_SUFFIX}${suffix}`;
}

function mandatePath(
  investorOrganisationId: string,
  mandateId: string,
  suffix = "",
): string {
  return mandatesPath(
    investorOrganisationId,
    `/${encodeURIComponent(mandateId)}${suffix}`,
  );
}

/** `POST /v1/investors/:id/mandates` -- a DRAFT mandate. Key generated once per intended creation. */
export function createInvestorMandate(
  session: ApiSession,
  investorOrganisationId: string,
  input: CreateInvestorMandateRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    mandatesPath(investorOrganisationId),
    InvestorMandateDtoSchema,
    {
      body: input,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** `GET /v1/investors/:id/mandates` -- the investor's own mandates, newest first. */
export function listInvestorMandates(
  session: ApiSession,
  investorOrganisationId: string,
  page: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
    readonly status?: InvestorMandateStatus | undefined;
  } = {},
) {
  const query = new URLSearchParams();
  if (page.cursor !== undefined) {
    query.set("cursor", page.cursor);
  }
  if (page.limit !== undefined) {
    query.set("limit", String(page.limit));
  }
  if (page.status !== undefined) {
    query.set("status", page.status);
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    mandatesPath(investorOrganisationId, suffix),
    ListInvestorMandatesResponseSchema,
  );
}

/** `GET /v1/investors/:id/mandates/:mandateId`. */
export function getInvestorMandate(
  session: ApiSession,
  investorOrganisationId: string,
  mandateId: string,
) {
  return call(
    session,
    "GET",
    mandatePath(investorOrganisationId, mandateId),
    InvestorMandateDtoSchema,
  );
}

/** `PATCH /v1/investors/:id/mandates/:mandateId` with the version the client read. */
export function updateInvestorMandate(
  session: ApiSession,
  investorOrganisationId: string,
  mandateId: string,
  input: UpdateInvestorMandateRequest,
) {
  return call(
    session,
    "PATCH",
    mandatePath(investorOrganisationId, mandateId),
    InvestorMandateDtoSchema,
    { body: input },
  );
}

/** `POST .../activate` -- DRAFT to ACTIVE. */
export function activateInvestorMandate(
  session: ApiSession,
  investorOrganisationId: string,
  mandateId: string,
  input: InvestorMandateTransitionRequest = {},
) {
  return call(
    session,
    "POST",
    mandatePath(
      investorOrganisationId,
      mandateId,
      INVESTOR_MANDATE_ACTIVATE_SUFFIX,
    ),
    InvestorMandateDtoSchema,
    { body: input },
  );
}

/** `POST .../close` -- to CLOSED; the mandate remains as history. */
export function closeInvestorMandate(
  session: ApiSession,
  investorOrganisationId: string,
  mandateId: string,
  input: InvestorMandateTransitionRequest = {},
) {
  return call(
    session,
    "POST",
    mandatePath(
      investorOrganisationId,
      mandateId,
      INVESTOR_MANDATE_CLOSE_SUFFIX,
    ),
    InvestorMandateDtoSchema,
    { body: input },
  );
}
