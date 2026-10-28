import { describe, expect, it } from "vitest";

import { ownJourneyOf } from "../src/features/q/context";
import {
  companyLandingPath,
  mandateLandingPath,
} from "../src/features/q/own-paths";

/**
 * `/company` and `/mandate` (live typed run 2026-10-28, D6; production
 * re-test the same day): each lands on the person's own page, or their own
 * setup, decided from the server-resolved context and journey alone. A
 * redirect never sends anybody into the other side's setup (which created
 * a second onboarding session); only somebody with no journey at all is
 * offered the welcome choice.
 */
describe("the bare company and mandate addresses", () => {
  const founder = {
    kind: "FOUNDER" as const,
    companyId: "dc04ddfd-d3fa-4760-bd20-bc2b820af682",
    label: "Ajali Health",
  };
  const investor = {
    kind: "INVESTOR" as const,
    investorOrganisationId: "x",
    label: "Harmattan Angels",
  };

  it("/company: a founder's company; an investor's own profile; never founder setup for an investor", () => {
    expect(companyLandingPath(founder, "founder")).toBe(
      "/company/dc04ddfd-d3fa-4760-bd20-bc2b820af682",
    );
    expect(companyLandingPath(investor, "investor")).toBe("/profile");
    // An investor still setting up (no firm yet) is an investor.
    expect(companyLandingPath({ kind: "NONE" }, "investor")).toBe("/profile");
    expect(companyLandingPath({ kind: "NONE" }, "founder")).toBe(
      "/onboarding/founder",
    );
    expect(companyLandingPath({ kind: "NONE" }, null)).toBe("/welcome");
  });

  it("/mandate: an investor's mandate; a founder's home; never investor setup for a founder", () => {
    expect(mandateLandingPath(investor, "investor")).toBe("/profile#mandate");
    expect(mandateLandingPath(founder, "founder")).toBe("/home");
    expect(mandateLandingPath({ kind: "NONE" }, "founder")).toBe("/home");
    expect(mandateLandingPath({ kind: "NONE" }, "investor")).toBe(
      "/onboarding/investor",
    );
    expect(mandateLandingPath({ kind: "NONE" }, null)).toBe("/welcome");
  });

  it("the journey is the one started first: a stray second session is not theirs", () => {
    const view = (status: string, startedAt: string) => ({
      status: "fulfilled" as const,
      value: { session: { status, startedAt } },
    });
    // The investor account: its own investor session, then a founder one a
    // redirect opened (16:52:24 and 16:55:28 on 2026-10-28).
    const views = [
      {
        journey: "founder" as const,
        view: view("ACTIVE", "2026-10-28T16:55:28.754Z"),
      },
      {
        journey: "investor" as const,
        view: view("ACTIVE", "2026-10-28T16:52:24.196Z"),
      },
    ];
    expect(ownJourneyOf(views)).toBe("investor");
    expect(
      ownJourneyOf([
        {
          journey: "founder",
          view: { status: "rejected", reason: new Error("404") },
        },
      ]),
    ).toBeNull();
  });
});
