import type { z } from "zod";

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

/**
 * One typed request: bearer token, optional organisation selector, JSON
 * body, problem-details failure, schema-validated success. Raw bodies are
 * never retained and never rendered.
 */
export async function call<TSchema extends z.ZodType>(
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
