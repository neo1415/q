/**
 * The one door to Google (BIZ-007). Every provider request goes through an
 * injected `GoogleHttp`, so tests hand in a fake and nothing in a test run
 * can reach a Google host. Production passes the platform `fetch`.
 *
 * A provider failure becomes a `GoogleProviderError` with a stable code and
 * the HTTP status only: never the response body, never a request header,
 * so a token cannot travel inside an error into a log.
 */

export type GoogleHttpRequest = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type GoogleHttpResponse = {
  readonly status: number;
  readonly json: () => Promise<unknown>;
};

export type GoogleHttp = (
  url: string,
  request: GoogleHttpRequest,
) => Promise<GoogleHttpResponse>;

export const platformGoogleHttp: GoogleHttp = async (url, request) => {
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: request.signal ?? AbortSignal.timeout(15_000),
  });
  return { status: response.status, json: () => response.json() };
};

export type GoogleProviderErrorCode =
  | "INVALID_GRANT"
  | "UNAUTHORIZED"
  | "HISTORY_EXPIRED"
  | "RATE_LIMITED"
  | "REJECTED"
  | "UNAVAILABLE"
  | "MALFORMED_RESPONSE";

export class GoogleProviderError extends Error {
  readonly code: GoogleProviderErrorCode;
  readonly status: number | null;
  /** Whether trying again later could succeed. */
  readonly retryable: boolean;

  constructor(code: GoogleProviderErrorCode, status: number | null) {
    super(
      `google provider ${code}${status === null ? "" : ` (${String(status)})`}`,
    );
    this.name = "GoogleProviderError";
    this.code = code;
    this.status = status;
    this.retryable =
      code === "RATE_LIMITED" ||
      code === "UNAVAILABLE" ||
      code === "UNAUTHORIZED";
  }
}

export function errorForStatus(status: number): GoogleProviderError {
  if (status === 401) return new GoogleProviderError("UNAUTHORIZED", status);
  if (status === 404) return new GoogleProviderError("HISTORY_EXPIRED", status);
  if (status === 429) return new GoogleProviderError("RATE_LIMITED", status);
  if (status >= 500) return new GoogleProviderError("UNAVAILABLE", status);
  return new GoogleProviderError("REJECTED", status);
}

/** A network failure (no response at all) is unavailable, never success. */
export async function send(
  http: GoogleHttp,
  url: string,
  request: GoogleHttpRequest,
): Promise<GoogleHttpResponse> {
  try {
    return await http(url, request);
  } catch {
    throw new GoogleProviderError("UNAVAILABLE", null);
  }
}

export async function readJson(response: GoogleHttpResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
  }
}
