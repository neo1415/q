import { NextResponse } from "next/server";

import { ApiProblemError, getWorkforceJobLive } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Owner 2026-10-24: where a document Q is making stands, for the card that
 * follows it in the conversation. A GET the card polls while the work runs
 * (server actions queue one at a time per client; a poll must not). The
 * session cookie is the only authority; the Q API answers only for the
 * person's own job, and anyone else's id is the same 404.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params;
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined)
    return NextResponse.json(null, { status: 503, headers: NO_STORE });
  const accessToken = await getSessionAccessToken();
  if (accessToken === null)
    return NextResponse.json(null, { status: 401, headers: NO_STORE });
  try {
    const live = await getWorkforceJobLive(
      { baseUrl: qApiBaseUrl, accessToken },
      jobId,
    );
    return NextResponse.json(live, { headers: NO_STORE });
  } catch (error: unknown) {
    return NextResponse.json(null, {
      status:
        error instanceof ApiProblemError && error.status === 404 ? 404 : 502,
      headers: NO_STORE,
    });
  }
}
