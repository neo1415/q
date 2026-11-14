import { NextResponse } from "next/server";

import { loadWebServerConfig } from "@capital-q/config/web";

export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new NextResponse("Not found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });

/**
 * `/g/:publicId/logo` (brand from website, 2026-11-14): the gateway's
 * logo, from Capital Q's own copy through the API, so the public page and
 * the embed draw it from this origin and never hot-link the investor's
 * site. Re-checked as PNG or JPEG by its bytes here too; served with
 * nosniff so it can only ever be an image. A paused, unknown or logo-less
 * gateway is the one 404.
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
  if (!png && !jpeg) return NOT_FOUND();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": png ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // The URL carries the asset id, so a new logo is a new URL.
      "Cache-Control": "public, max-age=300",
    },
  });
}
