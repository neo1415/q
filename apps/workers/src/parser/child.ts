import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createContentExtractorRegistry,
  createDocxExtractor,
  createPdfExtractor,
  createPptxExtractor,
  createTextExtractor,
  type ContentExtractor,
} from "./extractors.js";
import { OoxmlRefusedError } from "./ooxml.js";
import {
  PARSER_INPUT_FILE,
  PARSER_REQUEST_FILE,
  ParserRequestSchema,
  ParserRefusalCodeSchema,
  type ParserRefusalCode,
} from "./protocol.js";

/**
 * The parser sandbox entry point (doc 15 §28, doc 16 TM-FILE-05).
 *
 * This process is the only place a document's bytes are interpreted, and it
 * is deliberately impoverished: it receives one directory path on argv, reads
 * two files from it, writes one JSON line to stdout and exits. It holds no
 * database handle, no storage credential, no model key and no connector
 * token, because its environment was scrubbed before it started — an
 * exploited parser has nothing to steal and nowhere to send it.
 *
 * It also never executes what it reads. Macros are not run, PDF JavaScript is
 * not enabled, embedded objects are not opened, and no relationship to an
 * external target is ever followed.
 */

type PdfDocument = {
  readonly numPages: number;
  readonly getPage: (n: number) => Promise<{
    readonly getTextContent: () => Promise<{
      readonly items: readonly { readonly str?: unknown }[];
    }>;
    readonly cleanup: () => void;
  }>;
  readonly destroy: () => Promise<void>;
};

/**
 * pdf.js is loaded through a non-literal specifier so its browser-shaped type
 * surface never enters this build, and lazily so a DOCX never pays for it.
 */
async function loadPdfDocument(bytes: Uint8Array): Promise<PdfDocument> {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const loaded: unknown = await import(specifier);
  const getDocument = (
    loaded as {
      getDocument?: (options: Record<string, unknown>) => unknown;
    }
  ).getDocument;
  if (typeof getDocument !== "function") {
    throw new Error("pdf backend unavailable");
  }
  const task: unknown = getDocument({
    data: bytes,
    // No eval, no system fonts, no network font fetches, no scripting: a PDF
    // is data here, never a program.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const promise = (task as { promise?: unknown }).promise;
  const document = (await promise) as PdfDocument;
  return {
    numPages: document.numPages,
    getPage: (n) => document.getPage(n),
    destroy: async () => {
      const destroy = (task as { destroy?: () => Promise<void> }).destroy;
      if (typeof destroy === "function") await destroy.call(task);
    },
  };
}

function buildRegistry(): readonly ContentExtractor[] {
  return [
    createPdfExtractor(loadPdfDocument),
    createDocxExtractor(),
    createPptxExtractor(),
    createTextExtractor(),
  ];
}

function refusalOf(error: unknown): ParserRefusalCode {
  if (error instanceof OoxmlRefusedError) {
    const parsed = ParserRefusalCodeSchema.safeParse(error.code);
    return parsed.success ? parsed.data : "PARSER_FAILED";
  }
  return "PARSER_FAILED";
}

/** One JSON line, then exit. Never a stack trace, never document text. */
function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main(): Promise<void> {
  const workspace = process.argv[2];
  if (workspace === undefined || workspace.length === 0) {
    emit({ ok: false, code: "PARSER_FAILED" });
    return;
  }

  const request = ParserRequestSchema.parse(
    JSON.parse(readFileSync(join(workspace, PARSER_REQUEST_FILE), "utf8")),
  );
  const input = readFileSync(join(workspace, PARSER_INPUT_FILE));
  if (
    input.byteLength >
    request.limits.maxEntryBytes * request.limits.maxEntries
  ) {
    emit({ ok: false, code: "INPUT_TOO_LARGE" });
    return;
  }

  const registry = createContentExtractorRegistry(buildRegistry());
  const extractor = registry.resolve({
    mimeType: request.mimeType,
    filename: request.filename,
    sizeBytes: request.sizeBytes,
  });
  if (extractor === null) {
    // Spreadsheets and CSV are admissible uploads with no extractor yet. The
    // pipeline records that honestly instead of reporting a completed run.
    emit({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
    return;
  }

  try {
    const output = await extractor.extract(input, { limits: request.limits });
    emit({
      ok: true,
      extractorId: extractor.id,
      extractorVersion: extractor.version,
      output,
    });
  } catch (error: unknown) {
    emit({ ok: false, code: refusalOf(error) });
  }
}

try {
  await main();
} catch {
  // Any unexpected failure is reported as a bounded code. The parent decides
  // what it means; the child never editorialises with a message it read.
  emit({ ok: false, code: "PARSER_FAILED" });
  process.exitCode = 0;
}
