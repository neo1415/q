import { NextResponse } from "next/server";

import { pollQVoiceDuplexNarration } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QVoiceDuplexNarrationRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * ADR 0062: the silence ladder's beats on a duplex line while ask_q works.
 * A route, not a server action: server actions run one at a time per
 * client, and this long poll runs beside the ask_q relay it narrates. The
 * session cookie is the only authority; the Q API answers only the line's
 * own person.
 */
export const dynamic = "force-dynamic";

const idle = (status: number) =>
  NextResponse.json(
    { beats: [], idle: true },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(
  request: Request,
  context: { params: Promise<{ voiceSessionId: string }> },
): Promise<NextResponse> {
  const id = UuidSchema.safeParse((await context.params).voiceSessionId);
  let raw: unknown = null;
  try {
    raw = await request.json();
  } catch {
    return idle(400);
  }
  const body = QVoiceDuplexNarrationRequestSchema.safeParse(raw);
  if (!id.success || !body.success) return idle(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return idle(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return idle(401);
  try {
    const result = await pollQVoiceDuplexNarration(
      { baseUrl: qApiBaseUrl, accessToken },
      id.data,
      body.data,
    );
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return idle(502);
  }
}
