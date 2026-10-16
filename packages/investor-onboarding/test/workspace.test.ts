import { describe, expect, it } from "vitest";

import { investorMayReuseWorkspace } from "../src/integration/workspace.js";

/** Owner directive 2026-10-16: founder and investor memberships, no crossover. */
describe("investorMayReuseWorkspace", () => {
  it("reuses a firm's workspace", () => {
    for (const organisationType of [
      "investment_firm",
      "family_office",
      "syndicate",
      "accelerator",
      "institution",
    ]) {
      expect(
        investorMayReuseWorkspace({ organisationType, holdsCompany: false }),
      ).toBe(true);
    }
  });

  it("never makes a founder's company workspace an investor", () => {
    expect(
      investorMayReuseWorkspace({
        organisationType: "company",
        holdsCompany: false,
      }),
    ).toBe(false);
    expect(
      investorMayReuseWorkspace({
        organisationType: "company",
        holdsCompany: true,
      }),
    ).toBe(false);
  });

  it("never reuses an organisation that already holds a canonical company", () => {
    expect(
      investorMayReuseWorkspace({
        organisationType: "other",
        holdsCompany: true,
      }),
    ).toBe(false);
  });
});
