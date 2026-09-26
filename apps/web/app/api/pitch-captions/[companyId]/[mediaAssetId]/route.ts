import { NextResponse, type NextRequest } from "next/server";

import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  MEDIA_CAPTIONS_VTT_SUFFIX,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * A pitch's captions for the player's <track> (R18).
 *
 * The API authenticates with a bearer token kept in an HttpOnly cookie, and
 * a <track> element can send only cookies, so the token is attached here,
 * on the server, for this one read. It is deliberately not a proxy: GET
 * only, two UUIDs, one fixed path; anything else is a 404 before a socket
 * is opened. The API decides, under the pitch playback rule, whether this
 * person may read the captions at all; a refusal and "not generated yet"
 * are the same 404 here, and the player simply has no captions.
 *
 * Captions are text, a few kilobytes. Video bytes never pass through here
 * or anywhere on the app origin.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 1024 * 1024;

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: NextRequest,
  context: {
    readonly params: Promise<{
      readonly companyId: string;
      readonly mediaAssetId: string;
    }>;
  },
): Promise<NextResponse> {
  const { companyId, mediaAssetId } = await context.params;
  if (!UUID.test(companyId) || !UUID.test(mediaAssetId)) return notFound();
  const { apiBaseUrl } = loadWebServerConfig();
  const token = await getSessionAccessToken();
  if (apiBaseUrl === undefined || token === null) return notFound();

  const upstream = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}${COMPANIES_PATH}/${companyId}${COMPANY_PITCH_SUFFIX}/${mediaAssetId}${MEDIA_CAPTIONS_VTT_SUFFIX}`,
    {
      headers: { authorization: `Bearer ${token}`, accept: "text/vtt" },
      cache: "no-store",
    },
  ).catch(() => null);
  if (upstream === null || !upstream.ok) return notFound();
  const vtt = await upstream.text();
  if (!vtt.startsWith("WEBVTT") || vtt.length > MAX_BYTES) return notFound();
  return new NextResponse(vtt, {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
