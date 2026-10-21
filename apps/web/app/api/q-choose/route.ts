import { NextResponse } from "next/server";

import { chooseQNavigation } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QNavigationChooseRequestSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Lane 7: the tie-break for a pointing request ("open their deck"), read
 * in the Q API as the person. A route, not a server action, for the same
 * reason as /api/q-navigate: it must not wait behind the sentence's run.
 */
export const dynamic = "force-dynamic";

const none = (status: number) =>
  NextResponse.json(
    { kind: "NONE", allowed: [], ms: 0 },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = QNavigationChooseRequestSchema.safeParse(body);
  if (!parsed.success) return none(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return none(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return none(401);
  try {
    const decided = await chooseQNavigation(
      { baseUrl: qApiBaseUrl, accessToken },
      parsed.data,
    );
    return NextResponse.json(decided, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return none(502);
  }
}
