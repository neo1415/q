import { describe, expect, it } from "vitest";
import { submittedReading } from "../src/actions/gateq-submitted-reading.js";

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
