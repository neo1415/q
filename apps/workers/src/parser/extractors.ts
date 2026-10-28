import {
  EXTRACTION_LIMITS,
  LOW_TEXT_PAGE_CHARACTERS,
  type ExtractedBlock,
  type ParserOutput,
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
import {
  pageBlocks,
  pageTextCharacters,
  type PdfTextItem,
} from "./pdf-layout.js";

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
  readonly maxSheets: number;
  readonly maxRowsPerSheet: number;
  readonly maxColumnsPerSheet: number;
  readonly maxCellsTotal: number;
  readonly maxRangeRows: number;
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
export class BlockBuilder {
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

export function normaliseWhitespace(value: string): string {
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
    // CSV has its own row-preserving extractor (CQ-RAG-001).
    supports: (descriptor) => descriptor.mimeType === "text/plain",
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

/**
 * 1.1.0: a slide's speaker notes and its charts' series, categories and
 * values are read with it (founders put the numbers in a chart and the
 * story in the notes); both are labelled in the slide's text.
 */
export const PPTX_EXTRACTOR_VERSION = "1.1.0";

type XmlLimits = { readonly maxNodes: number; readonly maxDepth: number };

/**
 * A part's relationships, internal targets only, resolved against the
 * part's folder. An external target or one that climbs out of the package
 * is never followed.
 */
function relationshipsOf(
  pkg: { readonly read: (name: string) => string | null },
  partName: string,
  limits: XmlLimits,
): ReadonlyMap<string, { readonly type: string; readonly target: string }> {
  const slash = partName.lastIndexOf("/");
  const folder = partName.slice(0, slash);
  const xml = pkg.read(`${folder}/_rels/${partName.slice(slash + 1)}.rels`);
  const found = new Map<string, { type: string; target: string }>();
  if (xml === null) return found;
  for (const rel of findAll(parseXml(xml, limits), "Relationship")) {
    const id = rel.attributes.get("Id");
    const type = rel.attributes.get("Type") ?? "";
    const target = rel.attributes.get("Target");
    if (id === undefined || target === undefined) continue;
    if (rel.attributes.get("TargetMode") === "External") continue;
    const parts = target.startsWith("/")
      ? target.slice(1).split("/")
      : [...folder.split("/"), ...target.split("/")];
    const resolved: string[] = [];
    let escaped = false;
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (resolved.length === 0) escaped = true;
        resolved.pop();
      } else resolved.push(part);
    }
    if (!escaped) found.set(id, { type, target: resolved.join("/") });
  }
  return found;
}

const paragraphLines = (node: XmlNode): string[] =>
  findAll(node, "p")
    .map((paragraph) =>
      normaliseWhitespace(
        findAll(paragraph, "t")
          .map((t) => t.text)
          .join(""),
      ),
    )
    .filter((line) => line.length > 0);

/** The speaker notes: the notes page's body placeholder, nothing else. */
function notesText(xml: string, limits: XmlLimits): string {
  const lines: string[] = [];
  for (const shape of findAll(parseXml(xml, limits), "sp")) {
    const body = findAll(shape, "ph").some(
      (ph) => ph.attributes.get("type") === "body",
    );
    if (body) lines.push(...paragraphLines(shape));
  }
  return lines.join("\n");
}

/** Cached point values of a chart reference, in index order. */
function pointValues(node: XmlNode | undefined): string[] {
  if (node === undefined) return [];
  return findAll(node, "pt")
    .map((pt) => ({
      idx: Number(pt.attributes.get("idx") ?? "0"),
      value: normaliseWhitespace(findAll(pt, "v").map(textOf).join("")),
    }))
    .sort((a, b) => a.idx - b.idx)
    .map((pt) => pt.value)
    .slice(0, 60);
}

/**
 * A chart as text: its title, then each series as "name: category =
 * value; ...". The cached values the file carries, as written; nothing is
 * computed or estimated, and a chart with no cached values says so by
 * having none.
 */
function chartText(xml: string, limits: XmlLimits): string {
  const root = parseXml(xml, limits);
  const first = (node: XmlNode, name: string) => findAll(node, name)[0];
  const titleNode = first(root, "title");
  const title =
    titleNode === undefined
      ? ""
      : normaliseWhitespace(
          findAll(titleNode, "t")
            .map((t) => t.text)
            .join(" "),
        );
  const lines: string[] = [`Chart${title.length > 0 ? `: ${title}` : ""}`];
  for (const series of findAll(root, "ser").slice(0, 12)) {
    const nameNode = first(series, "tx");
    const name =
      nameNode === undefined
        ? ""
        : normaliseWhitespace(
            findAll(nameNode, "v").map(textOf).join(" ") ||
              findAll(nameNode, "t")
                .map((t) => t.text)
                .join(" "),
          );
    const categories = pointValues(first(series, "cat"));
    const values = pointValues(first(series, "val") ?? first(series, "yVal"));
    if (values.length === 0) continue;
    const points = values.map((value, at) =>
      categories[at] === undefined ? value : `${categories[at]} = ${value}`,
    );
    lines.push(`${name.length > 0 ? `${name}: ` : ""}${points.join("; ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

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
        // Paragraph-level text, so slide lines stay separate lines. Chart
        // frames hold no paragraphs of their own; their data is read below.
        const lines = paragraphLines(parsed);
        const xmlLimits = {
          maxNodes: context.limits.maxXmlNodes,
          maxDepth: context.limits.maxXmlDepth,
        };
        const rels = relationshipsOf(pkg, slide.name, xmlLimits);
        const charts: string[] = [];
        for (const chart of findAll(parsed, "chart")) {
          const id =
            chart.attributes.get("r:id") ??
            [...chart.attributes.entries()].find(([key]) =>
              key.endsWith(":id"),
            )?.[1];
          const rel = id === undefined ? undefined : rels.get(id);
          if (rel === undefined || !rel.type.endsWith("/chart")) continue;
          const chartXml = pkg.read(rel.target);
          const text = chartXml === null ? "" : chartText(chartXml, xmlLimits);
          if (text.length > 0) charts.push(text);
        }
        const notesRel = [...rels.values()].find((rel) =>
          rel.type.endsWith("/notesSlide"),
        );
        const notesXml =
          notesRel === undefined ? null : pkg.read(notesRel.target);
        const notes = notesXml === null ? "" : notesText(notesXml, xmlLimits);
        if (lines.length === 0 && charts.length === 0 && notes.length === 0)
          continue;
        const title = lines[0];
        const text = builder.clip(
          [
            ...lines,
            ...charts,
            ...(notes.length === 0 ? [] : [`Speaker notes: ${notes}`]),
          ].join("\n"),
        );
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

/**
 * 2.0.0: reading order rebuilt from geometry (pdf-layout.ts): lines sorted
 * left to right (right to left for RTL scripts), table cells kept apart,
 * columns read one at a time, paragraphs split on vertical gaps, larger
 * short lines emitted as headings.
 */
export const PDF_EXTRACTOR_VERSION = "2.0.0";

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
      // Pages that are pictures (scans, slides exported as one image):
      // recorded, so a reader is told rather than handed silence.
      const lowTextPages: number[] = [];
      try {
        for (let page = 1; page <= pageCount; page += 1) {
          const loaded = await document.getPage(page);
          const content = await loaded.getTextContent();
          if (
            pageTextCharacters(content.items) < LOW_TEXT_PAGE_CHARACTERS &&
            lowTextPages.length < EXTRACTION_LIMITS.maxPageList
          ) {
            lowTextPages.push(page);
          }
          for (const block of pageBlocks(content.items)) {
            const clipped = builder.clip(block.text);
            builder.add(
              block.kind === "heading"
                ? {
                    kind: "heading",
                    level: 1,
                    text: clipped,
                    locator: { index: builder.index, page },
                  }
                : {
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
          ...(lowTextPages.length === 0 ? {} : { lowTextPages }),
          ...(builder.truncated || pageCount < document.numPages
            ? { truncated: true }
            : {}),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const IMAGE_EXTRACTOR_VERSION = "1.0.0";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * An uploaded PNG or JPEG: a picture has no text layer, so the extraction
 * is honest about that (one low-text page, no blocks) instead of refusing
 * the file as unsupported. The page's text can then be transcribed from
 * the picture through the model gateway; without a vision provider the
 * founder is told the picture could not be read. The bytes must be what
 * the type claims: a file whose signature disagrees is malformed.
 */
export function createImageExtractor(): ContentExtractor {
  return {
    id: "image",
    version: IMAGE_EXTRACTOR_VERSION,
    supports: (descriptor) =>
      descriptor.mimeType === "image/png" ||
      descriptor.mimeType === "image/jpeg",
    extract: (input) => {
      const png = PNG_SIGNATURE.every((byte, at) => input[at] === byte);
      const jpeg = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
      if (!png && !jpeg) {
        return Promise.reject(
          new OoxmlRefusedError(
            "MALFORMED_PACKAGE",
            "image signature mismatch",
          ),
        );
      }
      return Promise.resolve({
        blocks: [],
        metadata: {
          parser: "image",
          parserVersion: IMAGE_EXTRACTOR_VERSION,
          pageCount: 1,
          lowTextPages: [1],
        },
      });
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
