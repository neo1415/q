import { describe, expect, it, vi } from "vitest";

import type {
  GateQReadyApplicationDocument,
  GateQSharedSubmittedDocument,
} from "@capital-q/evidence";

import { createSubmittedDocumentText } from "../src/composition/gateq-submitted-documents.js";

/**
 * Live D4b (2026-11-14, application bf389feb): Q told the investor twice
 * that no documents were attached while the founder had sent a deck (9
 * pages) and a product brief (1 page) from their library. Q's application
 * read now lists and reads the founder's sent library documents beside any
 * application-owned uploads.
 */

const ref = {
  tenantId: "a27357f9-0000-4000-8000-000000000001",
  applicationId: "bf389feb-962e-410b-9804-71295185926b",
};

const ready = (
  title: string,
  pageCount: number,
  extra: Partial<GateQReadyApplicationDocument> = {},
): GateQReadyApplicationDocument => ({
  documentId: `${title}-id`,
  versionId: `${title}-v`,
  title,
  fileName: `${title}.pdf`,
  contentType: "application/pdf",
  sha256: "a".repeat(64),
  byteSize: 100,
  pageCount,
  malwareStatus: "NOT_SCANNED",
  instructionRisk: false,
  excerpts: [{ page: 1, text: `${title} page one` }],
  truncated: false,
  ...extra,
});

function port(shared: readonly GateQSharedSubmittedDocument[]) {
  return {
    frozenDocuments: vi.fn(() => Promise.resolve([])),
    readFrozenDocument: vi.fn(() => Promise.resolve(null)),
    sharedSubmittedDocuments: vi.fn(() => Promise.resolve(shared)),
  };
}

describe("Q's read of a submitted application's documents (live D4b)", () => {
  it("lists and reads the deck and the brief the founder sent", async () => {
    const evidence = port([
      {
        documentId: "deck",
        title: "Branchari investor deck (fictional)",
        reading: ready("Branchari investor deck (fictional)", 9),
      },
      {
        documentId: "brief",
        title: "Branchari product brief (fictional)",
        reading: ready("Branchari product brief (fictional)", 1),
      },
    ]);
    const read = await createSubmittedDocumentText(evidence).read(ref);
    expect(read.map((d) => [d.title, d.pageCount, d.notRead])).toEqual([
      ["Branchari investor deck (fictional)", 9, null],
      ["Branchari product brief (fictional)", 1, null],
    ]);
    expect(read[0]?.excerpts?.[0]?.text).toContain("page one");
    expect(evidence.sharedSubmittedDocuments).toHaveBeenCalledWith(
      expect.objectContaining(ref),
    );
  });

  it("says why a sent document was not read, and withholds flagged text", async () => {
    const read = await createSubmittedDocumentText(
      port([
        { documentId: "deck", title: "Deck", reading: null },
        {
          documentId: "brief",
          title: "Brief",
          reading: ready("Brief", 1, { instructionRisk: true }),
        },
      ]),
    ).read(ref);
    expect(read.map((d) => [d.title, d.excerpts, d.notRead])).toEqual([
      ["Deck", null, "its text is not available"],
      ["Brief", null, "its text was withheld by the safety check"],
    ]);
  });

  it("nothing sent is nothing read", async () => {
    expect(await createSubmittedDocumentText(port([])).read(ref)).toEqual([]);
  });
});
