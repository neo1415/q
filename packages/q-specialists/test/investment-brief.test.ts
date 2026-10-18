import { describe, expect, it } from "vitest";

import {
  applyRevisedBodies,
  composeInvestmentBrief,
  inventsFigures,
  type ComposedInvestmentBrief,
} from "../src/index.js";
import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";

/**
 * The investment brief (QX-003D/F; ADR 0013).
 *
 * A brief is the document somebody sends to an investor, so the property
 * that matters most is the one a persuasive model would break first: it
 * may not state a number the record does not carry. These drive that
 * directly — with a synthesis that invents traction, with a revision that
 * adds customers, and with a record that is simply too thin to write from.
 *
 * The second property is nearly as important and quieter: a claim keeps
 * whose claim it is. A brief that renders somebody's own statement and an
 * externally verified fact in the same voice is the document that earns
 * trust it has not got.
 */

const COMPANY = "f0000000-0000-4000-8000-000000000001";

function finding(overrides: Record<string, unknown> = {}): CompanyFinding {
  return {
    findingId: "a0000000-0000-4000-8000-000000000001",
    type: "FACT",
    statement: "Northstar Logistics moves freight between Lagos and Abuja.",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension: "DESCRIPTION",
    derivation: "MODEL",
    ...overrides,
  } as unknown as CompanyFinding;
}

function result(
  overrides: Partial<CompanyIntelligenceResult> = {},
): CompanyIntelligenceResult {
  return {
    companyId: COMPANY,
    specialistVersion: "company-intelligence/v1",
    asOf: "2026-09-22T00:00:00.000Z",
    blocked: null,
    findings: [finding()],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
    ...overrides,
  };
}

describe("QX-003D · a brief states no figure the record does not", () => {
  it("spots an invented number and passes a quoted one", () => {
    const grounding = ["Revenue reached 120,000 NGN in the last quarter."];
    expect(inventsFigures("Revenue reached 120,000 NGN.", grounding)).toBe(
      false,
    );
    // The classic fabrication: a plausible figure nobody recorded.
    expect(inventsFigures("They have 40 customers.", grounding)).toBe(true);
    expect(inventsFigures("Growth of 30% year on year.", grounding)).toBe(true);
    // Prose with no figure at all cannot invent one.
    expect(inventsFigures("They move freight.", grounding)).toBe(false);
  });

  it("drops a synthesis that invents traction and opens plainly instead", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result({
        synthesis:
          "Northstar is scaling fast, with 40 enterprise customers and £1.2m in ARR.",
      }),
    });
    expect(composed).not.toBeNull();
    const summary = composed?.content.sections[0]?.body ?? "";
    expect(summary).not.toContain("40");
    expect(summary).not.toContain("1.2m");
    expect(summary).toContain("Northstar Logistics");
  });

  it("opens with the record, never the conversational reply (CQ-QX-007)", () => {
    // The reply is Q talking to one person about one request. Even when it
    // invents nothing it is chat, and a brief is sent to investors.
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result({
        findings: [
          finding({
            statement: "The company recorded 120000 NGN of revenue.",
            dimension: "FINANCIAL",
          }),
          finding(),
        ],
        synthesis:
          "I am preparing your investment brief. Revenue on record is 120000 NGN.",
      }),
    });
    const opening = composed?.content.sections[0]?.body ?? "";
    expect(opening).toBe(
      "Northstar Logistics moves freight between Lagos and Abuja.",
    );
    expect(opening).not.toContain("I am preparing");
    expect(composed?.summary).not.toContain("I am preparing");
  });

  it("prefers the company's canonical description to any finding", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result({
        canonicalDescription:
          "Northstar Logistics is a freight marketplace for West African shippers.",
        findings: [
          finding({
            statement: "The company recorded 120000 NGN of revenue.",
            dimension: "FINANCIAL",
          }),
          finding(),
        ],
        synthesis: "Here's your brief! Let me know what you think.",
      }),
    });
    expect(composed?.content.sections[0]?.body).toBe(
      "Northstar Logistics is a freight marketplace for West African shippers.",
    );
  });
});

describe("QX-003D · a brief says whose claim each sentence is", () => {
  it("marks a company's own statement, an estimate and Q's inference", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result({
        findings: [
          finding({ truthClass: "USER_CLAIM" }),
          finding({
            findingId: "a0000000-0000-4000-8000-000000000002",
            statement: "Monthly burn is around the sector median",
            truthClass: "ESTIMATE",
            dimension: "FINANCIAL",
          }),
          finding({
            findingId: "a0000000-0000-4000-8000-000000000003",
            statement: "The business appears to be pre-revenue",
            truthClass: "Q_INFERENCE",
            dimension: "BUSINESS_MODEL",
          }),
        ],
      }),
    });
    const bodies = (composed?.content.sections ?? [])
      .map((section) => section.body)
      .join(" ");
    expect(bodies).toContain("(stated by the company)");
    expect(bodies).toContain("(estimate)");
    expect(bodies).toContain("(Q's reading of the record)");
  });

  it("carries the findings a section rests on, with no evidence identifiers", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result(),
    });
    const section = composed?.content.sections.find(
      (candidate) => candidate.heading === "What the company does",
    );
    expect(section?.findings).toHaveLength(1);
    expect(section?.findings[0]?.evidenceRefs).toEqual([]);
    expect(section?.findings[0]?.truthClass).toBe("USER_CLAIM");
  });
});

describe("QX-003D · what the record does not say", () => {
  it("names the gaps rather than filling them", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result(),
    });
    // One dimension is covered; the other nine are named as missing.
    expect(composed?.content.gaps).toContain("Traction");
    expect(composed?.content.gaps).toContain("Team");
    expect(composed?.content.gaps).not.toContain("What the company does");
    // And no section was invented to hold them.
    const headings = (composed?.content.sections ?? []).map(
      (section) => section.heading,
    );
    expect(headings).not.toContain("Traction");
  });

  it("composes nothing at all when the record holds nothing to say", () => {
    expect(
      composeInvestmentBrief({
        companyName: "Northstar Logistics",
        result: result({ findings: [] }),
      }),
    ).toBeNull();
    // A finding that is only a gap is not something to write a brief from.
    expect(
      composeInvestmentBrief({
        companyName: "Northstar Logistics",
        result: result({
          findings: [finding({ type: "GAP", statement: "No team on record" })],
        }),
      }),
    ).toBeNull();
  });

  it("shows an unreconciled figure as unreconciled rather than choosing", () => {
    const composed = composeInvestmentBrief({
      companyName: "Northstar Logistics",
      result: result({
        contradictions: [
          {
            statements: ["Revenue was 100", "Revenue was 900"],
          } as unknown as CompanyIntelligenceResult["contradictions"][number],
        ],
      }),
    });
    const section = composed?.content.sections.find(
      (candidate) => candidate.heading === "Unreconciled figures",
    );
    expect(section?.body).toContain("100");
    expect(section?.body).toContain("900");
  });
});

describe("QX-003F · a revision changes how it reads, not what it claims", () => {
  const base: ComposedInvestmentBrief = {
    title: "Investment brief — Northstar Logistics",
    summary: "They move freight between Lagos and Abuja.",
    content: {
      sections: [
        {
          heading: "Summary",
          body: "They move freight between Lagos and Abuja.",
          findings: [],
        },
        {
          heading: "Traction",
          body: "Revenue reached 120000 NGN (stated by the company).",
          findings: [],
        },
      ],
      gaps: [],
    },
  };
  const grounding = ["Revenue reached 120000 NGN."];

  it("takes a shorter, plainer rewrite", () => {
    const revised = applyRevisedBodies({
      base,
      revised: new Map([["Summary", "Freight, Lagos to Abuja."]]),
      grounding,
    });
    expect(revised.content.sections[0]?.body).toBe("Freight, Lagos to Abuja.");
    expect(revised.summary).toBe("Freight, Lagos to Abuja.");
    // Untouched sections stay untouched.
    expect(revised.content.sections[1]?.body).toBe(
      base.content.sections[1]?.body,
    );
  });

  it("refuses a rewrite that adds a figure and keeps the original", () => {
    const revised = applyRevisedBodies({
      base,
      revised: new Map([
        ["Traction", "Revenue reached 120000 NGN across 40 customers."],
      ]),
      grounding,
    });
    expect(revised.content.sections[1]?.body).toBe(
      "Revenue reached 120000 NGN (stated by the company).",
    );
  });

  it("ignores a heading the document does not have", () => {
    const revised = applyRevisedBodies({
      base,
      revised: new Map([["Our Winning Team", "Ten world-class engineers."]]),
      grounding,
    });
    expect(revised.content.sections).toHaveLength(2);
    expect(revised.content.sections.map((section) => section.heading)).toEqual([
      "Summary",
      "Traction",
    ]);
  });
});
