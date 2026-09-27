import { PDFDocument, type PDFPage } from "pdf-lib";

import type { QArtifactVersion } from "@capital-q/contracts";

import { drawLine, embedFonts, type EmbeddedFont } from "./fonts.js";
import { colour } from "./pdf.js";
import { themeFor, type BrandInput } from "./theme.js";

/**
 * Any artifact as a document you can print, file and forward (BIZ-001).
 *
 * A deck has slides and exports as slides. Everything else Q composes — a
 * brief today; a memo, a meeting summary or an intelligence report next —
 * is sections of prose with the findings each rests on and the gaps Q
 * could not fill, and that shape is already the artifact contract's. So
 * there is one document renderer rather than one per type: a new type
 * with sections and gaps is exportable the day it exists, and gets a
 * sensible name on the page from its code until somebody writes it one.
 *
 * What goes into the file is what the viewer shows, in the same order:
 * each section, the findings under it with their truth class and
 * evidence status kept apart and visible, what isn't on record yet, and
 * the sentence saying this is a private draft rather than verified
 * evidence. A PDF travels further than the screen does, so it is the
 * last place to drop that sentence.
 *
 * Unlike the deck PDF, this layout wraps with the embedded font's own
 * metrics. No other renderer draws this layout — the viewer reflows the
 * same prose as HTML — so there is no second opinion to agree with, and
 * the exact widths are the better authority.
 */

export type DocumentFinding = {
  readonly statement: string;
  /** "user claim · self reported": whose claim it is, and what supports it. */
  readonly provenance: string;
};

export type DocumentSection = {
  readonly heading: string;
  readonly body: string;
  readonly findings: readonly DocumentFinding[];
};

/** A composed artifact as a document: what to print, in reading order. */
export type ArtifactDocument = {
  /** What kind of document this is, as a person names it. */
  readonly kind: string;
  readonly title: string;
  readonly summary: string | undefined;
  /** "Version 2 · 25 September 2026". */
  readonly dateline: string;
  readonly sections: readonly DocumentSection[];
  readonly gaps: readonly string[];
  /** The standing sentence about what this document is not. */
  readonly notice: string;
};

/**
 * Names for the types this build knows.
 *
 * Reference data, like the type codes themselves: a type this build has
 * never heard of is named from its code ("INVESTMENT_MEMO" → "Investment
 * memo") rather than refused.
 */
const KIND_NAMES: Readonly<Record<string, string>> = {
  INVESTMENT_BRIEF: "Investment brief",
  PITCH_DECK: "Investor deck",
};

export function artifactKindName(type: string): string {
  const known = KIND_NAMES[type];
  if (known !== undefined) return known;
  const words = type.toLowerCase().replace(/_+/g, " ").trim();
  return words.length === 0
    ? "Document"
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

const NOTICE =
  "Q composed this from what Capital Q holds on record. It is a private draft: it is not verified evidence, it changes nothing on your record, and nothing here has been shared or sent.";

function provenanceOf(finding: {
  readonly truthClass: string;
  readonly evidenceStatus: string;
}): string {
  const words = (code: string) => code.toLowerCase().replace(/_/g, " ");
  return `${words(finding.truthClass)} · ${words(finding.evidenceStatus)}`;
}

/** Deterministic, and in UTC: the same version prints the same date anywhere. */
function dateOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(at);
}

/** One stored version as a document. Adds nothing the version does not say. */
export function documentFromArtifact(input: {
  readonly type: string;
  readonly version: QArtifactVersion;
}): ArtifactDocument {
  const { version } = input;
  return {
    kind: artifactKindName(input.type),
    title: version.title,
    summary: version.summary,
    dateline: `Version ${String(version.version)} · ${dateOf(version.createdAt)}`,
    sections: version.content.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      findings: section.findings.map((finding) => ({
        statement: finding.statement,
        provenance: provenanceOf(finding),
      })),
    })),
    gaps: version.content.gaps,
    notice: NOTICE,
  };
}

/** A4 portrait, in points: what a printer in Lagos and in London both have. */
export const DOCUMENT_PAGE = { width: 595.28, height: 841.89 } as const;

const PAGE = {
  ...DOCUMENT_PAGE,
  left: 64,
  right: 64,
  top: 68,
  /** Room for the footer, which is drawn once every page is known. */
  bottom: 84,
} as const;

const INK = "#101418";
const SECONDARY = "#39424b";
/** 5.9:1 on white: secondary text that still passes WCAG AA. */
const MUTED = "#5b6570";

/**
 * Break text into lines no wider than `width`, with real metrics.
 *
 * A word longer than a whole line is broken by character rather than
 * left to run off the page: a pasted URL is the usual culprit.
 */
function wrapWith(
  face: EmbeddedFont,
  text: string,
  size: number,
  width: number,
): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = face
      .text(paragraph)
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (face.width(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line.length > 0) lines.push(line);
      if (face.width(word, size) <= width) {
        line = word;
        continue;
      }
      // Longer than a line on its own: split it where it has to be.
      let piece = "";
      for (const character of word) {
        if (face.width(piece + character, size) > width && piece.length > 0) {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      line = piece;
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * A cursor down a sequence of pages.
 *
 * Everything is placed by asking for room: `ensure` starts a new page
 * when what comes next would cross the bottom margin, which is also how
 * a heading is kept with the first lines under it.
 */
class Flow {
  private readonly pdf: PDFDocument;
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];

  constructor(pdf: PDFDocument) {
    this.pdf = pdf;
    this.page = this.addPage();
    this.y = PAGE.top;
  }

  private addPage(): PDFPage {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  get width(): number {
    return PAGE.width - PAGE.left - PAGE.right;
  }

  ensure(height: number): void {
    if (this.y + height > PAGE.height - PAGE.bottom && this.y > PAGE.top) {
      this.page = this.addPage();
      this.y = PAGE.top;
    }
  }

  gap(points: number): void {
    this.y += points;
  }

  /** Lines of one style, each on whichever page has room for it. */
  lines(
    face: EmbeddedFont,
    lines: readonly string[],
    options: {
      readonly size: number;
      readonly leading: number;
      readonly colour: string;
      readonly indent?: number;
      readonly rule?: string;
    },
  ): void {
    const indent = options.indent ?? 0;
    const lineHeight = Math.round(options.size * options.leading * 10) / 10;
    for (const line of lines) {
      this.ensure(lineHeight);
      if (options.rule !== undefined) {
        // A rule beside a finding, drawn per line so it follows the text
        // across a page break instead of spanning the gap.
        this.page.drawRectangle({
          x: PAGE.left + 2,
          y: PAGE.height - this.y - lineHeight,
          width: 1.5,
          height: lineHeight,
          color: colour(options.rule),
        });
      }
      drawLine(this.page, face, line, {
        x: PAGE.left + indent,
        y: PAGE.height - this.y - options.size,
        size: options.size,
        colour: colour(options.colour),
        maxWidth: this.width - indent,
      });
      this.y += lineHeight;
    }
  }

  rule(width: number, height: number, hex: string): void {
    this.ensure(height);
    this.page.drawRectangle({
      x: PAGE.left,
      y: PAGE.height - this.y - height,
      width,
      height,
      color: colour(hex),
    });
    this.y += height;
  }
}

/**
 * Write the document. Returns the PDF bytes.
 *
 * `brand` colours the rules and nothing else: a document prints on white
 * paper, and text stays in ink and a muted grey that both pass contrast,
 * whatever accent a company chose.
 */
export async function documentToPdf(
  document: ArtifactDocument,
  meta: { readonly title: string; readonly company?: string | undefined },
  brand?: BrandInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title, { showInWindowTitleBar: true });
  pdf.setSubject(document.kind);
  if (meta.company !== undefined) pdf.setAuthor(meta.company);
  pdf.setProducer("Capital Q");
  pdf.setCreator("Capital Q");
  pdf.setLanguage("en");
  const fonts = await embedFonts(pdf);
  const accent = themeFor(brand?.direction, brand?.accent).accent;

  const flow = new Flow(pdf);
  const width = flow.width;

  flow.lines(fonts.bold, wrapWith(fonts.bold, document.kind, 10, width), {
    size: 10,
    leading: 1.4,
    colour: MUTED,
  });
  flow.gap(6);
  flow.lines(fonts.bold, wrapWith(fonts.bold, document.title, 22, width), {
    size: 22,
    leading: 1.25,
    colour: INK,
  });
  flow.gap(10);
  flow.rule(64, 2.5, accent);
  flow.gap(14);
  if (document.summary !== undefined && document.summary.length > 0) {
    flow.lines(
      fonts.regular,
      wrapWith(fonts.regular, document.summary, 12, width),
      { size: 12, leading: 1.45, colour: SECONDARY },
    );
    flow.gap(8);
  }
  flow.lines(fonts.regular, [document.dateline], {
    size: 9,
    leading: 1.4,
    colour: MUTED,
  });
  flow.gap(22);

  const heading = (text: string) => {
    const lines = wrapWith(fonts.bold, text, 13.5, width);
    // Keep a heading with at least two lines of what follows it.
    flow.ensure(lines.length * 13.5 * 1.3 + 2 * 10.5 * 1.5 + 6);
    flow.lines(fonts.bold, lines, { size: 13.5, leading: 1.3, colour: INK });
    flow.gap(6);
  };

  for (const section of document.sections) {
    heading(section.heading);
    flow.lines(
      fonts.regular,
      wrapWith(fonts.regular, section.body, 10.5, width),
      { size: 10.5, leading: 1.5, colour: INK },
    );
    if (section.findings.length > 0) {
      flow.gap(8);
      for (const finding of section.findings) {
        flow.lines(
          fonts.regular,
          wrapWith(fonts.regular, finding.statement, 9.5, width - 14),
          {
            size: 9.5,
            leading: 1.45,
            colour: SECONDARY,
            indent: 14,
            rule: accent,
          },
        );
        flow.lines(
          fonts.regular,
          wrapWith(fonts.regular, finding.provenance, 8.5, width - 14),
          { size: 8.5, leading: 1.45, colour: MUTED, indent: 14, rule: accent },
        );
        flow.gap(5);
      }
    }
    flow.gap(16);
  }

  if (document.gaps.length > 0) {
    heading("What isn't on record yet");
    for (const gap of document.gaps) {
      const lines = wrapWith(fonts.regular, gap, 10.5, width - 16);
      lines.forEach((line, index) => {
        flow.lines(fonts.regular, [index === 0 ? `•  ${line}` : line], {
          size: 10.5,
          leading: 1.5,
          colour: INK,
          indent: index === 0 ? 0 : 13,
        });
      });
    }
    flow.gap(16);
  }

  // The footer, now that the page count is known: what this is not, on
  // every page, because a page can be printed and passed on alone.
  const notice = wrapWith(fonts.regular, document.notice, 7.5, width - 72);
  flow.pages.forEach((page, index) => {
    const label = `Page ${String(index + 1)} of ${String(flow.pages.length)}`;
    const labelWidth = fonts.regular.width(label, 7.5);
    drawLine(page, fonts.regular, label, {
      x: PAGE.width - PAGE.right - labelWidth,
      y: PAGE.bottom - 40,
      size: 7.5,
      colour: colour(MUTED),
      maxWidth: labelWidth + 1,
    });
    notice.forEach((line, lineIndex) => {
      drawLine(page, fonts.regular, line, {
        x: PAGE.left,
        y: PAGE.bottom - 40 - lineIndex * 10,
        size: 7.5,
        colour: colour(MUTED),
        maxWidth: width - 72,
      });
    });
    page.drawRectangle({
      x: PAGE.left,
      y: PAGE.bottom - 28,
      width,
      height: 0.5,
      color: colour("#d5dbe1"),
    });
  });

  return pdf.save();
}
