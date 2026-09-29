import * as pptxgenjs from "pptxgenjs";
import { backgroundBands } from "./background.js";
import { imageKind, type SlideImages } from "./images.js";

import type { LaidOutDeck, TextBox } from "./layout.js";

/**
 * The deck as a real, editable PowerPoint file (QX-004 §7).
 *
 * Editable is the point. A founder who cannot change a slide has a
 * picture, not a deck, so every text frame here is a text frame and every
 * column is a shape — nothing is flattened into an image on the way out.
 *
 * Every position comes from the layout. PowerPoint works in inches and
 * the layout works in points, so the only arithmetic in this file is that
 * conversion: this renderer decides nothing about what fits, which is
 * what keeps the file a founder opens identical to the one they checked
 * in the browser.
 *
 * Autofit is deliberately off. Given the chance, PowerPoint answers a
 * full text box by shrinking the type, which is the outcome QX-004 §5
 * names as wrong — and it would do it silently, after the inspector had
 * already passed the slide.
 */

/**
 * The part of pptxgenjs this file uses, declared here.
 *
 * The package ships one set of typings for both its CommonJS and its ESM
 * build, and under NodeNext the default export resolves to the module
 * rather than to the class — so the shipped types describe something that
 * cannot be constructed, while the build Node actually loads exports the
 * class. Rather than assert past that, the surface is named: it is six
 * calls, it is checked once at the boundary, and a package that changes
 * shape fails here with a sentence instead of somewhere downstream with a
 * TypeError.
 */
type PptxTextOptions = Readonly<Record<string, unknown>>;
type PptxSlide = {
  background: { color: string };
  addText(text: string, options: PptxTextOptions): unknown;
  addShape(kind: string, options: PptxTextOptions): unknown;
  addImage(options: PptxTextOptions): unknown;
  addNotes(text: string): unknown;
};
type PptxPresentation = {
  title: string;
  company: string;
  layout: string;
  defineLayout(input: { name: string; width: number; height: number }): unknown;
  addSlide(): PptxSlide;
  write(options: { outputType: string }): Promise<unknown>;
};
type PptxConstructor = new () => PptxPresentation;

function presentationConstructor(): PptxConstructor {
  const module: unknown = pptxgenjs;
  const candidate =
    typeof module === "object" && module !== null && "default" in module
      ? (module as { readonly default: unknown }).default
      : module;
  if (typeof candidate !== "function") {
    throw new Error("pptxgenjs did not export a presentation constructor");
  }
  return candidate as PptxConstructor;
}

const PT_PER_INCH = 72;
const inches = (points: number): number => points / PT_PER_INCH;

/** pptxgenjs wants colours as six hex digits with no hash. */
const hex = (colour: string): string =>
  colour.replace(/^#/, "").toUpperCase().slice(0, 6);

function addText(
  slide: PptxSlide,
  box: TextBox,
  theme: LaidOutDeck["theme"],
): void {
  slide.addText(box.lines.join("\n"), {
    x: inches(box.x),
    y: inches(box.y),
    w: inches(box.width),
    h: inches(box.height),
    fontSize: box.size,
    bold: box.bold,
    color: hex(box.colour),
    fontFace:
      box.role === "TITLE" || box.role === "HEADING"
        ? theme.headingFont
        : theme.bodyFont,
    align: box.align === "centre" ? "center" : "left",
    valign: "top",
    // The layout already wrapped these lines and already decided they fit.
    shrinkText: false,
    wrap: false,
    margin: 0,
    lineSpacingMultiple: box.lineHeight / box.size,
  });
}

/**
 * Write the deck. Returns the .pptx bytes.
 *
 * `title` becomes the file's own title property, which is what a mail
 * client and a file browser show; the deck's first slide is unchanged.
 */
export async function deckToPptx(
  deck: LaidOutDeck,
  meta: { readonly title: string; readonly company?: string | undefined },
  images: SlideImages = new Map(),
): Promise<Uint8Array> {
  const Presentation = presentationConstructor();
  const pptx = new Presentation();
  pptx.title = meta.title;
  if (meta.company !== undefined) pptx.company = meta.company;
  // 16:9 at the layout's own size, so a point here is a point there.
  pptx.defineLayout({
    name: "CQ",
    width: inches(deck.width),
    height: inches(deck.height),
  });
  pptx.layout = "CQ";

  for (const laid of deck.slides) {
    const slide = pptx.addSlide();
    const bands = backgroundBands(laid.background ?? [], deck.height);
    slide.background = {
      color: hex(bands[0]?.colour ?? deck.theme.background),
    };
    // A gradient is bands behind everything else (ADR 0025).
    if (bands.length > 1) {
      for (const band of bands) {
        slide.addShape("rect", {
          x: 0,
          y: inches(band.y),
          w: inches(deck.width),
          h: inches(band.height),
          fill: { color: hex(band.colour) },
          line: { color: hex(band.colour), width: 0 },
        });
      }
    }
    for (const box of laid.boxes) {
      if (box.kind === "RULE") {
        slide.addShape("rect", {
          x: inches(box.x),
          y: inches(box.y),
          w: inches(box.width),
          h: inches(box.height),
          fill: { color: hex(box.colour) },
          line: { color: hex(box.colour), width: 0 },
        });
        continue;
      }
      if (box.kind === "CIRCLE") {
        slide.addShape("ellipse", {
          x: inches(box.x),
          y: inches(box.y),
          w: inches(box.width),
          h: inches(box.height),
          fill: { color: hex(box.colour) },
          line: { color: hex(box.colour), width: 0 },
        });
        continue;
      }
      if (box.kind === "TEXT") {
        addText(slide, box, deck.theme);
        continue;
      }
      if (box.kind === "IMAGE") {
        const bytes = images.get(box.url);
        const kind = bytes === undefined ? null : imageKind(bytes);
        if (bytes === undefined || kind === null) continue;
        // Embedded, not linked: the file opens offline and on any machine.
        slide.addImage({
          data: `image/${kind};base64,${Buffer.from(bytes).toString("base64")}`,
          x: inches(box.x),
          y: inches(box.y),
          w: inches(box.width),
          h: inches(box.height),
          sizing: {
            type: "cover",
            w: inches(box.width),
            h: inches(box.height),
          },
          altText: box.alt,
        });
        continue;
      }
      // A chart drawn as shapes rather than as a PowerPoint chart object:
      // the numbers are already decided, and a native chart would carry a
      // second copy of them that a later edit could put out of step with
      // the artifact this came from.
      slide.addShape("line", {
        x: inches(box.x),
        y: inches(box.baseline),
        w: inches(box.width),
        h: 0,
        line: { color: hex(deck.theme.muted), width: 1 },
      });
      for (const bar of box.bars) {
        slide.addShape("rect", {
          x: inches(bar.x),
          y: inches(bar.y),
          w: inches(bar.width),
          h: inches(bar.height),
          fill: { color: hex(box.colour) },
          line: { color: hex(box.colour), width: 0 },
        });
        slide.addText(bar.formatted, {
          x: inches(bar.x - 20),
          y: inches(bar.y - box.labelSize - 8),
          w: inches(bar.width + 40),
          h: inches(box.labelSize + 6),
          fontSize: box.labelSize,
          bold: true,
          color: hex(deck.theme.ink),
          fontFace: deck.theme.bodyFont,
          align: "center",
          valign: "bottom",
          shrinkText: false,
          margin: 0,
        });
        slide.addText(bar.label.join("\n"), {
          x: inches(bar.x - 20),
          y: inches(box.baseline + 6),
          w: inches(bar.width + 40),
          h: inches(box.labelSize * 1.3 * bar.label.length + 4),
          fontSize: box.labelSize,
          color: hex(deck.theme.muted),
          fontFace: deck.theme.bodyFont,
          align: "center",
          valign: "top",
          shrinkText: false,
          margin: 0,
        });
      }
    }
    if (laid.note !== undefined) {
      slide.addNotes(laid.note);
    }
  }

  const written: unknown = await pptx.write({ outputType: "nodebuffer" });
  if (written instanceof Uint8Array) return written;
  throw new Error("the deck writer did not return bytes");
}
