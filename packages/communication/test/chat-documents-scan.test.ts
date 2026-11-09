import { describe, expect, it } from "vitest";

import { createChatDocuments } from "../src/compose.js";

// DECISIONS 83 (owner, 9 Nov 2026): uploads are not held for a virus scan.
// Production runs no scanner, so every version is NOT_SCANNED; a CLEAN-only
// gate made every chat attachment unsendable. BLOCKED and ERROR stay refused.
const actor = { tenantId: "00000000-0000-4000-8000-000000000001" } as never;
const documentWith = (malwareScanStatus: string) =>
  createChatDocuments(() =>
    Promise.resolve({
      versionId: "v1",
      title: "Deck",
      mimeType: "application/pdf",
      sizeBytes: 10,
      malwareScanStatus,
    }),
  );

describe("chat attachments and the scan state (D83)", () => {
  it.each(["CLEAN", "NOT_SCANNED", "PENDING"])("%s is shareable", async (s) => {
    const result = await documentWith(s)(actor, "d1");
    expect(result.outcome).toBe("READY");
  });

  it.each(["BLOCKED", "ERROR"])("%s is never shared", async (s) => {
    const result = await documentWith(s)(actor, "d1");
    expect(result.outcome).toBe("NOT_READY");
  });
});
