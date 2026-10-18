import { NextResponse, type NextRequest } from "next/server";

import { getQWorkReportPdf } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * A first-stage interview report as PDF (AUTO, ADR 0030). The Q API holds
 * the bearer token behind an HttpOnly cookie, so the browser cannot call it
 * directly; this route attaches the token for exactly one read. Not a proxy:
 * GET only, two ids checked as UUIDs, one path. The Q API answers only for
 * the person's own delegation; anyone else gets the same 404 as a missing
 * report.
 */

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: {
    readonly params: Promise<{ delegationId: string; laneId: string }>;
  },
): Promise<NextResponse> {
  const { delegationId, laneId } = await context.params;
  if (!UUID.test(delegationId) || !UUID.test(laneId)) {
    return new NextResponse(null, { status: 404 });
  }
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const bytes = await getQWorkReportPdf(
      { baseUrl: qApiBaseUrl, accessToken },
      delegationId,
      laneId,
    );
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="first-stage-report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
