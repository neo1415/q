import { NextResponse, type NextRequest } from "next/server";

import {
  Q_BRAND_KIT_LOGO_SUFFIX,
  Q_BRAND_KIT_PATH,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * A brand kit version's logo, for the Documents page (DOCS). The Q API
 * serves only the actor's own organisation's logo; the session cookie is
 * the only authority this carries.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const version = request.nextUrl.searchParams.get("version") ?? "";
  if (!/^[1-9]\d{0,5}$/.test(version)) {
    return new NextResponse(null, { status: 404 });
  }
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return new NextResponse(null, { status: 401 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(
      `${qApiBaseUrl}${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_LOGO_SUFFIX}?version=${version}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: request.signal,
      },
    );
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (
    !upstream.ok ||
    upstream.body === null ||
    !(type === "image/png" || type === "image/jpeg")
  ) {
    return new NextResponse(null, { status: 404 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
