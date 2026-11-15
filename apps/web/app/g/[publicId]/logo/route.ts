import { NextResponse } from "next/server";

import { loadWebServerConfig } from "@capital-q/config/web";

import { servedLogo } from "@/features/gateq/served-logo";

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
 * site. Re-checked here too: PNG or JPEG by its bytes, or an SVG the API
 * labelled as one, in the sanitiser's exact form (the API has already
 * checked it is a fixed point of the allow-list) with nothing that could
 * run. Served with nosniff and a sandboxing policy so it can only ever be
 * an image. A paused, unknown or logo-less gateway is the one 404 (its own
 * people preview it through /gateq/logo/:gatewayId instead).
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
  // The URL carries the asset id, so a new logo is a new URL.
  return (
    servedLogo(
      response.headers.get("content-type"),
      bytes,
      "public, max-age=300",
    ) ?? NOT_FOUND()
  );
}
