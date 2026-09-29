import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

import {
  CARD_IMAGE_SIZE,
  cardFileName,
  renderCardImage,
} from "@/features/q-card/card-image";
import { appOrigin } from "@/features/q-card/public-card-data";

export const dynamic = "force-dynamic";

/**
 * `/@handle.pdf` (founder design 2026-09-28, through a rewrite): the Q
 * Card as a one-page PDF, the same image as `.png` on a page of the
 * card's own proportions, with the public page as the document's link
 * subject. Public fields only; never indexed, never shared-cached.
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
    return NextResponse.redirect(`${appOrigin()}/@${image.handle}.pdf`, 308);
  }
  const png = new Uint8Array(await image.response.arrayBuffer());
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Q Card @${image.handle}`);
  pdf.setSubject(`${appOrigin()}/@${image.handle}`);
  pdf.setProducer("Capital Q");
  // 85 mm wide at 72 points per inch, the card's own proportions.
  const width = 241;
  const height = (width * CARD_IMAGE_SIZE.height) / CARD_IMAGE_SIZE.width;
  const page = pdf.addPage([width, height]);
  const embedded = await pdf.embedPng(png);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${cardFileName(image.handle, "pdf")}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
