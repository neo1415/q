import { NextResponse, type NextRequest } from "next/server";

import {
  LAST_EVENT_ID_HEADER,
  Q_RUN_EVENTS_SUFFIX,
  Q_RUNS_PATH,
  Q_SSE_CONTENT_TYPE,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The Q run stream, reachable from the browser (CQ-C5-R1 §13, §16).
 *
 * The Q API authenticates with a bearer token, and Capital Q keeps that
 * token in an HttpOnly cookie precisely so no script can read it. Those two
 * facts are why this route exists: the browser cannot call the Q API
 * directly, so the token is attached here, on the server, for one specific
 * request that this file can describe in a sentence.
 *
 * It is deliberately not a proxy to the Q API. There is no catch-all, no
 * method but GET, and no path but one run's event stream: everything else a
 * client needs — starting a run, adding a turn, cancelling — goes through
 * the server actions, which validate their own arguments. A general
 * forwarder would hand the browser the Q API's whole surface under the
 * session's authority, which is the shortcut §34 exists to refuse.
 *
 * What is forwarded: the run id, and `Last-Event-ID` so a reconnect resumes
 * from the client's cursor. What is not: any header the browser sent,
 * including its own `Authorization`. Authority here is the session cookie,
 * verified server-side; a header from a script is input, never proof.
 *
 * The Q API still authorises the run against the resolved actor, so this
 * route grants nothing. It is transport.
 */

export const dynamic = "force-dynamic";

/** Bounded: the header is a cursor, and a cursor is a small integer. */
function lastEventId(request: NextRequest): string | null {
  const raw =
    request.headers.get(LAST_EVENT_ID_HEADER) ??
    request.nextUrl.searchParams.get("lastEventId");
  if (raw === null) {
    return null;
  }
  return /^\d{1,19}$/.test(raw) ? raw : null;
}

function plain(status: number, message: string): NextResponse {
  const response = NextResponse.json({ message }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ readonly runId: string }> },
): Promise<NextResponse | Response> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return plain(503, "Q isn't connected on this build yet.");
  }

  const { runId } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      runId,
    )
  ) {
    return plain(404, "I couldn't find that conversation.");
  }

  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Please sign in again to continue.");
  }

  const cursor = lastEventId(request);
  let upstream: Response;
  try {
    upstream = await fetch(
      `${qApiBaseUrl}${Q_RUNS_PATH}/${encodeURIComponent(runId)}${Q_RUN_EVENTS_SUFFIX}`,
      {
        method: "GET",
        headers: {
          accept: Q_SSE_CONTENT_TYPE,
          authorization: `Bearer ${accessToken}`,
          ...(cursor === null ? {} : { [LAST_EVENT_ID_HEADER]: cursor }),
        },
        cache: "no-store",
        // The client's abort must reach the Q API, or a closed tab would
        // leave a stream open on the service.
        signal: request.signal,
      },
    );
  } catch {
    return plain(502, "I lost the connection to Q. Please try again.");
  }

  if (!upstream.ok || upstream.body === null) {
    // The upstream problem document is server-authored, but it describes the
    // Q API to an operator, not this person. One plain sentence per class.
    if (upstream.status === 401 || upstream.status === 403) {
      return plain(401, "Please sign in again to continue.");
    }
    if (upstream.status === 404) {
      return plain(404, "I couldn't find that conversation.");
    }
    return plain(502, "I couldn't follow that answer. Please try again.");
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? Q_SSE_CONTENT_TYPE,
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Proxies that buffer would defeat the point of a stream.
      "x-accel-buffering": "no",
    },
  });
}
