import type { DocumentUploadFailureCode } from "../contracts/upload.js";
import type { DetectedContentKind } from "./upload-policy.js";

/**
 * What the stored bytes actually are (doc 15 §26–29, doc 16 TM-FILE-02/03/04).
 *
 * Pure identification, no interpretation. Nothing here decompresses an
 * archive, evaluates a formula, executes a macro, follows a reference or
 * reads a document's words. It answers one question: is this container the
 * kind of thing it claims to be? A document that is structurally a DOCX and
 * whose text says "ignore all instructions" is a valid DOCX; its words
 * carry no authority and are not this layer's business.
 *
 * Bounded by construction: the caller supplies a ranged reader over bytes
 * already staged under the size limit, and every read here is capped.
 */

/** Random access over the staged bytes. Never the live storage object. */
export type ByteRangeReader = (
  offset: number,
  length: number,
) => Promise<Uint8Array>;

export type ContentDetection =
  | { readonly ok: true; readonly kind: DetectedContentKind }
  | { readonly ok: false; readonly failureCode: DocumentUploadFailureCode };

const HEAD_BYTES = 8192;
/** EOCD is 22 bytes plus a comment of at most 65535. */
const ZIP_TAIL_BYTES = 65557;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 8192;
const TEXT_SAMPLE_BYTES = 65536;

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  zip: [0x50, 0x4b, 0x03, 0x04],
  zipEmpty: [0x50, 0x4b, 0x05, 0x06],
  zipSpanned: [0x50, 0x4b, 0x07, 0x08],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
  elf: [0x7f, 0x45, 0x4c, 0x46],
  mz: [0x4d, 0x5a], // DOS/PE executable
  rar: [0x52, 0x61, 0x72, 0x21],
  sevenZip: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  gzip: [0x1f, 0x8b],
  compoundFile: [0xd0, 0xcf, 0x11, 0xe0], // legacy .doc/.xls/.ppt
  classFile: [0xca, 0xfe, 0xba, 0xbe],
} as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Entry names from the ZIP central directory, read as data.
 *
 * Only the directory is parsed: names, not contents. No entry is inflated,
 * so a decompression bomb cannot detonate here — and equally, admitting the
 * package says nothing about whether extracting it later is safe. That
 * judgement belongs to the isolated processing worker.
 */
async function readZipEntryNames(input: {
  readonly sizeBytes: number;
  readonly read: ByteRangeReader;
}): Promise<
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly failureCode: DocumentUploadFailureCode }
> {
  const unreadable = {
    ok: false,
    failureCode: "CONTENT_UNRECOGNISED",
  } as const;
  const tailLength = Math.min(input.sizeBytes, ZIP_TAIL_BYTES);
  const tailOffset = input.sizeBytes - tailLength;
  const tail = await input.read(tailOffset, tailLength);

  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (
      tail[index] === 0x50 &&
      tail[index + 1] === 0x4b &&
      tail[index + 2] === 0x05 &&
      tail[index + 3] === 0x06
    ) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return unreadable;

  const entryCount = readUint16(tail, eocd + 10);
  const directorySize = readUint32(tail, eocd + 12);
  const directoryOffset = readUint32(tail, eocd + 16);
  // ZIP64 sentinel values: identity cannot be established with bounded
  // reads, and a business document has no reason to need them.
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    return unreadable;
  }
  if (
    entryCount === 0 ||
    entryCount > ZIP_MAX_ENTRIES ||
    directorySize === 0 ||
    directorySize > ZIP_MAX_CENTRAL_DIRECTORY_BYTES ||
    directoryOffset + directorySize > input.sizeBytes
  ) {
    return unreadable;
  }

  const directory = await input.read(directoryOffset, directorySize);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const names: string[] = [];
  let cursor = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (cursor + 46 > directory.length) return unreadable;
    if (
      directory[cursor] !== 0x50 ||
      directory[cursor + 1] !== 0x4b ||
      directory[cursor + 2] !== 0x01 ||
      directory[cursor + 3] !== 0x02
    ) {
      return unreadable;
    }
    const nameLength = readUint16(directory, cursor + 28);
    const extraLength = readUint16(directory, cursor + 30);
    const commentLength = readUint16(directory, cursor + 32);
    const nameStart = cursor + 46;
    if (nameLength > 512 || nameStart + nameLength > directory.length) {
      return unreadable;
    }
    names.push(
      decoder.decode(directory.subarray(nameStart, nameStart + nameLength)),
    );
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return { ok: true, names };
}

function classifyOoxml(names: readonly string[]): ContentDetection {
  const lower = names.map((name) => name.toLowerCase());
  // A package that traverses is malformed by definition; we never extract
  // it, but a name like "../../x" is a refusal, not a curiosity.
  if (
    lower.some(
      (name) =>
        name.startsWith("/") ||
        name.split("/").includes("..") ||
        name.includes("\\"),
    )
  ) {
    return { ok: false, failureCode: "ARCHIVE_NOT_ALLOWED" };
  }
  if (lower.some((name) => name.endsWith("vbaproject.bin"))) {
    return { ok: false, failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED" };
  }
  if (!lower.includes("[content_types].xml")) {
    // A plain archive wearing an Office extension.
    return { ok: false, failureCode: "ARCHIVE_NOT_ALLOWED" };
  }
  const word = lower.some((name) => name.startsWith("word/"));
  const presentation = lower.some((name) => name.startsWith("ppt/"));
  const spreadsheet = lower.some((name) => name.startsWith("xl/"));
  const families = [word, presentation, spreadsheet].filter(Boolean).length;
  if (families !== 1) {
    return { ok: false, failureCode: "OOXML_TYPE_MISMATCH" };
  }
  if (word) return { ok: true, kind: "ooxml_word" };
  if (presentation) return { ok: true, kind: "ooxml_presentation" };
  return { ok: true, kind: "ooxml_spreadsheet" };
}

/**
 * Openings a file claiming to be text must not have. Markup and scripts are
 * separately inadmissible formats, and the printable binary headers below
 * are how a polyglot hides: a file whose first bytes announce one format
 * and whose later bytes announce another has no single identity, so it has
 * none we will accept.
 */
const MASQUERADE_PREFIXES = [
  "<!doctype",
  "<html",
  "<svg",
  "<?xml",
  "<script",
  "<%",
  "#!",
  "<!entity",
  "gif87a",
  "gif89a",
  "%!ps",
  "riff",
  "oggs",
  "id3",
];

function classifyText(head: Uint8Array): ContentDetection {
  for (const byte of head) {
    if (byte === 0x00) {
      return { ok: false, failureCode: "CONTENT_UNRECOGNISED" };
    }
    const control =
      byte < 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0d &&
      byte !== 0x0c;
    if (control) {
      return { ok: false, failureCode: "CONTENT_UNRECOGNISED" };
    }
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const decoded = decoder.decode(head.subarray(0, 512));
  // Strip a UTF-8 byte order mark before judging the opening bytes.
  const bom = decoded.charCodeAt(0) === 0xfeff;
  const sample = (bom ? decoded.slice(1) : decoded).trimStart().toLowerCase();
  if (MASQUERADE_PREFIXES.some((prefix) => sample.startsWith(prefix))) {
    return { ok: false, failureCode: "SIGNATURE_MISMATCH" };
  }
  return { ok: true, kind: "text" };
}

/**
 * Identify staged bytes, or refuse them. Ambiguity is always a refusal:
 * where identity cannot be established the answer is no, never the most
 * convenient guess (doc 16 TM-FILE-02).
 */
export async function detectDocumentContent(input: {
  readonly sizeBytes: number;
  readonly read: ByteRangeReader;
}): Promise<ContentDetection> {
  if (input.sizeBytes <= 0) {
    return { ok: false, failureCode: "FILE_EMPTY" };
  }
  const head = await input.read(0, Math.min(input.sizeBytes, HEAD_BYTES));

  // Spec-compliant PDFs begin at byte zero. Tolerating leading junk is
  // exactly the polyglot vector, so we do not.
  if (startsWith(head, MAGIC.pdf)) return { ok: true, kind: "pdf" };
  if (startsWith(head, MAGIC.png)) return { ok: true, kind: "png" };
  if (startsWith(head, MAGIC.jpeg)) return { ok: true, kind: "jpeg" };

  if (startsWith(head, MAGIC.elf) || startsWith(head, MAGIC.mz)) {
    return { ok: false, failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED" };
  }
  if (startsWith(head, MAGIC.classFile)) {
    return { ok: false, failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED" };
  }
  if (
    startsWith(head, MAGIC.rar) ||
    startsWith(head, MAGIC.sevenZip) ||
    startsWith(head, MAGIC.gzip)
  ) {
    return { ok: false, failureCode: "ARCHIVE_NOT_ALLOWED" };
  }
  if (startsWith(head, MAGIC.compoundFile)) {
    // Legacy .doc/.xls/.ppt: macro-capable, never admitted.
    return { ok: false, failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED" };
  }

  if (
    startsWith(head, MAGIC.zip) ||
    startsWith(head, MAGIC.zipEmpty) ||
    startsWith(head, MAGIC.zipSpanned)
  ) {
    const entries = await readZipEntryNames(input);
    if (!entries.ok) return entries;
    return classifyOoxml(entries.names);
  }

  return classifyText(
    head.subarray(0, Math.min(head.length, TEXT_SAMPLE_BYTES)),
  );
}
