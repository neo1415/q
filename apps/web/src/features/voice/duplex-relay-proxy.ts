import "server-only";

import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QVoiceDuplexAttachSchema,
  QVoiceDuplexEndSchema,
  QVoiceDuplexHeardResultSchema,
  QVoiceDuplexHeardSchema,
  QVoiceDuplexRejoinResultSchema,
  QVoiceDuplexRejoinSchema,
  QVoiceDuplexSaidSchema,
  QVoiceDuplexToolCallSchema,
  QVoiceDuplexToolResultSchema,
  QVoiceDuplexTurnReportSchema,
  QVoiceDuplexUsageReportSchema,
  QVoiceDuplexUsageResultSchema,
  UuidSchema,
  qVoiceDuplexAttachPath,
  qVoiceDuplexEndPath,
  qVoiceDuplexHeardPath,
  qVoiceDuplexOutcomePath,
  qVoiceDuplexRejoinPath,
  qVoiceDuplexSaidPath,
  qVoiceDuplexToolPath,
  qVoiceDuplexUsagePath,
} from "@capital-q/contracts";
import type { z } from "zod";

import { getSessionAccessToken } from "@/auth/session";

/**
 * RECOVERY A8 (C-08): the duplex line's relays as one route handler, not
 * server actions. Next.js runs server actions one at a time per client, so
 * `heard` (which holds for a whole ask_q) queued the 1.5 s turn poll,
 * usage reports, `said` and rejoins behind it. A route handler is a plain
 * fetch: relays run side by side.
 *
 * The person's own session is the only authority, as before; the body is
 * validated against the contract here and again by the Q API; the reply
 * is validated before it reaches the browser. The sealed voice session
 * token is passed through (A11) so any Q API instance can adopt the line.
 */

const SESSION_TOKEN_HEADER = "x-q-voice-session";
const SESSION_TOKEN_MAX = 8192;

type Relay = {
  readonly path: (id: string) => string;
  readonly body: z.ZodType;
  /** Null: the Q API answers 204 and so does this. */
  readonly result: z.ZodType | null;
};

const RELAYS: Readonly<Record<string, Relay>> = {
  tool: {
    path: qVoiceDuplexToolPath,
    body: QVoiceDuplexToolCallSchema,
    result: QVoiceDuplexToolResultSchema,
  },
  heard: {
    path: qVoiceDuplexHeardPath,
    body: QVoiceDuplexHeardSchema,
    result: QVoiceDuplexHeardResultSchema,
  },
  said: {
    path: qVoiceDuplexSaidPath,
    body: QVoiceDuplexSaidSchema,
    result: null,
  },
  usage: {
    path: qVoiceDuplexUsagePath,
    body: QVoiceDuplexUsageReportSchema,
    result: QVoiceDuplexUsageResultSchema,
  },
  rejoin: {
    path: qVoiceDuplexRejoinPath,
    body: QVoiceDuplexRejoinSchema,
    result: QVoiceDuplexRejoinResultSchema,
  },
  end: { path: qVoiceDuplexEndPath, body: QVoiceDuplexEndSchema, result: null },
  outcome: {
    path: qVoiceDuplexOutcomePath,
    body: QVoiceDuplexTurnReportSchema,
    result: null,
  },
  attach: {
    path: qVoiceDuplexAttachPath,
    body: QVoiceDuplexAttachSchema,
    result: null,
  },
};

const problem = (status: number) =>
  Response.json(
    { type: "about:blank", title: "Voice relay", status },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function relayDuplex(
  request: Request,
  params: { readonly voiceSessionId: string; readonly relay: string },
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const relay = Object.hasOwn(RELAYS, params.relay)
    ? RELAYS[params.relay]
    : undefined;
  const id = UuidSchema.safeParse(params.voiceSessionId);
  if (relay === undefined || !id.success) return problem(404);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return problem(400);
  }
  const body = relay.body.safeParse(raw);
  if (!body.success) return problem(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return problem(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return problem(401);
  const token = request.headers.get(SESSION_TOKEN_HEADER);
  let upstream: Response;
  try {
    upstream = await doFetch(
      `${qApiBaseUrl.replace(/\/$/, "")}${relay.path(id.data)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          ...(token !== null &&
          token.length > 0 &&
          token.length <= SESSION_TOKEN_MAX
            ? { [SESSION_TOKEN_HEADER]: token }
            : {}),
        },
        body: JSON.stringify(body.data),
        cache: "no-store",
        // The browser letting go (a barge-in, a closed tab) stops the turn.
        signal: request.signal,
      },
    );
  } catch {
    return problem(502);
  }
  // 404 is "the line is gone" to the browser; anything else is a failure.
  if (!upstream.ok) return problem(upstream.status === 404 ? 404 : 502);
  if (relay.result === null) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  let result: unknown;
  try {
    result = await upstream.json();
  } catch {
    return problem(502);
  }
  const parsed = relay.result.safeParse(result);
  if (!parsed.success) return problem(502);
  return Response.json(parsed.data, {
    headers: { "cache-control": "no-store" },
  });
}
