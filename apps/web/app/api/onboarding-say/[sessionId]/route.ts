import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  IDEMPOTENCY_KEY_HEADER,
  ONBOARDING_PATH,
  ONBOARDING_SAY_SEGMENT,
  ONBOARDING_SESSIONS_SEGMENT,
  OnboardingStepKeySchema,
  Q_SSE_CONTENT_TYPE,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * One typed onboarding turn, streamed (turn latency 2026-10-21, L9).
 *
 * The same request the `onboardingSayAction` server action makes, for one
 * reason: a server action returns only when the turn is over, so Q's reply
 * appeared all at once, seconds after Q had written its first sentence.
 * Here the API's event stream comes straight through, so the screen shows
 * each sentence as Q finishes it.
 *
 * Not a proxy: one method, one path, a validated body, and nothing the
 * browser sent forwarded except those words. Authority is the session
 * cookie, read server-side; the API authorises the session itself.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const SayBody = z
  .object({
    text: z.string().trim().max(2000),
    expectedSessionVersion: z.number().int().min(0),
    idempotencyKey: z.string().regex(UUID),
    recentTurns: z
      .array(
        z
          .object({
            role: z.enum(["person", "q"]),
            text: z.string().max(1500),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    focus: z
      .string()
      .regex(/^[a-z][a-z_]{0,39}$/u)
      .optional(),
    // The review whose confirm button they tapped (sweep D1).
    confirmReview: OnboardingStepKeySchema.optional(),
  })
  .strict();

function plain(status: number, message: string): NextResponse {
  const response = NextResponse.json({ message }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(
  request: NextRequest,
  context: { readonly params: Promise<{ readonly sessionId: string }> },
): Promise<NextResponse | Response> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) {
    return plain(503, "Setup isn't available right now. Try again later.");
  }
  const { sessionId } = await context.params;
  if (!UUID.test(sessionId)) {
    return plain(404, "I couldn't find that setup.");
  }
  const raw: unknown = await request.json().catch(() => null);
  const body = SayBody.safeParse(raw);
  if (!body.success) {
    return plain(400, "That message couldn't be sent. Try again.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Your session ended. Sign in again to continue.");
  }
  const { idempotencyKey, ...say } = body.data;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBaseUrl}${ONBOARDING_PATH}${ONBOARDING_SESSIONS_SEGMENT}/${encodeURIComponent(sessionId)}${ONBOARDING_SAY_SEGMENT}`,
      {
        method: "POST",
        headers: {
          accept: Q_SSE_CONTENT_TYPE,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        },
        body: JSON.stringify(say),
        cache: "no-store",
        signal: request.signal,
      },
    );
  } catch {
    return plain(502, "I lost the connection to Q. Try again.");
  }

  if (!upstream.ok || upstream.body === null) {
    // The problem document passes through: the screen's existing reading
    // of a refused turn (a conflict, a paused account) needs its code.
    const problem: unknown = await upstream.json().catch(() => null);
    const response = NextResponse.json(problem ?? {}, {
      status: upstream.status === 200 ? 502 : upstream.status,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? Q_SSE_CONTENT_TYPE,
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
