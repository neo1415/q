import type { LaidOutDeck, LaidOutSlide, TextBox } from "./layout.js";

/**
 * A laid-out slide as SVG (QX-004 §6, §7).
 *
 * The viewer's picture of a slide, and the drawing the PDF writer traces.
 * It computes nothing: every position, size and wrapped line was decided
 * by the layout, so what a founder sees in the browser is the same
 * geometry that goes into the file they send.
 *
 * Text is escaped on the way in. A slide's words come from a deck Q
 * composed, and a composed deck can carry a founder's own prose, which
 * can carry an angle bracket — SVG is markup, and markup assembled by
 * concatenation is exactly where that becomes a defect.
 */

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textElement(box: TextBox, fontFamily: string): string {
  const anchor = box.align === "centre" ? "middle" : "start";
  const x = box.align === "centre" ? box.x + box.width / 2 : box.x;
  // `y` is the box's top; a baseline sits most of a line-height below it.
  const first = box.y + box.size;
  const lines = box.lines
    .map(
      (line, index) =>
        `<tspan x="${String(x)}" y="${String(first + index * box.lineHeight)}">${escape(line)}</tspan>`,
    )
    .join("");
  return `<text font-family="${escape(fontFamily)}" font-size="${String(box.size)}" font-weight="${box.bold ? "700" : "400"}" fill="${escape(box.colour)}" text-anchor="${anchor}">${lines}</text>`;
}

/** One slide as a standalone SVG document. */
export function slideToSvg(slide: LaidOutSlide, deck: LaidOutDeck): string {
  const { theme } = deck;
  const own = slide.background;
  const parts: string[] =
    own === undefined || own.length === 0
      ? [
          `<rect x="0" y="0" width="${String(deck.width)}" height="${String(deck.height)}" fill="${escape(theme.background)}"/>`,
        ]
      : own.length === 1
        ? [
            `<rect x="0" y="0" width="${String(deck.width)}" height="${String(deck.height)}" fill="${escape(own[0] ?? theme.background)}"/>`,
          ]
        : [
            `<defs><linearGradient id="cq-cover" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${escape(own[0] ?? theme.background)}"/><stop offset="1" stop-color="${escape(own[1] ?? theme.background)}"/></linearGradient></defs>`,
            `<rect x="0" y="0" width="${String(deck.width)}" height="${String(deck.height)}" fill="url(#cq-cover)"/>`,
          ];
  for (const box of slide.boxes) {
    if (box.kind === "RULE") {
      parts.push(
        `<rect x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" fill="${escape(box.colour)}"/>`,
      );
      continue;
    }
    if (box.kind === "CIRCLE") {
      parts.push(
        `<circle cx="${String(box.x + box.width / 2)}" cy="${String(box.y + box.height / 2)}" r="${String(box.width / 2)}" fill="${escape(box.colour)}"/>`,
      );
      continue;
    }
    if (box.kind === "IMAGE") {
      // The browser fetches a photo from the stock library's CDN directly;
      // a logo arrives inline as a data URI and is fitted, never cropped.
      const fit = box.fit === "contain" ? "xMinYMid meet" : "xMidYMid slice";
      parts.push(
        `<image href="${escape(box.url)}" x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" preserveAspectRatio="${fit}"><title>${escape(box.alt)}</title></image>`,
      );
      continue;
    }
    if (box.kind === "PATH") {
      const points = box.points
        .map((point) => `${String(point.x)},${String(point.y)}`)
        .join(" ");
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${escape(box.colour)}" stroke-width="${String(box.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      continue;
    }
    if (box.kind === "TEXT") {
      const family = `${
        box.role === "TITLE" || box.role === "HEADING"
          ? theme.headingFont
          : theme.bodyFont
      }, Helvetica, Arial, sans-serif`;
      parts.push(textElement(box, family));
      continue;
    }
    // A chart: the columns, the value over each, the label under each, and
    // one baseline. Nothing else — no gridlines, no legend for one series.
    parts.push(
      `<line x1="${String(box.x)}" y1="${String(box.baseline)}" x2="${String(box.x + box.width)}" y2="${String(box.baseline)}" stroke="${escape(theme.muted)}" stroke-width="1"/>`,
    );
    for (const bar of box.bars) {
      parts.push(
        `<rect x="${String(bar.x)}" y="${String(bar.y)}" width="${String(bar.width)}" height="${String(bar.height)}" fill="${escape(box.colour)}"/>`,
      );
      const centre = bar.x + bar.width / 2;
      parts.push(
        `<text font-family="${escape(theme.bodyFont)}" font-size="${String(box.labelSize)}" font-weight="700" fill="${escape(theme.ink)}" text-anchor="middle" x="${String(centre)}" y="${String(bar.y - 6)}">${escape(bar.formatted)}</text>`,
      );
      bar.label.forEach((line, index) => {
        parts.push(
          `<text font-family="${escape(theme.bodyFont)}" font-size="${String(box.labelSize)}" fill="${escape(theme.muted)}" text-anchor="middle" x="${String(centre)}" y="${String(box.baseline + box.labelSize + 6 + index * Math.round(box.labelSize * 1.25))}">${escape(line)}</text>`,
        );
      });
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(deck.width)} ${String(deck.height)}" width="${String(deck.width)}" height="${String(deck.height)}" role="img" aria-label="${escape(slide.title)}">${parts.join("")}</svg>`;
}

/** Every slide, in order. */
export function deckToSvg(deck: LaidOutDeck): readonly string[] {
  return deck.slides.map((slide) => slideToSvg(slide, deck));
}

/**
 * DOCS: every picture on a laid-out deck, in slide units, for a viewer to
 * draw over the slide. A slide shown as an SVG image cannot load pictures
 * of its own, so the viewer places them itself: a stock photo straight
 * from the library's CDN, a generated image by a short-lived signed URL
 * straight from storage.
 */
/**
 * Q room W5: where each slide's placeholder is drawn, for the room to put
 * a drop target over it (same layout as the drawing, so they line up).
 */
export function slidePlaceholderBoxes(deck: LaidOutDeck): readonly {
  readonly slide: number;
  readonly kind: "IMAGE" | "TEXT";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}[] {
  return deck.slides.flatMap((slide) =>
    slide.boxes.flatMap((box) =>
      box.kind === "RULE" && box.placeholder !== undefined
        ? [
            {
              slide: slide.index,
              kind: box.placeholder,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            },
          ]
        : [],
    ),
  );
}

export function slideImageBoxes(deck: LaidOutDeck): readonly {
  readonly slide: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly alt: string;
  readonly credit: string;
  readonly fit: "cover" | "contain";
}[] {
  return deck.slides.flatMap((slide) =>
    slide.boxes.flatMap((box) =>
      box.kind === "IMAGE" && !box.url.startsWith("data:")
        ? [
            {
              slide: slide.index,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              url: box.url,
              alt: box.alt,
              credit: box.credit,
              fit: box.fit ?? "cover",
            },
          ]
        : [],
    ),
  );
}
