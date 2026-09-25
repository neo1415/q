import { readFile } from "node:fs/promises";

import * as fontkitModule from "@pdf-lib/fontkit";
import {
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

/**
 * The fonts a PDF is written in (BIZ-001).
 *
 * The PDF writers used pdf-lib's standard fourteen fonts, which cover
 * WinAnsi and nothing else, so a founder in Lagos who wrote "₦2,000,000"
 * got a deck that said "2,000,000" — a different claim, silently. Noto
 * Sans is bundled instead (SIL Open Font License 1.1, `fonts/OFL.txt`),
 * because it carries the naira, cedi, rupee and euro signs, Greek,
 * Cyrillic, and the dot-below letters Yoruba names are written with, and
 * because a bundled file renders the same on a laptop and on Railway: no
 * font is looked up on the host.
 *
 * Embedded whole, not subset by pdf-lib. pdf-lib's subsetter (through
 * @pdf-lib/fontkit 1.1.1) writes a Noto subset whose outlines Chrome's
 * PDF viewer cannot draw: the text extracts perfectly and the page shows
 * one letter in five. So the bundled files are cut down ahead of time
 * instead (see `FONT_FILES`), and pdf-lib embeds them as they are: about
 * 100 KB per face once compressed, so a one-page brief is ~230 KB. pdf-lib
 * still writes a ToUnicode map, which is what lets a reader search,
 * select and copy "₦" back out.
 *
 * The bytes are read once per process and kept: about 1.3 MB resident,
 * which on a 1 GB service is the cheap side of the trade against reading
 * two files for every download.
 */

/**
 * Noto Sans 400 and 700 (Google Fonts static TTFs, via
 * @expo-google-fonts/noto-sans 0.4.2), subset with HarfBuzz hb-subset
 * (harfbuzzjs 0.4.12), hinting dropped, keeping these Unicode ranges:
 * 0020-007E, 00A0-024F, 02B0-036F, 0370-03FF, 0400-052F, 1E00-1EFF,
 * 2000-206F, 20A0-20C0, 2100-218F, 2200-22FF — Latin with every
 * extension (Yoruba, Igbo, Hausa, Vietnamese), Greek, Cyrillic,
 * punctuation, currency, letterlike symbols, number forms and operators.
 * 629 KB → 196 KB per face. Regenerate the same way to widen coverage.
 * The licence (`fonts/OFL.txt`, OFL 1.1) travels with the files and
 * permits modified versions; this family declares no Reserved Font Name,
 * so the subset may keep its name.
 */
const FONT_FILES = {
  regular: "NotoSans-Regular.ttf",
  bold: "NotoSans-Bold.ttf",
} as const;

/**
 * `fonts/` sits beside `src/` and `dist/`, so one relative URL resolves
 * from the source under test and from the build under `node dist/…`.
 */
const FONT_DIRECTORY = new URL("../fonts/", import.meta.url);

let fontBytes: Promise<{
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}> | null = null;

function loadFontBytes(): Promise<{
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}> {
  fontBytes ??= Promise.all([
    readFile(new URL(FONT_FILES.regular, FONT_DIRECTORY)),
    readFile(new URL(FONT_FILES.bold, FONT_DIRECTORY)),
  ]).then(([regular, bold]) => ({ regular, bold }));
  // A failed read is not cached: the next export tries again rather than
  // every download failing for the life of the process.
  fontBytes.catch(() => {
    fontBytes = null;
  });
  return fontBytes;
}

/**
 * The fontkit instance pdf-lib needs to embed a TrueType font.
 *
 * The package is a UMD bundle whose typings describe a namespace, while
 * Node's ESM loader hands back the bundle as `default`. The same shape
 * problem `pptx.ts` names for pptxgenjs, answered the same way: checked
 * once at the boundary, with a sentence if it ever changes shape.
 */
type Fontkit = Parameters<PDFDocument["registerFontkit"]>[0];

function fontkit(): Fontkit {
  const module: unknown = fontkitModule;
  const candidate =
    typeof module === "object" && module !== null && "default" in module
      ? (module as { readonly default: unknown }).default
      : module;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("create" in candidate) ||
    typeof candidate.create !== "function"
  ) {
    throw new Error("@pdf-lib/fontkit did not export a font engine");
  }
  return candidate as Fontkit;
}

/**
 * A font embedded in one document, with what it can draw.
 *
 * `text` is the only way a string reaches a page: it composes what can be
 * composed and replaces what the face has no glyph for, so a character
 * outside Noto's coverage costs that character rather than the file.
 */
export type EmbeddedFont = {
  readonly font: PDFFont;
  readonly text: (input: string) => string;
  readonly width: (input: string, size: number) => number;
};

export type EmbeddedFonts = {
  readonly regular: EmbeddedFont;
  readonly bold: EmbeddedFont;
};

/**
 * What stands in for a character the face cannot draw.
 *
 * Only a handful, and only where the substitute says the same thing; for
 * anything else the character is left out, because a tofu box in a file
 * an investor opens reads as a broken document.
 */
const SUBSTITUTES: Readonly<Record<string, string>> = {
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "✓": "",
  "✔": "",
  "\t": " ",
};

function textFor(font: PDFFont): (input: string) => string {
  const drawable = new Set(font.getCharacterSet());
  return (input) => {
    // NFC first: "o" followed by a combining dot below becomes "ọ", which
    // the face has as one glyph. pdf-lib does no mark positioning, so an
    // uncomposed sequence would draw its accent in the wrong place.
    let out = "";
    for (const character of input.normalize("NFC")) {
      const code = character.codePointAt(0) ?? 0;
      if (drawable.has(code)) {
        out += character;
        continue;
      }
      const substitute = SUBSTITUTES[character];
      if (substitute !== undefined) {
        out += substitute;
      }
      // Control characters and anything else without a glyph: left out.
    }
    return out;
  };
}

/**
 * OpenType shaping, switched off: one character, one glyph.
 *
 * fontkit applies the font's substitution features by default, and Noto's
 * `ccmp` decomposes "ọ" into "o" plus a combining dot. pdf-lib then writes
 * one ToUnicode entry per glyph, so the plain "o" glyph was mapped back to
 * "ọ" — every "on record" in a brief extracted as "ọn recọrd", and the
 * dot drew without the mark positioning pdf-lib does not do. Latin,
 * Greek and Cyrillic text needs no shaping once it is NFC-composed, so
 * every feature is off and each glyph maps to exactly the character it
 * was drawn for. Scripts that need shaping (Arabic, Devanagari) are not
 * covered by this face either, and would need a shaping renderer.
 */
const NO_SHAPING: Readonly<Record<string, boolean>> = Object.fromEntries(
  [
    "ccmp",
    "locl",
    "rlig",
    "mark",
    "mkmk",
    "calt",
    "clig",
    "liga",
    "rclt",
    "curs",
    "kern",
  ].map((feature) => [feature, false]),
);

/** Embed the bundled faces into `pdf`, subset to what the file draws. */
export async function embedFonts(pdf: PDFDocument): Promise<EmbeddedFonts> {
  const bytes = await loadFontBytes();
  pdf.registerFontkit(fontkit());
  const [regular, bold] = await Promise.all([
    pdf.embedFont(bytes.regular, { subset: false, features: NO_SHAPING }),
    pdf.embedFont(bytes.bold, { subset: false, features: NO_SHAPING }),
  ]);
  const wrapFont = (font: PDFFont): EmbeddedFont => {
    const text = textFor(font);
    // With shaping off a line's width is the sum of its characters'
    // advances, so each character is measured once per document. Asking
    // fontkit to lay out every candidate line while wrapping a long brief
    // was the slow part of an export.
    const advances = new Map<string, number>();
    const advance = (character: string): number => {
      let known = advances.get(character);
      if (known === undefined) {
        known = font.widthOfTextAtSize(character, 1000) / 1000;
        advances.set(character, known);
      }
      return known;
    };
    return {
      font,
      text,
      width: (input, size) => {
        let units = 0;
        for (const character of text(input)) units += advance(character);
        return units * size;
      },
    };
  };
  return { regular: wrapFont(regular), bold: wrapFont(bold) };
}

/**
 * Draw one line so it never crosses `maxWidth`.
 *
 * The deck layout measures with a font-independent width model so the
 * viewer, the PPTX and the PDF agree about where lines break; Noto Sans
 * Bold runs a few per cent wider than that model at heading sizes. Rather
 * than let a heading run past the gutter, a line that is wider than its
 * box is condensed horizontally (the PDF text operator `Tz`) by exactly
 * the overshoot, floored at 85%. The words, the line breaks and the type
 * size stay what the layout decided; nothing is re-wrapped here.
 */
export function drawLine(
  page: PDFPage,
  fonts: EmbeddedFont,
  input: string,
  options: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly colour: RGB;
    readonly maxWidth: number;
    readonly align?: "left" | "centre";
  },
): void {
  const text = fonts.text(input);
  if (text.trim().length === 0) return;
  const natural = fonts.width(text, options.size);
  const squeeze =
    natural > options.maxWidth && natural > 0
      ? Math.max(0.85, options.maxWidth / natural)
      : 1;
  const drawn = natural * squeeze;
  const x =
    options.align === "centre"
      ? options.x + (options.maxWidth - drawn) / 2
      : options.x;
  if (squeeze < 1) {
    page.pushOperators(
      pushGraphicsState(),
      setCharacterSqueeze(Math.round(squeeze * 1000) / 10),
    );
  }
  page.drawText(text, {
    x,
    y: options.y,
    size: options.size,
    font: fonts.font,
    color: options.colour,
  });
  if (squeeze < 1) {
    page.pushOperators(popGraphicsState());
  }
}
