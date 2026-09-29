import type { QChart, QDeck, QSlide } from "@capital-q/contracts";

import {
  MARGIN,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  themeFor,
  type BrandInput,
  type DeckTheme,
} from "./theme.js";
import { contrastRatio } from "./contrast.js";

/**
 * Where everything on a slide goes (QX-004 §5, §6, §7).
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
 * Text is measured rather than guessed, by a width model per font rather
 * than a font file: the renderers use different font machinery and none
 * of them may be the authority on whether a line fits. The model is
 * deliberately pessimistic — it over-estimates slightly — because a
 * layout that thinks a line is narrower than it is produces the one fault
 * nobody catches until a person opens the file.
 */

export type TextBox = {
  readonly kind: "TEXT";
  readonly role: "TITLE" | "SUBTITLE" | "HEADING" | "BULLET" | "LABEL";
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
  readonly align: "left" | "centre";
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
};

export type RuleBox = {
  readonly kind: "RULE";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
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
};

export type LaidOutBox = TextBox | ChartBox | RuleBox | ImageBox;

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
};

export type LaidOutDeck = {
  readonly theme: DeckTheme;
  readonly width: number;
  readonly height: number;
  readonly slides: readonly LaidOutSlide[];
};

/**
 * Roughly how wide a string is, in points, at a given size.
 *
 * A per-character width model rather than a font file. Capital letters,
 * digits and the wide lowercase letters cost more than an `i`, which is
 * enough to tell a line that fits from one that does not — and it is
 * stable, which matters more here than being exact: two renderers reading
 * this layout must agree, and they only agree if the measurement does not
 * depend on which fonts a machine happens to have installed.
 *
 * The factors are deliberately generous. Over-estimating wraps a line
 * early, which reads fine; under-estimating runs text off a slide, which
 * does not.
 */
const NARROW = new Set([..."iljtfrI.,;:'|!()[]{}-"]);
const WIDE = new Set([..."mwMW@%"]);

export function measure(text: string, size: number): number {
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
): readonly string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (measure(candidate, size) <= width || line.length === 0) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

const LINE_SPACING = 1.32;
const BULLET_GAP = 10;

function text(
  role: TextBox["role"],
  content: string,
  options: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly size: number;
    readonly colour: string;
    readonly bold?: boolean;
    readonly align?: TextBox["align"];
  },
): TextBox {
  const lines = wrap(content, options.size, options.width);
  const lineHeight = Math.round(options.size * LINE_SPACING);
  return {
    kind: "TEXT",
    role,
    lines,
    x: options.x,
    y: options.y,
    width: options.width,
    height: lines.length * lineHeight,
    size: options.size,
    lineHeight,
    colour: options.colour,
    bold: options.bold ?? false,
    align: options.align ?? "left",
  };
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

/** Column geometry for a chart, drawn from the largest value rather than zero. */
function layOutChart(
  chart: QChart,
  theme: DeckTheme,
  frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): ChartBox {
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  // Room under the columns for a wrapped label and above them for a value.
  const labelBand = Math.round(labelSize * LINE_SPACING * 2) + 8;
  const valueBand = Math.round(labelSize * LINE_SPACING) + 6;
  const plotHeight = Math.max(40, frame.height - labelBand - valueBand);
  const baseline = frame.y + valueBand + plotHeight;

  const values = chart.points.map((point) => Number(point.value));
  const highest = values.reduce(
    (most, value) => (Number.isFinite(value) && value > most ? value : most),
    0,
  );
  const slot = frame.width / chart.points.length;
  const barWidth = Math.min(120, Math.max(24, slot * 0.56));

  const bars: ChartBar[] = chart.points.map((point, index) => {
    const value = Number(point.value);
    const scaled =
      highest > 0 && Number.isFinite(value)
        ? Math.max(2, Math.round((value / highest) * plotHeight))
        : 2;
    const centre = frame.x + slot * index + slot / 2;
    return {
      label: wrap(point.label, labelSize, slot - 8),
      value: Number.isFinite(value) ? value : 0,
      formatted: `${formatValue(point.value)}${chart.unit === "count" ? "" : ` ${chart.unit}`}`,
      x: Math.round(centre - barWidth / 2),
      y: baseline - scaled,
      width: Math.round(barWidth),
      height: scaled,
    };
  });

  return {
    kind: "CHART",
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    bars,
    baseline,
    unit: chart.unit,
    colour: theme.accent,
    labelSize,
  };
}

/**
 * One slide, at a given scale.
 *
 * `scale` is how the fitter asks for a smaller pass. It multiplies every
 * type size and is floored at the theme's minimum, which is what stops
 * the fitter from answering "it does not fit" with eight-point text.
 */
function layOutSlide(
  slide: QSlide,
  index: number,
  theme: DeckTheme,
  scale: number,
  /** Narrower when a photograph takes the right of the slide. */
  textWidth: number = SLIDE_WIDTH - MARGIN * 2,
): LaidOutSlide {
  const size = (base: number) =>
    Math.max(theme.minimumSize, Math.round(base * scale));
  const boxes: LaidOutBox[] = [];
  const dropped: string[] = [];
  const width = textWidth;
  const bottom = SLIDE_HEIGHT - MARGIN;

  if (slide.layout === "TITLE") {
    const title = text("TITLE", slide.title, {
      x: MARGIN,
      y: 0,
      width,
      size: size(theme.sizes.title),
      colour: theme.ink,
      bold: true,
    });
    const subtitle =
      slide.subtitle === undefined
        ? null
        : text("SUBTITLE", slide.subtitle, {
            x: MARGIN,
            y: 0,
            width,
            size: size(theme.sizes.subtitle),
            colour: theme.muted,
          });
    const rule = 3;
    const gap = 24;
    const total =
      title.height +
      gap +
      rule +
      (subtitle === null ? 0 : gap + subtitle.height);
    const top = Math.max(MARGIN, Math.round((SLIDE_HEIGHT - total) / 2));
    boxes.push({ ...title, y: top });
    boxes.push({
      kind: "RULE",
      x: MARGIN,
      y: top + title.height + gap,
      width: 160,
      height: rule,
      colour: theme.accent,
    });
    if (subtitle !== null) {
      boxes.push({
        ...subtitle,
        y: top + title.height + gap + rule + gap,
      });
    }
    return {
      index,
      layout: slide.layout,
      title: slide.title,
      boxes,
      note: slide.note,
      dropped,
    };
  }

  const heading = text("HEADING", slide.title, {
    x: MARGIN,
    y: MARGIN,
    width,
    size: size(theme.sizes.slideTitle),
    colour: theme.ink,
    bold: true,
  });
  boxes.push(heading);
  let cursor = MARGIN + heading.height + 18;
  boxes.push({
    kind: "RULE",
    x: MARGIN,
    y: cursor,
    width: 96,
    height: 2,
    colour: theme.accent,
  });
  cursor += 2 + 26;

  if (slide.subtitle !== undefined) {
    const subtitle = text("SUBTITLE", slide.subtitle, {
      x: MARGIN,
      y: cursor,
      width,
      size: size(theme.sizes.subtitle),
      colour: theme.muted,
    });
    boxes.push(subtitle);
    cursor += subtitle.height + 22;
  }

  if (slide.layout === "CHART" && slide.chart !== undefined) {
    const available = bottom - cursor;
    if (available >= 120) {
      boxes.push(
        layOutChart(slide.chart, theme, {
          x: MARGIN,
          y: cursor,
          width,
          height: available,
        }),
      );
    } else {
      dropped.push(slide.chart.measure);
    }
    return {
      index,
      layout: slide.layout,
      title: slide.title,
      boxes,
      note: slide.note,
      dropped,
    };
  }

  if (slide.layout === "QUOTE") {
    const body = text("BULLET", slide.bullets[0] ?? slide.title, {
      x: MARGIN,
      y: cursor,
      width,
      size: size(theme.sizes.statement),
      colour: theme.ink,
    });
    boxes.push(body);
    cursor += body.height + 18;
    if (slide.attribution !== undefined) {
      boxes.push(
        text("LABEL", `— ${slide.attribution}`, {
          x: MARGIN,
          y: cursor,
          width,
          size: size(theme.sizes.label),
          colour: theme.muted,
        }),
      );
    }
    return {
      index,
      layout: slide.layout,
      title: slide.title,
      boxes,
      note: slide.note,
      dropped,
    };
  }

  const columns = slide.layout === "TWO_COLUMN";
  const columnWidth = columns ? Math.round((width - 48) / 2) : width;
  const bulletSize = size(
    slide.layout === "STATEMENT" ? theme.sizes.statement : theme.sizes.bullet,
  );

  const place = (
    items: readonly string[],
    x: number,
  ): {
    readonly placed: readonly TextBox[];
    readonly overflow: readonly string[];
  } => {
    const placed: TextBox[] = [];
    const overflow: string[] = [];
    let y = cursor;
    for (const item of items) {
      const box = text("BULLET", item, {
        x,
        y,
        width: columnWidth,
        size: bulletSize,
        colour: theme.ink,
      });
      if (y + box.height > bottom) {
        overflow.push(item);
        continue;
      }
      placed.push(box);
      y += box.height + BULLET_GAP;
    }
    return { placed, overflow };
  };

  const left = place(slide.bullets, MARGIN);
  boxes.push(...left.placed);
  dropped.push(...left.overflow);
  if (columns) {
    const right = place(slide.bulletsRight, MARGIN + columnWidth + 48);
    boxes.push(...right.placed);
    dropped.push(...right.overflow);
  }

  return {
    index,
    layout: slide.layout,
    title: slide.title,
    boxes,
    note: slide.note,
    dropped,
  };
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
  );
  const cover = deck.cover;
  const slides = deck.slides.map((slide, index) => {
    // The cover the person asked for: the first slide, when it is a title
    // slide. Its text takes their ink, or whichever of black and white
    // reads best on their colours.
    const own =
      cover !== undefined && index === 0 && slide.layout === "TITLE"
        ? cover
        : undefined;
    const slideTheme =
      own === undefined
        ? theme
        : {
            ...theme,
            background: own.background[0] ?? theme.background,
            ink: own.titleInk ?? readableInk(own.background),
            muted: own.titleInk ?? readableInk(own.background),
          };
    // A photograph takes the right 40% of a title or bullet slide; the
    // words keep the left, and still never shrink below the floor.
    const image =
      slide.image !== undefined &&
      (slide.layout === "TITLE" || slide.layout === "BULLETS")
        ? slide.image
        : undefined;
    const imageLeft = Math.round(SLIDE_WIDTH * 0.6);
    const textWidth =
      image === undefined ? SLIDE_WIDTH - MARGIN * 2 : imageLeft - MARGIN * 2;
    let laid = layOutSlide(slide, index, slideTheme, 1, textWidth);
    for (const scale of [0.9, 0.8]) {
      if (laid.dropped.length === 0) break;
      laid = layOutSlide(slide, index, slideTheme, scale, textWidth);
    }
    if (image !== undefined) {
      laid = {
        ...laid,
        boxes: [
          ...laid.boxes,
          {
            kind: "IMAGE",
            x: imageLeft,
            y: 0,
            width: SLIDE_WIDTH - imageLeft,
            height: SLIDE_HEIGHT,
            url: image.url,
            alt: image.alt,
            credit: image.credit,
          },
        ],
      };
    }
    return own === undefined ? laid : { ...laid, background: own.background };
  });
  return { theme, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, slides };
}

/** Black or white, whichever reads better on every stop of a background. */
function readableInk(stops: readonly string[]): string {
  const worst = (ink: string) =>
    Math.min(...stops.map((stop) => contrastRatio(ink, stop) ?? 21));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}
