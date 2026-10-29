import { NextResponse, type NextRequest } from "next/server";

import { getDiscoveredInvestorPhoto } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";
import { noPicture } from "@/features/entity/no-picture";

/**
 * An investor organisation's logo where a page knows the investor only by
 * id (a Q investor reference), the twin of the company photo route.
 *
 * An <img> can send only cookies, and the API takes a bearer token kept in
 * an HttpOnly cookie, so the token is attached here for this one read. It
 * is a redirect, never a proxy: the browser then fetches the photo straight
 * from private storage on the short-lived signed URL the API minted. The
 * API decides whether this person may see the investor's name (founder
 * decision 2026-10-04: the logo has the name's scope); every "no" is the
 * same 404, and the avatar keeps its initials.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(kept = false): NextResponse {
  // Re-test #3 (2026-10-28): a 1x1 placeholder, never a 404 in the
  // console; the avatar reads it as no picture.
  // Perf lane 2026-10-16: the API's answer "no photo for you" is kept
  // briefly in this browser, like a photo's redirect, so every list and
  // page view does not ask again (hosted: ten 404s per Pipeline view).
  // A missing session or a malformed id is never kept.
  return noPicture(kept ? "private, max-age=300" : "private, no-store");
}

export async function GET(
  _request: NextRequest,
  context: {
    readonly params: Promise<{ readonly investorOrganisationId: string }>;
  },
): Promise<NextResponse> {
  const { investorOrganisationId } = await context.params;
  if (!UUID.test(investorOrganisationId)) return notFound();
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (apiBaseUrl === undefined || accessToken === null) return notFound();

  const photo = await getDiscoveredInvestorPhoto(
    { baseUrl: apiBaseUrl, accessToken },
    investorOrganisationId,
  ).catch(() => null);
  const target = photo?.photoUrl ?? null;
  // Only a web URL is ever a redirect target (a local stack's storage is
  // plain http); anything else is no photo.
  const protocol = target === null ? null : URL.parse(target)?.protocol;
  if (target === null || (protocol !== "https:" && protocol !== "http:")) {
    // Only the API's own answer is kept: a read that failed asks again.
    return notFound(photo !== null);
  }
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: target,
      // Briefly, and only in this browser: the signed URL outlives it.
      "Cache-Control": "private, max-age=300",
    },
  });
}
