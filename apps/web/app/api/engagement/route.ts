import { NextResponse } from "next/server";

import { recordEngagement } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { RecordEngagementBatchRequestSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Q Workspace §8 A1: engagement batches from the person's screen to the
 * API. A route, not a server action (audit C-08: server actions queue per
 * client), so a batch sent as the page closes never waits. The session
 * cookie is the only authority; the API resolves the viewer and the
 * database stamps their privacy level. Analytics may be lost: every
 * failure answers quietly.
 */
export const dynamic = "force-dynamic";

const answer = (status: number) =>
  new NextResponse(null, {
    status,
    headers: { "cache-control": "no-store" },
  });

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RecordEngagementBatchRequestSchema.safeParse(body);
  if (!parsed.success) return answer(400);
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return answer(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return answer(401);
  try {
    await recordEngagement({ baseUrl: apiBaseUrl, accessToken }, parsed.data);
    return answer(202);
  } catch {
    return answer(502);
  }
}
