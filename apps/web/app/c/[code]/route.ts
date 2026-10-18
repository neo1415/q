import { NextResponse } from "next/server";

import { ApiProblemError, resolveCardCode } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

export const dynamic = "force-dynamic";

/**
 * `/c/<code>` (BIZ-004): the short first-party redirect a Q Card's QR
 * encodes. A temporary redirect on purpose -- the target changes when the
 * handle does, and a revoked code must stop working rather than live on in
 * a browser's permanent-redirect cache. The API counts the scan, first
 * party and aggregate only; nothing about the scanner is recorded here.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly code: string }> },
) {
  const { code } = await params;
  const { apiBaseUrl, auth } = loadWebServerConfig();
  const notFound = new NextResponse("This card link isn't active.", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });
  if (apiBaseUrl === undefined || !/^[a-z0-9]{10}$/.test(code)) {
    return notFound;
  }
  try {
    const { handle } = await resolveCardCode({ baseUrl: apiBaseUrl }, code);
    const response = NextResponse.redirect(`${auth.appOrigin}/@${handle}`, 302);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
    return response;
  } catch (error) {
    if (error instanceof ApiProblemError && error.status === 404) {
      return notFound;
    }
    throw error;
  }
}
