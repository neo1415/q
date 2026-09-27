import { describe, expect, it } from "vitest";

import {
  DOCUMENT_TYPES as WIRE_DOCUMENT_TYPES,
  DOCUMENT_UPLOAD_FAILURE_CODES,
} from "@capital-q/contracts";

import {
  ADMISSIBLE_MIME_TYPES,
  checkClaimedType,
  createDocumentStorageKey,
  detectDocumentContent,
  DOCUMENT_MIME_ALLOWLIST,
  DOCUMENT_TYPES,
  DOCUMENT_UPLOAD_DEFAULT_MAX_BYTES,
  DOCUMENT_MAX_SIZE_BYTES,
  extensionOf,
  REFUSED_EXTENSIONS,
  sanitiseOriginalFilename,
  StorageKeySchema,
  type DetectedContentKind,
} from "../src/index.js";
import { FIXTURES, readerFor } from "./upload-fixtures.js";

/**
 * The upload boundary decides what may become a document version. These are
 * the cases it must keep refusing: a renamed executable, an archive wearing
 * an Office name, a macro-enabled package, markup pretending to be text, a
 * polyglot whose signature starts late.
 *
 * A file being admissible here means its container is what it claims to be.
 * It never means the file is safe, scanned, parseable or true.
 */

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function detect(content: Uint8Array) {
  return detectDocumentContent({
    sizeBytes: content.byteLength,
    read: readerFor(content),
  });
}

async function expectKind(
  content: Uint8Array,
  kind: DetectedContentKind,
): Promise<void> {
  const result = await detect(content);
  expect(result).toEqual({ ok: true, kind });
}

async function expectRefused(
  content: Uint8Array,
  failureCode: string,
): Promise<void> {
  const result = await detect(content);
  expect(result).toEqual({ ok: false, failureCode });
}

describe("content detection", () => {
  it("recognises the business formats V1 accepts", async () => {
    await expectKind(FIXTURES.pdf, "pdf");
    await expectKind(FIXTURES.docx, "ooxml_word");
    await expectKind(FIXTURES.pptx, "ooxml_presentation");
    await expectKind(FIXTURES.xlsx, "ooxml_spreadsheet");
    await expectKind(FIXTURES.text, "text");
    await expectKind(FIXTURES.textWithBom, "text");
    await expectKind(FIXTURES.png, "png");
    await expectKind(FIXTURES.jpeg, "jpeg");
  });

  it("refuses executables, archives, legacy Office and macro packages", async () => {
    await expectRefused(
      FIXTURES.windowsExecutable,
      "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
    );
    await expectRefused(
      FIXTURES.elfExecutable,
      "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
    );
    await expectRefused(FIXTURES.legacyDoc, "ACTIVE_CONTENT_TYPE_NOT_ALLOWED");
    await expectRefused(
      FIXTURES.docmWithMacro,
      "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
    );
    await expectRefused(FIXTURES.rar, "ARCHIVE_NOT_ALLOWED");
    await expectRefused(FIXTURES.gzip, "ARCHIVE_NOT_ALLOWED");
    // A real ZIP with no Office package inside it.
    await expectRefused(FIXTURES.plainZip, "ARCHIVE_NOT_ALLOWED");
    await expectRefused(FIXTURES.traversalZip, "ARCHIVE_NOT_ALLOWED");
  });

  it("refuses an OOXML package that claims two Office families", async () => {
    await expectRefused(FIXTURES.ambiguousOoxml, "OOXML_TYPE_MISMATCH");
  });

  it("refuses markup, scripts and binary noise wearing a text name", async () => {
    await expectRefused(FIXTURES.html, "SIGNATURE_MISMATCH");
    await expectRefused(FIXTURES.svg, "SIGNATURE_MISMATCH");
    await expectRefused(FIXTURES.javascript, "SIGNATURE_MISMATCH");
    await expectRefused(FIXTURES.binaryNoise, "CONTENT_UNRECOGNISED");
  });

  it("refuses a polyglot whose PDF signature does not start at byte zero", async () => {
    // Readers that tolerate leading junk are exactly how one file becomes
    // two things at once. The blob announces GIF and then PDF, so it is
    // never detected as a PDF...
    const detected = await detect(FIXTURES.pdfWithLeadingJunk);
    expect(detected).not.toMatchObject({ ok: true, kind: "pdf" });
    // ...and it is refused outright rather than admitted as something else.
    await expectRefused(FIXTURES.pdfWithLeadingJunk, "SIGNATURE_MISMATCH");
    // Claiming to be a PDF cannot rescue it either.
    expect(
      checkClaimedType({
        filename: "deck.pdf",
        declaredMimeType: PDF,
        detected: "text",
      }),
    ).toEqual({ ok: false, failureCode: "SIGNATURE_MISMATCH" });
  });

  it("refuses an empty object", async () => {
    await expectRefused(FIXTURES.empty, "FILE_EMPTY");
  });

  it("admits a structurally valid document whose words try to give instructions", async () => {
    // Prompt injection is a processing and Q concern. The bytes are a PDF;
    // the sentences inside carry no authority and are not read here.
    await expectKind(FIXTURES.promptInjectionPdf, "pdf");
  });
});

describe("voice notes (R34)", () => {
  const webm = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81,
  ]);
  const m4a = new Uint8Array([
    0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0,
  ]);

  it("recognises the two audio containers browsers record into", async () => {
    await expectKind(webm, "webm_audio");
    await expectKind(m4a, "mp4_audio");
  });

  it("admits audio only when name, declared type and bytes agree", () => {
    expect(
      checkClaimedType({
        filename: "voice-note.webm",
        declaredMimeType: "audio/webm",
        detected: "webm_audio",
      }),
    ).toMatchObject({ ok: true });
    expect(
      checkClaimedType({
        filename: "voice-note.m4a",
        declaredMimeType: "audio/mp4",
        detected: "mp4_audio",
      }),
    ).toMatchObject({ ok: true });
    // Audio bytes wearing a document's name, and a document wearing audio's.
    expect(
      checkClaimedType({
        filename: "deck.pdf",
        declaredMimeType: PDF,
        detected: "webm_audio",
      }),
    ).toMatchObject({ ok: false });
    expect(
      checkClaimedType({
        filename: "voice-note.webm",
        declaredMimeType: "audio/webm",
        detected: "pdf",
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("claimed type agreement", () => {
  it("accepts a file whose extension, declared type and content all agree", () => {
    expect(
      checkClaimedType({
        filename: "deck.pdf",
        declaredMimeType: PDF,
        detected: "pdf",
      }),
    ).toMatchObject({ ok: true });
    expect(
      checkClaimedType({
        filename: "model.xlsx",
        declaredMimeType: XLSX,
        detected: "ooxml_spreadsheet",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses an executable renamed as a document", () => {
    // The name and the declared type agree with each other and lie together.
    expect(
      checkClaimedType({
        filename: "invoice.pdf",
        declaredMimeType: PDF,
        detected: "text",
      }),
    ).toEqual({ ok: false, failureCode: "SIGNATURE_MISMATCH" });
  });

  it("refuses one Office family wearing another's extension", () => {
    expect(
      checkClaimedType({
        filename: "accounts.docx",
        declaredMimeType: DOCX,
        detected: "ooxml_spreadsheet",
      }),
    ).toEqual({ ok: false, failureCode: "OOXML_TYPE_MISMATCH" });
  });

  it("refuses an extension the declared type does not own", () => {
    expect(
      checkClaimedType({ filename: "deck.pptx", declaredMimeType: PDF }),
    ).toEqual({ ok: false, failureCode: "EXTENSION_NOT_ALLOWED" });
  });

  it("refuses every named executable, script, archive, legacy and macro extension", () => {
    for (const extension of REFUSED_EXTENSIONS) {
      expect(
        checkClaimedType({
          filename: `payload${extension}`,
          declaredMimeType: PDF,
        }),
      ).toEqual({ ok: false, failureCode: "EXTENSION_NOT_ALLOWED" });
    }
  });

  it("refuses a MIME type outside the allowlist and a file with no extension", () => {
    expect(
      checkClaimedType({
        filename: "archive.zip",
        declaredMimeType: "application/zip",
      }),
    ).toEqual({ ok: false, failureCode: "EXTENSION_NOT_ALLOWED" });
    expect(
      checkClaimedType({
        filename: "notes",
        declaredMimeType: "text/plain",
      }),
    ).toEqual({ ok: false, failureCode: "EXTENSION_NOT_ALLOWED" });
    expect(
      checkClaimedType({
        filename: "page.pdf",
        declaredMimeType: "text/html",
      }),
    ).toEqual({ ok: false, failureCode: "MIME_NOT_ALLOWED" });
  });

  it("treats PPTX and DOCX as distinct despite sharing a container", () => {
    expect(
      checkClaimedType({
        filename: "deck.pptx",
        declaredMimeType: PPTX,
        detected: "ooxml_presentation",
      }),
    ).toMatchObject({ ok: true });
    expect(
      checkClaimedType({
        filename: "deck.pptx",
        declaredMimeType: PPTX,
        detected: "ooxml_word",
      }),
    ).toEqual({ ok: false, failureCode: "OOXML_TYPE_MISMATCH" });
  });
});

describe("filename handling", () => {
  it("keeps the name for display and strips the client's directories", () => {
    expect(sanitiseOriginalFilename("C:\\Users\\dana\\deck.pdf")).toEqual({
      ok: true,
      filename: "deck.pdf",
    });
    expect(sanitiseOriginalFilename("reports/2026/model.xlsx")).toEqual({
      ok: true,
      filename: "model.xlsx",
    });
    expect(sanitiseOriginalFilename("../../../etc/passwd")).toEqual({
      ok: true,
      filename: "passwd",
    });
  });

  it("refuses control characters, header injection and empty names", () => {
    for (const name of [
      "deck\u0000.pdf",
      "deck\r\nContent-Type: text/html.pdf",
      "deck\n.pdf",
      "   ",
      "..",
      ".",
      `${"a".repeat(300)}.pdf`,
    ]) {
      expect(sanitiseOriginalFilename(name)).toEqual({
        ok: false,
        failureCode: "FILENAME_NOT_ALLOWED",
      });
    }
  });

  it("reads the extension case-insensitively", () => {
    expect(extensionOf("Deck.PDF")).toBe(".pdf");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("noextension")).toBe("");
  });
});

describe("object identity", () => {
  it("is random, tenant-scoped and never derived from the file", () => {
    const tenantId = "3f1d0d94-6d8f-4a3f-8b0e-9f7b4d2a1c55";
    const first = createDocumentStorageKey(tenantId as never);
    const second = createDocumentStorageKey(tenantId as never);

    expect(first).not.toBe(second);
    expect(first.startsWith(`raw/${tenantId}/`)).toBe(true);
    expect(() => StorageKeySchema.parse(first)).not.toThrow();
    // 128 bits of randomness: collisions are not a case to handle.
    expect(first.split("/")[2]).toMatch(/^[0-9a-f]{32}$/);
    // The name a person chose never appears in the identity.
    expect(first).not.toContain("deck");
  });
});

describe("boundary vocabulary", () => {
  it("admits exactly the formats the version registry can store", () => {
    expect([...ADMISSIBLE_MIME_TYPES].sort()).toEqual(
      [...DOCUMENT_MIME_ALLOWLIST].sort(),
    );
  });

  it("keeps the wire vocabularies identical to the domain's", () => {
    expect([...WIRE_DOCUMENT_TYPES]).toEqual([...DOCUMENT_TYPES]);
    expect([...DOCUMENT_UPLOAD_FAILURE_CODES].length).toBeGreaterThan(0);
  });

  it("keeps the upload limit inside the ceiling a version may carry", () => {
    expect(DOCUMENT_UPLOAD_DEFAULT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(DOCUMENT_UPLOAD_DEFAULT_MAX_BYTES).toBeLessThanOrEqual(
      DOCUMENT_MAX_SIZE_BYTES,
    );
  });
});

describe("staging bounds", () => {
  it("reads only the ranges it is asked for", async () => {
    const reads: number[] = [];
    const content = FIXTURES.docx;
    const result = await detectDocumentContent({
      sizeBytes: content.byteLength,
      read: (offset, length) => {
        reads.push(length);
        return Promise.resolve(content.subarray(offset, offset + length));
      },
    });
    expect(result).toMatchObject({ ok: true });
    // Head, then the tail, then the central directory: never the whole file
    // and never an inflated entry.
    expect(reads.every((length) => length <= 8192 + 65557)).toBe(true);
  });

  it("refuses a truncated archive rather than guessing", async () => {
    const truncated = FIXTURES.docx.subarray(0, 40);
    await expectRefused(truncated, "CONTENT_UNRECOGNISED");
  });

  it("refuses a file whose central directory claims to sit past the end", async () => {
    const corrupted = new Uint8Array(FIXTURES.docx);
    // Point the central-directory offset far beyond the object.
    corrupted.set([0xff, 0xff, 0xff, 0x7f], corrupted.length - 22 + 16);
    await expectRefused(corrupted, "CONTENT_UNRECOGNISED");
  });
});
