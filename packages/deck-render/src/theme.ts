/**
 * What a visual direction means, in numbers (QX-004 §3.3, §5).
 *
 * A direction is a choice a founder makes in words — institutional, dark,
 * warm — and everything downstream of that choice is decided here, once.
 * Not in the composer, because what a deck says must not depend on how it
 * looks; and not in a renderer, because three renderers that each decide
 * their own type sizes produce three different decks.
 *
 * The sizes are deliberately large. A deck is read across a room, and the
 * failure this packet names explicitly — shrinking text until it fits —
 * is prevented by having a floor that the layout is not allowed to go
 * under, so that content which does not fit has to be laid out again
 * rather than squeezed.
 */

/** 16:9 at 96dpi in points: the size PowerPoint and a PDF page agree on. */
export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
/** The gutter nothing crosses. A slide with text at its edge reads as a mistake. */
export const MARGIN = 64;

export type DeckTheme = {
  readonly background: string;
  readonly ink: string;
  /** Secondary text: subtitles, axis labels, attribution. */
  readonly muted: string;
  readonly accent: string;
  /** Fill behind a chart column, when the accent would be too loud. */
  readonly surface: string;
  readonly headingFont: string;
  readonly bodyFont: string;
  readonly sizes: {
    readonly title: number;
    readonly slideTitle: number;
    readonly subtitle: number;
    readonly statement: number;
    readonly bullet: number;
    readonly label: number;
  };
  /** Nothing is ever laid out smaller than this. */
  readonly minimumSize: number;
};

const INSTITUTIONAL: DeckTheme = {
  background: "#ffffff",
  ink: "#101418",
  muted: "#5b6570",
  accent: "#1f4f7a",
  surface: "#e8edf2",
  headingFont: "Georgia",
  bodyFont: "Helvetica",
  sizes: {
    title: 54,
    slideTitle: 34,
    subtitle: 20,
    statement: 30,
    bullet: 20,
    label: 14,
  },
  minimumSize: 14,
};

const DARK: DeckTheme = {
  ...INSTITUTIONAL,
  background: "#0e1116",
  ink: "#f2f5f8",
  muted: "#9aa5b1",
  accent: "#4aa3df",
  surface: "#1b212a",
  headingFont: "Helvetica",
};

const WARM: DeckTheme = {
  ...INSTITUTIONAL,
  background: "#fdfaf5",
  ink: "#1d1a16",
  muted: "#6b6258",
  accent: "#b5622a",
  surface: "#f1e7db",
};

const BY_DIRECTION: Readonly<Record<string, DeckTheme>> = {
  MINIMAL_INSTITUTIONAL: INSTITUTIONAL,
  DARK_TECHNICAL: DARK,
  WARM_GROWTH: WARM,
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
};

/**
 * The theme for a direction, with the founder's own accent applied.
 *
 * A direction this build has never heard of falls back to the
 * institutional one rather than failing: the direction is reference data
 * and an older renderer must still draw a newer deck.
 */
export function themeFor(
  // Widened to `string` on purpose, not narrowed to QVisualDirection: an
  // older renderer must still draw a newer deck, and an unknown direction
  // falls through to the institutional default below rather than failing.
  direction: string | undefined,
  accent?: string,
): DeckTheme {
  const base = BY_DIRECTION[direction ?? ""] ?? INSTITUTIONAL;
  return accent === undefined ? base : { ...base, accent };
}
