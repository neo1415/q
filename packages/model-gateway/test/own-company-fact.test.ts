import { describe, expect, it } from "vitest";

import { ownCompanySnapshotFact } from "../src/q/company-fact.js";

/**
 * K Part 4: a founder's own company from their working snapshot becomes a
 * fact only where this run's plan holds that company's profile scope.
 */
const OWN = {
  companyId: "7c1d0e55-0000-4000-8000-000000000001",
  name: "Tier A Robotics",
  shortDescription: "Robots for warehouses.",
  stageCode: "seed",
  countryCode: "NG",
};

describe("their own company from the working snapshot (K4)", () => {
  it("is a fact about their own company when the plan holds its profile", () => {
    const fact = ownCompanySnapshotFact(OWN, {
      scopes: [
        {
          kind: "COMPANY_PROFILE",
          sensitivity: "INTERNAL",
          companyId: OWN.companyId,
        },
      ],
    });
    expect(fact?.statement).toMatch(/Tier A Robotics/u);
    expect(fact?.statement).toMatch(/^Their own company/u);
  });

  it("is nothing when the plan does not hold that company's profile", () => {
    expect(ownCompanySnapshotFact(OWN, { scopes: [] })).toBeNull();
    expect(
      ownCompanySnapshotFact(OWN, {
        scopes: [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: "7c1d0e55-0000-4000-8000-000000000002",
          },
        ],
      }),
    ).toBeNull();
  });
});
