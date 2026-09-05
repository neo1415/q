import type { DocumentUploadFailureCode } from "../contracts/upload.js";

/**
 * What Capital Q admits at the upload boundary, and how a claimed identity
 * is checked (doc 15 §26–29, doc 16 TM-FILE-01…04).
 *
 * Three independent signals must agree before bytes may become a
 * DocumentVersion: the filename extension, the MIME the browser declared,
 * and the content actually detected in the stored bytes. Any disagreement
 * is a rejection — never a "pick the most convenient one".
 *
 *   extension ≠ proof     declared MIME ≠ proof     transferred ≠ admissible
 *
 * Admitting a format here says only that its container is what it claims to
 * be. It says nothing about macros the parser has yet to see, about
 * decompression ratios, or about the meaning of the words inside.
 */

/** What the stored bytes were recognised as. Not a MIME type. */
export const DETECTED_CONTENT_KINDS = [
  "pdf",
  "ooxml_word",
  "ooxml_presentation",
  "ooxml_spreadsheet",
  "text",
  "png",
  "jpeg",
] as const;
export type DetectedContentKind = (typeof DETECTED_CONTENT_KINDS)[number];

export type AdmissibleDocumentType = {
  /** Canonical MIME stored on the version. Never the browser's word for it. */
  readonly mimeType: string;
  readonly extensions: readonly string[];
  /** Detections that may carry this MIME type. */
  readonly kinds: readonly DetectedContentKind[];
};

const WORD =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PRESENTATION =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SPREADSHEET =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The V1 business-document set. It is deliberately the same list the
 * Evidence version registry already admits, so nothing can be uploaded that
 * could not be stored, and nothing can be stored that was not uploaded
 * through this boundary.
 */
export const ADMISSIBLE_DOCUMENT_TYPES: readonly AdmissibleDocumentType[] = [
  { mimeType: "application/pdf", extensions: [".pdf"], kinds: ["pdf"] },
  { mimeType: WORD, extensions: [".docx"], kinds: ["ooxml_word"] },
  {
    mimeType: PRESENTATION,
    extensions: [".pptx"],
    kinds: ["ooxml_presentation"],
  },
  {
    mimeType: SPREADSHEET,
    extensions: [".xlsx"],
    kinds: ["ooxml_spreadsheet"],
  },
  { mimeType: "text/csv", extensions: [".csv"], kinds: ["text"] },
  { mimeType: "text/plain", extensions: [".txt"], kinds: ["text"] },
  { mimeType: "image/png", extensions: [".png"], kinds: ["png"] },
  { mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"], kinds: ["jpeg"] },
];

export const ADMISSIBLE_MIME_TYPES: readonly string[] =
  ADMISSIBLE_DOCUMENT_TYPES.map((type) => type.mimeType);

export const ADMISSIBLE_EXTENSIONS: readonly string[] =
  ADMISSIBLE_DOCUMENT_TYPES.flatMap((type) => [...type.extensions]);

/**
 * Named refusals. Everything outside the allowlist is refused anyway; this
 * list exists so the intent is legible and so the tests that must keep
 * failing have something to point at. Executables, scripts, active content,
 * general archives and the legacy/macro Office formats never enter.
 */
export const REFUSED_EXTENSIONS: readonly string[] = [
  ".exe",
  ".dll",
  ".js",
  ".mjs",
  ".html",
  ".htm",
  ".svg",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".tgz",
  ".doc",
  ".xls",
  ".ppt",
  ".docm",
  ".xlsm",
  ".pptm",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".jar",
  ".sh",
];

/** 25 MiB. An adjustable implementation limit, not a locked product decision. */
export const DOCUMENT_UPLOAD_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** The private bucket. Server-owned; never public, never listable. */
export const DOCUMENT_STORAGE_BUCKET = "cq-documents-private";

/** How long an authorised session stays finalizable. */
export const DOCUMENT_UPLOAD_SESSION_TTL_SECONDS = 30 * 60;

/**
 * How many upload authorizations one organisation may hold open at once.
 * A bound on outstanding scoped writes to private storage, not a rate
 * limiter: the repository has no rate-limit infrastructure, and inventing
 * one here would be the wrong home for it.
 */
export const DOCUMENT_UPLOAD_MAX_OPEN_SESSIONS = 25;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? "" : filename.slice(dot).toLowerCase();
}

export function admissibleByMimeType(
  mimeType: string,
): AdmissibleDocumentType | undefined {
  const normalised = mimeType.trim().toLowerCase();
  return ADMISSIBLE_DOCUMENT_TYPES.find((type) => type.mimeType === normalised);
}

/**
 * The filename as display metadata only: the client's directories are
 * stripped, control characters and separators are refused, and the result
 * is never used as, or derived into, an object identity.
 */
export function sanitiseOriginalFilename(raw: string):
  | { readonly ok: true; readonly filename: string }
  | {
      readonly ok: false;
      readonly failureCode: DocumentUploadFailureCode;
    } {
  const refused = { ok: false, failureCode: "FILENAME_NOT_ALLOWED" } as const;
  if (raw.length > 1024) return refused;
  // Control characters are refused across the whole input, before anything
  // is trimmed away: a name carrying CR/LF is rejected outright rather than
  // quietly becoming a clean-looking basename.
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    // C0 and C1 control characters and DEL; CR/LF header injection included.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return refused;
  }
  // A browser may send "C:\\Users\\x\\deck.pdf" or "folder/deck.pdf".
  const filename = (raw.split(/[\\/]/).pop() ?? "").trim();
  if (filename.length === 0 || filename.length > 255) return refused;
  if (filename === "." || filename === "..") return refused;
  return { ok: true, filename };
}

/**
 * Do the three claimed identities agree? Called once before an upload is
 * authorised (extension + declared MIME) and again after the bytes land
 * (extension + declared MIME + detected content).
 */
export function checkClaimedType(input: {
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly detected?: DetectedContentKind | undefined;
}):
  | { readonly ok: true; readonly type: AdmissibleDocumentType }
  | { readonly ok: false; readonly failureCode: DocumentUploadFailureCode } {
  const extension = extensionOf(input.filename);
  if (extension.length === 0 || REFUSED_EXTENSIONS.includes(extension)) {
    return { ok: false, failureCode: "EXTENSION_NOT_ALLOWED" };
  }
  const type = admissibleByMimeType(input.declaredMimeType);
  if (type === undefined) {
    return { ok: false, failureCode: "MIME_NOT_ALLOWED" };
  }
  if (!type.extensions.includes(extension)) {
    return { ok: false, failureCode: "EXTENSION_NOT_ALLOWED" };
  }
  if (input.detected !== undefined && !type.kinds.includes(input.detected)) {
    // An OOXML package that is a different Office family is worth its own
    // code; anything else is a plain signature disagreement.
    const ooxml =
      input.detected.startsWith("ooxml_") &&
      type.kinds.some((kind) => kind.startsWith("ooxml_"));
    return {
      ok: false,
      failureCode: ooxml ? "OOXML_TYPE_MISMATCH" : "SIGNATURE_MISMATCH",
    };
  }
  return { ok: true, type };
}
