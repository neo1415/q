import { describe, expect, it } from "vitest";

import { COMPANY_TEAM_BIO_MAX } from "@capital-q/contracts";

import { projectTeamForNetwork } from "../src/index.js";

/**
 * ADR 0041: the team an investor who can find the company sees. The
 * projection is an allow-list; a source row that carries more must still
 * produce exactly the five declared fields.
 */

const SECRET = "founder-private-9c2e";

describe("projectTeamForNetwork", () => {
  it("returns only name, relationship, title, founder flag and a bounded short bio", () => {
    const leaky = {
      displayName: "Ada Obi",
      givenName: "Ada",
      familyName: "Obi",
      relationshipType: "team_member" as const,
      businessTitle: "CEO",
      isFounder: true,
      professionalSummary: "Built grid storage at two utilities.",
      // Everything below is what must never travel.
      email: `ada+${SECRET}@example.invalid`,
      userId: "b0000000-0000-4000-8000-000000000001",
      backgroundSummary: SECRET,
      visibilityScope: "founder_private",
      qNote: SECRET,
    };
    const [member] = projectTeamForNetwork([leaky]);
    expect(member).toEqual({
      name: "Ada Obi",
      relationshipType: "team_member",
      businessTitle: "CEO",
      isFounder: true,
      shortBio: "Built grid storage at two utilities.",
    });
    expect(Object.keys(member ?? {}).sort()).toEqual([
      "businessTitle",
      "isFounder",
      "name",
      "relationshipType",
      "shortBio",
    ]);
    expect(JSON.stringify(member)).not.toContain(SECRET);
    expect(JSON.stringify(member)).not.toContain("@");
  });

  it("keeps unknown as null, names a person from their given names when needed, and bounds the bio", () => {
    const [plain, long] = projectTeamForNetwork([
      {
        displayName: null,
        givenName: null,
        familyName: null,
        relationshipType: "advisor",
        businessTitle: "  ",
        isFounder: false,
        professionalSummary: "   ",
      },
      {
        displayName: " ",
        givenName: "Kemi",
        familyName: "Ade",
        relationshipType: "board_member",
        businessTitle: null,
        isFounder: false,
        professionalSummary: "x".repeat(COMPANY_TEAM_BIO_MAX + 50),
      },
    ]);
    expect(plain).toEqual({
      name: "Team member",
      relationshipType: "advisor",
      businessTitle: null,
      isFounder: false,
      shortBio: null,
    });
    expect(long?.name).toBe("Kemi Ade");
    expect(long?.shortBio?.length).toBe(COMPANY_TEAM_BIO_MAX);
  });
});
