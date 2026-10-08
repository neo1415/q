import {
  clip,
  endPath,
  LineCapStyle,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { backgroundBands } from "./background.js";
import { imageBytesFor, imageKind, type SlideImages } from "./images.js";

import type { FaceKey } from "./faces.js";
import { drawLine, embedFaces, type EmbeddedFont } from "./fonts.js";
import type { LaidOutDeck, TextBox } from "./layout.js";
import { arcPath, roundedRectPath } from "./paths.js";

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

type FaceFor = (face: FaceKey | undefined, bold: boolean) => EmbeddedFont;

function drawText(
  page: PDFPage,
  box: TextBox,
  height: number,
  faceFor: FaceFor,
): void {
  const face = faceFor(box.face, box.bold);
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
  // Deck quality: the faces the layout measured in, each backed by Noto
  // for what it cannot draw. A box with no face (the newspaper) is Noto.
  const wanted = new Set<FaceKey>();
  for (const slide of deck.slides) {
    for (const box of slide.boxes) {
      if (box.kind === "TEXT" && box.face !== undefined) wanted.add(box.face);
      if (box.kind === "CHART") {
        if (box.face !== undefined) wanted.add(box.face);
        if (box.strongFace !== undefined) wanted.add(box.strongFace);
      }
    }
  }
  const faces = await embedFaces(pdf, [...wanted]);
  const faceFor: FaceFor = (face, bold) => {
    const found = face === undefined ? undefined : faces.get(face);
    if (found !== undefined) return found;
    const noto = faces.get(bold ? "NOTO_BOLD" : "NOTO");
    if (noto === undefined) throw new Error("the bundled face did not embed");
    return noto;
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
      if (box.kind === "RULE" && (box.radius ?? 0) > 0) {
        page.drawSvgPath(
          roundedRectPath(box.x, box.y, box.width, box.height, box.radius ?? 0),
          { x: 0, y: deck.height, color: colour(box.colour) },
        );
        continue;
      }
      if (box.kind === "ARC") {
        page.drawSvgPath(arcPath(box), {
          x: 0,
          y: deck.height,
          color: colour(box.colour),
        });
        continue;
      }
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
      if (box.kind === "CIRCLE") {
        page.drawCircle({
          x: box.x + box.width / 2,
          y: deck.height - box.y - box.height / 2,
          size: box.width / 2,
          color: colour(box.colour),
        });
        continue;
      }
      if (box.kind === "TEXT") {
        drawText(page, box, deck.height, faceFor);
        continue;
      }
      if (box.kind === "PATH") {
        for (let at = 1; at < box.points.length; at += 1) {
          const from = box.points[at - 1];
          const to = box.points[at];
          if (from === undefined || to === undefined) continue;
          page.drawLine({
            start: { x: from.x, y: deck.height - from.y },
            end: { x: to.x, y: deck.height - to.y },
            thickness: box.strokeWidth,
            color: colour(box.colour),
            lineCap: LineCapStyle.Round,
          });
        }
        continue;
      }
      if (box.kind === "IMAGE") {
        const bytes = imageBytesFor(box.url, images);
        const kind = bytes === undefined ? null : imageKind(bytes);
        if (bytes === undefined || kind === null) continue;
        const embedded =
          kind === "png"
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        // Cover the box, cropping the overflow: a photo is never stretched.
        // A logo is fitted inside its box instead, left-aligned, uncropped.
        if (box.fit === "contain") {
          const fitted = Math.min(
            box.width / embedded.width,
            box.height / embedded.height,
          );
          page.drawImage(embedded, {
            x: box.x,
            y:
              deck.height -
              box.y -
              box.height +
              (box.height - embedded.height * fitted) / 2,
            width: embedded.width * fitted,
            height: embedded.height * fitted,
          });
          continue;
        }
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
        color: colour(box.muted ?? deck.theme.muted),
      });
      const slot =
        box.bars.length === 0 ? box.width : box.width / box.bars.length;
      box.bars.forEach((bar, at) => {
        const quiet = box.highlight !== undefined && at !== box.highlight;
        page.drawRectangle({
          x: bar.x,
          y: deck.height - bar.y - bar.height,
          width: bar.width,
          height: bar.height,
          color: colour(quiet ? (box.quiet ?? box.colour) : box.colour),
        });
        const centre = bar.x + bar.width / 2;
        drawLine(page, faceFor(box.strongFace, true), bar.formatted, {
          x: centre - slot / 2,
          y: deck.height - bar.y + 8,
          size: box.labelSize,
          colour: colour(
            quiet
              ? (box.muted ?? deck.theme.muted)
              : (box.ink ?? deck.theme.ink),
          ),
          maxWidth: slot,
          align: "centre",
        });
        bar.label.forEach((line, index) => {
          drawLine(page, faceFor(box.face, false), line, {
            x: centre - slot / 2,
            y:
              deck.height -
              (box.baseline +
                box.labelSize +
                6 +
                index * Math.round(box.labelSize * 1.25)),
            size: box.labelSize,
            colour: colour(box.muted ?? deck.theme.muted),
            maxWidth: slot,
            align: "centre",
          });
        });
      });
    }
  }

  return pdf.save();
}
