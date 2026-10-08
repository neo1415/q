import type { QChart, QDeck, QSlide } from "@capital-q/contracts";

import { contrastRatio, mix } from "./contrast.js";
import { measureIn, type FaceKey } from "./faces.js";
import {
  FOOTER_INSET,
  MARGIN,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  themeFor,
  type BrandInput,
  type DeckTheme,
} from "./theme.js";

/**
 * Where everything on a slide goes (QX-004 §5, §6, §7; deck quality
 * 2026-10-08).
 *
 * One layout, computed once, consumed by every renderer. That is the
 * whole point: a viewer, a PPTX and a PDF that each decide their own
 * wrapping produce three decks that disagree about how much fits, and the
 * one the founder checked is not the one the investor opens.
 *
 * It is also what makes visual QA a fact rather than an opinion. "Does
 * this slide overflow" is answerable here, before anything is drawn, by
 * asking whether a box ran past the margin — so a bad slide is caught and
 * laid out again instead of being rendered and looked at afterwards.
 *
 * **The design system.** A 12-column grid inside a 64pt gutter; a title
 * that is the slide's one sentence, set in the deck's heading face; body
 * text held to a readable measure; one accent; and a design per slide
 * chosen by code from the slide's own shape (ADR 0031: no model picks a
 * layout's colours or faces). A cover opens on the deck's deep colour,
 * headline figures are set as figures, a chart takes the slide with its
 * takeaway beside it, a list of two to four points becomes columns, a
 * team becomes a grid, a FLOW a timeline, parts of a whole a donut, a
 * market's figures nested rings. Nothing here adds a word or a number the
 * deck does not carry: every label drawn is the slide's own.
 *
 * Text is measured with the advance widths of the face it will be drawn
 * in (`faces.ts`), so the PDF draws exactly the lines measured here.
 */

export type TextBox = {
  readonly kind: "TEXT";
  readonly role:
    | "TITLE"
    | "SUBTITLE"
    | "HEADING"
    | "BULLET"
    | "LABEL"
    /** Deck quality: a source line or a credit, read up close. */
    | "CAPTION"
    /** Deck quality: the company and page number, in the bottom gutter. */
    | "FOOTER";
  /** Already wrapped: one entry per rendered line. */
  readonly lines: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly colour: string;
  readonly bold: boolean;
  readonly align: "left" | "centre" | "right";
  /**
   * Deck quality: the bundled face this box was measured in and is drawn
   * in. Absent (the newspaper, older callers): the generic width model and
   * Noto Sans.
   */
  readonly face?: FaceKey | undefined;
};

export type ChartBar = {
  readonly label: readonly string[];
  readonly value: number;
  readonly formatted: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ChartBox = {
  readonly kind: "CHART";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bars: readonly ChartBar[];
  readonly baseline: number;
  readonly unit: string;
  readonly colour: string;
  readonly labelSize: number;
  /**
   * Deck quality: the column the chart is about (the latest), drawn in the
   * accent; the others in `quiet`. Absent: every column in `colour`.
   */
  readonly highlight?: number | undefined;
  readonly quiet?: string | undefined;
  /** The faces its labels and values are drawn in. */
  readonly face?: FaceKey | undefined;
  readonly strongFace?: FaceKey | undefined;
  /** Ink for values and labels; absent: the deck theme's. */
  readonly ink?: string | undefined;
  readonly muted?: string | undefined;
};

export type RuleBox = {
  readonly kind: "RULE";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
  /**
   * Q room W5: this fill marks a placeholder's space (a picture to drop
   * here, or a fact the record does not hold yet). Renderers draw it like
   * any rule; the room reads it as a drop target.
   */
  readonly placeholder?: "IMAGE" | "TEXT" | undefined;
  /** Deck quality: rounded corners, in points. */
  readonly radius?: number | undefined;
  /**
   * Deck quality: a panel that runs to the slide's edge on purpose (the
   * cover's colour field). The gutter rule does not apply to it.
   */
  readonly bleed?: boolean | undefined;
};

/** A stock photograph, full-bleed on its side of the slide. */
export type ImageBox = {
  readonly kind: "IMAGE";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly alt: string;
  readonly credit: string;
  /**
   * DOCS: "cover" fills the box and crops (a photo); "contain" fits inside
   * it uncropped (a logo). Absent is cover.
   */
  readonly fit?: "cover" | "contain" | undefined;
};

/**
 * DOCS: a stroked polyline through points (a line chart's series).
 * Decoration like a rule: the numbers it joins are printed beside them.
 */
export type PathBox = {
  readonly kind: "PATH";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly colour: string;
  readonly strokeWidth: number;
};

/** A filled circle: a step marker, a ring, a monogram. Decoration, like a rule. */
export type CircleBox = {
  readonly kind: "CIRCLE";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
};

/**
 * Deck quality: one segment of a donut — a ring from `start` through
 * `sweep` degrees, clockwise from twelve o'clock, `thickness` deep, inside
 * the square box. Decoration: its value is printed in the legend.
 */
export type ArcBox = {
  readonly kind: "ARC";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly start: number;
  readonly sweep: number;
  readonly thickness: number;
  readonly colour: string;
};

export type LaidOutBox =
  TextBox | ChartBox | RuleBox | ImageBox | CircleBox | PathBox | ArcBox;

/** Deck quality: which design a slide was drawn as (for tests and QA). */
export type SlideDesign =
  | "COVER"
  | "CLOSING"
  | "STATEMENT"
  | "LIST"
  | "KPI"
  | "KPI_CHART"
  | "CHART"
  | "DONUT"
  | "MARKET"
  | "TEAM"
  | "TIMELINE"
  | "TWO_COLUMN"
  | "QUOTE"
  | "PRODUCT";

export type LaidOutSlide = {
  readonly index: number;
  readonly layout: QSlide["layout"];
  readonly title: string;
  readonly boxes: readonly LaidOutBox[];
  /** The founder's own words for this slide, carried through to a PPTX note. */
  readonly note: string | undefined;
  /**
   * Content this layout could not place. Never silently dropped: the
   * inspector reports it, and the fitter's job is to get it to empty.
   */
  readonly dropped: readonly string[];
  /**
   * This slide's own background, when the person chose one for the cover
   * (ADR 0025): one stop is a fill, two a top-to-bottom gradient. Absent:
   * the theme's background.
   */
  readonly background?: readonly string[] | undefined;
  readonly design?: SlideDesign | undefined;
};

export type LaidOutDeck = {
  readonly theme: DeckTheme;
  readonly width: number;
  readonly height: number;
  readonly slides: readonly LaidOutSlide[];
};

/**
 * Roughly how wide a string is, in points, at a given size, in no face in
 * particular. Kept for the newspaper and older callers; a deck's own text
 * is measured in its face (`measureIn`).
 *
 * The factors are deliberately generous. Over-estimating wraps a line
 * early, which reads fine; under-estimating runs text off a slide, which
 * does not.
 */
const NARROW = new Set([..."iljtfrI.,;:'|!()[]{}-"]);
const WIDE = new Set([..."mwMW@%"]);

export function measure(text: string, size: number, face?: FaceKey): number {
  if (face !== undefined) return measureIn(text, size, face);
  let units = 0;
  for (const character of text) {
    if (NARROW.has(character)) units += 0.34;
    else if (WIDE.has(character)) units += 0.92;
    else if (character === " ") units += 0.28;
    else if (character >= "A" && character <= "Z") units += 0.68;
    else units += 0.54;
  }
  return units * size;
}

/** Break a string into lines that each fit `width`, longest-first-fit. */
export function wrap(
  text: string,
  size: number,
  width: number,
  face?: FaceKey,
): readonly string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (measure(candidate, size, face) <= width || line.length === 0) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line.length > 0) lines.push(line);
  // A last line of one short word reads as a mistake (a widow): take a
  // word down from the line above when that line can spare it.
  const last = lines[lines.length - 1];
  const above = lines[lines.length - 2];
  if (
    lines.length >= 2 &&
    last !== undefined &&
    above !== undefined &&
    !last.includes(" ") &&
    above.includes(" ")
  ) {
    const cut = above.lastIndexOf(" ");
    const moved = `${above.slice(cut + 1)} ${last}`;
    if (measure(moved, size, face) <= width) {
      lines[lines.length - 2] = above.slice(0, cut);
      lines[lines.length - 1] = moved;
    }
  }
  return lines;
}

const LINE_SPACING = 1.32;

type TextOptions = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly size: number;
  readonly colour: string;
  readonly bold?: boolean;
  readonly align?: TextBox["align"];
  readonly face?: FaceKey;
  /** Line height as a multiple of the size. */
  readonly leading?: number;
  /** At most this many lines; the rest is reported by the caller. */
  readonly maxLines?: number;
};

function text(
  role: TextBox["role"],
  content: string,
  options: TextOptions,
): TextBox {
  const all = wrap(content, options.size, options.width, options.face);
  const lines =
    options.maxLines === undefined ? all : all.slice(0, options.maxLines);
  const lineHeight = Math.round(
    options.size * (options.leading ?? LINE_SPACING),
  );
  return {
    kind: "TEXT",
    role,
    lines,
    x: Math.round(options.x),
    y: Math.round(options.y),
    width: Math.round(options.width),
    height: lines.length * lineHeight,
    size: options.size,
    lineHeight,
    colour: options.colour,
    bold: options.bold ?? false,
    align: options.align ?? "left",
    ...(options.face === undefined ? {} : { face: options.face }),
  };
}

/** Whether `content` wrapped at these options would need more lines than allowed. */
function overflows(content: string, options: TextOptions): boolean {
  return (
    options.maxLines !== undefined &&
    wrap(content, options.size, options.width, options.face).length >
      options.maxLines
  );
}

/**
 * A number as a person reads it.
 *
 * The value is the composer's decimal string and stays authoritative; this
 * only decides how many places to show, so an axis does not read
 * "320.00000001". Nothing is rounded to a different number: a value with
 * decimals keeps one.
 */
function formatValue(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const shown = Number.isInteger(parsed)
    ? parsed.toString()
    : parsed.toFixed(1);
  return shown.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "1,200 USD", or "1,200" for a plain count. */
function formatted(chart: QChart, value: string): string {
  return `${formatValue(value)}${chart.unit === "count" ? "" : ` ${chart.unit}`}`;
}

type Frame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

// --- the grid -----------------------------------------------------------------

const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;
const GUTTER = 24;
const COLUMN = (CONTENT_WIDTH - GUTTER * 11) / 12;
/** The width of `n` grid columns and the gutters between them. */
const span = (n: number): number => Math.round(n * COLUMN + (n - 1) * GUTTER);
const BOTTOM = SLIDE_HEIGHT - MARGIN;
/** Where a photo's side of the slide begins. */
const PHOTO_LEFT = 480;
/** Body text is held to a readable measure, never the slide's full width. */
const MEASURE_MAX = 660;

/** Every colour a slide is drawn in, after the person's page choices. */
type Palette = DeckTheme;

type Context = {
  readonly theme: Palette;
  readonly scale: number;
  readonly size: (base: number) => number;
  readonly boxes: LaidOutBox[];
  readonly dropped: string[];
};

function contextFor(theme: Palette, scale: number): Context {
  return {
    theme,
    scale,
    size: (base) => Math.max(theme.minimumSize, Math.round(base * scale)),
    boxes: [],
    dropped: [],
  };
}

/** The ink that reads on `fill`: whichever of the two is clearer. */
function inkOn(fill: string, light: string, dark: string): string {
  return (contrastRatio(light, fill) ?? 0) >= (contrastRatio(dark, fill) ?? 0)
    ? light
    : dark;
}

/** A slide's title (its one sentence) and its lead line; returns the bottom. */
function header(
  ctx: Context,
  slide: QSlide,
  width: number,
  options: { readonly x?: number; readonly kicker?: string } = {},
): number {
  const { theme } = ctx;
  const x = options.x ?? MARGIN;
  let y = MARGIN;
  if (options.kicker !== undefined) {
    const kicker = text("LABEL", options.kicker, {
      x,
      y,
      width,
      size: ctx.size(theme.sizes.label),
      colour: theme.accentInk,
      bold: true,
      face: theme.faces.bodyStrong,
      maxLines: 1,
    });
    ctx.boxes.push(kicker);
    y += kicker.height + 10;
  }
  const titleOptions: TextOptions = {
    x,
    y,
    width,
    size: ctx.size(theme.sizes.slideTitle),
    colour: theme.ink,
    bold: true,
    face: theme.faces.heading,
    leading: 1.16,
    maxLines: 3,
  };
  const title = text("HEADING", slide.title, titleOptions);
  if (overflows(slide.title, titleOptions)) ctx.dropped.push(slide.title);
  ctx.boxes.push(title);
  y += title.height;
  if (slide.subtitle !== undefined) {
    y += 12;
    const lead = text("SUBTITLE", slide.subtitle, {
      x,
      y,
      width: Math.min(width, MEASURE_MAX),
      size: ctx.size(theme.sizes.subtitle),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.4,
    });
    ctx.boxes.push(lead);
    y += lead.height;
  }
  return y;
}

/** The top of the content area under a header ending at `bottom`. */
const contentTop = (bottom: number, dense = false): number =>
  dense ? Math.max(bottom + 24, 150) : Math.max(bottom + 36, 176);

/** The company and the page number, in the bottom gutter. */
function footer(
  ctx: Context,
  company: string | undefined,
  page: number,
  right: number,
): void {
  const { theme } = ctx;
  const size = theme.sizes.caption;
  const y = SLIDE_HEIGHT - FOOTER_INSET - Math.round(size * 1.3);
  if (company !== undefined) {
    ctx.boxes.push(
      text("FOOTER", company, {
        x: MARGIN,
        y,
        width: 300,
        size,
        colour: theme.muted,
        face: theme.faces.bodyStrong,
        bold: true,
        leading: 1.3,
        maxLines: 1,
      }),
    );
  }
  ctx.boxes.push(
    text("FOOTER", String(page).padStart(2, "0"), {
      x: right - 60,
      y,
      width: 60,
      size,
      colour: theme.muted,
      face: theme.faces.body,
      align: "right",
      leading: 1.3,
    }),
  );
}

// --- body text ------------------------------------------------------------------

/**
 * Points as columns (two to four short ones) or as numbered rows. Returns
 * the bottom of what it placed; what does not fit above `bottom` is
 * reported dropped.
 */
function points(
  ctx: Context,
  items: readonly string[],
  frame: Frame,
  options: { readonly columns: boolean; readonly size?: number },
): number {
  const { theme } = ctx;
  if (items.length === 0) return frame.y;
  const words = items.join(" ").split(/\s+/).length;
  const size =
    options.size ??
    ctx.size(
      words <= 24
        ? theme.sizes.bullet + 6
        : words <= 48
          ? theme.sizes.bullet + 2
          : theme.sizes.bullet,
    );
  const columns = options.columns && items.length >= 2 && items.length <= 4;
  if (columns) {
    const gap = 32;
    const width = Math.floor(
      (frame.width - gap * (items.length - 1)) / items.length,
    );
    const placed: LaidOutBox[] = [];
    let bottom = frame.y;
    let fits = true;
    items.forEach((item, index) => {
      const x = frame.x + index * (width + gap);
      placed.push({
        kind: "RULE",
        x,
        y: frame.y,
        width,
        height: 1,
        colour: theme.hairline,
      });
      placed.push({
        kind: "RULE",
        x,
        y: frame.y - 1,
        width: 28,
        height: 3,
        colour: theme.accent,
      });
      const number = text("LABEL", String(index + 1).padStart(2, "0"), {
        x,
        y: frame.y + 16,
        width,
        size: ctx.size(theme.sizes.label),
        colour: theme.accentInk,
        bold: true,
        face: theme.faces.bodyStrong,
      });
      const body = text("BULLET", item, {
        x,
        y: number.y + number.height + 8,
        width,
        size,
        colour: theme.ink,
        face: theme.faces.body,
        leading: 1.38,
      });
      placed.push(number, body);
      bottom = Math.max(bottom, body.y + body.height);
      if (body.y + body.height > frame.y + frame.height) fits = false;
    });
    if (fits) {
      ctx.boxes.push(...placed);
      return bottom;
    }
  }
  // Rows: a number in the accent, the point beside it, a hairline between.
  // A full slide (five or six points) closes up: tighter rows in two
  // columns of rows, each still a readable measure, before anything is
  // dropped.
  const dense = items.length > 4;
  if (dense && frame.width >= 700) {
    const half = Math.ceil(items.length / 2);
    const width = Math.floor((frame.width - 32) / 2);
    const bottoms = [items.slice(0, half), items.slice(half)].map(
      (part, column) =>
        rows(
          ctx,
          part,
          { ...frame, x: frame.x + column * (width + 32), width },
          size,
          column * half,
          true,
        ),
    );
    return Math.max(...bottoms);
  }
  return rows(ctx, items, frame, size, 0, dense);
}

/** Numbered rows, a hairline between; returns the bottom of what was placed. */
function rows(
  ctx: Context,
  items: readonly string[],
  frame: Frame,
  size: number,
  first: number,
  dense: boolean,
): number {
  const { theme } = ctx;
  const pad = dense ? 8 : 14;
  const indent = 44;
  let y = frame.y;
  items.forEach((item, at) => {
    const index = first + at;
    const body = text("BULLET", item, {
      x: frame.x + indent,
      y: y + pad,
      width: Math.min(frame.width - indent, MEASURE_MAX),
      size,
      colour: theme.ink,
      face: theme.faces.body,
      leading: dense ? 1.3 : 1.38,
    });
    if (body.y + body.height > frame.y + frame.height) {
      ctx.dropped.push(item);
      return;
    }
    ctx.boxes.push({
      kind: "RULE",
      x: frame.x,
      y,
      width: frame.width,
      height: 1,
      colour: theme.hairline,
    });
    ctx.boxes.push(
      text("LABEL", String(index + 1).padStart(2, "0"), {
        x: frame.x,
        y: y + pad + Math.round((size - ctx.size(theme.sizes.label)) * 0.9),
        width: indent - 8,
        size: ctx.size(theme.sizes.label),
        colour: theme.accentInk,
        bold: true,
        face: theme.faces.bodyStrong,
      }),
    );
    ctx.boxes.push(body);
    y = body.y + body.height + pad;
  });
  return y;
}

// --- figures ----------------------------------------------------------------------

type Figure = { readonly value: string; readonly label: string };

/** Figures across a row: the number large, what it counts beneath. */
function figureRow(
  ctx: Context,
  figures: readonly Figure[],
  frame: Frame,
): number {
  const { theme } = ctx;
  const count = figures.length;
  const gap = 32;
  const tile = Math.floor((frame.width - gap * (count - 1)) / count);
  const base = count <= 2 ? theme.sizes.figure + 4 : count === 3 ? 52 : 42;
  let tallest = 0;
  const placed: LaidOutBox[] = [];
  figures.forEach((figure, index) => {
    const x = frame.x + index * (tile + gap);
    if (index > 0) {
      placed.push({
        kind: "RULE",
        x: x - Math.round(gap / 2),
        y: frame.y,
        width: 1,
        height: 0,
        colour: theme.hairline,
      });
    }
    // The value on one line: a long one steps down rather than wrapping.
    let size = ctx.size(base);
    while (
      size > theme.minimumSize + 10 &&
      measureIn(figure.value, size, theme.faces.heading) > tile
    ) {
      size -= 4;
    }
    const value = text("HEADING", figure.value, {
      x,
      y: frame.y,
      width: tile,
      size,
      colour: theme.ink,
      bold: true,
      face: theme.faces.heading,
      leading: 1.08,
    });
    const label = text("LABEL", figure.label, {
      x,
      y: frame.y + value.height + 10,
      width: Math.min(tile, 300),
      size: ctx.size(theme.sizes.label + 1),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.38,
      maxLines: 3,
    });
    placed.push(
      {
        kind: "RULE",
        x,
        y: frame.y - 22,
        width: 28,
        height: 3,
        colour: theme.accent,
      },
      value,
      label,
    );
    tallest = Math.max(tallest, value.height + 10 + label.height);
  });
  // Separators run the height of the tallest tile.
  ctx.boxes.push(
    ...placed.map((box) =>
      box.kind === "RULE" && box.height === 0
        ? { ...box, height: tallest }
        : box,
    ),
  );
  return frame.y + tallest;
}

/** Figures stacked down a column, each under a hairline. */
function figureStack(
  ctx: Context,
  figures: readonly Figure[],
  frame: Frame,
): number {
  const { theme } = ctx;
  let y = frame.y;
  figures.forEach((figure, index) => {
    if (index > 0) {
      ctx.boxes.push({
        kind: "RULE",
        x: frame.x,
        y: y - 14,
        width: frame.width,
        height: 1,
        colour: theme.hairline,
      });
    }
    let size = ctx.size(figures.length > 2 ? 36 : 44);
    while (
      size > theme.minimumSize + 10 &&
      measureIn(figure.value, size, theme.faces.heading) > frame.width
    ) {
      size -= 4;
    }
    const value = text("HEADING", figure.value, {
      x: frame.x,
      y,
      width: frame.width,
      size,
      colour: theme.ink,
      bold: true,
      face: theme.faces.heading,
      leading: 1.08,
    });
    const label = text("LABEL", figure.label, {
      x: frame.x,
      y: y + value.height + 6,
      width: frame.width,
      size: ctx.size(theme.sizes.label),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.36,
      maxLines: 2,
    });
    ctx.boxes.push(value, label);
    y = label.y + label.height + 28;
  });
  return y - 28;
}

// --- charts -----------------------------------------------------------------------

/** Columns from zero, the latest in the accent and the rest quiet. */
function layOutChart(chart: QChart, theme: Palette, frame: Frame): ChartBox {
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  // Room under the columns for a wrapped label and above them for a value.
  const labelBand = Math.round(labelSize * LINE_SPACING * 2) + 8;
  const valueBand = Math.round(labelSize * LINE_SPACING) + 10;
  const plotHeight = Math.max(40, frame.height - labelBand - valueBand);
  const baseline = frame.y + valueBand + plotHeight;

  const values = chart.points.map((point) => Number(point.value));
  const highest = values.reduce(
    (most, value) => (Number.isFinite(value) && value > most ? value : most),
    0,
  );
  const slot = frame.width / chart.points.length;
  const barWidth = Math.min(88, Math.max(24, slot * 0.5));

  const bars: ChartBar[] = chart.points.map((point, index) => {
    const value = Number(point.value);
    const scaled =
      highest > 0 && Number.isFinite(value)
        ? Math.max(2, Math.round((value / highest) * plotHeight))
        : 2;
    const centre = frame.x + slot * index + slot / 2;
    return {
      label: wrap(point.label, labelSize, slot - 8, theme.faces.body).slice(
        0,
        2,
      ),
      value: Number.isFinite(value) ? value : 0,
      formatted: formatted(chart, point.value),
      x: Math.round(centre - barWidth / 2),
      y: baseline - scaled,
      width: Math.round(barWidth),
      height: scaled,
    };
  });

  return {
    kind: "CHART",
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
    bars,
    baseline,
    unit: chart.unit,
    colour: theme.accent,
    labelSize,
    highlight: bars.length - 1,
    quiet: mix(theme.accent, theme.background, 0.62),
    face: theme.faces.body,
    strongFace: theme.faces.bodyStrong,
    ink: theme.ink,
    muted: theme.muted,
  };
}

/**
 * Horizontal bars (DOCS): a label on the left, the bar from a zero
 * baseline, the value printed at its end. For comparisons whose labels
 * are long, which columns would have to wrap into three lines.
 */
function layOutBars(chart: QChart, theme: Palette, area: Frame): LaidOutBox[] {
  // The rows sit a little above the middle of the space, not at its top.
  const rowFor = (height: number) =>
    Math.min(60, Math.floor(height / chart.points.length));
  const frame: Frame = {
    ...area,
    y:
      area.y +
      Math.round(
        (area.height - rowFor(area.height) * chart.points.length) * 0.35,
      ),
  };
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const values = chart.points.map((point) => Number(point.value));
  const highest = values.reduce(
    (most, value) => (Number.isFinite(value) && value > most ? value : most),
    0,
  );
  const top = values.indexOf(highest);
  const labelWidth = Math.round(frame.width * 0.3);
  const valueWidth =
    Math.max(
      ...chart.points.map((point) =>
        measureIn(
          formatted(chart, point.value),
          labelSize,
          theme.faces.bodyStrong,
        ),
      ),
    ) + 12;
  const barLeft = frame.x + labelWidth + 16;
  const barSpan = Math.max(
    40,
    frame.x + frame.width - valueWidth - 8 - barLeft,
  );
  const row = rowFor(area.height);
  const thickness = Math.max(10, Math.round(row * 0.46));
  const boxes: LaidOutBox[] = [
    {
      kind: "RULE",
      x: barLeft - 1,
      y: frame.y,
      width: 1,
      height: row * chart.points.length,
      colour: theme.hairline,
    },
  ];
  chart.points.forEach((point, index) => {
    const value = values[index] ?? 0;
    const rowTop = frame.y + row * index;
    const length =
      highest > 0 && Number.isFinite(value) && value > 0
        ? Math.max(2, Math.round((value / highest) * barSpan))
        : 2;
    const barTop = rowTop + Math.round((row - thickness) / 2);
    const label = text("LABEL", point.label, {
      x: frame.x,
      y: 0,
      width: labelWidth,
      size: labelSize,
      colour: theme.muted,
      face: theme.faces.body,
      maxLines: 2,
    });
    boxes.push({
      ...label,
      y: Math.round(rowTop + (row - label.height) / 2),
    });
    boxes.push({
      kind: "RULE",
      x: barLeft,
      y: barTop,
      width: length,
      height: thickness,
      colour:
        index === top
          ? theme.accent
          : mix(theme.accent, theme.background, 0.55),
    });
    boxes.push(
      text("LABEL", formatted(chart, point.value), {
        x: barLeft + length + 8,
        y: Math.round(rowTop + (row - labelSize * LINE_SPACING) / 2),
        width: valueWidth,
        size: labelSize,
        colour: theme.ink,
        bold: true,
        face: theme.faces.bodyStrong,
      }),
    );
  });
  return boxes;
}

/**
 * A line through an ordered sequence (DOCS): one series, every point
 * marked and its value printed above it, labels along the bottom. Scaled
 * from zero like a column, so a line never exaggerates a change.
 */
function layOutLine(chart: QChart, theme: Palette, frame: Frame): LaidOutBox[] {
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const labelBand = Math.round(labelSize * LINE_SPACING * 2) + 8;
  const valueBand = Math.round(labelSize * LINE_SPACING) + 18;
  const plotHeight = Math.max(40, frame.height - labelBand - valueBand);
  const baseline = frame.y + valueBand + plotHeight;
  const values = chart.points.map((point) => Number(point.value));
  const highest = values.reduce(
    (most, value) => (Number.isFinite(value) && value > most ? value : most),
    0,
  );
  const slot = frame.width / chart.points.length;
  const at = chart.points.map((_, index) => {
    const value = values[index] ?? 0;
    const scaled =
      highest > 0 && Number.isFinite(value) && value > 0
        ? (value / highest) * plotHeight
        : 0;
    return {
      x: Math.round(frame.x + slot * index + slot / 2),
      y: Math.round(baseline - scaled),
    };
  });
  const boxes: LaidOutBox[] = [
    {
      kind: "RULE",
      x: Math.round(frame.x),
      y: baseline,
      width: Math.round(frame.width),
      height: 1,
      colour: theme.hairline,
    },
    {
      kind: "PATH",
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      points: at,
      colour: theme.accent,
      strokeWidth: 3,
    },
  ];
  const last = chart.points.length - 1;
  chart.points.forEach((point, index) => {
    const spot = at[index];
    if (spot === undefined) return;
    const marker = index === last ? 14 : 9;
    boxes.push({
      kind: "CIRCLE",
      x: spot.x - marker / 2,
      y: spot.y - marker / 2,
      width: marker,
      height: marker,
      colour: theme.accent,
    });
    boxes.push(
      text("LABEL", formatted(chart, point.value), {
        x: Math.round(spot.x - slot / 2),
        y: Math.round(spot.y - marker / 2 - 6 - labelSize * LINE_SPACING),
        width: Math.round(slot),
        size: labelSize,
        colour: index === last ? theme.ink : theme.muted,
        bold: true,
        face: theme.faces.bodyStrong,
        align: "centre",
      }),
    );
    boxes.push(
      text("LABEL", point.label, {
        x: Math.round(spot.x - slot / 2 + 4),
        y: baseline + 8,
        width: Math.round(slot - 8),
        size: labelSize,
        colour: theme.muted,
        face: theme.faces.body,
        align: "centre",
        maxLines: 2,
      }),
    );
  });
  return boxes;
}

/** One hue in steps from the accent toward the page, for parts of a whole. */
const tint = (theme: Palette, index: number): string =>
  mix(theme.accent, theme.background, Math.min(0.78, index * 0.2));

/**
 * Parts of a whole (DOCS, deck quality): a donut with the whole's parts
 * clockwise from twelve o'clock, a gap between each, and a legend that
 * names every part with its value and share, so colour never carries the
 * meaning alone. Parts that are not all positive are not a whole: they are
 * drawn as bars instead.
 */
function layOutDonut(
  chart: QChart,
  theme: Palette,
  frame: Frame,
): LaidOutBox[] {
  const values = chart.points.map((point) => Number(point.value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return layOutBars(chart, theme, frame);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const diameter = Math.round(Math.min(frame.height, frame.width * 0.46, 250));
  const thickness = Math.round(diameter * 0.2);
  const top = Math.round(frame.y + (frame.height - diameter) / 2);
  const boxes: LaidOutBox[] = [];
  const gap = values.length > 1 ? 1.6 : 0;
  let angle = 0;
  values.forEach((value, index) => {
    const sweep = (value / total) * 360;
    boxes.push({
      kind: "ARC",
      x: Math.round(frame.x),
      y: top,
      width: diameter,
      height: diameter,
      start: angle + gap / 2,
      sweep: Math.max(0.5, sweep - gap),
      thickness,
      colour: tint(theme, index),
    });
    angle += sweep;
  });
  // The legend: swatch, part, value and share.
  const legendX = Math.round(frame.x + diameter + 40);
  const legendWidth = Math.round(frame.x + frame.width - legendX);
  const rowHeight = Math.round(labelSize * LINE_SPACING) + 14;
  const legendTop = Math.round(
    frame.y + (frame.height - rowHeight * values.length) / 2,
  );
  chart.points.forEach((point, index) => {
    const y = legendTop + index * rowHeight;
    const share = Math.round(((values[index] ?? 0) / total) * 100);
    boxes.push({
      kind: "RULE",
      x: legendX,
      y: y + 4,
      width: 12,
      height: 12,
      colour: tint(theme, index),
      radius: 2,
    });
    boxes.push(
      text(
        "LABEL",
        // Parts already given in per cent are their own share.
        chart.unit === "%"
          ? `${point.label}: ${formatValue(point.value)}%`
          : `${point.label}: ${formatted(chart, point.value)} (${String(share)}%)`,
        {
          x: legendX + 22,
          y,
          width: legendWidth - 22,
          size: labelSize,
          colour: theme.ink,
          face: theme.faces.body,
          maxLines: 1,
        },
      ),
    );
  });
  return boxes;
}

/**
 * A chart in the form its kind names, with its source line under it
 * (DOCS: a chart says where its numbers came from on the slide itself).
 */
function layOutChartForm(
  chart: QChart,
  page: Palette,
  frame: Frame,
): LaidOutBox[] {
  // A mark carries meaning, so it needs WCAG's 3:1 for graphics: a brand
  // accent too light for that is drawn in its darkened text form.
  const theme: Palette =
    (contrastRatio(page.accent, page.background) ?? 0) >= 3
      ? page
      : { ...page, accent: page.accentInk };
  const captionSize = theme.sizes.caption;
  const sourceBand =
    chart.source === undefined ? 0 : Math.round(captionSize * 1.4) + 14;
  const plot = { ...frame, height: frame.height - sourceBand };
  const boxes: LaidOutBox[] =
    chart.kind === "BAR"
      ? layOutBars(chart, theme, plot)
      : chart.kind === "LINE"
        ? layOutLine(chart, theme, plot)
        : chart.kind === "DONUT"
          ? layOutDonut(chart, theme, plot)
          : [layOutChart(chart, theme, plot)];
  if (chart.source !== undefined) {
    boxes.push(
      text("CAPTION", `Source: ${chart.source}`, {
        x: frame.x,
        y: frame.y + frame.height - sourceBand + 14,
        width: frame.width,
        size: captionSize,
        colour: theme.muted,
        face: theme.faces.body,
        leading: 1.4,
        maxLines: 1,
      }),
    );
  }
  return boxes;
}

// --- placeholders -----------------------------------------------------------------

/**
 * Q room W5: a placeholder's space, drawn so it reads as "add yours here"
 * and never as a fault: a quiet fill, a fine border, a plus mark and the
 * label in ink. The fill carries the placeholder kind for the room's
 * drop target.
 */
function placeholderSpace(
  area: Frame,
  kind: "IMAGE" | "TEXT",
  label: string,
  theme: Palette,
  options: { readonly bleed?: boolean; readonly framed?: boolean } = {},
): LaidOutBox[] {
  const size = Math.max(theme.minimumSize, theme.sizes.label);
  const plain = options.bleed === true || options.framed === true;
  const boxes: LaidOutBox[] = [
    {
      kind: "RULE",
      ...area,
      colour: theme.surface,
      placeholder: kind,
      ...(options.bleed === true
        ? { bleed: true }
        : plain
          ? {}
          : { radius: 6 }),
    },
  ];
  if (!plain) {
    // A fine border, drawn as four hairlines inside the fill.
    const { x, y, width, height } = area;
    const line = mix(theme.hairline, theme.muted, 0.25);
    boxes.push(
      { kind: "RULE", x: x + 6, y, width: width - 12, height: 1, colour: line },
      {
        kind: "RULE",
        x: x + 6,
        y: y + height - 1,
        width: width - 12,
        height: 1,
        colour: line,
      },
      {
        kind: "RULE",
        x,
        y: y + 6,
        width: 1,
        height: height - 12,
        colour: line,
      },
      {
        kind: "RULE",
        x: x + width - 1,
        y: y + 6,
        width: 1,
        height: height - 12,
        colour: line,
      },
    );
  }
  // Inside the gutter on every side, like every other word on a slide.
  const inner =
    options.bleed === true
      ? {
          x: area.x + 40,
          width:
            Math.min(area.x + area.width - 40, SLIDE_WIDTH - MARGIN) -
            (area.x + 40),
        }
      : { x: area.x + 24, width: area.width - 48 };
  const words = text("LABEL", label, {
    x: inner.x,
    y: 0,
    width: inner.width,
    size,
    colour: theme.ink,
    bold: true,
    face: theme.faces.bodyStrong,
    align: kind === "IMAGE" ? "centre" : "left",
    maxLines: 3,
  });
  if (kind === "IMAGE") {
    // A plus, centred above the words: the place to drop a picture.
    const block = 28 + 14 + words.height;
    const top = Math.round(area.y + (area.height - block) / 2);
    const centreX = Math.round(inner.x + inner.width / 2);
    boxes.push(
      {
        kind: "CIRCLE",
        x: centreX - 14,
        y: top,
        width: 28,
        height: 28,
        colour: theme.accent,
      },
      {
        kind: "RULE",
        x: centreX - 6,
        y: top + 13,
        width: 12,
        height: 2,
        colour: inkOn(theme.accent, "#ffffff", "#000000"),
      },
      {
        kind: "RULE",
        x: centreX - 1,
        y: top + 8,
        width: 2,
        height: 12,
        colour: inkOn(theme.accent, "#ffffff", "#000000"),
      },
      { ...words, y: top + 28 + 14 },
    );
  } else {
    const y = Math.round(area.y + (area.height - words.height) / 2);
    boxes.push(
      {
        kind: "RULE",
        x: area.x + 24,
        y: y + 2,
        width: 3,
        height: words.height - 4,
        colour: theme.accent,
      },
      { ...words, x: words.x + 14, width: words.width - 14, y },
    );
  }
  return boxes;
}

// --- designs ----------------------------------------------------------------------

type Picture = NonNullable<QSlide["image"]>;

type SlideInput = {
  readonly slide: QSlide;
  readonly index: number;
  readonly company: string | undefined;
  readonly image: Picture | undefined;
  readonly logo: BrandInput["logo"];
  /** The person's own cover colours (ADR 0025): no deep panel then. */
  readonly ownCover: boolean;
  /** The person's own page colour: no deep panel on a closing slide either. */
  readonly ownPage: boolean;
};

const TEAM = /\bteam\b|founders?\b/i;
const MARKET = /\bmarket\b|\bTAM\b/i;
const PRODUCT = /\bproduct\b|screenshot/i;

/** Which design a slide is drawn as: chosen from its shape, by code. */
export function designFor(slide: QSlide, index: number): SlideDesign {
  const figures = slide.figures ?? [];
  if (slide.layout === "TITLE") return index === 0 ? "COVER" : "CLOSING";
  if (slide.layout === "QUOTE") return "QUOTE";
  if (slide.chart?.kind === "DONUT") return "DONUT";
  if (slide.layout === "CHART" && slide.chart !== undefined) {
    return figures.length > 0 ? "KPI_CHART" : "CHART";
  }
  if (slide.chart !== undefined) {
    return figures.length > 0 ? "KPI_CHART" : "CHART";
  }
  if (
    slide.visual === "FLOW" &&
    slide.bullets.length >= 2 &&
    slide.bullets.length <= 5
  ) {
    return "TIMELINE";
  }
  if (figures.length >= 2 && MARKET.test(slide.title)) return "MARKET";
  if (figures.length > 0) return "KPI";
  if (slide.layout === "TWO_COLUMN") return "TWO_COLUMN";
  if (
    TEAM.test(slide.title) &&
    (people(slide) !== null || slide.placeholder?.kind === "TEXT")
  ) {
    return "TEAM";
  }
  if (
    PRODUCT.test(`${slide.title} ${slide.placeholder?.label ?? ""}`) &&
    (slide.placeholder?.kind === "IMAGE" ||
      slide.image?.provenance === "OWN_UPLOAD")
  ) {
    return "PRODUCT";
  }
  if (slide.layout === "STATEMENT") return "STATEMENT";
  return "LIST";
}

type Person = { readonly name: string; readonly role: string };

/**
 * A team slide's bullets as people, when every one reads "Name — role"
 * (or "Name, role" / "Name: role"); null when any is prose, which is then
 * set as prose. The words are split, never rewritten.
 */
function people(slide: QSlide): readonly Person[] | null {
  if (slide.bullets.length === 0 || slide.bullets.length > 6) return null;
  const found: Person[] = [];
  for (const bullet of slide.bullets) {
    const match = /^([^,:—–(]{2,40}?)\s*(?:—|–|-|:|,|\()\s*(.+?)\)?$/.exec(
      bullet.trim(),
    );
    const name = match?.[1]?.trim() ?? "";
    const role = match?.[2]?.trim() ?? "";
    const words = name.split(/\s+/);
    if (
      match === null ||
      words.length > 4 ||
      !words.every((word) => /^[\p{Lu}]/u.test(word)) ||
      role.length === 0
    ) {
      return null;
    }
    found.push({ name, role });
  }
  return found;
}

/** Two letters for a monogram, from the name as written. */
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => /^[\p{L}]/u.test(word))
    .map((word) => [...word][0] ?? "");
  return `${letters[0] ?? ""}${letters.length > 1 ? (letters[letters.length - 1] ?? "") : ""}`.toUpperCase();
}

/** A photo on its half of the slide, edge to edge. */
function photo(image: Picture): LaidOutBox {
  return {
    kind: "IMAGE",
    x: PHOTO_LEFT,
    y: 0,
    width: SLIDE_WIDTH - PHOTO_LEFT,
    height: SLIDE_HEIGHT,
    url: image.url,
    alt: image.alt,
    credit: image.credit,
  };
}

function layOutSlide(
  input: SlideInput,
  theme: Palette,
  scale: number,
): LaidOutSlide {
  const { slide, index } = input;
  const ctx = contextFor(theme, scale);
  const design = designFor(slide, index);
  const finish = (background?: readonly string[]): LaidOutSlide => ({
    index,
    layout: slide.layout,
    title: slide.title,
    boxes: ctx.boxes,
    note: slide.note,
    dropped: ctx.dropped,
    design,
    ...(background === undefined ? {} : { background }),
  });

  if (design === "COVER" || design === "CLOSING") {
    return coverSlide(ctx, input, design);
  }

  // A photo (or the space for one) takes the right half of a words slide.
  const pictured =
    design === "STATEMENT" || design === "LIST" || design === "TEAM";
  const image = pictured ? input.image : undefined;
  const imageSpace =
    image === undefined && pictured && slide.placeholder?.kind === "IMAGE"
      ? slide.placeholder
      : undefined;
  const split = image !== undefined || imageSpace !== undefined;
  const right = split ? PHOTO_LEFT - 56 : SLIDE_WIDTH - MARGIN;
  const width = right - MARGIN;

  if (design === "STATEMENT") {
    statementSlide(ctx, slide, width);
  } else if (design === "PRODUCT") {
    productSlide(ctx, slide, input.image);
  } else if (design === "QUOTE") {
    quoteSlide(ctx, slide);
  } else {
    const bottom = header(
      ctx,
      slide,
      Math.min(width, split ? width : span(10)),
    );
    const top = contentTop(bottom, slide.bullets.length > 4);
    const area: Frame = { x: MARGIN, y: top, width, height: BOTTOM - top };
    switch (design) {
      case "KPI":
        kpiSlide(ctx, slide, area);
        break;
      case "KPI_CHART":
        kpiChartSlide(ctx, slide, area);
        break;
      case "CHART":
        chartSlide(ctx, slide, area);
        break;
      case "DONUT":
        donutSlide(ctx, slide, area);
        break;
      case "MARKET":
        marketSlide(ctx, slide, area);
        break;
      case "TEAM":
        teamSlide(ctx, slide, area, split);
        break;
      case "TIMELINE":
        timelineSlide(ctx, slide, area);
        break;
      case "TWO_COLUMN":
        twoColumnSlide(ctx, slide, area);
        break;
      case "LIST":
      default:
        points(ctx, slide.bullets, area, { columns: !split });
    }
  }

  if (image !== undefined) ctx.boxes.push(photo(image));
  if (imageSpace !== undefined) {
    ctx.boxes.push(
      ...placeholderSpace(
        {
          x: PHOTO_LEFT,
          y: 0,
          width: SLIDE_WIDTH - PHOTO_LEFT,
          height: SLIDE_HEIGHT,
        },
        "IMAGE",
        imageSpace.label,
        theme,
        { bleed: true },
      ),
    );
  } else if (slide.placeholder?.kind === "TEXT" && design !== "TEAM") {
    // A fact still to come: a marked band under whatever the slide says,
    // only where the slide leaves room for it (never over its words).
    const used = Math.max(
      MARGIN,
      ...ctx.boxes
        .filter((box) => !(box.kind === "TEXT" && box.role === "FOOTER"))
        .map((box) => box.y + box.height),
    );
    const band = { x: MARGIN, y: BOTTOM - 72, width, height: 72 };
    if (used + 16 <= band.y) {
      ctx.boxes.push(
        ...placeholderSpace(band, "TEXT", slide.placeholder.label, theme),
      );
    }
  }
  footer(ctx, input.company, index + 1, right);
  return finish();
}

/** The cover, or a closing slide: the deck's deep colour, the name large. */
function coverSlide(
  ctx: Context,
  input: SlideInput,
  design: "COVER" | "CLOSING",
): LaidOutSlide {
  const { slide, index } = input;
  const own = input.ownCover || (design === "CLOSING" && input.ownPage);
  const theme = ctx.theme;
  const image = design === "COVER" ? input.image : undefined;
  const imageSpace =
    design === "COVER" &&
    image === undefined &&
    slide.placeholder?.kind === "IMAGE"
      ? slide.placeholder
      : undefined;
  const panelRight =
    image !== undefined || imageSpace !== undefined ? 528 : SLIDE_WIDTH;
  const ink = own ? theme.ink : theme.onDeep;
  const soft = own ? theme.muted : theme.onDeepMuted;
  if (!own) {
    ctx.boxes.push({
      kind: "RULE",
      x: 0,
      y: 0,
      width: panelRight,
      height: SLIDE_HEIGHT,
      colour: theme.deep,
      bleed: true,
    });
  }
  const width = Math.min(panelRight - MARGIN - 56, 680);
  const titleSize = ctx.size(
    design === "CLOSING"
      ? 44
      : slide.title.length <= 16
        ? 68
        : theme.sizes.title,
  );
  const titleOptions: TextOptions = {
    x: MARGIN,
    y: 0,
    width,
    size: titleSize,
    colour: ink,
    bold: true,
    face: theme.faces.heading,
    leading: 1.06,
    maxLines: 3,
  };
  const title = text("TITLE", slide.title, titleOptions);
  if (overflows(slide.title, titleOptions)) ctx.dropped.push(slide.title);
  const subtitle =
    slide.subtitle === undefined
      ? null
      : text("SUBTITLE", slide.subtitle, {
          x: MARGIN,
          y: 0,
          width: Math.min(width, 520),
          size: ctx.size(theme.sizes.subtitle + 2),
          colour: soft,
          face: theme.faces.body,
          leading: 1.4,
          maxLines: 4,
        });
  const lines =
    slide.bullets.length > 0 && design === "CLOSING"
      ? text("BULLET", slide.bullets.join("  ·  "), {
          x: MARGIN,
          y: 0,
          width,
          size: ctx.size(theme.sizes.bullet),
          colour: soft,
          face: theme.faces.body,
          leading: 1.4,
          maxLines: 3,
        })
      : null;
  const ruleGap = 28;
  const block =
    3 +
    ruleGap +
    title.height +
    (subtitle === null ? 0 : 20 + subtitle.height) +
    (lines === null ? 0 : 20 + lines.height);
  // The cover's words sit low, the way a title page does; a closing
  // slide's sit in the middle.
  const top =
    design === "COVER"
      ? Math.max(MARGIN + 72, BOTTOM - 24 - block)
      : Math.max(MARGIN, Math.round((SLIDE_HEIGHT - block) / 2));
  ctx.boxes.push({
    kind: "RULE",
    x: MARGIN,
    y: top,
    width: 40,
    height: 3,
    colour: own ? theme.accent : mix(theme.accent, theme.onDeep, 0.25),
  });
  let y = top + 3 + ruleGap;
  ctx.boxes.push({ ...title, y });
  y += title.height;
  if (subtitle !== null) {
    y += 20;
    ctx.boxes.push({ ...subtitle, y });
    y += subtitle.height;
  }
  if (lines !== null) {
    y += 20;
    ctx.boxes.push({ ...lines, y });
  }
  if (image !== undefined) {
    ctx.boxes.push({
      kind: "IMAGE",
      x: panelRight,
      y: 0,
      width: SLIDE_WIDTH - panelRight,
      height: SLIDE_HEIGHT,
      url: image.url,
      alt: image.alt,
      credit: image.credit,
    });
  }
  if (imageSpace !== undefined) {
    ctx.boxes.push(
      ...placeholderSpace(
        {
          x: panelRight,
          y: 0,
          width: SLIDE_WIDTH - panelRight,
          height: SLIDE_HEIGHT,
        },
        "IMAGE",
        imageSpace.label,
        theme,
        { bleed: true },
      ),
    );
  }
  // DOCS: the company's own logo on the cover, top left, uncropped.
  if (design === "COVER" && input.logo !== undefined) {
    ctx.boxes.push({
      kind: "IMAGE",
      x: MARGIN,
      y: MARGIN,
      width: 180,
      height: 48,
      url: `data:${input.logo.contentType};base64,${Buffer.from(input.logo.bytes).toString("base64")}`,
      alt: "Company logo",
      credit: "",
      fit: "contain",
    });
  }
  return {
    index,
    layout: slide.layout,
    title: slide.title,
    boxes: ctx.boxes,
    note: slide.note,
    dropped: ctx.dropped,
    design,
  };
}

/** One claim, set large in the heading face, the topic above it. */
function statementSlide(ctx: Context, slide: QSlide, width: number): void {
  const { theme } = ctx;
  const claim = slide.bullets[0];
  if (claim === undefined) {
    header(ctx, slide, width);
    return;
  }
  const kicker = text("LABEL", slide.title, {
    x: MARGIN,
    y: MARGIN,
    width,
    size: ctx.size(theme.sizes.label),
    colour: theme.accentInk,
    bold: true,
    face: theme.faces.bodyStrong,
    maxLines: 2,
  });
  ctx.boxes.push(kicker);
  const words = claim.split(/\s+/).length;
  const base =
    words <= 14
      ? theme.sizes.statement + 4
      : words <= 26
        ? theme.sizes.statement
        : 28;
  const top = kicker.y + kicker.height + 28;
  const statement = text("BULLET", claim, {
    x: MARGIN,
    y: 0,
    width: Math.min(width, 760),
    size: ctx.size(base),
    colour: theme.ink,
    face: theme.faces.heading,
    bold: true,
    leading: 1.2,
  });
  const room = BOTTOM - 40 - top;
  if (statement.height > room) {
    ctx.dropped.push(claim);
    return;
  }
  // Optically centred: a little above the middle of the space left.
  const y = top + Math.max(0, Math.round((room - statement.height) * 0.42));
  ctx.boxes.push({ ...statement, y });
  const rest = slide.bullets.slice(1);
  if (rest.length > 0) {
    const after = y + statement.height + 28;
    points(
      ctx,
      rest,
      { x: MARGIN, y: after, width, height: BOTTOM - after },
      {
        columns: false,
        size: ctx.size(theme.sizes.bullet - 2),
      },
    );
  }
}

/** Somebody's words, large, with a quotation mark in the accent. */
function quoteSlide(ctx: Context, slide: QSlide): void {
  const { theme } = ctx;
  const words = slide.bullets[0] ?? slide.title;
  const mark = text("HEADING", "“", {
    x: MARGIN,
    y: MARGIN,
    width: 80,
    size: 110,
    colour: theme.accentInk,
    bold: true,
    face: theme.faces.heading,
    leading: 1,
  });
  ctx.boxes.push({ ...mark, height: 70 });
  const quote = text("BULLET", words, {
    x: MARGIN,
    y: MARGIN + 92,
    width: span(10),
    size: ctx.size(words.split(/\s+/).length <= 24 ? 32 : 26),
    colour: theme.ink,
    face: theme.faces.heading,
    bold: true,
    leading: 1.24,
  });
  if (quote.y + quote.height > BOTTOM - 40) {
    ctx.dropped.push(words);
    return;
  }
  ctx.boxes.push(quote);
  if (slide.attribution !== undefined) {
    ctx.boxes.push(
      text("LABEL", `— ${slide.attribution}`, {
        x: MARGIN,
        y: quote.y + quote.height + 24,
        width: span(10),
        size: ctx.size(theme.sizes.label + 2),
        colour: theme.muted,
        face: theme.faces.body,
        maxLines: 2,
      }),
    );
  }
}

/** Headline figures across the slide, the lines that remain beneath. */
function kpiSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const figures = slide.figures ?? [];
  const top = area.y + 22;
  if (
    figures.length === 1 &&
    slide.bullets.length > 0 &&
    area.width > span(9)
  ) {
    // One figure: the number holds the left, the points the right, so
    // neither floats alone on a wide slide.
    figureRow(ctx, figures, { ...area, y: top, width: span(5) });
    const x = area.x + span(5) + GUTTER * 2;
    points(
      ctx,
      slide.bullets,
      {
        x,
        y: top - 22,
        width: area.x + area.width - x,
        height: BOTTOM - top + 22,
      },
      { columns: false, size: ctx.size(theme.sizes.bullet) },
    );
    return;
  }
  const bottom = figureRow(ctx, figures, { ...area, y: top });
  if (slide.bullets.length === 0) return;
  const after = bottom + 40;
  points(
    ctx,
    slide.bullets,
    { x: area.x, y: after, width: area.width, height: BOTTOM - after },
    { columns: true, size: ctx.size(theme.sizes.bullet - 2) },
  );
}

/** Figures down the left, the chart they belong to on the right. */
function kpiChartSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const chart = slide.chart;
  const figures = slide.figures ?? [];
  const left = {
    x: area.x,
    y: area.y + 8,
    width: span(4),
    height: area.height,
  };
  let y = figureStack(ctx, figures, left);
  for (const line of slide.bullets) {
    const body = text("BULLET", line, {
      x: left.x,
      y: y + 24,
      width: left.width,
      size: ctx.size(theme.sizes.bullet - 2),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.4,
    });
    if (body.y + body.height > BOTTOM) {
      ctx.dropped.push(line);
      continue;
    }
    ctx.boxes.push(body);
    y = body.y + body.height;
  }
  if (chart === undefined) return;
  const chartX = area.x + span(4) + GUTTER * 2;
  const frame = {
    x: chartX,
    y: area.y,
    width: area.x + area.width - chartX,
    height: Math.max(0, BOTTOM - area.y),
  };
  if (frame.height < 140) {
    ctx.dropped.push(chart.measure);
    return;
  }
  ctx.boxes.push(...layOutChartForm(chart, theme, frame));
}

/** The chart, with its takeaway beside it when the slide has one. */
function chartSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const chart = slide.chart;
  if (chart === undefined) return;
  const words = slide.bullets;
  let frame: Frame = { ...area, height: BOTTOM - area.y };
  if (words.length > 0) {
    const column = span(4);
    let y = area.y + 8;
    for (const line of words) {
      const body = text("BULLET", line, {
        x: area.x,
        y,
        width: column,
        size: ctx.size(theme.sizes.bullet - 1),
        colour: theme.ink,
        face: theme.faces.body,
        leading: 1.42,
      });
      if (body.y + body.height > BOTTOM) {
        ctx.dropped.push(line);
        continue;
      }
      ctx.boxes.push({
        kind: "RULE",
        x: area.x,
        y: y - 2,
        width: 3,
        height: body.height,
        colour: theme.accent,
      });
      ctx.boxes.push({ ...body, x: body.x + 16, width: body.width - 16 });
      y = body.y + body.height + 18;
    }
    const chartX = area.x + column + GUTTER * 2;
    frame = {
      x: chartX,
      y: area.y,
      width: area.x + area.width - chartX,
      height: BOTTOM - area.y,
    };
  }
  if (frame.height < 140) {
    ctx.dropped.push(chart.measure);
    return;
  }
  ctx.boxes.push(...layOutChartForm(chart, theme, frame));
}

/** The raise and its use: figures and words on the left, the donut right. */
function donutSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const chart = slide.chart;
  if (chart === undefined) return;
  const figures = slide.figures ?? [];
  const hasLeft = figures.length > 0 || slide.bullets.length > 0;
  let chartX = area.x;
  if (hasLeft) {
    const left = {
      x: area.x,
      y: area.y + 8,
      width: span(4),
      height: area.height,
    };
    let y =
      figures.length > 0 ? figureStack(ctx, figures, left) + 8 : left.y - 24;
    for (const line of slide.bullets) {
      const body = text("BULLET", line, {
        x: left.x,
        y: y + 24,
        width: left.width,
        size: ctx.size(theme.sizes.bullet - 2),
        colour: theme.muted,
        face: theme.faces.body,
        leading: 1.4,
      });
      if (body.y + body.height > BOTTOM) {
        ctx.dropped.push(line);
        continue;
      }
      ctx.boxes.push(body);
      y = body.y + body.height;
    }
    chartX = area.x + span(4) + GUTTER * 2;
  }
  const frame = {
    x: chartX,
    y: area.y,
    width: area.x + area.width - chartX,
    height: BOTTOM - area.y,
  };
  if (frame.height < 160) {
    ctx.dropped.push(chart.measure);
    return;
  }
  ctx.boxes.push(...layOutChartForm(chart, theme, frame));
}

/**
 * A market's figures as nested rings, largest first, each ring named in
 * the legend beside it with its figure. Ring sizes are a fixed nesting,
 * not a scale: the figures are printed, never implied by area.
 */
function marketSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const figures = (slide.figures ?? []).slice(0, 3);
  const height = BOTTOM - area.y;
  const outer = Math.round(Math.min(height, 300));
  const ratios = figures.length === 3 ? [1, 0.68, 0.38] : [1, 0.56];
  const cx = area.x + outer / 2;
  const bottomY = area.y + Math.round((height + outer) / 2);
  figures.forEach((_, index) => {
    const d = Math.round(outer * (ratios[index] ?? 0.4));
    ctx.boxes.push({
      kind: "CIRCLE",
      x: Math.round(cx - d / 2),
      y: bottomY - d,
      width: d,
      height: d,
      colour: mix(theme.accent, theme.background, [0.86, 0.6, 0][index] ?? 0),
    });
  });
  const legendX = area.x + outer + 56;
  const legendWidth = area.x + area.width - legendX;
  let y = area.y + 8;
  figures.forEach((figure, index) => {
    ctx.boxes.push({
      kind: "CIRCLE",
      x: legendX,
      y: y + 10,
      width: 14,
      height: 14,
      colour: mix(theme.accent, theme.background, [0.86, 0.6, 0][index] ?? 0),
    });
    const value = text("HEADING", figure.value, {
      x: legendX + 28,
      y,
      width: legendWidth - 28,
      size: ctx.size(34),
      colour: theme.ink,
      bold: true,
      face: theme.faces.heading,
      leading: 1.08,
      maxLines: 1,
    });
    const label = text("LABEL", figure.label, {
      x: legendX + 28,
      y: y + value.height + 4,
      width: legendWidth - 28,
      size: ctx.size(theme.sizes.label),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.36,
      maxLines: 2,
    });
    ctx.boxes.push(value, label);
    y = label.y + label.height + 22;
  });
  const rest = slide.bullets;
  if (rest.length > 0) {
    points(
      ctx,
      rest,
      { x: legendX, y: y + 6, width: legendWidth, height: BOTTOM - y - 6 },
      { columns: false, size: ctx.size(theme.sizes.label + 1) },
    );
  }
}

/** People as a grid of monograms; a team not yet on record as quiet cards. */
function teamSlide(
  ctx: Context,
  slide: QSlide,
  area: Frame,
  split: boolean,
): void {
  const { theme } = ctx;
  const found = people(slide);
  if (found === null) {
    if (slide.bullets.length > 0) {
      points(ctx, slide.bullets, area, { columns: !split });
      return;
    }
    // Nobody on record: three quiet cards and what to add, never names.
    const columns = 3;
    const gap = 32;
    const width = Math.floor((area.width - gap * (columns - 1)) / columns);
    const top = area.y + 8;
    for (let i = 0; i < columns; i += 1) {
      const x = area.x + i * (width + gap);
      ctx.boxes.push(
        {
          kind: "CIRCLE",
          x,
          y: top,
          width: 64,
          height: 64,
          colour: theme.surface,
        },
        {
          kind: "RULE",
          x,
          y: top + 84,
          width: Math.round(width * 0.6),
          height: 12,
          colour: theme.surface,
          radius: 3,
        },
        {
          kind: "RULE",
          x,
          y: top + 106,
          width: Math.round(width * 0.4),
          height: 10,
          colour: theme.surface,
          radius: 3,
        },
      );
    }
    const label = slide.placeholder?.label;
    if (label !== undefined) {
      ctx.boxes.push(
        ...placeholderSpace(
          { x: area.x, y: BOTTOM - 72, width: area.width, height: 72 },
          "TEXT",
          label,
          theme,
        ),
      );
    }
    return;
  }
  const columns = found.length <= 3 ? found.length : found.length === 4 ? 4 : 3;
  const gap = 32;
  const width = Math.floor((area.width - gap * (columns - 1)) / columns);
  const disc = 72;
  const rowHeight = disc + 96;
  found.forEach((person, i) => {
    const x = area.x + (i % columns) * (width + gap);
    // The grid sits a little above the middle of the space it has.
    const gridHeight = Math.ceil(found.length / columns) * rowHeight - 24;
    const lift = Math.max(0, Math.round((BOTTOM - area.y - gridHeight) * 0.4));
    const y = area.y + lift + Math.floor(i / columns) * rowHeight;
    if (y + rowHeight - 24 > BOTTOM) {
      ctx.dropped.push(`${person.name} — ${person.role}`);
      return;
    }
    const fill = mix(theme.accent, theme.background, 0.84);
    ctx.boxes.push({
      kind: "CIRCLE",
      x,
      y,
      width: disc,
      height: disc,
      colour: fill,
    });
    const letters = initials(person.name);
    const size = 24;
    ctx.boxes.push(
      text("LABEL", letters, {
        x,
        y: y + Math.round((disc - size * 1.2) / 2),
        width: disc,
        size,
        colour: readableText(theme.accentInk, fill, theme.ink),
        bold: true,
        face: theme.faces.heading,
        align: "centre",
        leading: 1.2,
      }),
    );
    const name = text("BULLET", person.name, {
      x,
      y: y + disc + 16,
      width,
      size: ctx.size(theme.sizes.bullet),
      colour: theme.ink,
      bold: true,
      face: theme.faces.bodyStrong,
      leading: 1.3,
      maxLines: 1,
    });
    const role = text("LABEL", person.role, {
      x,
      y: name.y + name.height + 4,
      width,
      size: ctx.size(theme.sizes.label),
      colour: theme.muted,
      face: theme.faces.body,
      leading: 1.36,
      maxLines: 2,
    });
    ctx.boxes.push(name, role);
  });
}

/** `preferred` where it reads on `fill`, else `fallback`. */
function readableText(
  preferred: string,
  fill: string,
  fallback: string,
): string {
  return (contrastRatio(preferred, fill) ?? 0) >= 4.5 ? preferred : fallback;
}

/** Numbered steps along a line, each step's words beneath its marker. */
function timelineSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const steps = slide.bullets;
  const slot = area.width / steps.length;
  const marker = 32;
  const textSize = ctx.size(theme.sizes.label + 2);
  const drawn = marker + 20 + textSize * 1.4 * 4;
  const top = area.y + Math.max(0, Math.round((BOTTOM - area.y - drawn) / 2));
  const centreY = top + marker / 2;
  const numberInk = inkOn(theme.accent, theme.background, theme.ink);
  ctx.boxes.push({
    kind: "RULE",
    x: Math.round(area.x + marker / 2),
    y: Math.round(centreY),
    width: Math.round(area.width - slot + marker / 2),
    height: 2,
    colour: theme.hairline,
  });
  steps.forEach((step, i) => {
    const x = Math.round(area.x + slot * i);
    ctx.boxes.push({
      kind: "CIRCLE",
      x,
      y: top,
      width: marker,
      height: marker,
      colour: theme.accent,
    });
    ctx.boxes.push(
      text("LABEL", String(i + 1), {
        x,
        y: Math.round(centreY - (textSize * 1.2) / 2),
        width: marker,
        size: ctx.size(theme.sizes.label),
        colour: numberInk,
        bold: true,
        face: theme.faces.bodyStrong,
        align: "centre",
        leading: 1.2,
      }),
    );
    const words = text("BULLET", step, {
      x,
      y: top + marker + 20,
      width: Math.round(slot - 28),
      size: textSize,
      colour: theme.ink,
      face: theme.faces.body,
      leading: 1.4,
    });
    if (words.y + words.height > BOTTOM) ctx.dropped.push(step);
    else ctx.boxes.push(words);
  });
}

/** Two lists side by side: the first on a quiet panel, the second in the accent's tint. */
function twoColumnSlide(ctx: Context, slide: QSlide, area: Frame): void {
  const { theme } = ctx;
  const gap = 24;
  const width = Math.floor((area.width - gap) / 2);
  const panels: [readonly string[], string, string][] = [
    [slide.bullets, theme.surface, mix(theme.muted, theme.surface, 0.3)],
    [
      slide.bulletsRight,
      mix(theme.accent, theme.background, 0.88),
      theme.accent,
    ],
  ];
  // The words first, so each panel is as tall as the longer list needs.
  const words: TextBox[][] = panels.map(([items], i) => {
    const x = area.x + i * (width + gap);
    const placed: TextBox[] = [];
    let y = area.y + 36;
    for (const item of items) {
      const body = text("BULLET", item, {
        x: x + 28,
        y,
        width: width - 56,
        size: ctx.size(theme.sizes.bullet),
        colour: theme.ink,
        face: theme.faces.body,
        leading: 1.4,
      });
      if (body.y + body.height > BOTTOM - 28) {
        ctx.dropped.push(item);
        continue;
      }
      placed.push(body);
      y = body.y + body.height + 18;
    }
    return placed;
  });
  const used = Math.max(
    area.y + 160,
    ...words.flat().map((box) => box.y + box.height + 36),
  );
  const height = Math.min(BOTTOM, used) - area.y;
  panels.forEach(([, fill, edge], i) => {
    const x = area.x + i * (width + gap);
    ctx.boxes.push(
      { kind: "RULE", x, y: area.y, width, height, colour: fill, radius: 8 },
      {
        kind: "RULE",
        x: x + 28,
        y: area.y,
        width: 40,
        height: 4,
        colour: edge,
      },
      ...(words[i] ?? []),
    );
  });
}

/** The product in a window frame: their screenshot, or the space for it. */
function productSlide(
  ctx: Context,
  slide: QSlide,
  image: Picture | undefined,
): void {
  const { theme } = ctx;
  // The words take the left third; the frame the rest.
  const textWidth = span(4);
  const bottom = header(ctx, slide, textWidth);
  points(
    ctx,
    slide.bullets,
    {
      x: MARGIN,
      y: bottom + 28,
      width: textWidth,
      height: BOTTOM - bottom - 28,
    },
    { columns: false, size: ctx.size(theme.sizes.bullet - 2) },
  );
  const frameX = MARGIN + textWidth + GUTTER * 2;
  const frameWidth = SLIDE_WIDTH - MARGIN - frameX;
  const frameHeight = Math.min(BOTTOM - MARGIN, Math.round(frameWidth * 0.68));
  const frameY = Math.round(MARGIN + (BOTTOM - MARGIN - frameHeight) / 2);
  const chrome = 26;
  ctx.boxes.push(
    {
      kind: "RULE",
      x: frameX,
      y: frameY,
      width: frameWidth,
      height: frameHeight,
      colour: theme.hairline,
      radius: 10,
    },
    {
      kind: "RULE",
      x: frameX + 1,
      y: frameY + 1,
      width: frameWidth - 2,
      height: chrome,
      colour: theme.surface,
      radius: 9,
    },
  );
  for (let i = 0; i < 3; i += 1) {
    ctx.boxes.push({
      kind: "CIRCLE",
      x: frameX + 14 + i * 14,
      y: frameY + 10,
      width: 8,
      height: 8,
      colour: mix(theme.hairline, theme.muted, 0.35),
    });
  }
  const screen = {
    x: frameX + 1,
    y: frameY + chrome + 1,
    width: frameWidth - 2,
    height: frameHeight - chrome - 2,
  };
  if (image !== undefined) {
    ctx.boxes.push({ kind: "RULE", ...screen, colour: theme.background });
    ctx.boxes.push({
      kind: "IMAGE",
      ...screen,
      url: image.url,
      alt: image.alt,
      credit: image.credit,
      fit: "contain",
    });
    return;
  }
  const label = slide.placeholder?.label ?? "Product screenshot";
  // Inside the frame the placeholder needs no border of its own.
  ctx.boxes.push(
    ...placeholderSpace(screen, "IMAGE", label, theme, { framed: true }),
  );
}

/**
 * Lay a deck out, re-laying out anything that did not fit.
 *
 * The fitter takes one modest step down in type size and tries again, and
 * it has a floor. What it will not do is keep going until everything fits,
 * because that is how a deck ends up at eight point and unreadable, which
 * QX-004 §5 names as the wrong answer. A slide that still does not fit
 * after the floor keeps its dropped content recorded, and the inspector
 * reports it as a fault for the composer to answer — by saying less.
 */
export function layOutDeck(deck: QDeck, brand?: BrandInput): LaidOutDeck {
  const theme = themeFor(
    brand?.direction ?? deck.direction,
    brand?.accent ?? deck.accent,
    deck.brand?.pairing,
  );
  const first = deck.slides[0];
  const company =
    first !== undefined && first.layout === "TITLE" ? first.title : undefined;
  const cover = deck.cover;
  const slides = deck.slides.map((slide, index) => {
    // The cover the person asked for: the first slide, when it is a title
    // slide. Its text takes their ink, or whichever of black and white
    // reads best on their colours.
    const own =
      cover !== undefined && index === 0 && slide.layout === "TITLE"
        ? cover
        : undefined;
    // Every other slide takes the page background the person asked for
    // (founder live 2026-09-30), with their text colour or whichever of
    // black and white reads best on it.
    const page =
      own === undefined && deck.background !== undefined
        ? deck.background
        : undefined;
    const slideTheme =
      own !== undefined
        ? onPage(theme, own.background, own.titleInk)
        : page !== undefined
          ? onPage(theme, [page], deck.ink)
          : deck.ink !== undefined
            ? { ...theme, ink: deck.ink }
            : theme;
    const input: SlideInput = {
      slide,
      index,
      company: index === 0 ? undefined : company,
      image: slide.image,
      logo: index === 0 ? brand?.logo : undefined,
      ownCover: own !== undefined,
      ownPage: page !== undefined,
    };
    let laid = layOutSlide(input, slideTheme, 1);
    for (const scale of [0.9, 0.8]) {
      if (laid.dropped.length === 0) break;
      laid = layOutSlide(input, slideTheme, scale);
    }
    return own !== undefined
      ? { ...laid, background: own.background }
      : page !== undefined
        ? { ...laid, background: [page] }
        : laid;
  });
  return { theme, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, slides };
}

/**
 * The theme on a page colour the person chose: their ink (or black or
 * white, whichever reads), and every quiet colour re-derived from that
 * ink and page so a rule or a panel never vanishes into their background.
 */
function onPage(
  theme: DeckTheme,
  stops: readonly string[],
  chosenInk: string | undefined,
): DeckTheme {
  const page = stops[0] ?? theme.background;
  const ink = chosenInk ?? readableInk(stops);
  return {
    ...theme,
    background: page,
    ink,
    muted: ink,
    accentInk: readableText(theme.accentInk, page, ink),
    hairline: mix(ink, page, 0.8),
    surface: mix(ink, page, 0.92),
  };
}

/** Black or white, whichever reads better on every stop of a background. */
function readableInk(stops: readonly string[]): string {
  const worst = (ink: string) =>
    Math.min(...stops.map((stop) => contrastRatio(ink, stop) ?? 21));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}
