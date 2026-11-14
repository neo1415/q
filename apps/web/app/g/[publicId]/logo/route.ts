import { NextResponse } from "next/server";

import { loadWebServerConfig } from "@capital-q/config/web";
import {
  GATEQ_SVG_LOGO_CSP,
  GATEQ_SVG_LOGO_MAX_BYTES,
} from "@capital-q/contracts";

export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new NextResponse("Not found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });

const SVG_PREFIX = '<svg xmlns="http://www.w3.org/2000/svg"';

/**
 * An SVG logo as the API serves it: labelled image/svg+xml, within the
 * bound, starting as the sanitiser writes it, and carrying nothing that
 * runs or loads (a second, independent check of the API's).
 */
function isServedSvgLogo(contentType: string | null, bytes: Uint8Array) {
  if (contentType?.split(";")[0]?.trim() !== "image/svg+xml") return false;
  if (bytes.byteLength > GATEQ_SVG_LOGO_MAX_BYTES) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!text.startsWith(SVG_PREFIX) || !text.endsWith("</svg>")) return false;
  return !/<\s*(script|foreignobject|iframe|image|a|animate|set)\b|\son[a-z]+\s*=|javascript:|data:|@import|<!/iu.test(
    text,
  );
}

/**
 * `/g/:publicId/logo` (brand from website, 2026-11-14): the gateway's
 * logo, from Capital Q's own copy through the API, so the public page and
 * the embed draw it from this origin and never hot-link the investor's
 * site. Re-checked here too: PNG or JPEG by its bytes, or an SVG the API
 * labelled as one, in the sanitiser's exact form (the API has already
 * checked it is a fixed point of the allow-list) with nothing that could
 * run. Served with nosniff and a sandboxing policy so it can only ever be
 * an image. A paused, unknown or logo-less gateway is the one 404.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly publicId: string }> },
) {
  const { publicId } = await params;
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined || !/^[A-Za-z0-9_-]{4,64}$/u.test(publicId)) {
    return NOT_FOUND();
  }
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/u, "")}/v1/gateq/public/${encodeURIComponent(publicId)}/logo`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
  } catch {
    return NOT_FOUND();
  }
  if (!response.ok) return NOT_FOUND();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 512 * 1024) return NOT_FOUND();
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const svg =
    !png &&
    !jpeg &&
    isServedSvgLogo(response.headers.get("content-type"), bytes);
  if (!png && !jpeg && !svg) return NOT_FOUND();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": svg ? "image/svg+xml" : png ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": svg
        ? GATEQ_SVG_LOGO_CSP
        : "default-src 'none'; sandbox",
      // The URL carries the asset id, so a new logo is a new URL.
      "Cache-Control": "public, max-age=300",
    },
  });
}
