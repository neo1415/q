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
  const parts: string[] = [
    `<rect x="0" y="0" width="${String(deck.width)}" height="${String(deck.height)}" fill="${escape(theme.background)}"/>`,
  ];
  for (const box of slide.boxes) {
    if (box.kind === "RULE") {
      parts.push(
        `<rect x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" fill="${escape(box.colour)}"/>`,
      );
      continue;
    }
    if (box.kind === "TEXT") {
      const family =
        box.role === "TITLE" || box.role === "HEADING"
          ? theme.headingFont
          : theme.bodyFont;
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
