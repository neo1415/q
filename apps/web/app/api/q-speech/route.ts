import { NextResponse, type NextRequest } from "next/server";

import {
  CreateQSpeechRequestSchema,
  Q_SPEECH_MAX_BYTES,
  Q_SPEECH_MEDIA_TYPE,
  Q_VOICE_SPEECH_PATH,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Q reading one line aloud, reachable from the browser
 * (Q-FIRST-RUN-TTS-001).
 *
 * The same shape, and the same reasoning, as the run-stream route next
 * door: the Q API authenticates with a bearer token, Capital Q keeps that
 * token in an HttpOnly cookie precisely so no script can read it, and so
 * the token is attached here, on the server, for one request this file
 * can describe in a sentence. It is not a proxy to the Q API — one
 * method, one path, one body shape — and it grants nothing, because the Q
 * API authorises against the actor it resolves for itself.
 *
 * The body is parsed against the same public contract the Q API will
 * parse it against, so a request that could not succeed never leaves this
 * process. Audio comes back as bytes; it is this person's own and no
 * shared cache's to keep.
 */

export const dynamic = "force-dynamic";

function plain(status: number, message: string): NextResponse {
  const response = NextResponse.json({ message }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest): Promise<Response> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return plain(503, "Q isn't connected on this build yet.");
  }

  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Please sign in again to continue.");
  }

  // External data starts as unknown, including a body this application's
  // own script sent: a script is input, never proof.
  const body: unknown = await request.json().catch(() => null);
  const parsed = CreateQSpeechRequestSchema.safeParse(body);
  if (!parsed.success) {
    return plain(422, "Q can't read that out.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${qApiBaseUrl}${Q_VOICE_SPEECH_PATH}`, {
      method: "POST",
      headers: {
        accept: Q_SPEECH_MEDIA_TYPE,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return plain(503, "Q can't speak right now.");
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      return plain(401, "Please sign in again to continue.");
    }
    if (upstream.status === 429) {
      return plain(429, "That is more speech than Q will read out just now.");
    }
    // Every other class is the same thing to a listener: no audio, and
    // the words are still on the screen.
    return plain(503, "Q can't speak right now.");
  }

  const audio = await upstream.arrayBuffer().catch(() => null);
  if (
    audio === null ||
    audio.byteLength === 0 ||
    audio.byteLength > Q_SPEECH_MAX_BYTES
  ) {
    return plain(503, "Q can't speak right now.");
  }

  return new Response(audio, {
    status: 200,
    headers: {
      "content-type": Q_SPEECH_MEDIA_TYPE,
      "cache-control": "no-store",
      "content-length": String(audio.byteLength),
    },
  });
}
