import {
  CAPITAL_OBJECTIVE_CLOSE_SUFFIX,
  CAPITAL_OBJECTIVE_CURRENT_SEGMENT,
  CAPITAL_OBJECTIVE_REPLACE_SUFFIX,
  CAPITAL_OBJECTIVES_SUFFIX,
  CapitalObjectiveDtoSchema,
  COMPANIES_PATH,
  IDEMPOTENCY_KEY_HEADER,
  ListCapitalObjectivesResponseSchema,
  type CloseCapitalObjectiveRequest,
  type CreateCapitalObjectiveRequest,
  type ReplaceCapitalObjectiveRequest,
  type UpdateCapitalObjectiveRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

function objectivesPath(companyId: string, suffix = ""): string {
  return `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${CAPITAL_OBJECTIVES_SUFFIX}${suffix}`;
}

function objectivePath(
  companyId: string,
  capitalObjectiveId: string,
  suffix = "",
): string {
  return objectivesPath(
    companyId,
    `/${encodeURIComponent(capitalObjectiveId)}${suffix}`,
  );
}

/** `POST /v1/companies/:id/capital-objectives` -- the company's ACTIVE objective. Key generated once per intended creation. */
export function createCapitalObjective(
  session: ApiSession,
  companyId: string,
  input: CreateCapitalObjectiveRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    objectivesPath(companyId),
    CapitalObjectiveDtoSchema,
    {
      body: input,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** `GET /v1/companies/:id/capital-objectives/current`. */
export function getCurrentCapitalObjective(
  session: ApiSession,
  companyId: string,
) {
  return call(
    session,
    "GET",
    objectivesPath(companyId, CAPITAL_OBJECTIVE_CURRENT_SEGMENT),
    CapitalObjectiveDtoSchema,
  );
}

/** `GET /v1/companies/:id/capital-objectives/:capitalObjectiveId` -- current or historical. */
export function getCapitalObjective(
  session: ApiSession,
  companyId: string,
  capitalObjectiveId: string,
) {
  return call(
    session,
    "GET",
    objectivePath(companyId, capitalObjectiveId),
    CapitalObjectiveDtoSchema,
  );
}

/** `GET /v1/companies/:id/capital-objectives` -- latest first, cursor paginated. */
export function listCapitalObjectives(
  session: ApiSession,
  companyId: string,
  page: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
) {
  const query = new URLSearchParams();
  if (page.cursor !== undefined) {
    query.set("cursor", page.cursor);
  }
  if (page.limit !== undefined) {
    query.set("limit", String(page.limit));
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    objectivesPath(companyId, suffix),
    ListCapitalObjectivesResponseSchema,
  );
}

/** `PATCH .../:capitalObjectiveId` -- recalibrate the ACTIVE objective with the version the client read. */
export function updateCapitalObjective(
  session: ApiSession,
  companyId: string,
  capitalObjectiveId: string,
  input: UpdateCapitalObjectiveRequest,
) {
  return call(
    session,
    "PATCH",
    objectivePath(companyId, capitalObjectiveId),
    CapitalObjectiveDtoSchema,
    { body: input },
  );
}

/** `POST .../:capitalObjectiveId/close` -- ACHIEVED, CLOSED_BY_FOUNDER or DISCONTINUED. */
export function closeCapitalObjective(
  session: ApiSession,
  companyId: string,
  capitalObjectiveId: string,
  input: CloseCapitalObjectiveRequest,
) {
  return call(
    session,
    "POST",
    objectivePath(
      companyId,
      capitalObjectiveId,
      CAPITAL_OBJECTIVE_CLOSE_SUFFIX,
    ),
    CapitalObjectiveDtoSchema,
    { body: input },
  );
}

/** `POST .../:capitalObjectiveId/replace` -- returns the new ACTIVE objective; the old one becomes REPLACED. */
export function replaceCapitalObjective(
  session: ApiSession,
  companyId: string,
  capitalObjectiveId: string,
  input: ReplaceCapitalObjectiveRequest,
) {
  return call(
    session,
    "POST",
    objectivePath(
      companyId,
      capitalObjectiveId,
      CAPITAL_OBJECTIVE_REPLACE_SUFFIX,
    ),
    CapitalObjectiveDtoSchema,
    { body: input },
  );
}
