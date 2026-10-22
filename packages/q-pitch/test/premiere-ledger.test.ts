import { describe, expect, it } from "vitest";

import {
  CertificationLedgerSchema,
  PREMIERE_CERTIFICATION_LEDGER,
  STORY_LEDGER,
} from "../src/index.js";

/**
 * The v5 premiere's tours are retired (v7 story, 21 Oct); its receipts stay
 * as ledger data that the story's product claims rest on.
 */
describe("premiere certification ledger (data only)", () => {
  it("parses, one entry per feature", () => {
    expect(
      CertificationLedgerSchema.safeParse(PREMIERE_CERTIFICATION_LEDGER)
        .success,
    ).toBe(true);
  });

  it("still carries the entries the story's claims use", () => {
    const features = new Set(
      PREMIERE_CERTIFICATION_LEDGER.map((e) => e.featureId),
    );
    for (const id of [
      "INV-MANDATE-VIEW",
      "GATEQ-INBOX-VIEW",
      "GATEQ-DOSSIER-VIEW",
      "QP-HOME-HANDOFF",
    ]) {
      expect(features.has(id)).toBe(true);
    }
    expect(STORY_LEDGER.length).toBeGreaterThan(0);
  });
});
