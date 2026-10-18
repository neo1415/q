import { NextResponse, type NextRequest } from "next/server";

import { qDailyEditionPdfPath } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The Q Daily's PDF edition (DAILY spec §3). Same reason as the artifact
 * download route: the Q API takes a bearer token Capital Q keeps in an
 * HttpOnly cookie, so the token is attached here, on the server, for this
 * one request. GET only, one edition id; the Q API reads the edition as
 * the session's own actor, so this route grants nothing.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plain(status: number, message: string): NextResponse {
  const response = NextResponse.json({ message }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ readonly editionId: string }> },
): Promise<NextResponse | Response> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return plain(503, "Q isn't available right now. Try again later.");
  }
  const { editionId } = await context.params;
  if (!UUID.test(editionId)) {
    return plain(404, "That edition isn't in your archive.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Your session ended. Sign in again to continue.");
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${qApiBaseUrl}${qDailyEditionPdfPath(editionId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return plain(502, "The PDF couldn't be prepared. Try again.");
  }
  if (!upstream.ok || upstream.body === null) {
    if (upstream.status === 401 || upstream.status === 403) {
      return plain(401, "Your session ended. Sign in again to continue.");
    }
    if (upstream.status === 404) {
      return plain(404, "That edition isn't in your archive.");
    }
    return plain(502, "The PDF couldn't be prepared. Try again.");
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition":
        upstream.headers.get("content-disposition") ??
        'attachment; filename="The-Q-Daily.pdf"',
    },
  });
}
