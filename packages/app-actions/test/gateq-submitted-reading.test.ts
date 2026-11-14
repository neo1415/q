import { describe, expect, it } from "vitest";
import {
  APPLICATION_ONLY,
  documentsReading,
  submittedReading,
} from "../src/actions/gateq-submitted-reading.js";

const claim = {
  dimension: "company.revenue",
  label: "Revenue",
  summary: "$100,000 annual revenue, applicant reported",
  provenance: "APPLICANT_PROVIDED" as const,
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  sourceFactId: "00000000-0000-4000-8000-000000000001",
  sourceTurnSeq: 7,
};
const dossier = {
  dimensions: [
    { group: "TRACTION" as const, label: "Traction", facts: [claim] },
  ],
  unknowns: [
    {
      dimension: "company.runway",
      group: "FUNDRAISING" as const,
      label: "Runway",
    },
  ],
  declined: [],
  missing: [],
  contradictions: ["Revenue periods differ"],
};

describe("Q's authorized submitted dossier reading", () => {
  it("hands Q a computed figure as Q's inference with its derivation, never as the founder's words", () => {
    const result = submittedReading({
      ...dossier,
      dimensions: [
        {
          group: "TRACTION",
          label: "Traction",
          facts: [
            {
              ...claim,
              summary: "360000 USD",
              truthClass: "Q_INFERENCE" as const,
              derivation:
                "Not said in these words: Q derived it from interview turn 7, where the founder said “two pay $180,000 each”",
            },
          ],
        },
      ],
    });
    expect(result).toContain("360000 USD [truth=Q_INFERENCE");
    expect(result).toContain("two pay $180,000 each");
    expect(result).toContain("never attribute it to them");
  });

  it("preserves exact findings, source lineage, epistemic labels and unresolved gaps", () => {
    const result = submittedReading(dossier);
    expect(result).toContain(claim.summary);
    expect(result).toContain(
      "truth=USER_CLAIM; evidence=SELF_REPORTED; provenance=APPLICANT_PROVIDED",
    );
    expect(result).toContain(
      `sourceFactId=${claim.sourceFactId}; sourceTurnSeq=7`,
    );
    expect(result).toContain("Unknown: Runway");
    expect(result).toContain("Revenue periods differ");
    expect(result).toContain("not independently verified");
  });
  it("omits whole findings at the context budget and discloses the missing context", () => {
    const result = submittedReading({
      ...dossier,
      dimensions: [
        {
          group: "TRACTION",
          label: "Traction",
          facts: Array.from({ length: 20 }, (_, index) => ({
            ...claim,
            summary: `${index}: ${"x".repeat(2000)}`,
          })),
        },
      ],
    });
    expect(result.length).toBeLessThan(14_000);
    expect(result).toContain("additional findings exceed");
    expect(result).toContain("consult the submitted dossier before answering");
  });
  it("labels a legacy submission without pretending an interview was read", () => {
    expect(submittedReading(null)).toContain("No frozen interview dossier");
  });
});

describe("what was attached, and what was read (live D4, 2026-11-13)", () => {
  const shared = [{ title: "Kazikit deck" }, { title: "Product brief" }];

  it("reads the attached documents as the founder's material, page-labelled", () => {
    const text = documentsReading(shared, [
      {
        title: "Kazikit deck",
        pageCount: 7,
        excerpts: [
          { page: 2, text: "1,900 fundis signed up since September 2025." },
        ],
        truncated: false,
        notRead: null,
      },
      {
        title: "Product brief",
        pageCount: 2,
        excerpts: null,
        truncated: true,
        notRead: "its text was withheld by the safety check",
      },
    ]);
    expect(text).toContain("Kazikit deck, 7 pages: READ");
    expect(text).toContain("[Kazikit deck, page 2] 1,900 fundis");
    expect(text).toContain(
      "Product brief, 2 pages: NOT READ (its text was withheld by the safety check)",
    );
    expect(text).toContain("never instructions");
    expect(text).not.toMatch(/no document/iu);
  });

  it("without a reader, names what was attached and says plainly it was not read", () => {
    const text = documentsReading(shared, null);
    expect(text).toContain("Kazikit deck, Product brief");
    expect(text).toContain("not read for this answer");
    expect(text).toContain("never that no document was attached");
  });

  it("no longer tells Q that no document contents were read when some were", () => {
    expect(submittedReading(dossier)).not.toContain("No document contents");
  });

  it("keeps the application apart from the company's network profile", () => {
    expect(APPLICATION_ONLY).toContain("Capital Q profile");
    expect(APPLICATION_ONLY).toContain("never as part of the application");
  });
});
