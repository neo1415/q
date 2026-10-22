import { NextResponse } from "next/server";

import { matchQPitchQa } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QPitchQaMatchRequestSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Q Story ending: tier 2 of a spoken question to the Q&A bank, asked only
 * when the browser's word matcher (tier 1) was not sure. The Q API embeds
 * the question; the provider key never reaches the browser. Any failure is
 * LEAVE_TO_Q: the person then gets normal Q, never an error.
 */
export const dynamic = "force-dynamic";

const leave = (status: number) =>
  NextResponse.json(
    { kind: "LEAVE_TO_Q", tier: 1, ms: 0 },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = QPitchQaMatchRequestSchema.safeParse(body);
  if (!parsed.success) return leave(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return leave(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return leave(401);
  try {
    const decided = await matchQPitchQa(
      { baseUrl: qApiBaseUrl, accessToken },
      parsed.data,
    );
    return NextResponse.json(decided, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return leave(502);
  }
}
