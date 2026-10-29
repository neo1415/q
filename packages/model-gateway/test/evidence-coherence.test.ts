import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { coherentEvidence, findingBlockOf } from "../src/q/result-blocks.js";

/**
 * ADR-001's truth and evidence axes kept coherent (live 2026-10-29, run B:
 * a RISK labelled Q_INFERENCE came back PLATFORM_VERIFIED).
 */
describe("a finding's evidence fits its truth class", () => {
  it("an inference, estimate or unknown is never verified evidence", () => {
    for (const truth of ["Q_INFERENCE", "ESTIMATE", "UNKNOWN"] as const) {
      for (const verified of [
        "PLATFORM_VERIFIED",
        "EXTERNALLY_VERIFIED",
      ] as const) {
        expect(coherentEvidence(truth, verified)).toBe("DOCUMENT_SUPPORTED");
      }
      expect(coherentEvidence(truth, "MULTI_SOURCE_SUPPORTED")).toBe(
        "MULTI_SOURCE_SUPPORTED",
      );
    }
    expect(coherentEvidence("VERIFIED", "PLATFORM_VERIFIED")).toBe(
      "PLATFORM_VERIFIED",
    );
  });

  it("run B's risk keeps its truth class and loses the verification it never had", () => {
    const block = findingBlockOf(
      {
        type: "RISK",
        statement:
          "The settlement model may create licensing exposure; the material does not establish how it is handled.",
        confidence: "MODERATE",
        truthClass: "Q_INFERENCE",
        evidenceStatus: "PLATFORM_VERIFIED",
      },
      [],
      randomUUID(),
    );
    expect(block?.finding).toMatchObject({
      truthClass: "Q_INFERENCE",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
  });
});
