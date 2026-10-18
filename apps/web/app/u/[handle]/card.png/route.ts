import { NextResponse } from "next/server";

import { cardFileName, renderCardImage } from "@/features/q-card/card-image";
import { appOrigin } from "@/features/q-card/public-card-data";

export const dynamic = "force-dynamic";

/**
 * `/@handle.png` (founder design 2026-09-28, through a rewrite): the Q
 * Card as an image to save or send. Public fields only; never indexed,
 * never shared-cached.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly handle: string }> },
) {
  const { handle } = await params;
  const image = await renderCardImage(handle);
  if (image === null) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  }
  if (image.kind === "REDIRECT") {
    return NextResponse.redirect(`${appOrigin()}/@${image.handle}.png`, 308);
  }
  const bytes = await image.response.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${cardFileName(image.handle, "png")}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
