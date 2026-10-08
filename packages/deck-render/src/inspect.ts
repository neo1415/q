import { contrastRatio } from "./contrast.js";
import { MARGIN, SLIDE_HEIGHT, SLIDE_WIDTH } from "./theme.js";

export { contrastRatio };
import {
  measure,
  type LaidOutDeck,
  type LaidOutSlide,
  type LaidOutBox,
  type TextBox,
} from "./layout.js";

/**
 * What is wrong with a slide, decided before anything is drawn
 * (QX-004 §5).
 *
 * The packet's instruction is not to generate a file and assume it looks
 * good. The way to honour that is not to render and squint at it, but to
 * make every fault a property of the layout: a box that runs past the
 * margin, two boxes that sit on top of each other, type under the floor,
 * a line so long nobody reads it, a chart whose columns have no labels.
 * All of those are answerable from the geometry, exactly, every time —
 * which a screenshot is not.
 *
 * The one thing deliberately absent is a judgement about whether a slide
 * is *good*. That is the founder's call and their investor's; this says
 * only whether it is broken.
 */

export const DECK_FAULTS = [
  /** Content the layout could not place, even after stepping type down. */
  "CONTENT_DROPPED",
  /** A box crosses the gutter, or runs off the slide. */
  "OUT_OF_MARGIN",
  /** Two boxes occupy the same space. */
  "OVERLAP",
  /** Type below the direction's floor: the 8pt answer this packet forbids. */
  "TYPE_TOO_SMALL",
  /** A line long enough that a reader loses their place. */
  "LINE_TOO_LONG",
  /** More on one slide than a person takes in from a projector. */
  "TOO_DENSE",
  /** A chart whose columns cannot be told apart. */
  "CHART_UNLABELLED",
  /** Ink and background too close to read. */
  "LOW_CONTRAST",
] as const;
export type DeckFault = (typeof DECK_FAULTS)[number];

export type DeckIssue = {
  readonly slide: number;
  readonly fault: DeckFault;
  /** What a person would need to change, in their own terms. */
  readonly detail: string;
};

/** Characters per line beyond which a reader starts losing the line. */
const LINE_CHARACTERS_MAX = 92;
/** Rendered lines of body text one slide may carry. */
const LINES_PER_SLIDE_MAX = 22;
/** WCAG's own threshold for large text, which every size here is. */
const CONTRAST_MIN = 3;

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  // A point of slack: boxes that merely touch are not overlapping, and
  // rounding a line height should not raise a fault.
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}

function inspectSlide(
  slide: LaidOutSlide,
  theme: LaidOutDeck["theme"],
): readonly DeckIssue[] {
  const issues: DeckIssue[] = [];
  const at = (fault: DeckFault, detail: string) => {
    issues.push({ slide: slide.index, fault, detail });
  };

  for (const item of slide.dropped) {
    at(
      "CONTENT_DROPPED",
      `"${item.slice(0, 60)}" did not fit on "${slide.title}" and was left off`,
    );
  }

  // Rules and step markers are decoration; a step's number sits on its marker.
  const placed = slide.boxes.filter(
    // A path's box is its whole chart frame; the labels inside it are
    // meant to be there (DOCS).
    (box) =>
      box.kind !== "RULE" &&
      box.kind !== "CIRCLE" &&
      box.kind !== "PATH" &&
      box.kind !== "ARC",
  );
  for (const box of slide.boxes) {
    // A photo is full-bleed on its side by design; a logo is not.
    if (box.kind === "IMAGE" && box.fit !== "contain") continue;
    // So is the space a picture is still to fill (Q room W5), and a
    // colour field that runs to the edge on purpose (the cover's panel).
    if (
      box.kind === "RULE" &&
      (box.placeholder === "IMAGE" || box.bleed === true)
    ) {
      continue;
    }
    // The page number and company sit in the bottom gutter by design;
    // they are still held inside the slide.
    if (box.kind === "TEXT" && box.role === "FOOTER") {
      if (
        box.x < MARGIN - 1 ||
        box.x + box.width > SLIDE_WIDTH - MARGIN + 1 ||
        box.y + box.height > SLIDE_HEIGHT - 16
      ) {
        at(
          "OUT_OF_MARGIN",
          `the footer on "${slide.title}" runs off the slide`,
        );
        break;
      }
      continue;
    }
    if (
      box.x < MARGIN - 1 ||
      box.y < MARGIN - 1 ||
      box.x + box.width > SLIDE_WIDTH - MARGIN + 1 ||
      box.y + box.height > SLIDE_HEIGHT - MARGIN + 1
    ) {
      at(
        "OUT_OF_MARGIN",
        `something on "${slide.title}" sits outside the slide's gutter`,
      );
      break;
    }
  }

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (a !== undefined && b !== undefined && overlaps(a, b)) {
        at(
          "OVERLAP",
          `two things on "${slide.title}" are drawn over one another`,
        );
        i = placed.length;
        break;
      }
    }
  }

  const texts = slide.boxes.filter(
    (box): box is TextBox => box.kind === "TEXT",
  );
  let lines = 0;
  for (const box of texts) {
    const small = box.role === "CAPTION" || box.role === "FOOTER";
    if (!small) lines += box.lines.length;
    if (box.size < (small ? theme.captionMinimum : theme.minimumSize)) {
      at(
        "TYPE_TOO_SMALL",
        `text on "${slide.title}" was shrunk below what a room can read`,
      );
    }
    for (const line of box.lines) {
      if (line.length > LINE_CHARACTERS_MAX) {
        at(
          "LINE_TOO_LONG",
          `a line on "${slide.title}" runs to ${String(line.length)} characters`,
        );
        break;
      }
    }
    // A word longer than the column it sits in. Wrapping cannot break it,
    // so it is drawn past the box it was measured into — which the box's
    // own coordinates do not show, and a reader sees as text running off
    // the slide.
    if (
      box.lines.some(
        (line) => measure(line, box.size, box.face) > box.width + 1,
      )
    ) {
      at(
        "OUT_OF_MARGIN",
        `a word on "${slide.title}" is wider than the space it has`,
      );
    }
    // Text is read against what is drawn under it: a step's marker, a
    // panel, the cover's colour field — or, failing those, the page.
    const under = fillUnder(slide.boxes, box);
    const ratio = worstContrast(
      box.colour,
      under === undefined ? (slide.background ?? [theme.background]) : [under],
    );
    if (ratio !== null && ratio < CONTRAST_MIN) {
      at(
        "LOW_CONTRAST",
        `text on "${slide.title}" is too close to its background`,
      );
    }
  }
  if (lines > LINES_PER_SLIDE_MAX) {
    at(
      "TOO_DENSE",
      `"${slide.title}" carries ${String(lines)} lines; say less or use two slides`,
    );
  }

  for (const box of slide.boxes) {
    if (box.kind !== "CHART") continue;
    if (box.bars.some((bar) => bar.label.length === 0)) {
      at(
        "CHART_UNLABELLED",
        `a column on "${slide.title}" has nothing naming it`,
      );
    }
    const ratio = contrastRatio(box.colour, theme.background);
    if (ratio !== null && ratio < 1.6) {
      at(
        "LOW_CONTRAST",
        `the chart on "${slide.title}" barely shows against the page`,
      );
    }
  }

  return issues;
}

/**
 * Every fault in a laid-out deck, slide by slide.
 *
 * Empty is the passing state and the one a deck must reach before its
 * representations are written: a PPTX with a slide whose text ran off it
 * is a file somebody sends to an investor.
 */
export function inspectDeck(deck: LaidOutDeck): readonly DeckIssue[] {
  return deck.slides.flatMap((slide) => inspectSlide(slide, deck.theme));
}

/**
 * The colour of the last filled shape drawn before `box` that holds the
 * centre of its first line (rules and markers; a hairline is too thin to
 * be a background).
 */
function fillUnder(
  boxes: readonly LaidOutBox[],
  box: TextBox,
): string | undefined {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + Math.min(box.height, box.lineHeight) / 2;
  let found: string | undefined;
  for (const other of boxes) {
    if (other === box) break;
    if (other.kind !== "RULE" && other.kind !== "CIRCLE") continue;
    if (other.width < 6 || other.height < 6) continue;
    if (
      centreX >= other.x &&
      centreX <= other.x + other.width &&
      centreY >= other.y &&
      centreY <= other.y + other.height
    ) {
      found = other.colour;
    }
  }
  return found;
}

/** The lowest contrast of a colour against any stop of a background. */
function worstContrast(
  colour: string,
  stops: readonly string[],
): number | null {
  const ratios = stops
    .map((stop) => contrastRatio(colour, stop))
    .filter((ratio): ratio is number => ratio !== null);
  return ratios.length === 0 ? null : Math.min(...ratios);
}
