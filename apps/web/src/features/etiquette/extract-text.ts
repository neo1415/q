import {
  ETIQUETTE_FILE_BYTES_MAX,
  type EtiquetteMediaType,
} from "@capital-q/contracts";

/**
 * Reading a guide's text in the person's own browser (ADR 0050).
 *
 * A guide is only ever text to Capital Q: the file's bytes are read here,
 * on the person's own device, and only the text is sent. No server parses
 * an uploaded guide, so there is no parser for a hostile file to attack.
 * PDF text comes from pdf.js (no scripting, no fonts fetched); a Word file
 * is unzipped with the browser's own decompressor and its paragraphs read
 * from word/document.xml; text and Markdown are read as they are.
 */

export type ExtractedGuide =
  | {
      readonly ok: true;
      readonly text: string;
      readonly fileName: string;
      readonly mediaType: EtiquetteMediaType;
    }
  | { readonly ok: false; readonly message: string };

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The guide type a file is, by its declared type and then its name. */
export function guideTypeOf(file: {
  readonly name: string;
  readonly type: string;
}): EtiquetteMediaType | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (file.type === DOCX || name.endsWith(".docx")) return DOCX;
  if (
    file.type === "text/markdown" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return "text/markdown";
  }
  if (file.type === "text/plain" || name.endsWith(".txt")) return "text/plain";
  return null;
}

/** Tidy extracted text: one newline style, no control characters, no runs. */
export function tidyText(text: string): string {
  return (
    text
      .replace(/\r\n?/gu, "\n")
      // eslint-disable-next-line no-control-regex -- removing them is the point.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim()
  );
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (whole, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[entity.toLowerCase()] ?? whole;
    },
  );
}

/** A Word document's paragraphs as text: each w:p a line, tabs and breaks kept. */
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/w:p>/u);
  return paragraphs
    .map((paragraph) => {
      let line = "";
      for (const match of paragraph.matchAll(
        /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/gu,
      )) {
        if (match[0] === "<w:tab/>") line += "\t";
        else if (match[0] === "<w:br/>") line += "\n";
        else line += decodeXml(match[1] ?? "");
      }
      return line;
    })
    .join("\n");
}

/** Enough to stop a zip bomb: the document part may not inflate past this. */
const INFLATED_MAX = 20 * 1024 * 1024;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INFLATED_MAX) {
      await reader.cancel();
      throw new Error("too large once unpacked");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * word/document.xml from a .docx, read from the zip's central directory
 * (stored or deflated; nothing else is opened, nothing is followed).
 */
export async function docxDocumentXml(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KiB + 22.
  let end = -1;
  for (
    let at = bytes.byteLength - 22;
    at >= Math.max(0, bytes.byteLength - 65_557);
    at -= 1
  ) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a Word file");
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("not a Word file");
    }
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name === "word/document.xml") {
      if (local + 30 > bytes.byteLength) throw new Error("not a Word file");
      const localName = view.getUint16(local + 26, true);
      const localExtra = view.getUint16(local + 28, true);
      const start = local + 30 + localName + localExtra;
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return decoder.decode(data);
      if (method === 8) return decoder.decode(await inflateRaw(data));
      throw new Error("unsupported compression");
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("not a Word file");
}

/** Most pages read from a PDF guide: a guide, not a book. */
const PDF_PAGES_MAX = 60;

async function pdfText(bytes: Uint8Array): Promise<string> {
  // The worker module runs on this thread ("fake worker"): no worker URL,
  // no extra origin, and it is loaded only when a PDF is chosen.
  await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const pdfjs = await import("pdfjs-dist");
  // pdf.js 6 never evaluates code from a PDF; fonts are not loaded either.
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(document.numPages, PDF_PAGES_MAX); n += 1) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "",
          )
          .join(""),
      );
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

/** Read a chosen file's text, within the size limit and the text limit. */
export async function extractGuideText(
  file: File,
  maxCharacters: number,
): Promise<ExtractedGuide> {
  const mediaType = guideTypeOf(file);
  if (mediaType === null) {
    return {
      ok: false,
      message: "Choose a PDF, a Word file (.docx), or a text or Markdown file.",
    };
  }
  if (file.size > ETIQUETTE_FILE_BYTES_MAX) {
    return {
      ok: false,
      message: "That file is over 10 MB. Choose a smaller one.",
    };
  }
  let raw: string;
  try {
    if (mediaType === "application/pdf") {
      raw = await pdfText(new Uint8Array(await file.arrayBuffer()));
    } else if (mediaType === DOCX) {
      raw = docxXmlToText(
        await docxDocumentXml(new Uint8Array(await file.arrayBuffer())),
      );
    } else {
      raw = await file.text();
    }
  } catch {
    return {
      ok: false,
      message:
        "That file couldn't be read. Try another, or paste the text instead.",
    };
  }
  const text = tidyText(raw);
  if (text.length < 20) {
    return {
      ok: false,
      message:
        "No text could be read from that file (a scanned PDF has none). Paste the text instead.",
    };
  }
  if (text.length > maxCharacters) {
    return {
      ok: false,
      message: `That guide is ${text.length.toLocaleString("en-GB")} characters; the limit is ${maxCharacters.toLocaleString("en-GB")}. Shorten it and try again.`,
    };
  }
  const fileName =
    file.name
      // eslint-disable-next-line no-control-regex -- a name, never a path or control text.
      .replace(/[/\\\u0000-\u001F\u007F]/gu, "_")
      .trim()
      .slice(0, 200) || "guide";
  return { ok: true, text, fileName, mediaType };
}
