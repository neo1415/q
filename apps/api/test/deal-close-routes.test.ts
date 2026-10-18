import { describe, expect, it } from "vitest";

import { documentToPdf } from "@capital-q/deck-render";

import { csvField, reportDocument } from "../src/http/deal-close.js";

/**
 * Deal close downloads (2026-10-08): a stored report prints as the same
 * sections, rows and gaps, with its version and digest on the dateline;
 * the audit CSV quotes every field and never starts one with a formula.
 */

const report = {
  reportId: "00000000-0000-4000-8000-000000000001",
  kind: "CLOSING" as const,
  version: 2,
  title: "Closing report: Tensorgate",
  visibility: "relationship_shared" as const,
  ownerSide: "COMPANY" as const,
  generatedBy: "Femi Ade",
  createdAt: "2026-10-09T10:00:00.000Z",
  contentSha256: "a".repeat(64),
  content: {
    compiler: "deal-report.v1",
    kind: "CLOSING" as const,
    title: "Closing report: Tensorgate",
    subtitle: "Northwind Ventures and Tensorgate",
    sections: [
      {
        heading: "Money",
        body: "Raised means received.",
        rows: [
          {
            label: "Funds received",
            value: "9 Oct 2026",
            source: "Femi Ade · 9 Oct 2026",
          },
        ],
      },
    ],
    gaps: ["Pro-rata rights are not stated."],
    notice: "Compiled by Capital Q.",
  },
};

describe("deal close downloads", () => {
  it("prints the stored report as written, with version and digest", async () => {
    const document = reportDocument(report);
    expect(document.kind).toBe("Closing report");
    expect(document.dateline).toContain("Version 2");
    expect(document.dateline).toContain("sha256 aaaaaaaaaaaaaaaa");
    expect(document.sections[0]?.findings[0]).toEqual({
      statement: "Funds received: 9 Oct 2026",
      provenance: "Femi Ade · 9 Oct 2026",
    });
    expect(document.gaps).toEqual(["Pro-rata rights are not stated."]);
    const pdf = await documentToPdf(document, { title: report.content.title });
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("quotes CSV fields and neutralises formulas", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
  });
});
