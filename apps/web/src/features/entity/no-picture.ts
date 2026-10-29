import { NextResponse } from "next/server";

/**
 * "No picture" from the photo and logo routes (production re-test
 * 2026-10-28: each avatar without a photo logged a 404 in the console).
 * The answer is a 1x1 transparent placeholder, never an error and never
 * someone's picture; EntityAvatar reads a 1x1 image as "none" and keeps its
 * fallback. Every "no" is the same placeholder, so it tells a viewer
 * without access nothing more than a 404 did.
 */
export const NO_PICTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

/** The header that names the placeholder, for tests and tools. */
export const NO_PICTURE_HEADER = "X-Capital-Q-Picture";

export function noPicture(cacheControl: string): NextResponse {
  return new NextResponse(NO_PICTURE_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": cacheControl,
      [NO_PICTURE_HEADER]: "none",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
