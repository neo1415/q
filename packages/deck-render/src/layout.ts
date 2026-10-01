import type { QChart, QDeck, QSlide } from "@capital-q/contracts";

import {
  MARGIN,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  themeFor,
  type BrandInput,
  type DeckTheme,
} from "./theme.js";
import { contrastRatio, mix } from "./contrast.js";

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

/** A filled circle: a step marker in a drawn flow. Decoration, like a rule. */
export type CircleBox = {
  readonly kind: "CIRCLE";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
};

export type LaidOutBox =
  TextBox | ChartBox | RuleBox | ImageBox | CircleBox | PathBox;

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

type Frame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** "1,200 USD", or "1,200" for a plain count. */
function formatted(chart: QChart, value: string): string {
  return `${formatValue(value)}${chart.unit === "count" ? "" : ` ${chart.unit}`}`;
}

/**
 * Horizontal bars (DOCS): a label on the left, the bar from a zero
 * baseline, the value printed at its end. For comparisons whose labels
 * are long, which columns would have to wrap into three lines.
 */
function layOutBars(
  chart: QChart,
  theme: DeckTheme,
  frame: Frame,
): LaidOutBox[] {
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const values = chart.points.map((point) => Number(point.value));
  const highest = values.reduce(
    (most, value) => (Number.isFinite(value) && value > most ? value : most),
    0,
  );
  const labelWidth = Math.round(frame.width * 0.32);
  const valueWidth =
    Math.max(
      ...chart.points.map((point) =>
        measure(formatted(chart, point.value), labelSize),
      ),
    ) + 12;
  const barLeft = frame.x + labelWidth + 16;
  const barSpan = Math.max(
    40,
    frame.x + frame.width - valueWidth - 8 - barLeft,
  );
  const row = Math.min(56, Math.floor(frame.height / chart.points.length));
  const thickness = Math.max(10, Math.round(row * 0.5));
  const boxes: LaidOutBox[] = [
    {
      kind: "RULE",
      x: barLeft - 1,
      y: frame.y,
      width: 1,
      height: row * chart.points.length,
      colour: theme.muted,
    },
  ];
  chart.points.forEach((point, index) => {
    const value = values[index] ?? 0;
    const top = frame.y + row * index;
    const length =
      highest > 0 && Number.isFinite(value) && value > 0
        ? Math.max(2, Math.round((value / highest) * barSpan))
        : 2;
    const barTop = top + Math.round((row - thickness) / 2);
    const label = text("LABEL", point.label, {
      x: frame.x,
      y: 0,
      width: labelWidth,
      size: labelSize,
      colour: theme.muted,
    });
    const shown = label.lines.slice(0, 2);
    boxes.push({
      ...label,
      lines: shown,
      height: shown.length * label.lineHeight,
      y: Math.round(top + (row - shown.length * label.lineHeight) / 2),
    });
    boxes.push({
      kind: "RULE",
      x: barLeft,
      y: barTop,
      width: length,
      height: thickness,
      colour: theme.accent,
    });
    boxes.push(
      text("LABEL", formatted(chart, point.value), {
        x: barLeft + length + 8,
        y: Math.round(top + (row - labelSize * LINE_SPACING) / 2),
        width: valueWidth,
        size: labelSize,
        colour: theme.ink,
        bold: true,
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
function layOutLine(
  chart: QChart,
  theme: DeckTheme,
  frame: Frame,
): LaidOutBox[] {
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
  const points = chart.points.map((_, index) => {
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
      x: frame.x,
      y: baseline,
      width: frame.width,
      height: 1,
      colour: theme.muted,
    },
    {
      kind: "PATH",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      points,
      colour: theme.accent,
      strokeWidth: 3,
    },
  ];
  const marker = 10;
  chart.points.forEach((point, index) => {
    const at = points[index];
    if (at === undefined) return;
    boxes.push({
      kind: "CIRCLE",
      x: at.x - marker / 2,
      y: at.y - marker / 2,
      width: marker,
      height: marker,
      colour: theme.accent,
    });
    boxes.push(
      text("LABEL", formatted(chart, point.value), {
        x: Math.round(at.x - slot / 2),
        y: Math.round(at.y - marker / 2 - 6 - labelSize * LINE_SPACING),
        width: Math.round(slot),
        size: labelSize,
        colour: theme.ink,
        bold: true,
        align: "centre",
      }),
    );
    const label = text("LABEL", point.label, {
      x: Math.round(at.x - slot / 2 + 4),
      y: baseline + 8,
      width: Math.round(slot - 8),
      size: labelSize,
      colour: theme.muted,
      align: "centre",
    });
    const shown = label.lines.slice(0, 2);
    boxes.push({
      ...label,
      lines: shown,
      height: shown.length * label.lineHeight,
    });
  });
  return boxes;
}

/**
 * Parts of a whole (DOCS): a DONUT is drawn as one stacked bar, because
 * lengths along one axis are read more accurately than angles and every
 * renderer can draw a rectangle exactly. One hue in tints, separated by
 * gaps, each part listed under it with its value and share, so colour
 * never carries the meaning. Parts that are not all positive are not a
 * whole: they are drawn as bars instead.
 */
function layOutParts(
  chart: QChart,
  theme: DeckTheme,
  frame: Frame,
): LaidOutBox[] {
  const values = chart.points.map((point) => Number(point.value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return layOutBars(chart, theme, frame);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const barHeight = 44;
  const gap = 3;
  const usable = frame.width - gap * (values.length - 1);
  const tint = (index: number) =>
    mix(theme.accent, theme.background, Math.min(0.8, index * 0.16));
  const boxes: LaidOutBox[] = [];
  let x = frame.x;
  values.forEach((value, index) => {
    const width =
      index === values.length - 1
        ? frame.x + frame.width - x
        : Math.max(2, Math.round((value / total) * usable));
    boxes.push({
      kind: "RULE",
      x,
      y: frame.y,
      width,
      height: barHeight,
      colour: tint(index),
    });
    x += width + gap;
  });
  const columns = values.length > 4 ? 2 : 1;
  const columnWidth = Math.floor((frame.width - 32 * (columns - 1)) / columns);
  const perColumn = Math.ceil(values.length / columns);
  const rowHeight = Math.round(labelSize * LINE_SPACING) + 10;
  chart.points.forEach((point, index) => {
    const column = Math.floor(index / perColumn);
    const left = frame.x + column * (columnWidth + 32);
    const top = frame.y + barHeight + 24 + (index % perColumn) * rowHeight;
    const share = Math.round(((values[index] ?? 0) / total) * 100);
    boxes.push({
      kind: "RULE",
      x: left,
      y: top + 3,
      width: 14,
      height: 14,
      colour: tint(index),
    });
    const line = text(
      "LABEL",
      `${point.label}: ${formatted(chart, point.value)} (${String(share)}%)`,
      {
        x: left + 24,
        y: top,
        width: columnWidth - 24,
        size: labelSize,
        colour: theme.ink,
      },
    );
    boxes.push({
      ...line,
      lines: line.lines.slice(0, 1),
      height: line.lineHeight,
    });
  });
  return boxes;
}

/**
 * A chart in the form its kind names, with its source line under it
 * (DOCS: a chart says where its numbers came from on the slide itself).
 */
function layOutChartForm(
  chart: QChart,
  theme: DeckTheme,
  frame: Frame,
): LaidOutBox[] {
  const labelSize = Math.max(theme.sizes.label, theme.minimumSize);
  const sourceBand =
    chart.source === undefined ? 0 : Math.round(labelSize * LINE_SPACING) + 10;
  const plot = { ...frame, height: frame.height - sourceBand };
  const boxes: LaidOutBox[] =
    chart.kind === "BAR"
      ? layOutBars(chart, theme, plot)
      : chart.kind === "LINE"
        ? layOutLine(chart, theme, plot)
        : chart.kind === "DONUT"
          ? layOutParts(chart, theme, plot)
          : [layOutChart(chart, theme, plot)];
  if (chart.source !== undefined) {
    const source = text("LABEL", `Source: ${chart.source}`, {
      x: frame.x,
      y: frame.y + frame.height - sourceBand + 10,
      width: frame.width,
      size: labelSize,
      colour: theme.muted,
    });
    boxes.push({
      ...source,
      lines: source.lines.slice(0, 1),
      height: source.lineHeight,
    });
  }
  return boxes;
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
        ...layOutChartForm(slide.chart, theme, {
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

  if (slide.figures !== undefined && slide.figures.length > 0) {
    // Headline figures across the slide: an accent rule, the number large,
    // what it counts underneath. The bullets follow only if room is left.
    const count = slide.figures.length;
    const gap = 32;
    const tile = Math.floor((width - gap * (count - 1)) / count);
    let tallest = 0;
    slide.figures.forEach((figure, i) => {
      const x = MARGIN + i * (tile + gap);
      boxes.push({
        kind: "RULE",
        x,
        y: cursor,
        width: 40,
        height: 3,
        colour: theme.accent,
      });
      const value = text("HEADING", figure.value, {
        x,
        y: cursor + 18,
        width: tile,
        size: size(Math.min(theme.sizes.title, count > 2 ? 40 : 52)),
        colour: theme.ink,
        bold: true,
      });
      const label = text("LABEL", figure.label, {
        x,
        y: cursor + 18 + value.height + 8,
        width: tile,
        size: size(theme.sizes.label),
        colour: theme.muted,
      });
      boxes.push(value, label);
      tallest = Math.max(tallest, 18 + value.height + 8 + label.height);
    });
    cursor += tallest + 36;
  }

  if (
    slide.visual === "FLOW" &&
    slide.bullets.length >= 2 &&
    slide.bullets.length <= 5
  ) {
    // Numbered steps joined left to right; each step's words under it.
    const steps = slide.bullets;
    const slot = width / steps.length;
    const diameter = 44;
    const labelSize = size(theme.sizes.label);
    const numberSize = size(theme.sizes.label);
    // Centred in the space left, allowing three lines of words per step.
    const drawn = diameter + 18 + labelSize * LINE_SPACING * 3;
    cursor += Math.max(0, Math.round((bottom - cursor - drawn) / 2));
    const centreY = cursor + diameter / 2;
    // The number in whichever of the deck's inks reads on the marker.
    const numberInk =
      (contrastRatio(theme.background, theme.accent) ?? 0) >=
      (contrastRatio(theme.ink, theme.accent) ?? 0)
        ? theme.background
        : theme.ink;
    for (let i = 0; i < steps.length - 1; i += 1) {
      const from = MARGIN + slot * i + slot / 2 + diameter / 2 + 6;
      const to = MARGIN + slot * (i + 1) + slot / 2 - diameter / 2 - 6;
      if (to > from) {
        boxes.push({
          kind: "RULE",
          x: Math.round(from),
          y: Math.round(centreY - 1),
          width: Math.round(to - from),
          height: 2,
          colour: theme.muted,
        });
      }
    }
    steps.forEach((step, i) => {
      const centreX = MARGIN + slot * i + slot / 2;
      boxes.push({
        kind: "CIRCLE",
        x: Math.round(centreX - diameter / 2),
        y: Math.round(cursor),
        width: diameter,
        height: diameter,
        colour: theme.accent,
      });
      const number = text("LABEL", String(i + 1), {
        x: Math.round(centreX - diameter / 2),
        y: Math.round(centreY - (numberSize * LINE_SPACING) / 2),
        width: diameter,
        size: numberSize,
        colour: numberInk,
        bold: true,
        align: "centre",
      });
      const words = text("BULLET", step, {
        x: Math.round(MARGIN + slot * i + 8),
        y: Math.round(cursor + diameter + 18),
        width: Math.round(slot - 16),
        size: labelSize,
        colour: theme.ink,
        align: "centre",
      });
      boxes.push(number);
      if (words.y + words.height > bottom) dropped.push(step);
      else boxes.push(words);
    });
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
    deck.brand?.pairing,
  );
  const logo = brand?.logo;
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
        ? {
            ...theme,
            background: own.background[0] ?? theme.background,
            ink: own.titleInk ?? readableInk(own.background),
            muted: own.titleInk ?? readableInk(own.background),
          }
        : page !== undefined
          ? {
              ...theme,
              background: page,
              ink: deck.ink ?? readableInk([page]),
              muted: deck.ink ?? readableInk([page]),
            }
          : deck.ink !== undefined
            ? { ...theme, ink: deck.ink }
            : theme;
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
    // DOCS: the company's own logo on the cover, top left, uncropped.
    if (logo !== undefined && index === 0 && slide.layout === "TITLE") {
      laid = {
        ...laid,
        boxes: [
          ...laid.boxes,
          {
            kind: "IMAGE",
            x: MARGIN,
            y: MARGIN,
            width: 180,
            height: 48,
            url: `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}`,
            alt: "Company logo",
            credit: "",
            fit: "contain",
          },
        ],
      };
    }
    return own !== undefined
      ? { ...laid, background: own.background }
      : page !== undefined
        ? { ...laid, background: [page] }
        : laid;
  });
  return { theme, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, slides };
}

/** Black or white, whichever reads better on every stop of a background. */
function readableInk(stops: readonly string[]): string {
  const worst = (ink: string) =>
    Math.min(...stops.map((stop) => contrastRatio(ink, stop) ?? 21));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}
