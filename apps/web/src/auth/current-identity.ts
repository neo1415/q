import "server-only";

import { fetchMe } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { MeResponse } from "@capital-q/contracts";

import { getSessionAccessToken } from "./session";

/**
 * The application's answer to "who is this person and where are they
 * acting?" -- `GET /v1/me`, called server-to-server with the session's access
 * token. The API verifies the token again and resolves the Person and any
 * organisation context from the database; the web app displays the result
 * and asserts nothing of its own.
 *
 * Honest about absence: when the API is not configured for this deployment
 * or cannot be reached, the surface says so rather than inventing a context.
 */
export type CurrentIdentity =
  | { readonly status: "AVAILABLE"; readonly me: MeResponse }
  | { readonly status: "NOT_CONFIGURED" }
  | { readonly status: "UNAVAILABLE" };

export async function getCurrentIdentity(): Promise<CurrentIdentity> {
  const { apiBaseUrl } = loadWebServerConfig();

  if (apiBaseUrl === undefined) {
    return { status: "NOT_CONFIGURED" };
  }

  const accessToken = await getSessionAccessToken();

  if (accessToken === null) {
    return { status: "UNAVAILABLE" };
  }

  try {
    const me = await fetchMe({ baseUrl: apiBaseUrl, accessToken });
    return { status: "AVAILABLE", me };
  } catch {
    // A problem response or a network failure. Nothing from it is rendered.
    return { status: "UNAVAILABLE" };
  }
}
