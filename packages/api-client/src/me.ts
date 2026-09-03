import {
  ME_PATH,
  MeResponseSchema,
  type MeResponse,
} from "@capital-q/contracts";

import {
  ApiProblemError,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "./problem.js";

/**
 * `GET /v1/me`.
 *
 * The caller supplies the verified session's access token; the API verifies
 * it again with the Auth server and resolves identity and context on its own.
 * The token travels as a bearer credential over a server-to-server call from
 * the web app -- never from a browser, and never stored by this client.
 */
export type FetchMeInput = {
  readonly baseUrl: string;
  readonly accessToken: string;
  /** Untrusted selector: which organisation the caller wants to act for. */
  readonly organisationId?: string | undefined;
  /** Injected for tests. Defaults to the global fetch. */
  readonly fetch?: typeof fetch | undefined;
};

export async function fetchMe(input: FetchMeInput): Promise<MeResponse> {
  const doFetch = input.fetch ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${input.accessToken}`,
  };
  if (input.organisationId !== undefined) {
    headers["x-organisation-id"] = input.organisationId;
  }

  const response = await doFetch(
    `${stripTrailingSlash(input.baseUrl)}${ME_PATH}`,
    {
      method: "GET",
      headers,
      // A session-dependent response is never cacheable.
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

  const parsed = MeResponseSchema.safeParse(body);
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

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
