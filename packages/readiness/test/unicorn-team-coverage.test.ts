import { describe, expect, it } from "vitest";
import type { DeckFact, DeckSection } from "@capital-q/contracts";
import type { InvestabilityInputs } from "../src/investability/inputs.js";
import { assessUnicornPotential } from "../src/unicorn-potential/assess.js";
import { typedTeamCoverage } from "../src/unicorn-potential/team-coverage.js";
const NOW = "2026-10-18T12:00:00.000Z";
function fact(
  label: string,
  value: string,
  patch: Partial<DeckFact> = {},
): DeckFact {
  return {
    label,
    value,
    kind: "FIGURE",
    asOf: "October 2026",
    pages: [1],
    unknownReason: null,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "HIGH",
    ...patch,
  };
}
function section(
  facts: DeckFact[] = [
    fact("Engineering", "4"),
    fact("Sales", "2 people"),
    fact("Customer operations", "3"),
  ],
): DeckSection {
  return {
    section: "TEAM",
    status: "PRESENT",
    summary: "Synthetic staffing fixture",
    pages: [1],
    confidence: "HIGH",
    facts,
  };
}
function assess(team: DeckSection, listed = true) {
  const inputs: InvestabilityInputs = {
    companyId: "synthetic-company",
    stageCode: "seed",
    sectorCodes: [],
    businessModelCodes: [],
    profile: { listed, description: false, website: false, updatedAt: NOW },
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: [],
    claims: [],
    deck: {
      extractionId: "synthetic-extraction",
      readAt: "2026-10-17T12:00:00.000Z",
      sections: [team],
    },
  };
  return assessUnicornPotential(inputs, NOW);
}
const p9 = (value: ReturnType<typeof assess>) =>
  value.view.pillars.find((p) => p.id === "P9");
describe("typed dated team function coverage (C2 P9.A)", () => {
  it("supports limited staffing coverage with all three distinct source references, never milestone delivery", () => {
    const result = assess(section());
    expect(p9(result)?.criteria[0]?.grade).toBe(2);
    expect(p9(result)?.criteria[0]?.sources.map((s) => s.id)).toEqual([
      "synthetic-extraction:TEAM:0",
      "synthetic-extraction:TEAM:1",
      "synthetic-extraction:TEAM:2",
    ]);
    expect(p9(result)?.criteria[1]?.state).toBe("UNKNOWN");
    expect(result.view.overallScore).toBeNull();
    expect(
      result.observations
        .filter((o) => o.pillar === "P9")
        .every((o) => o.inputMetadata?.["coverageOnly"] === true),
    ).toBe(true);
  });
  it("preserves dated self-report axes and never infers independently verified quality", () => {
    const sources = p9(assess(section()))?.criteria[0]?.sources;
    expect(
      sources?.every(
        (s) =>
          s.at === "2026-10-01T00:00:00.000Z" &&
          s.truthClass === "USER_CLAIM" &&
          s.evidenceStatus === "SELF_REPORTED",
      ),
    ).toBe(true);
  });
  it("does not grade missing functions, aggregate total headcount or biography text", () => {
    for (const fields of [
      [fact("Total headcount", "20")],
      [fact("Engineering", "4"), fact("Sales", "2")],
      [
        fact("Engineering", "4"),
        fact("Sales", "2"),
        fact("Customer operations", "3", { kind: "TEXT" }),
      ],
    ])
      expect(typedTeamCoverage(section(fields))).toEqual([]);
  });
  it("rejects unknown, inferred, forecast, zero, negative or contradictory-count inputs", () => {
    for (const patch of [
      { unknownReason: "UNCLEAR" as const },
      { truthClass: "Q_INFERENCE" as const },
      { value: "3 projected" },
      { value: "0" },
      { value: "-3" },
      { value: "1,,2" },
      { value: "4," },
    ])
      expect(
        p9(
          assess(
            section([
              fact("Engineering", "4"),
              fact("Sales", "2"),
              fact("Customer operations", "3", patch),
            ]),
          ),
        )?.criteria[0]?.grade,
      ).toBeNull();
    expect(
      typedTeamCoverage(
        section([
          fact("Engineering", "4"),
          fact("Engineering headcount", "5"),
          fact("Sales", "2"),
          fact("Operations", "3"),
        ]),
      ),
    ).toEqual([]);
  });
  it("requires compatible explicit measurement dates without using capture time", () => {
    expect(
      typedTeamCoverage(
        section([
          fact("Engineering", "4"),
          fact("Sales", "2"),
          fact("Operations", "3", { asOf: null }),
        ]),
      ),
    ).toEqual([]);
    expect(
      typedTeamCoverage(
        section([
          fact("Engineering", "4"),
          fact("Sales", "2"),
          fact("Operations", "3", { asOf: "September 2026" }),
        ]),
      ),
    ).toEqual([]);
    const old = section(
      section().facts.map((f) => ({ ...f, asOf: "October 2024" })),
    );
    expect(p9(assess(old))?.criteria[0]?.state).toBe("STALE");
    const future = section(
      section().facts.map((f) => ({ ...f, asOf: "November 2026" })),
    );
    expect(p9(assess(future))?.criteria[0]?.state).toBe("STALE");
  });
  it("keeps unreviewed/private and conflicted sections out of an observed grade", () => {
    expect(
      p9(assess({ ...section(), status: "UNCLEAR" }))?.criteria[0]?.grade,
    ).toBeNull();
    expect(p9(assess(section(), false))?.criteria[0]?.grade).toBeNull();
    expect(
      p9(assess({ ...section(), status: "CONTRADICTORY" }))?.criteria[0]?.state,
    ).toBe("CONFLICTED");
  });
});
