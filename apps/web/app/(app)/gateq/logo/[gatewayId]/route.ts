import { getGatewayAppearanceLogo } from "@capital-q/api-client";

import { servedLogo } from "@/features/gateq/served-logo";
import { apiSession } from "@/features/q/context";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });

/**
 * The gateway's saved logo for its own people, whatever its status (live
 * defect 2026-11-14: the settings preview drew it from the public route,
 * which is 404 while paused, so a saved logo showed broken). The token
 * rides this one read and the API decides (investor.gateway.view); the
 * public /g/:publicId/logo stays 404 for a paused gateway. Re-checked and
 * served exactly as the public route serves it, but never shared-cached.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly gatewayId: string }> },
): Promise<Response> {
  const { gatewayId } = await params;
  const session = await apiSession();
  if (session === null || !UUID.test(gatewayId)) return NOT_FOUND();
  const logo = await getGatewayAppearanceLogo(session, gatewayId).catch(
    () => null,
  );
  if (logo === null) return NOT_FOUND();
  return (
    servedLogo(logo.contentType, logo.bytes, "private, no-store") ??
    NOT_FOUND()
  );
}
