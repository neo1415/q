import {
  ActivateOrganisationResponseSchema,
  CreateOrganisationResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  ListMyOrganisationsResponseSchema,
  ORGANISATIONS_PATH,
  OrganisationDtoSchema,
  type CreateOrganisationRequest,
  type UpdateOrganisationRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

export type { ApiSession } from "./request.js";

/**
 * `POST /v1/organisations`. The idempotency key is client-generated once per
 * intended creation and reused on retry; the server never creates a second
 * workspace for the same key.
 */
export function createOrganisation(
  session: ApiSession,
  input: CreateOrganisationRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    ORGANISATIONS_PATH,
    CreateOrganisationResponseSchema,
    {
      body: input,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** `GET /v1/organisations`: the caller's own active memberships. */
export function listMyOrganisations(
  session: ApiSession,
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
    `${ORGANISATIONS_PATH}${suffix}`,
    ListMyOrganisationsResponseSchema,
  );
}

/** `GET /v1/organisations/:id` -- the current organisation context only. */
export function getOrganisation(session: ApiSession, organisationId: string) {
  return call(
    session,
    "GET",
    `${ORGANISATIONS_PATH}/${encodeURIComponent(organisationId)}`,
    OrganisationDtoSchema,
  );
}

/** `PATCH /v1/organisations/:id` with the version the client read. */
export function updateOrganisation(
  session: ApiSession,
  organisationId: string,
  input: UpdateOrganisationRequest,
) {
  return call(
    session,
    "PATCH",
    `${ORGANISATIONS_PATH}/${encodeURIComponent(organisationId)}`,
    OrganisationDtoSchema,
    { body: input },
  );
}

/** `POST /v1/organisations/:id/activate` -- switch the active context. */
export function activateOrganisation(
  session: ApiSession,
  organisationId: string,
) {
  return call(
    session,
    "POST",
    `${ORGANISATIONS_PATH}/${encodeURIComponent(organisationId)}/activate`,
    ActivateOrganisationResponseSchema,
  );
}
