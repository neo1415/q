import { NextResponse } from "next/server";

import { reportQUiActs } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QUiActReceiptsRequestSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * RECOVERY-2026-10 (workstream C): the receipts of Q's UI acts, from the
 * person's screen to the Q API. A route, not a server action: server
 * actions run one at a time per client (audit C-08), and a receipt must
 * not wait behind a voice relay or a run. The session cookie is the only
 * authority; the Q API keys the receipts by the person it resolves.
 */
export const dynamic = "force-dynamic";

const answer = (status: number, accepted = 0) =>
  NextResponse.json(
    { accepted },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = QUiActReceiptsRequestSchema.safeParse(body);
  if (!parsed.success) return answer(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return answer(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return answer(401);
  try {
    const result = await reportQUiActs(
      { baseUrl: qApiBaseUrl, accessToken },
      parsed.data,
    );
    return answer(200, result.accepted);
  } catch {
    return answer(502);
  }
}
