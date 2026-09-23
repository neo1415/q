import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

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
 * The standard fourteen fonts are used rather than embedded ones, so a
 * worker needs no font files on disk and the output is byte-stable. They
 * cover Latin text; a character outside WinAnsi would throw, so it is
 * replaced before drawing — a missing accent is a blemish, and a failed
 * render is a founder with no deck.
 */

const WIN_ANSI_SAFE = /[^ -~\u00a0-\u00ff]/g;

/** What pdf-lib's standard fonts can draw, with the rest made harmless. */
function drawable(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(WIN_ANSI_SAFE, "");
}

function colour(hex: string): ReturnType<typeof rgb> {
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
  fonts: { readonly regular: PDFFont; readonly bold: PDFFont },
): void {
  const font = box.bold ? fonts.bold : fonts.regular;
  box.lines.forEach((line, index) => {
    const text = drawable(line);
    if (text.length === 0) return;
    // The layout's `y` is the box's top and its baselines sit a size below
    // each line's own top; a PDF's origin is the bottom of the page.
    const top = box.y + index * box.lineHeight + box.size;
    const width = font.widthOfTextAtSize(text, box.size);
    const x = box.align === "centre" ? box.x + (box.width - width) / 2 : box.x;
    page.drawText(text, {
      x,
      y: height - top,
      size: box.size,
      font,
      color: colour(box.colour),
    });
  });
}

/** Write the deck. Returns the PDF bytes. */
export async function deckToPdf(
  deck: LaidOutDeck,
  meta: { readonly title: string; readonly company?: string | undefined },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title);
  if (meta.company !== undefined) pdf.setAuthor(meta.company);
  pdf.setProducer("Capital Q");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  for (const laid of deck.slides) {
    const page = pdf.addPage([deck.width, deck.height]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: deck.width,
      height: deck.height,
      color: colour(deck.theme.background),
    });
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
      page.drawRectangle({
        x: box.x,
        y: deck.height - box.baseline,
        width: box.width,
        height: 1,
        color: colour(deck.theme.muted),
      });
      for (const bar of box.bars) {
        page.drawRectangle({
          x: bar.x,
          y: deck.height - bar.y - bar.height,
          width: bar.width,
          height: bar.height,
          color: colour(box.colour),
        });
        const centre = bar.x + bar.width / 2;
        const value = drawable(bar.formatted);
        const valueWidth = fonts.bold.widthOfTextAtSize(value, box.labelSize);
        page.drawText(value, {
          x: centre - valueWidth / 2,
          y: deck.height - bar.y + 6,
          size: box.labelSize,
          font: fonts.bold,
          color: colour(deck.theme.ink),
        });
        bar.label.forEach((line, index) => {
          const text = drawable(line);
          if (text.length === 0) return;
          const width = fonts.regular.widthOfTextAtSize(text, box.labelSize);
          page.drawText(text, {
            x: centre - width / 2,
            y:
              deck.height -
              (box.baseline +
                box.labelSize +
                6 +
                index * Math.round(box.labelSize * 1.25)),
            size: box.labelSize,
            font: fonts.regular,
            color: colour(deck.theme.muted),
          });
        });
      }
    }
  }

  return pdf.save();
}
