import { NextResponse } from "next/server";

import { resolveQNavigation } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QFastNavigationRequestSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * RECOVERY-2026-10 (workstream C, "stupid fast"): where the person's
 * finished sentence goes, read by code in the Q API as them. A route, not
 * a server action: server actions run one at a time per tab (audit C-08)
 * and this must not wait behind the run the same sentence started.
 */
export const dynamic = "force-dynamic";

const leave = (status: number) =>
  NextResponse.json(
    { kind: "LEAVE_TO_Q", ms: 0 },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = QFastNavigationRequestSchema.safeParse(body);
  if (!parsed.success) return leave(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return leave(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return leave(401);
  try {
    const decided = await resolveQNavigation(
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
