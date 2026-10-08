import { describe, expect, it, vi } from "vitest";

import type { DiligenceDto } from "@capital-q/contracts";

// The diligence actions are server actions; only the pure wording is tested.
vi.mock("@/features/relationships/diligence-actions", () => ({}));
vi.mock("@/features/documents/not-scanned-note", () => ({
  NotScannedNote: () => null,
}));

vi.mock("@/features/onboarding-kit/material-actions", () => ({}));

const { requestStatus } =
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
  requestedByName: "Amara Diallo-Benson",
  status,
  declineNote: null,
  fulfilledBy,
});

const share = (viewedAt: string | null): DiligenceDto["shares"][number] => ({
  policyId: "9f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  documentId: DOC,
  title: "Cap table Sep 2026",
  documentType: "FINANCIAL",
  sharedAt: "2026-10-03T08:00:00.000Z",
  scanned: true,
  viewedAt,
  qSummary: null,
});

/** 2026-10-04: Requested → Shared → Viewed, said from the request itself. */
describe("diligence request status", () => {
  it("is Requested until answered", () => {
    expect(requestStatus(request("OPEN", null), [])).toMatchObject({
      words: "Requested",
      answerable: true,
    });
  });

  it("is Shared once answered, Viewed once their side opened it", () => {
    const answered = request("FULFILLED", { documentId: DOC, title: "Cap" });
    expect(requestStatus(answered, [share(null)])).toMatchObject({
      words: "Shared",
      answerable: false,
    });
    expect(
      requestStatus(answered, [share("2026-10-03T09:00:00.000Z")]),
    ).toMatchObject({ words: "Viewed" });
  });

  it("asks for a new file when the answer was taken back", () => {
    expect(
      requestStatus(request("FULFILLED", { documentId: DOC, title: null }), []),
    ).toMatchObject({
      words: "Needs a new file",
      answerable: true,
      share: null,
    });
  });
});
