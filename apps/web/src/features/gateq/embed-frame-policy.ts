import { NextResponse, type NextRequest } from "next/server";

import { getPublicGateway } from "@capital-q/api-client";
import { GatewayEmbedOriginSchema } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

/**
 * B7 (2026-11-14): who may frame a gateway's embed (`/g/:publicId/embed`).
 *
 * The organisation lists its own sites on the Gateway page; the public
 * gateway answer carries them. None listed: any site may, as before. The
 * header is built here, per request, because it depends on the gateway
 * (next.config headers are static). Every origin is re-checked against
 * the one stored spelling before it reaches the header, so nothing but an
 * origin can be written into it.
 *
 * When the gateway cannot be read (unknown, paused, the API slow or down)
 * the embed may be framed only by Capital Q itself: the page would show
 * nothing to apply to anyway, and an allowlist must never fail open.
 */

const EMBED_PATH = /^\/g\/([A-Za-z0-9_-]{4,64})\/embed\/?$/u;
const LOOKUP_TIMEOUT_MS = 3_000;

export function isGatewayEmbedPath(pathname: string): boolean {
  return EMBED_PATH.test(pathname);
}

/** The CSP directive for a gateway's embed; null origins: unreadable gateway. */
export function frameAncestorsFor(
  origins: readonly string[] | null | undefined,
): string {
  if (origins === null) return "frame-ancestors 'self'";
  const safe = (origins ?? []).filter(
    (origin) => GatewayEmbedOriginSchema.safeParse(origin).success,
  );
  // A list whose entries are all unusable is still a list: never "any site".
  if (safe.length === 0 && (origins ?? []).length > 0) {
    return "frame-ancestors 'self'";
  }
  return safe.length === 0
    ? "frame-ancestors *"
    : `frame-ancestors 'self' ${safe.join(" ")}`;
}

async function embedOriginsOf(
  publicId: string,
): Promise<readonly string[] | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return null;
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS),
  );
  const read = getPublicGateway(apiBaseUrl, publicId)
    .then((gateway) => gateway.embedOrigins ?? [])
    .catch(() => null);
  return Promise.race([read, timeout]);
}

export async function handleGatewayEmbedProxy(
  request: NextRequest,
): Promise<NextResponse> {
  const publicId = EMBED_PATH.exec(request.nextUrl.pathname)?.[1];
  const origins =
    publicId === undefined ? null : await embedOriginsOf(publicId);
  const response = NextResponse.next({ request });
  response.headers.set("Content-Security-Policy", frameAncestorsFor(origins));
  return response;
}
