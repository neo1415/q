import { describe, expect, it } from "vitest";

import { ASKS_ABOUT_OWN_TEAM, ownTeamFact } from "../src/q/own-readiness.js";

/** Live 2026-10-16: Home Q said "1 founder and 1 person" for 2 and 14. */
describe("their own team counts, from the recorded team facts", () => {
  it("states the recorded counts, and that their membership is not the team", () => {
    const fact = ownTeamFact({
      status: "FOUND",
      data: {
        teamCounts: {
          status: "RECORDED",
          numberOfFounders: 2,
          numberOfFullTimeFounders: 2,
          peopleWorkingOnTheCompany: 14,
        },
        yourOwnRole: { title: "CEO", isFounder: true },
      },
    });
    expect(fact?.statement).toContain("founders: 2");
    expect(fact?.statement).toContain("people working on the company: 14");
    expect(fact?.statement).toContain("not the team size");
  });

  it("not recorded: says so, with no number", () => {
    const fact = ownTeamFact({
      status: "FOUND",
      data: { teamCounts: { status: "NOT_RECORDED" } },
    });
    expect(fact?.statement).toMatch(/not on record/);
    expect(fact?.statement).not.toMatch(/\d/);
  });

  it("is read for team questions only", () => {
    expect(
      ASKS_ABOUT_OWN_TEAM.test(
        "How many founders do we have, and how many people work at Quillmark?",
      ),
    ).toBe(true);
    expect(ASKS_ABOUT_OWN_TEAM.test("What should I do next?")).toBe(false);
  });
});
