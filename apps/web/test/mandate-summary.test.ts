import { describe, expect, it, vi } from "vitest";

import type { InvestorMandateDto } from "@capital-q/contracts";

vi.mock("@/features/q/context", () => ({ apiSession: () => null }));

const { chequeLine, stageLine } =
  await import("@/features/capital/mandate-summary");

const base: InvestorMandateDto = {
  id: "7f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  investorOrganisationId: "8f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  name: "Seed fund",
  status: "ACTIVE",
  effectiveFrom: null,
  effectiveTo: null,
  discoveryMode: null,
  chequeRange: null,
  minStageCode: null,
  maxStageCode: null,
  rawMandateText: null,
  constraints: [],
  taxonomyPreferences: [],
  version: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("the investor's mandate, in a few declared lines", () => {
  it("says the cheque range and the typical cheque from decimal strings", () => {
    expect(
      chequeLine({
        ...base,
        chequeRange: {
          currency: "USD",
          min: "250000",
          typical: "600000",
          max: "1000000",
        },
      }),
    ).toBe("USD 250,000 to 1,000,000, typically 600,000");
  });

  it("says Not stated for what was never declared, never a zero", () => {
    expect(chequeLine(base)).toBe("Not stated");
    expect(stageLine(base)).toBe("Not stated");
  });

  it("names one stage once, and a range as a range", () => {
    expect(
      stageLine({ ...base, minStageCode: "seed", maxStageCode: "seed" }),
    ).not.toContain(" to ");
    expect(
      stageLine({ ...base, minStageCode: "pre_seed", maxStageCode: "seed" }),
    ).toContain(" to ");
  });
});
