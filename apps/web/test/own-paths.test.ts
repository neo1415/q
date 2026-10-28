import { describe, expect, it } from "vitest";

import {
  companyLandingPath,
  mandateLandingPath,
} from "../src/features/q/own-paths";

/**
 * Live typed run 2026-10-28, D6: `/company` and `/mandate` were 404s. Each
 * now lands on the person's own page, or on the setup that creates it,
 * decided from the server-resolved context alone.
 */
describe("the bare company and mandate addresses", () => {
  it("take a founder to their company, and anyone else to founder setup", () => {
    expect(
      companyLandingPath({
        kind: "FOUNDER",
        companyId: "dc04ddfd-d3fa-4760-bd20-bc2b820af682",
        label: "Ajali Health",
      }),
    ).toBe("/company/dc04ddfd-d3fa-4760-bd20-bc2b820af682");
    expect(
      companyLandingPath({
        kind: "INVESTOR",
        investorOrganisationId: "x",
        label: null,
      }),
    ).toBe("/onboarding/founder");
    expect(companyLandingPath({ kind: "NONE" })).toBe("/onboarding/founder");
  });

  it("take an investor to the mandate on their profile, and anyone else to investor setup", () => {
    expect(
      mandateLandingPath({
        kind: "INVESTOR",
        investorOrganisationId: "x",
        label: "Harmattan Angels",
      }),
    ).toBe("/profile#mandate");
    expect(
      mandateLandingPath({ kind: "FOUNDER", companyId: "c", label: null }),
    ).toBe("/onboarding/investor");
    expect(mandateLandingPath({ kind: "NONE" })).toBe("/onboarding/investor");
  });
});
