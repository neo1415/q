import { accessTokenFor } from "./auth.js";
import { API_URL, Q_API_URL } from "./stack.js";

/**
 * API-level calls as a signed-in person (their own bearer token, never a
 * service credential). Used by permission-negative and promise backend
 * steps: what the server allows is the authority, not what the UI hides.
 */
export type Service = "api" | "q-api";

const tokens = new Map<string, Promise<string>>();

export function tokenFor(email: string): Promise<string> {
  let token = tokens.get(email);
  if (token === undefined) {
    token = accessTokenFor(email);
    tokens.set(email, token);
  }
  return token;
}

export type Reply = {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
};

export async function call(
  email: string | null,
  service: Service,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const base = service === "api" ? API_URL : Q_API_URL;
  const headers: Record<string, string> = { accept: "application/json" };
  if (email !== null)
    headers["authorization"] = `Bearer ${await tokenFor(email)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: parseOrNull(text), text };
}

function parseOrNull(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A refusal is 401/403/404 (problem details), never a 2xx carrying data. */
export function isRefusal(reply: Reply): boolean {
  return reply.status === 401 || reply.status === 403 || reply.status === 404;
}
