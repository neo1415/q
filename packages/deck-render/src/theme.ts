import { contrastRatio, mix } from "./contrast.js";
import { fontPairing } from "./design.js";
import type { FaceKey } from "./faces.js";

/**
 * What a visual direction means, in numbers (QX-004 §3.3, §5; deck
 * quality 2026-10-08).
 *
 * A direction is a choice a founder makes in words — institutional, dark,
 * warm — and everything downstream of that choice is decided here, once.
 * Not in the composer, because what a deck says must not depend on how it
 * looks; and not in a renderer, because three renderers that each decide
 * their own type sizes produce three different decks.
 *
 * The scale is a keynote scale, not a document one: a display size for
 * the cover, a title size for the one sentence a slide exists to say, a
 * body size that is still read across a room, and a caption size only for
 * what is read up close (a chart's source, the page number). The floor
 * stays: content that does not fit is laid out again or reported, never
 * squeezed below `minimumSize`.
 *
 * Colour follows a 60/30/10 rule: the page, the ink, one accent. The deep
 * colour is the accent's own darkest shade (or the direction's), used for
 * the cover and closing panels so a deck opens and closes in its brand.
 * No model chooses any of these (ADR 0031).
 */

/** 16:9 at 96dpi in points: the size PowerPoint and a PDF page agree on. */
export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
/** The gutter nothing crosses. A slide with text at its edge reads as a mistake. */
export const MARGIN = 64;
/** The footer's baseline band, inside the bottom gutter. */
export const FOOTER_INSET = 28;

export type DeckTheme = {
  readonly background: string;
  readonly ink: string;
  /** Secondary text: subtitles, axis labels, attribution. */
  readonly muted: string;
  /** The one accent: a fill. As text only through `accentInk`. */
  readonly accent: string;
  /** The accent where it is text: the accent itself when it reads (AA). */
  readonly accentInk: string;
  /** Fill behind a panel or a chart's quiet bars. */
  readonly surface: string;
  /** Thin rules and separators. */
  readonly hairline: string;
  /** The cover's and closing's panel, and the ink on it. */
  readonly deep: string;
  readonly onDeep: string;
  readonly onDeepMuted: string;
  /** Family names, as a PPTX and an SVG name them. */
  readonly headingFont: string;
  readonly bodyFont: string;
  /** The bundled faces the PDF draws (and the layout measures) in. */
  readonly faces: {
    readonly heading: FaceKey;
    readonly body: FaceKey;
    readonly bodyStrong: FaceKey;
  };
  readonly sizes: {
    /** The cover's name. */
    readonly title: number;
    /** A slide's title: its one sentence. */
    readonly slideTitle: number;
    readonly subtitle: number;
    /** A single claim, set large. */
    readonly statement: number;
    readonly bullet: number;
    readonly label: number;
    /** A headline figure. */
    readonly figure: number;
    /** Sources, page numbers, credits. */
    readonly caption: number;
  };
  /** Nothing a slide says is ever laid out smaller than this. */
  readonly minimumSize: number;
  /** Captions (a source, a page number) may go down to this, never lower. */
  readonly captionMinimum: number;
};

const SIZES: DeckTheme["sizes"] = {
  title: 56,
  slideTitle: 34,
  subtitle: 18,
  statement: 34,
  bullet: 18,
  label: 14,
  figure: 60,
  caption: 11,
};

const INSTITUTIONAL: DeckTheme = {
  background: "#ffffff",
  ink: "#0f1b2d",
  muted: "#566273",
  accent: "#1f4e8c",
  accentInk: "#1f4e8c",
  surface: "#f2f4f7",
  hairline: "#d8dde4",
  deep: "#0f2138",
  onDeep: "#ffffff",
  onDeepMuted: "#b7c3d1",
  headingFont: "Source Serif 4",
  bodyFont: "Inter",
  faces: {
    heading: "SOURCE_SERIF_DISPLAY",
    body: "INTER",
    bodyStrong: "INTER_SEMIBOLD",
  },
  sizes: SIZES,
  minimumSize: 14,
  captionMinimum: 10,
};

const DARK: DeckTheme = {
  ...INSTITUTIONAL,
  background: "#0b0f14",
  ink: "#f3f5f7",
  muted: "#9aa4b0",
  accent: "#5aa9e6",
  accentInk: "#5aa9e6",
  surface: "#151b23",
  hairline: "#273141",
  deep: "#0f2236",
  onDeep: "#f3f5f7",
  onDeepMuted: "#9aa4b0",
  headingFont: "Inter",
  faces: {
    heading: "INTER_DISPLAY",
    body: "INTER",
    bodyStrong: "INTER_SEMIBOLD",
  },
};

const WARM: DeckTheme = {
  ...INSTITUTIONAL,
  background: "#fbf8f3",
  ink: "#1e1a15",
  muted: "#6a6056",
  accent: "#b4532a",
  accentInk: "#a14a25",
  surface: "#f3ece2",
  hairline: "#e3d9cc",
  deep: "#2b211a",
  onDeep: "#fbf8f3",
  onDeepMuted: "#d2c4b4",
  headingFont: "Fraunces",
  faces: { heading: "FRAUNCES", body: "INTER", bodyStrong: "INTER_SEMIBOLD" },
};

const BY_DIRECTION: Readonly<Record<string, DeckTheme>> = {
  MINIMAL_INSTITUTIONAL: INSTITUTIONAL,
  DARK_TECHNICAL: DARK,
  WARM_GROWTH: WARM,
};

/** The heading face each pairing's PDF is drawn in (body is always Inter). */
const HEADING_FACE: Readonly<Record<string, FaceKey>> = {
  "Source Serif 4": "SOURCE_SERIF_DISPLAY",
  "IBM Plex Serif": "PLEX_SERIF",
  Fraunces: "FRAUNCES",
  Inter: "INTER_DISPLAY",
};

/**
 * A company's own look, when one is known (BIZ-001; filled by BIZ-005).
 *
 * The one seam through which a brand kit reaches a rendered artifact:
 * a direction and an accent, both optional, both overriding what the
 * composed content carries. It is content about the company — it colours
 * the company's own files and never the Capital Q application chrome,
 * whose `--cq-*` tokens stay the product's visual truth (ADR-001 D3).
 */
export type BrandInput = {
  readonly direction?: string | undefined;
  readonly accent?: string | undefined;
  /**
   * DOCS: the confirmed brand kit's logo, drawn on the cover. Bytes, never
   * a URL: a renderer fetches nothing a brand kit names (PNG or JPEG,
   * checked by magic bytes before it is stored and again when drawn).
   */
  readonly logo?: BrandLogo | undefined;
};

export type BrandLogo = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/png" | "image/jpeg";
};

/** AA for body text; the accent as text must reach it on the page. */
const TEXT_CONTRAST = 4.5;

/** `colour`, moved toward `toward` in steps until it reads on `page`. */
function readableOn(colour: string, page: string, toward: string): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mix(colour, toward, step / 10);
    if ((contrastRatio(candidate, page) ?? 0) >= TEXT_CONTRAST)
      return candidate;
  }
  return toward;
}

/**
 * The theme for a direction, with the founder's own accent applied.
 *
 * A direction this build has never heard of falls back to the
 * institutional one rather than failing: the direction is reference data
 * and an older renderer must still draw a newer deck.
 *
 * A brand accent too light to be read as text stays the fill and its
 * text form is darkened until it reads (ADR 0031); the deep panel becomes
 * the accent's own darkest shade, dark enough for white on it.
 */
export function themeFor(
  // Widened to `string` on purpose, not narrowed to QVisualDirection: an
  // older renderer must still draw a newer deck, and an unknown direction
  // falls through to the institutional default below rather than failing.
  direction: string | undefined,
  accent?: string,
  /** DOCS: a type pairing code; unknown codes keep the direction's faces. */
  pairing?: string,
): DeckTheme {
  const base = BY_DIRECTION[direction ?? ""] ?? INSTITUTIONAL;
  const faces = fontPairing(pairing);
  const branded: DeckTheme =
    accent === undefined
      ? base
      : {
          ...base,
          accent,
          accentInk: readableOn(accent, base.background, base.ink),
          ...(base === DARK
            ? {}
            : {
                deep: readableOn(
                  mix(accent, "#000000", 0.55),
                  base.onDeep,
                  "#000000",
                ),
              }),
        };
  if (faces === undefined) return branded;
  return {
    ...branded,
    headingFont: faces.headingFont,
    bodyFont: faces.bodyFont,
    faces: {
      ...branded.faces,
      heading: HEADING_FACE[faces.headingFont] ?? branded.faces.heading,
    },
  };
}
