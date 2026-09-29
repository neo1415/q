import {
  clip,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { backgroundBands } from "./background.js";
import { imageKind, type SlideImages } from "./images.js";

import { drawLine, embedFonts, type EmbeddedFonts } from "./fonts.js";
import type { LaidOutDeck, TextBox } from "./layout.js";

/**
 * The deck as a PDF (QX-004 §7).
 *
 * The file somebody forwards. It is drawn from the same layout as the
 * PPTX and the viewer, with one conversion: PDF measures from the bottom
 * of the page and everything else here measures from the top.
 *
 * Text is drawn line by line, using the lines the layout already wrapped.
 * That is deliberate even though pdf-lib can wrap: a PDF that wrapped for
 * itself would disagree with the PowerPoint about how much fits, and the
 * inspector would have passed a slide that only one of them renders
 * correctly.
 *
 * The text is set in the bundled Noto Sans (BIZ-001, `fonts.ts`) rather
 * than the standard fourteen fonts, which could not draw "₦" and quietly
 * dropped it. What the bundled face cannot draw either is left out one
 * character at a time — a missing symbol is a blemish, a failed render is
 * a founder with no deck.
 */

export function colour(hex: string): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1] ?? "000000";
  return rgb(
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  );
}

function drawText(
  page: PDFPage,
  box: TextBox,
  height: number,
  fonts: EmbeddedFonts,
): void {
  const face = box.bold ? fonts.bold : fonts.regular;
  box.lines.forEach((line, index) => {
    // The layout's `y` is the box's top and its baselines sit a size below
    // each line's own top; a PDF's origin is the bottom of the page.
    const top = box.y + index * box.lineHeight + box.size;
    drawLine(page, face, line, {
      x: box.x,
      y: height - top,
      size: box.size,
      colour: colour(box.colour),
      maxWidth: box.width,
      align: box.align,
    });
  });
}

/** Write the deck. Returns the PDF bytes. */
export async function deckToPdf(
  deck: LaidOutDeck,
  meta: { readonly title: string; readonly company?: string | undefined },
  images: SlideImages = new Map(),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title);
  if (meta.company !== undefined) pdf.setAuthor(meta.company);
  pdf.setProducer("Capital Q");
  const fonts = await embedFonts(pdf);

  for (const laid of deck.slides) {
    const page = pdf.addPage([deck.width, deck.height]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: deck.width,
      height: deck.height,
      color: colour(deck.theme.background),
    });
    // The person's own cover (ADR 0025), drawn over the theme's page.
    for (const band of backgroundBands(laid.background ?? [], deck.height)) {
      page.drawRectangle({
        x: 0,
        y: deck.height - band.y - band.height,
        width: deck.width,
        height: band.height,
        color: colour(band.colour),
      });
    }
    for (const box of laid.boxes) {
      if (box.kind === "RULE") {
        page.drawRectangle({
          x: box.x,
          y: deck.height - box.y - box.height,
          width: box.width,
          height: box.height,
          color: colour(box.colour),
        });
        continue;
      }
      if (box.kind === "TEXT") {
        drawText(page, box, deck.height, fonts);
        continue;
      }
      if (box.kind === "IMAGE") {
        const bytes = images.get(box.url);
        const kind = bytes === undefined ? null : imageKind(bytes);
        if (bytes === undefined || kind === null) continue;
        const embedded =
          kind === "png"
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        // Cover the box, cropping the overflow: a photo is never stretched.
        const ratio = Math.max(
          box.width / embedded.width,
          box.height / embedded.height,
        );
        const width = embedded.width * ratio;
        const height = embedded.height * ratio;
        // Clipped to its box: the photo covers its side and nothing else.
        const boxBottom = deck.height - box.y - box.height;
        page.pushOperators(
          pushGraphicsState(),
          rectangle(box.x, boxBottom, box.width, box.height),
          clip(),
          endPath(),
        );
        page.drawImage(embedded, {
          x: box.x - (width - box.width) / 2,
          y: boxBottom - (height - box.height) / 2,
          width,
          height,
        });
        page.pushOperators(popGraphicsState());
        continue;
      }
      // A chart: drawn from the numbers as vector shapes, never an image.
      page.drawRectangle({
        x: box.x,
        y: deck.height - box.baseline,
        width: box.width,
        height: 1,
        color: colour(deck.theme.muted),
      });
      const slot =
        box.bars.length === 0 ? box.width : box.width / box.bars.length;
      for (const bar of box.bars) {
        page.drawRectangle({
          x: bar.x,
          y: deck.height - bar.y - bar.height,
          width: bar.width,
          height: bar.height,
          color: colour(box.colour),
        });
        const centre = bar.x + bar.width / 2;
        drawLine(page, fonts.bold, bar.formatted, {
          x: centre - slot / 2,
          y: deck.height - bar.y + 6,
          size: box.labelSize,
          colour: colour(deck.theme.ink),
          maxWidth: slot,
          align: "centre",
        });
        bar.label.forEach((line, index) => {
          drawLine(page, fonts.regular, line, {
            x: centre - slot / 2,
            y:
              deck.height -
              (box.baseline +
                box.labelSize +
                6 +
                index * Math.round(box.labelSize * 1.25)),
            size: box.labelSize,
            colour: colour(deck.theme.muted),
            maxWidth: slot,
            align: "centre",
          });
        });
      }
    }
  }

  return pdf.save();
}
