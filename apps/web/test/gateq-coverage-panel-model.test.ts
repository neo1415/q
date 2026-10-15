import { describe, expect, it } from "vitest";

import type { ApplicationCoverageDto } from "@capital-q/contracts";

import { coveragePanelModel } from "@/features/gateq/coverage-panel-model";

const dto = (
  coverage: Partial<ApplicationCoverageDto["coverage"]>,
): ApplicationCoverageDto => ({
  coverage: {
    version: 1,
    access: "NEEDS_INFORMATION",
    unmet: [],
    stillNeeded: [],
    answered: [],
    unknown: [],
    declined: [],
    missing: [],
    contradictions: [],
    ...coverage,
  },
  contact: { required: true, confirmed: true },
  documentCount: 0,
  transcriptTurns: 0,
});

describe("the live coverage reading (C2)", () => {
  it("lists mandate-required needs first, then clarifications, then the rest", () => {
    const model = coveragePanelModel(
      dto({
        missing: [
          {
            dimension: "company.team",
            label: "Team",
            group: "TEAM",
            reason: "UNDERSTANDING",
          },
          {
            dimension: "raise.amount",
            label: "Raise size",
            group: "FUNDRAISING",
            reason: "PREFERRED_BY_GATEWAY",
          },
          {
            dimension: "claims.revenue",
            label: "Revenue",
            group: "TRACTION",
            reason: "CONTRADICTION",
          },
          {
            dimension: "company.stage",
            label: "Stage",
            group: "COMPANY",
            reason: "REQUIRED_BY_GATEWAY",
          },
        ],
      }),
      "Sahel",
    );
    expect(model.needed.map((n) => n.label)).toEqual([
      "Stage",
      "Revenue",
      "Raise size",
      "Team",
    ]);
    expect(model.needed[0]).toMatchObject({
      required: true,
      why: "Sahel's published mandate requires this",
    });
  });

  it("keeps where an answer came from and flags self-reported traction for evidence", () => {
    const model = coveragePanelModel(
      dto({
        answered: [
          {
            dimension: "claims.traction",
            label: "Traction",
            group: "TRACTION",
            summary: "12 pilots",
            provenance: "APPLICANT_PROVIDED",
          },
          {
            dimension: "claims.revenue",
            label: "Revenue",
            group: "TRACTION",
            summary: "40000 USD",
            provenance: "DOCUMENT_SUPPORTED",
          },
          {
            dimension: "company.stage",
            label: "Stage",
            group: "COMPANY",
            summary: "Seed",
            provenance: "ESTIMATED",
          },
        ],
      }),
      "Sahel",
    );
    expect(model.have.map((h) => h.source)).toEqual([
      "Your answer",
      "Supported by a shared document",
      "Your estimate",
    ]);
    expect(model.evidenceFollowUps).toEqual(["Traction"]);
  });

  it("never turns unknown or declined into a gap to chase or a no", () => {
    const model = coveragePanelModel(
      dto({
        unknown: [
          { dimension: "claims.revenue", label: "Revenue", group: "TRACTION" },
        ],
        declined: [
          {
            dimension: "raise.amount",
            label: "Raise size",
            group: "FUNDRAISING",
          },
        ],
      }),
      "Sahel",
    );
    expect(model.needed).toEqual([]);
    expect(model.notKnown).toEqual(["Revenue"]);
    expect(model.declined).toEqual(["Raise size"]);
    expect(model.status).toBe("Saved: 0 answered, 0 still needed.");
  });
});
