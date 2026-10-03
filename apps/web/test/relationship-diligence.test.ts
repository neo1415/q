import { describe, expect, it, vi } from "vitest";

import type { DiligenceDto } from "@capital-q/contracts";

// The diligence actions are server actions; only the pure wording is tested.
vi.mock("@/features/relationships/diligence-actions", () => ({}));
vi.mock("@/features/documents/not-scanned-note", () => ({
  NotScannedNote: () => null,
}));

const { requestStatusWords } =
  await import("@/features/relationships/relationship-diligence");

const DOC = "7f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

const request = (
  status: "OPEN" | "FULFILLED",
  fulfilledBy: { documentId: string; title: string | null } | null,
): DiligenceDto["requests"][number] => ({
  requestId: "8f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  title: "Cap table",
  note: null,
  requestedAt: "2026-10-03T07:00:00.000Z",
  status,
  fulfilledBy,
});

describe("diligence request wording", () => {
  it("says answered only while the answering document is still shared", () => {
    const answered = request("FULFILLED", {
      documentId: DOC,
      title: "Seed deck",
    });
    expect(requestStatusWords(answered, new Set([DOC]))).toEqual({
      words: "answered with Seed deck",
      answerable: false,
    });
  });

  it("says both facts when the answer was later taken back, and lets it be answered again", () => {
    const answered = request("FULFILLED", {
      documentId: DOC,
      title: "Seed deck",
    });
    expect(requestStatusWords(answered, new Set())).toEqual({
      words: "answered with Seed deck, which is no longer shared",
      answerable: true,
    });
  });

  it("keeps an open request open", () => {
    expect(requestStatusWords(request("OPEN", null), new Set())).toEqual({
      words: "open",
      answerable: true,
    });
  });
});
