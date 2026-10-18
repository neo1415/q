import { describe, expect, it } from "vitest";

import type { GetInvestorMandateOutput } from "@capital-q/q-tools";

import { composeOwnMandateDocument } from "../src/index.js";

/**
 * A document of the person's own mandate, from their record (gap 3).
 * Properties: every figure in it is one on the record; a mandate not yet
 * confirmed is a draft, in the title and the summary; what the record
 * leaves open is a gap, never content; no record, no document.
 */

type Mandate = GetInvestorMandateOutput["mandates"][number];

function record(
  mandate: Partial<Mandate>,
  more: Partial<GetInvestorMandateOutput> = {},
): GetInvestorMandateOutput {
  return {
    investorOrganisationId: "a0000000-0000-4000-8000-0000000000aa",
    displayName: "Harrow Road Capital",
    investorType: "angel",
    deploymentState: "actively_investing",
    truncated: false,
    ...more,
    mandates: [
      {
        mandateId: "a0000000-0000-4000-8000-0000000000bb",
        status: "ACTIVE",
        version: 3,
        discoveryMode: "BALANCED",
        cheque: {
          currency: "USD",
          min: "25000",
          typical: "50000",
          max: "100000",
        },
        stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
        constraints: [
          {
            dimension: "geography.country",
            operator: "IN",
            value: { kind: "codes", values: ["ng", "gh"] },
            importance: "STRONG",
            isHardExclusion: false,
            automatedUse: "ELIGIBLE",
          },
          {
            dimension: "red_flag",
            operator: "IN",
            value: { kind: "codes", values: ["gambling"] },
            importance: "HARD_EXCLUSION",
            isHardExclusion: true,
            automatedUse: "ELIGIBLE",
          },
        ],
        taxonomyPreferences: [],
        truthClass: "USER_CLAIM",
        ...mandate,
      },
    ],
  };
}

const text = (doc: ReturnType<typeof composeOwnMandateDocument>) =>
  doc === null
    ? ""
    : [
        doc.title,
        doc.summary,
        ...doc.content.sections.map((s) => `${s.heading} ${s.body}`),
      ].join("\n");

describe("a mandate document from the person's own record", () => {
  it("states the figures on the record, and no other", () => {
    const doc = composeOwnMandateDocument(record({}));
    const all = text(doc);
    for (const figure of ["25,000", "50,000", "100,000"]) {
      expect(all).toContain(figure);
    }
    const figures = all.match(/\d[\d,]*/g) ?? [];
    for (const figure of figures) {
      expect(["25,000", "50,000", "100,000"]).toContain(figure);
    }
    expect(all).toContain("Gambling (never shown)");
    expect(all).toContain("Ng, Gh (strong preference)");
  });

  it("is a draft exactly when the mandate is not active", () => {
    for (const status of ["ACTIVE", "DRAFT", "CLOSED"] as const) {
      const doc = composeOwnMandateDocument(record({ status }));
      const draft = status !== "ACTIVE";
      expect(doc?.draft, status).toBe(draft);
      expect(doc?.title.includes("(draft)"), status).toBe(draft);
      expect(doc?.summary.toLowerCase().includes("draft"), status).toBe(draft);
    }
  });

  it("lists what the record leaves open as gaps, never as content", () => {
    const doc = composeOwnMandateDocument(
      record(
        {
          cheque: null,
          constraints: [],
          stage: { minStageCode: null, maxStageCode: null },
        },
        { investorType: null, deploymentState: null },
      ),
    );
    expect(doc?.content.gaps).toEqual(
      expect.arrayContaining([
        "How they invest is not yet stated.",
        "Whether they are deploying capital is not yet stated.",
        "Cheque size is not yet stated.",
        "Stages are not yet stated.",
        "Geography is not yet stated.",
        "Sectors are not yet stated.",
      ]),
    );
    expect(text(doc)).not.toMatch(/\d/);
  });

  it("prefers the active mandate, and there is no document without one", () => {
    expect(
      composeOwnMandateDocument({ ...record({}), mandates: [] }),
    ).toBeNull();
    const two = record({});
    const draftFirst: GetInvestorMandateOutput = {
      ...two,
      mandates: [
        { ...(two.mandates[0] as Mandate), status: "DRAFT", cheque: null },
        two.mandates[0] as Mandate,
      ],
    };
    expect(composeOwnMandateDocument(draftFirst)?.draft).toBe(false);
  });
});
