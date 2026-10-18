import {
  Q_SLIDE_IMAGE_HOST,
  type QDailyEdition,
  type QDailyStory,
} from "@capital-q/contracts";

import { DOCUMENT_PAGE } from "./document.js";
import { fetchSlideImages, type SlideImages } from "./images.js";
import {
  measure,
  wrap,
  type ChartBox,
  type LaidOutBox,
  type LaidOutDeck,
  type LaidOutSlide,
  type TextBox,
} from "./layout.js";
import { deckToPdf } from "./pdf.js";
import { themeFor, type DeckTheme } from "./theme.js";

/**
 * The Q Daily as a newspaper (DAILY spec §6; DOCS spec §7: a template over
 * the same boxes, measured by the same `measure`/`wrap`, drawn by the same
 * renderers — this file adds a layout, not a renderer).
 *
 * A4 portrait pages. Page one carries the masthead and the lead across the
 * full width; everything else flows down two columns of about fifty
 * characters, continuing on the next column and the next page line by
 * line. Pictures are placed only when they can be embedded: licensed
 * stock photographs. A publisher's thumbnail is shown hotlinked in the
 * reader and the email, never copied into a file.
 *
 * Nothing here decides what the paper says: every word comes from the
 * edition, which was checked against its sources before it was stored.
 */

/** The same A4 page every other document is drawn on (DOCS). */
export const NEWSPAPER_PAGE = DOCUMENT_PAGE;
const MARGIN = 40;
const GUTTER = 18;
const COLUMNS = 2;
const COLUMN_WIDTH =
  (NEWSPAPER_PAGE.width - 2 * MARGIN - GUTTER * (COLUMNS - 1)) / COLUMNS;
const FULL_WIDTH = NEWSPAPER_PAGE.width - 2 * MARGIN;
const BOTTOM = NEWSPAPER_PAGE.height - MARGIN;
const SPACING = 1.32;

const SIZES = {
  masthead: 40,
  leadHeadline: 22,
  leadStandfirst: 12,
  kicker: 11,
  headline: 13,
  standfirst: 10.5,
  body: 9.5,
  quote: 10.5,
  label: 8,
} as const;

function longDate(editionDate: string): string {
  const [year, month, day] = editionDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function isEmbeddable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.host === Q_SLIDE_IMAGE_HOST;
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Lines flowing down columns and across pages. */
class Flow {
  readonly pages: LaidOutBox[][] = [[]];
  private column = 0;
  private columnTop: number;
  private readonly theme: DeckTheme;
  private readonly runningHead: string;
  y: number;

  constructor(theme: DeckTheme, runningHead: string, top: number) {
    this.theme = theme;
    this.runningHead = runningHead;
    this.columnTop = top;
    this.y = top;
  }

  private get boxes(): LaidOutBox[] {
    const page = this.pages[this.pages.length - 1];
    if (page === undefined) throw new Error("no page");
    return page;
  }

  private get x(): number {
    return MARGIN + this.column * (COLUMN_WIDTH + GUTTER);
  }

  private nextColumn(): void {
    if (this.column + 1 < COLUMNS) {
      this.column += 1;
      this.y = this.columnTop;
      return;
    }
    this.pages.push([]);
    this.column = 0;
    const head = text(
      "LABEL",
      [`${this.runningHead} · page ${this.pages.length}`],
      MARGIN,
      MARGIN,
      FULL_WIDTH,
      SIZES.label,
      this.theme.muted,
      false,
    );
    this.boxes.push(
      head,
      rule(MARGIN, MARGIN + 14, FULL_WIDTH, 0.75, this.theme.ink),
    );
    this.columnTop = MARGIN + 26;
    this.y = this.columnTop;
  }

  /** Room for `height` in this column, moving on when there is none. */
  private room(height: number): void {
    if (this.y + height > BOTTOM && this.y > this.columnTop) this.nextColumn();
  }

  /** Keep the next `height` points together (a headline with its first lines). */
  keep(height: number): void {
    this.room(height);
  }

  gap(points: number): void {
    this.y += points;
  }

  /** Wrapped text, split across columns line by line. */
  text(
    role: TextBox["role"],
    content: string,
    size: number,
    options: {
      readonly bold?: boolean;
      readonly colour?: string;
      readonly after?: number;
    } = {},
  ): void {
    const lineHeight = Math.round(size * SPACING * 10) / 10;
    const lines = wrap(content, size, COLUMN_WIDTH);
    let index = 0;
    while (index < lines.length) {
      this.room(lineHeight);
      const fit = Math.max(1, Math.floor((BOTTOM - this.y) / lineHeight));
      const chunk = lines.slice(index, index + fit);
      this.boxes.push(
        text(
          role,
          chunk,
          this.x,
          this.y,
          COLUMN_WIDTH,
          size,
          options.colour ?? this.theme.ink,
          options.bold ?? false,
          lineHeight,
        ),
      );
      this.y += chunk.length * lineHeight;
      index += chunk.length;
      if (index < lines.length) this.nextColumn();
    }
    this.y += options.after ?? 0;
  }

  /** An unbreakable block (a picture, a chart), drawn at the column's x. */
  block(
    height: number,
    draw: (x: number, y: number) => readonly LaidOutBox[],
  ): void {
    this.room(height);
    this.boxes.push(...draw(this.x, this.y));
    this.y += height;
  }

  kicker(title: string): void {
    this.room(SIZES.kicker * SPACING + 24);
    this.gap(8);
    this.text("HEADING", title, SIZES.kicker, { bold: true });
    this.block(6, (x, y) => [
      rule(x, y + 1, COLUMN_WIDTH, 1.5, this.theme.ink),
    ]);
  }

  /** Content placed on the page outside the flow (page one's full width). */
  place(boxes: readonly LaidOutBox[]): void {
    this.boxes.push(...boxes);
  }
}

function text(
  role: TextBox["role"],
  lines: readonly string[],
  x: number,
  y: number,
  width: number,
  size: number,
  colour: string,
  bold: boolean,
  lineHeight: number = Math.round(size * SPACING * 10) / 10,
  align: TextBox["align"] = "left",
): TextBox {
  return {
    kind: "TEXT",
    role,
    lines,
    x,
    y,
    width,
    height: lines.length * lineHeight,
    size,
    lineHeight,
    colour,
    bold,
    align,
  };
}

function rule(
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): LaidOutBox {
  return { kind: "RULE", x, y, width, height, colour };
}

function photo(
  story: QDailyStory,
  flow: Flow,
  theme: DeckTheme,
  height: number,
  embeddable: (url: string) => boolean,
): void {
  const image = story.image;
  if (
    image === null ||
    image.kind !== "STOCK" ||
    !isEmbeddable(image.url) ||
    !embeddable(image.url)
  ) {
    return;
  }
  const credit = wrap(image.credit, SIZES.label, COLUMN_WIDTH);
  const creditHeight = credit.length * SIZES.label * SPACING;
  flow.block(height + creditHeight + 8, (x, y) => [
    {
      kind: "IMAGE",
      x,
      y,
      width: COLUMN_WIDTH,
      height,
      url: image.url,
      alt: image.alt,
      credit: image.credit,
      fit: "cover",
    },
    text(
      "LABEL",
      credit,
      x,
      y + height + 3,
      COLUMN_WIDTH,
      SIZES.label,
      theme.muted,
      false,
    ),
  ]);
}

function sources(story: QDailyStory): string {
  return `Source: ${story.sources
    .map((source) => `${source.publisher} (${hostOf(source.url)})`)
    .join("; ")}`;
}

function body(story: QDailyStory, flow: Flow, theme: DeckTheme): void {
  for (const paragraph of story.paragraphs) {
    flow.text("BULLET", paragraph, SIZES.body, { after: 4 });
  }
  for (const quote of story.quotes) {
    flow.text("SUBTITLE", `“${quote.text}”`, SIZES.quote, {
      bold: true,
      after: quote.speaker === null ? 4 : 0,
    });
    if (quote.speaker !== null) {
      flow.text("LABEL", `— ${quote.speaker}`, SIZES.label, {
        colour: theme.muted,
        after: 4,
      });
    }
  }
  flow.text("LABEL", sources(story), SIZES.label, {
    colour: theme.muted,
    after: 10,
  });
}

function story(
  item: QDailyStory,
  flow: Flow,
  theme: DeckTheme,
  embeddable: (url: string) => boolean,
): void {
  const headlineLines = wrap(
    item.headline,
    SIZES.headline,
    COLUMN_WIDTH,
  ).length;
  flow.keep(
    headlineLines * SIZES.headline * SPACING + 3 * SIZES.body * SPACING,
  );
  flow.text("HEADING", item.headline, SIZES.headline, { bold: true, after: 3 });
  photo(item, flow, theme, 110, embeddable);
  if (item.standfirst.length > 0) {
    flow.text("SUBTITLE", item.standfirst, SIZES.standfirst, { after: 4 });
  }
  body(item, flow, theme);
}

function chartBlock(
  edition: QDailyEdition,
  flow: Flow,
  theme: DeckTheme,
): void {
  const chart = edition.chart;
  if (chart === null) return;
  flow.text("HEADING", chart.title, SIZES.standfirst, { bold: true, after: 4 });
  const height = 150;
  const labelSize = 7;
  flow.block(height + 8, (x, y) => {
    const baseline = y + height - 3 * labelSize * 1.25 - 6;
    const top = y + labelSize + 10;
    const slot = COLUMN_WIDTH / chart.bars.length;
    const highest = Math.max(...chart.bars.map((bar) => bar.value), 1);
    const bars = chart.bars.map((bar, index) => {
      const barHeight = Math.max(1, ((baseline - top) * bar.value) / highest);
      const width = Math.min(28, slot * 0.6);
      return {
        label: wrap(bar.label, labelSize, slot - 2).slice(0, 3),
        value: bar.value,
        formatted: bar.formatted,
        x: x + index * slot + (slot - width) / 2,
        y: baseline - barHeight,
        width,
        height: barHeight,
      };
    });
    const box: ChartBox = {
      kind: "CHART",
      x,
      y,
      width: COLUMN_WIDTH,
      height,
      bars,
      baseline,
      unit: "USD",
      colour: theme.accent,
      labelSize,
    };
    return [box];
  });
  flow.text("LABEL", chart.source, SIZES.label, {
    colour: theme.muted,
    after: 10,
  });
}

/**
 * The edition, laid out as A4 pages of boxes. `embeddable` says which
 * photographs are actually in hand: a photo that could not be fetched is
 * left out of the layout rather than leaving a hole.
 */
export function layOutNewspaper(
  edition: QDailyEdition,
  embeddable: (url: string) => boolean = () => true,
): LaidOutDeck {
  const theme = themeFor("MINIMAL_INSTITUTIONAL");
  const date = longDate(edition.editionDate);
  const placed: LaidOutBox[] = [];
  let y = MARGIN;

  placed.push(
    text(
      "TITLE",
      ["The Q Daily"],
      MARGIN,
      y,
      FULL_WIDTH,
      SIZES.masthead,
      theme.ink,
      true,
      SIZES.masthead * 1.15,
      "centre",
    ),
  );
  y += SIZES.masthead * 1.15 + 6;
  placed.push(rule(MARGIN, y, FULL_WIDTH, 2.5, theme.ink));
  y += 7;
  const kind = edition.frequency === "DAILY" ? "Daily" : "Weekly";
  const dateline = [
    date,
    `${kind} edition`,
    `No. ${edition.number}`,
    ...(edition.readerName === null ? [] : [`For ${edition.readerName}`]),
  ].join(" · ");
  placed.push(
    text(
      "LABEL",
      [dateline],
      MARGIN,
      y,
      FULL_WIDTH,
      9,
      theme.muted,
      false,
      12,
      "centre",
    ),
  );
  y += 14;
  placed.push(rule(MARGIN, y, FULL_WIDTH, 0.75, theme.ink));
  y += 6;
  if (edition.topics.length > 0) {
    const topics = wrap(
      `Following ${edition.topics.join(", ")}`,
      SIZES.label,
      FULL_WIDTH,
    ).slice(0, 2);
    placed.push(
      text(
        "LABEL",
        topics,
        MARGIN,
        y,
        FULL_WIDTH,
        SIZES.label,
        theme.muted,
        false,
        SIZES.label * SPACING,
        "centre",
      ),
    );
    y += topics.length * SIZES.label * SPACING;
  }
  y += 14;

  const lead = edition.lead;
  if (lead !== null) {
    const headline = wrap(lead.headline, SIZES.leadHeadline, FULL_WIDTH).slice(
      0,
      4,
    );
    const headlineHeight = headline.length * SIZES.leadHeadline * 1.18;
    placed.push(
      text(
        "TITLE",
        headline,
        MARGIN,
        y,
        FULL_WIDTH,
        SIZES.leadHeadline,
        theme.ink,
        true,
        SIZES.leadHeadline * 1.18,
      ),
    );
    y += headlineHeight + 6;
    if (lead.standfirst.length > 0) {
      const standfirst = wrap(
        lead.standfirst,
        SIZES.leadStandfirst,
        FULL_WIDTH,
      ).slice(0, 4);
      placed.push(
        text(
          "SUBTITLE",
          standfirst,
          MARGIN,
          y,
          FULL_WIDTH,
          SIZES.leadStandfirst,
          theme.ink,
          false,
        ),
      );
      y += standfirst.length * SIZES.leadStandfirst * SPACING + 8;
    }
    const image = lead.image;
    if (
      image !== null &&
      image.kind === "STOCK" &&
      isEmbeddable(image.url) &&
      embeddable(image.url)
    ) {
      const height = 220;
      placed.push({
        kind: "IMAGE",
        x: MARGIN,
        y,
        width: FULL_WIDTH,
        height,
        url: image.url,
        alt: image.alt,
        credit: image.credit,
        fit: "cover",
      });
      y += height + 3;
      placed.push(
        text(
          "LABEL",
          [image.credit],
          MARGIN,
          y,
          FULL_WIDTH,
          SIZES.label,
          theme.muted,
          false,
        ),
      );
      y += SIZES.label * SPACING + 8;
    }
  } else {
    const quiet = `A quiet ${edition.frequency === "DAILY" ? "day" : "week"} in your markets: nothing new we could cite.`;
    placed.push(
      text(
        "SUBTITLE",
        wrap(quiet, SIZES.leadStandfirst, FULL_WIDTH),
        MARGIN,
        y,
        FULL_WIDTH,
        SIZES.leadStandfirst,
        theme.ink,
        false,
      ),
    );
    y += SIZES.leadStandfirst * SPACING * 2 + 8;
  }

  const flow = new Flow(theme, `The Q Daily · ${date}`, y);
  flow.place(placed);
  if (lead !== null) body(lead, flow, theme);

  for (const section of edition.sections) {
    flow.kicker(section.title);
    for (const item of section.stories) story(item, flow, theme, embeddable);
    if (section.code === "DEALS") chartBlock(edition, flow, theme);
  }
  if (
    edition.chart !== null &&
    !edition.sections.some((section) => section.code === "DEALS")
  ) {
    flow.kicker("Deals and rounds");
    chartBlock(edition, flow, theme);
  }
  if (edition.briefs.length > 0) {
    flow.kicker("In brief");
    for (const brief of edition.briefs) {
      flow.text("HEADING", brief.headline, SIZES.standfirst, { bold: true });
      flow.text("LABEL", sources(brief), SIZES.label, {
        colour: theme.muted,
        after: 6,
      });
    }
  }
  if (edition.qTake !== null) {
    flow.kicker("Q's take");
    flow.text(
      "LABEL",
      "Q's inference from the stories in this edition, not reported fact.",
      SIZES.label,
      {
        colour: theme.muted,
        after: 4,
      },
    );
    for (const paragraph of edition.qTake.paragraphs) {
      flow.text("BULLET", paragraph, SIZES.body, { after: 4 });
    }
  }
  flow.gap(8);
  const usesStock = [
    ...(lead === null ? [] : [lead]),
    ...edition.sections.flatMap((section) => section.stories),
  ].some((item) => item.image?.kind === "STOCK");
  flow.text(
    "LABEL",
    `Every story names its source. Q's take is Q's inference.${usesStock ? " Photos provided by Pexels." : ""} Capital Q.`,
    SIZES.label,
    { colour: theme.muted },
  );

  const slides: LaidOutSlide[] = flow.pages.map((boxes, index) => ({
    index,
    layout: "TWO_COLUMN",
    title: index === 0 ? "The Q Daily" : `The Q Daily, page ${index + 1}`,
    boxes,
    note: undefined,
    dropped: [],
  }));
  return {
    theme,
    width: NEWSPAPER_PAGE.width,
    height: NEWSPAPER_PAGE.height,
    slides,
  };
}

/** The PDF edition: the stock photographs fetched once, then drawn. */
export async function newspaperToPdf(
  edition: QDailyEdition,
  options: {
    readonly fetch?: typeof fetch | undefined;
    readonly images?: SlideImages | undefined;
  } = {},
): Promise<Uint8Array> {
  const images =
    options.images ??
    (await fetchSlideImages(layOutNewspaper(edition), options.fetch));
  // Laid out again knowing which photos are in hand: no holes.
  const laid = layOutNewspaper(edition, (url) => images.has(url));
  return deckToPdf(
    laid,
    {
      title: `The Q Daily, ${longDate(edition.editionDate)}`,
      company: "Capital Q",
    },
    images,
  );
}

/** Widest line of a laid-out page, for tests: nothing crosses its column. */
export function overflowingBoxes(deck: LaidOutDeck): readonly TextBox[] {
  return deck.slides.flatMap((slide) =>
    slide.boxes.filter(
      (box): box is TextBox =>
        box.kind === "TEXT" &&
        (box.lines.some(
          (line) =>
            measure(line, box.size) > box.width + 0.5 && line.includes(" "),
        ) ||
          box.y + box.height > NEWSPAPER_PAGE.height - MARGIN + 0.5),
    ),
  );
}
