import { describe, expect, it } from "vitest";

import { heldBackDocumentsFact } from "../src/q/own-readiness.js";

/**
 * Live 2026-10-29 (S02-F): the prepared answer from their own record kept
 * the readiness data only, so the held-back report was never mentioned.
 */
describe("documents held back from Q, from their record read", () => {
  it("names each one with the compliant path, never contents", () => {
    const fact = heldBackDocumentsFact({
      status: "FOUND",
      data: { companyId: "c1" },
      heldBackDocuments: [
        {
          title: "Management accounts Sept 2026",
          qUse: "Held back from Q by its classification. 2 key figures wait for your confirmation on your setup screen.",
        },
      ],
    });
    expect(fact?.statement).toContain("Management accounts Sept 2026");
    expect(fact?.statement).toContain("wait for your confirmation");
    expect(fact?.truthClass).toBe("VERIFIED");
  });

  it("nothing when none is held back or the read is not a record", () => {
    expect(heldBackDocumentsFact({ status: "FOUND", data: {} })).toBeNull();
    expect(
      heldBackDocumentsFact({ status: "FOUND", heldBackDocuments: [] }),
    ).toBeNull();
    expect(heldBackDocumentsFact(null)).toBeNull();
    expect(
      heldBackDocumentsFact({ heldBackDocuments: [{ title: 3, qUse: null }] }),
    ).toBeNull();
  });
});
