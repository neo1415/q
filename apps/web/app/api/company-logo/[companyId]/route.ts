import { NextResponse, type NextRequest } from "next/server";

import { getCompanyProfileLogo } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";
import { noPicture } from "@/features/entity/no-picture";

/**
 * A company's logo from its own website (artifacts live, owner
 * 2026-10-20), for an avatar whose company has no photo.
 *
 * The same shape as the photo route: the token rides this one read, the
 * API decides whether this person may see the company and reads only the
 * website on its record, and the answer is a redirect to a public https
 * image on that site, never a proxy. Every "no" is the same 404, kept
 * briefly so a list does not ask again, and the avatar shows initials.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(kept = false): NextResponse {
  // Re-test #3 (2026-10-28): a 1x1 placeholder, never a 404 in the
  // console; the avatar reads it as no picture.
  return noPicture(kept ? "private, max-age=3600" : "private, no-store");
}

export async function GET(
  _request: NextRequest,
  context: { readonly params: Promise<{ readonly companyId: string }> },
): Promise<NextResponse> {
  const { companyId } = await context.params;
  if (!UUID.test(companyId)) return notFound();
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (apiBaseUrl === undefined || accessToken === null) return notFound();

  const logo = await getCompanyProfileLogo(
    { baseUrl: apiBaseUrl, accessToken },
    companyId,
  ).catch(() => null);
  const target = logo?.logoUrl ?? null;
  if (target === null || URL.parse(target)?.protocol !== "https:") {
    // Only the API's own answer is kept: a read that failed asks again.
    return notFound(logo !== null);
  }
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: target,
      // A public logo on the company's own site: an hour in this browser.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
