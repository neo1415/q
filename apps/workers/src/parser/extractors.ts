import type {
  ExtractedBlock,
  ParserOutput,
} from "@capital-q/evidence/contracts";

import {
  findAll,
  localName,
  openOoxmlPackage,
  OoxmlRefusedError,
  parseXml,
  textOf,
  type XmlNode,
  type ZipLimits,
} from "./ooxml.js";

/**
 * Content extractors (doc 14 §9.2).
 *
 * Each turns one format into structured blocks that remember where they came
 * from: a page, a slide, a section, a line range. Flattening a deck into
 * prose would make a later citation impossible, so nothing here flattens.
 *
 * These run inside the parser sandbox and only there. They hold no
 * credentials, open no sockets, write no files and execute nothing the
 * document contains — no macro, no PDF JavaScript, no embedded object, no
 * external reference.
 */

export type SourceDescriptor = {
  readonly mimeType: string;
  readonly filename: string;
  readonly sizeBytes: number;
};

export type ExtractionLimits = ZipLimits & {
  readonly maxBlocks: number;
  readonly maxBlockCharacters: number;
  readonly maxTotalCharacters: number;
  readonly maxPages: number;
  readonly maxSlides: number;
  readonly maxXmlNodes: number;
  readonly maxXmlDepth: number;
};

export type ExtractionContext = {
  readonly limits: ExtractionLimits;
};

export type ContentExtractor = {
  readonly id: string;
  readonly version: string;
  readonly supports: (descriptor: SourceDescriptor) => boolean;
  readonly extract: (
    input: Buffer,
    context: ExtractionContext,
  ) => Promise<ParserOutput>;
};

export type ContentExtractorRegistry = {
  readonly resolve: (descriptor: SourceDescriptor) => ContentExtractor | null;
};

/** Collects blocks while enforcing the bounds the artifact schema also checks. */
class BlockBuilder {
  private readonly blocks: ExtractedBlock[] = [];
  private readonly limits: ExtractionLimits;
  private characters = 0;
  private stopped = false;

  constructor(limits: ExtractionLimits) {
    this.limits = limits;
  }

  get truncated(): boolean {
    return this.stopped;
  }

  get index(): number {
    return this.blocks.length;
  }

  clip(text: string): string {
    return text.length > this.limits.maxBlockCharacters
      ? text.slice(0, this.limits.maxBlockCharacters)
      : text;
  }

  add(block: ExtractedBlock, characters: number): boolean {
    if (this.stopped) return false;
    if (
      this.blocks.length >= this.limits.maxBlocks ||
      this.characters + characters > this.limits.maxTotalCharacters
    ) {
      // Stop and say so, rather than silently returning a partial document
      // that looks complete.
      this.stopped = true;
      return false;
    }
    this.blocks.push(block);
    this.characters += characters;
    return true;
  }

  build(): readonly ExtractedBlock[] {
    return this.blocks;
  }
}

function normaliseWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export const TEXT_EXTRACTOR_VERSION = "1.0.0";

export function createTextExtractor(): ContentExtractor {
  return {
    id: "text",
    version: TEXT_EXTRACTOR_VERSION,
    supports: (descriptor) =>
      descriptor.mimeType === "text/plain" ||
      descriptor.mimeType === "text/csv",
    extract: (input, context) => {
      const builder = new BlockBuilder(context.limits);
      // Decoded leniently: a document with a bad byte is still a document,
      // and replacement characters are more honest than a hard failure.
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(input);
      // A leading byte-order mark is an encoding artefact, not content.
      const decoded = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const lines = decoded.replace(/\r\n?/g, "\n").split("\n");

      let paragraph: string[] = [];
      let startLine = 1;
      const flush = (endLine: number): void => {
        const text = normaliseWhitespace(paragraph.join("\n"));
        paragraph = [];
        if (text.length === 0) return;
        const clipped = builder.clip(text);
        builder.add(
          {
            kind: "paragraph",
            text: clipped,
            locator: {
              index: builder.index,
              lineStart: startLine,
              lineEnd: endLine,
            },
          },
          clipped.length,
        );
      };

      lines.forEach((line, offset) => {
        if (line.trim().length === 0) {
          flush(offset);
          startLine = offset + 2;
          return;
        }
        if (paragraph.length === 0) startLine = offset + 1;
        paragraph.push(line);
      });
      flush(lines.length);

      return Promise.resolve({
        blocks: [...builder.build()],
        metadata: {
          parser: "text",
          parserVersion: TEXT_EXTRACTOR_VERSION,
          ...(builder.truncated ? { truncated: true } : {}),
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

export const DOCX_EXTRACTOR_VERSION = "1.0.0";

const WORD_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function paragraphStyle(paragraph: XmlNode): {
  readonly heading: number | null;
  readonly listed: boolean;
} {
  const properties = paragraph.children.find(
    (child) => localName(child) === "pPr",
  );
  if (properties === undefined) return { heading: null, listed: false };
  const style = properties.children.find(
    (child) => localName(child) === "pStyle",
  );
  const value = style?.attributes.get("w:val") ?? style?.attributes.get("val");
  const heading = /^heading\s*([1-6])$/i.exec(value ?? "");
  return {
    heading: heading === null ? null : Number(heading[1]),
    listed: properties.children.some((child) => localName(child) === "numPr"),
  };
}

function paragraphText(paragraph: XmlNode): string {
  return normaliseWhitespace(
    findAll(paragraph, "t")
      .map((node) => node.text)
      .join(""),
  );
}

export function createDocxExtractor(): ContentExtractor {
  return {
    id: "ooxml_docx",
    version: DOCX_EXTRACTOR_VERSION,
    supports: (descriptor) => descriptor.mimeType === WORD_MIME,
    extract: (input, context) => {
      const pkg = openOoxmlPackage(input, context.limits);
      const xml = pkg.read("word/document.xml");
      if (xml === null) {
        throw new OoxmlRefusedError(
          "MALFORMED_PACKAGE",
          "no word/document.xml",
        );
      }
      const document = parseXml(xml, {
        maxNodes: context.limits.maxXmlNodes,
        maxDepth: context.limits.maxXmlDepth,
      });
      const bodies = findAll(document, "body");
      const body = bodies[0];
      const builder = new BlockBuilder(context.limits);
      let section = 0;
      let pendingList: string[] = [];

      const flushList = (): void => {
        if (pendingList.length === 0) return;
        const items = pendingList.map((item) => builder.clip(item));
        pendingList = [];
        builder.add(
          {
            kind: "list",
            ordered: false,
            items,
            locator: { index: builder.index, section },
          },
          items.reduce((total, item) => total + item.length, 0),
        );
      };

      for (const node of body?.children ?? []) {
        const name = localName(node);
        if (name === "p") {
          section += 1;
          const text = paragraphText(node);
          const style = paragraphStyle(node);
          if (text.length === 0) {
            flushList();
            continue;
          }
          if (style.listed) {
            pendingList.push(text);
            continue;
          }
          flushList();
          const clipped = builder.clip(text);
          builder.add(
            style.heading === null
              ? {
                  kind: "paragraph",
                  text: clipped,
                  locator: { index: builder.index, section },
                }
              : {
                  kind: "heading",
                  level: style.heading,
                  text: clipped,
                  locator: { index: builder.index, section },
                },
            clipped.length,
          );
          continue;
        }
        if (name === "tbl") {
          flushList();
          section += 1;
          const rows = findAll(node, "tr").map((row) =>
            findAll(row, "tc").map((cell) =>
              builder.clip(normaliseWhitespace(textOf(cell))),
            ),
          );
          if (rows.length === 0) continue;
          builder.add(
            {
              kind: "table",
              rows: rows.slice(0, 500).map((row) => row.slice(0, 64)),
              locator: { index: builder.index, section },
            },
            rows.reduce(
              (total, row) =>
                total + row.reduce((sum, cell) => sum + cell.length, 0),
              0,
            ),
          );
        }
      }
      flushList();

      return Promise.resolve({
        blocks: [...builder.build()],
        metadata: {
          parser: "ooxml_docx",
          parserVersion: DOCX_EXTRACTOR_VERSION,
          ...(builder.truncated ? { truncated: true } : {}),
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

export const PPTX_EXTRACTOR_VERSION = "1.0.0";

const PRESENTATION_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const SLIDE_NAME = /^ppt\/slides\/slide(\d+)\.xml$/;

export function createPptxExtractor(): ContentExtractor {
  return {
    id: "ooxml_pptx",
    version: PPTX_EXTRACTOR_VERSION,
    supports: (descriptor) => descriptor.mimeType === PRESENTATION_MIME,
    extract: (input, context) => {
      const pkg = openOoxmlPackage(input, context.limits);
      const slides = pkg.names
        .map((name) => ({ name, match: SLIDE_NAME.exec(name) }))
        .filter(
          (entry): entry is { name: string; match: RegExpExecArray } =>
            entry.match !== null,
        )
        .map((entry) => ({ name: entry.name, number: Number(entry.match[1]) }))
        // A deck's order is its meaning; file order in the package is not.
        .sort((a, b) => a.number - b.number)
        .slice(0, context.limits.maxSlides);

      const builder = new BlockBuilder(context.limits);
      for (const slide of slides) {
        const xml = pkg.read(slide.name);
        if (xml === null) continue;
        const parsed = parseXml(xml, {
          maxNodes: context.limits.maxXmlNodes,
          maxDepth: context.limits.maxXmlDepth,
        });
        // Paragraph-level text, so slide lines stay separate lines.
        const lines = findAll(parsed, "p")
          .map((paragraph) =>
            normaliseWhitespace(
              findAll(paragraph, "t")
                .map((node) => node.text)
                .join(""),
            ),
          )
          .filter((line) => line.length > 0);
        if (lines.length === 0) continue;
        const title = lines[0];
        const text = builder.clip(lines.join("\n"));
        builder.add(
          {
            kind: "slide",
            slideNumber: slide.number,
            ...(title === undefined ? {} : { title: builder.clip(title) }),
            text,
            locator: { index: builder.index, slide: slide.number },
          },
          text.length,
        );
      }

      return Promise.resolve({
        blocks: [...builder.build()],
        metadata: {
          parser: "ooxml_pptx",
          parserVersion: PPTX_EXTRACTOR_VERSION,
          slideCount: slides.length,
          ...(builder.truncated ? { truncated: true } : {}),
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export const PDF_EXTRACTOR_VERSION = "1.0.0";

type PdfTextItem = { readonly str?: unknown; readonly transform?: unknown };

/** Groups a page's text items into lines by vertical position, then paragraphs. */
function pageParagraphs(items: readonly PdfTextItem[]): readonly string[] {
  const lines = new Map<number, string[]>();
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.length === 0) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const y = typeof transform[5] === "number" ? Math.round(transform[5]) : 0;
    const existing = lines.get(y);
    if (existing === undefined) lines.set(y, [item.str]);
    else existing.push(item.str);
  }
  const ordered = [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => normaliseWhitespace(parts.join(" ")))
    .filter((line) => line.length > 0);

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of ordered) {
    current.push(line);
    // A short line that ends a sentence closes the paragraph; anything more
    // clever would be guessing at layout we cannot see.
    if (/[.!?:]$/.test(line) && current.join(" ").length > 120) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

export function createPdfExtractor(
  loadPdf: (bytes: Uint8Array) => Promise<{
    readonly numPages: number;
    readonly getPage: (n: number) => Promise<{
      readonly getTextContent: () => Promise<{
        readonly items: readonly PdfTextItem[];
      }>;
      readonly cleanup: () => void;
    }>;
    readonly destroy: () => Promise<void>;
  }>,
): ContentExtractor {
  return {
    id: "pdf",
    version: PDF_EXTRACTOR_VERSION,
    supports: (descriptor) => descriptor.mimeType === "application/pdf",
    extract: async (input, context) => {
      const document = await loadPdf(new Uint8Array(input));
      const builder = new BlockBuilder(context.limits);
      const pageCount = Math.min(document.numPages, context.limits.maxPages);
      try {
        for (let page = 1; page <= pageCount; page += 1) {
          const loaded = await document.getPage(page);
          const content = await loaded.getTextContent();
          for (const paragraph of pageParagraphs(content.items)) {
            const clipped = builder.clip(paragraph);
            builder.add(
              {
                kind: "paragraph",
                text: clipped,
                locator: { index: builder.index, page },
              },
              clipped.length,
            );
          }
          loaded.cleanup();
          if (page < pageCount) {
            builder.add(
              { kind: "page_break", locator: { index: builder.index, page } },
              0,
            );
          }
        }
      } finally {
        await document.destroy();
      }

      return {
        blocks: [...builder.build()],
        metadata: {
          parser: "pdf",
          parserVersion: PDF_EXTRACTOR_VERSION,
          pageCount: document.numPages,
          ...(builder.truncated || pageCount < document.numPages
            ? { truncated: true }
            : {}),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function createContentExtractorRegistry(
  extractors: readonly ContentExtractor[],
): ContentExtractorRegistry {
  return {
    resolve: (descriptor) =>
      extractors.find((extractor) => extractor.supports(descriptor)) ?? null,
  };
}
