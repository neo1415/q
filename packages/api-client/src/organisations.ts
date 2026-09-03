import type { z } from "zod";

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

import {
  ApiProblemError,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "./problem.js";

/**
 * The authenticated call context: where the API is, the session's access
 * token, and optionally which organisation the caller wants to act for.
 * The organisation selector is a request, never authority -- the server
 * confirms membership on every call.
 */
export type ApiSession = {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly organisationId?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
};

async function call<TSchema extends z.ZodType>(
  session: ApiSession,
  method: "GET" | "POST" | "PATCH",
  path: string,
  schema: TSchema,
  options: {
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>> | undefined;
  } = {},
): Promise<z.infer<TSchema>> {
  const doFetch = session.fetch ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${session.accessToken}`,
    ...(session.organisationId === undefined
      ? {}
      : { "x-organisation-id": session.organisationId }),
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${path}`,
    {
      method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw await readProblemResponse(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiProblemError(
      "The API returned an unreadable response.",
      response.status,
      UNEXPECTED_API_RESPONSE,
      response.headers.get("x-request-id") ?? undefined,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiProblemError(
      "The API returned an unexpected response.",
      response.status,
      UNEXPECTED_API_RESPONSE,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  return parsed.data;
}

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
