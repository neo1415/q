import { describe, expect, it } from "vitest";

import { founderMayReuseWorkspace } from "../src/integration/workspace.js";

/**
 * Owner directive 2026-10-16: one person, founder and investor memberships,
 * no crossover; an invited teammate is never treated as the founder.
 */
describe("founderMayReuseWorkspace", () => {
  it("reuses an empty company workspace (a retry after the workspace was created)", () => {
    expect(
      founderMayReuseWorkspace({
        organisationType: "company",
        isOwner: true,
        holdsCompany: false,
      }),
    ).toBe(true);
  });

  it("reuses the owner's own company workspace, as before", () => {
    expect(
      founderMayReuseWorkspace({
        organisationType: "company",
        isOwner: true,
        holdsCompany: true,
      }),
    ).toBe(true);
  });

  it("never founds a second company in a team somebody else owns", () => {
    expect(
      founderMayReuseWorkspace({
        organisationType: "company",
        isOwner: false,
        holdsCompany: true,
      }),
    ).toBe(false);
  });

  it("never creates a company inside a firm's workspace, whatever the role", () => {
    for (const organisationType of [
      "investment_firm",
      "family_office",
      "syndicate",
      "accelerator",
      "institution",
      "advisor",
      "other",
    ]) {
      expect(
        founderMayReuseWorkspace({
          organisationType,
          isOwner: true,
          holdsCompany: false,
        }),
      ).toBe(false);
    }
  });
});
