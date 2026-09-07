import { describe, expect, it } from "vitest";

import { toDocumentVersionDto } from "../src/contracts/dto.js";
import {
  PROCESSING_RUN_STATUSES,
  TEXT_EXTRACTION_STATUSES,
  type DocumentVersion,
} from "../src/contracts/index.js";

/**
 * What a person sees when processing fails (CQ-RAG-001 §64).
 *
 * A failure is reported as a state a person can act on — still processing,
 * could not be read, not supported — and never as the engineering reason.
 * Parser refusal codes, ZIP ratios, Postgres errors, storage keys and stack
 * traces stay on the internal side of this projection, where operators can
 * still count them.
 */

const INTERNAL_CODES = [
  "ARCHIVE_EXPANSION_LIMIT",
  "ARCHIVE_UNSAFE_ENTRY",
  "MALFORMED_PACKAGE",
  "MALWARE_SCAN_UNAVAILABLE",
  "PARSER_FAILED",
  "PARSER_TIMEOUT",
  "XML_NODE_LIMIT",
  "CHUNKING_FAILED",
  "OBJECT_MISMATCH",
];

function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    documentId: "33333333-3333-4333-8333-333333333333",
    versionNumber: 1,
    storageBucket: "cq-documents-private",
    storageKey: "raw/tenant/0000000000000000000000000000000a",
    originalFilename: "model.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 2048,
    sha256: "a".repeat(64),
    uploadedByUserId: "44444444-4444-4444-8444-444444444444",
    uploadedAt: "2026-09-06T00:00:00.000Z",
    supersedesVersionId: null,
    processingStatus: "FAILED",
    malwareScanStatus: "PENDING",
    textExtractionStatus: "FAILED",
    ...overrides,
  } as DocumentVersion;
}

describe("public processing state", () => {
  it("reports a failure as a state, never as an engineering reason", () => {
    const dto = toDocumentVersionDto(version());
    const text = JSON.stringify(dto);
    for (const code of INTERNAL_CODES) {
      expect(text).not.toContain(code);
    }
    expect(text).not.toContain("cq-documents-private");
    expect(text).not.toContain("raw/tenant");
    expect(dto).toMatchObject({
      processingStatus: "FAILED",
      textExtractionStatus: "FAILED",
    });
    // No free-text failure field exists to leak one later.
    expect(Object.keys(dto)).not.toContain("errorCode");
    expect(Object.keys(dto)).not.toContain("failure");
  });

  it("distinguishes not-yet-processed, unreadable and unsupported without explaining why", () => {
    expect(
      toDocumentVersionDto(
        version({
          processingStatus: "PROCESSING",
          textExtractionStatus: "PROCESSING",
        }),
      ).textExtractionStatus,
    ).toBe("PROCESSING");
    expect(
      toDocumentVersionDto(version({ textExtractionStatus: "UNSUPPORTED" }))
        .textExtractionStatus,
    ).toBe("UNSUPPORTED");
    // Every reported value comes from the closed vocabulary.
    for (const status of TEXT_EXTRACTION_STATUSES) {
      expect(
        toDocumentVersionDto(version({ textExtractionStatus: status }))
          .textExtractionStatus,
      ).toBe(status);
    }
    // A run status is internal; it never appears on the version projection.
    const dto = toDocumentVersionDto(version());
    for (const status of PROCESSING_RUN_STATUSES) {
      if (status === "BLOCKED" || status === "RUNNING" || status === "QUEUED") {
        expect(JSON.stringify(dto)).not.toContain(status);
      }
    }
  });

  it("never carries the scanner's verdict as a reassurance", () => {
    // An unscanned file says PENDING. Nothing may report CLEAN on its behalf.
    expect(toDocumentVersionDto(version()).malwareScanStatus).toBe("PENDING");
  });
});
