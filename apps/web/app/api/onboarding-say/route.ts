import { NextResponse } from "next/server";

import {
  Q_INTERVIEW_PATH,
  Q_INTERVIEW_STREAM_CONTENT_TYPE,
  Q_INTERVIEW_TURN_STREAM_SEGMENT,
  QInterviewStreamRequestSchema,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * One typed onboarding turn, streamed (onboarding speed 2026-10-20, L9).
 *
 * The typed screen used to wait for the whole turn, behind a server action
 * (actions run one at a time per tab), before showing a word of Q's reply.
 * This route carries the same turn to the same interviewer and streams
 * Q's sentences back as they are written, then the settled turn.
 *
 * Like the Q run stream, it exists because the bearer lives in an HttpOnly
 * cookie: it is attached here, for this one request, and nothing the
 * browser sent is forwarded but the validated body. It is not a proxy:
 * one method, one upstream path. The interviewer reads and writes the
 * onboarding session under the person's own bearer, and the onboarding
 * API checks the session is theirs, so this route grants nothing.
 * Only JSON from this site's own pages is accepted.
 */
export const dynamic = "force-dynamic";

function plain(status: number, message: string): NextResponse {
  return NextResponse.json(
    { message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return plain(403, "That request isn't allowed.");
  if (!(request.headers.get("content-type") ?? "").includes("application/json"))
    return plain(415, "That request isn't allowed.");
  const body: unknown = await request.json().catch(() => null);
  const input = QInterviewStreamRequestSchema.safeParse(body);
  if (!input.success) return plain(400, "That message couldn't be sent.");

  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return plain(503, "Q isn't available right now. Try again later.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Your session ended. Sign in again to continue.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${qApiBaseUrl}${Q_INTERVIEW_PATH}${Q_INTERVIEW_TURN_STREAM_SEGMENT}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: Q_INTERVIEW_STREAM_CONTENT_TYPE,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input.data),
        cache: "no-store",
        // A closed tab closes the stream; the interviewer still finishes
        // the turn, so what they sent is saved either way.
        signal: request.signal,
      },
    );
  } catch {
    return plain(502, "I lost the connection to Q. Try again.");
  }
  if (!upstream.ok || upstream.body === null) {
    if (upstream.status === 401 || upstream.status === 403) {
      return plain(401, "Your session ended. Sign in again to continue.");
    }
    if (upstream.status === 404) {
      return plain(404, "I couldn't find that setup.");
    }
    return plain(502, "Q couldn't answer that just now. Try again.");
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": Q_INTERVIEW_STREAM_CONTENT_TYPE,
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
