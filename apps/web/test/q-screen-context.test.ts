import { describe, expect, it } from "vitest";

import { QScreenContextSchema } from "@capital-q/contracts";

import { screenOf } from "../src/features/q/screen";

/**
 * The screen a question is asked from (R21): the route on the closed list
 * and only the canonical ids the route names; anything else is OTHER.
 */
const ID = "c0000000-0000-4000-8000-000000000001";

describe("the screen context the web sends with a question", () => {
  it("maps each screen and the ids its route names", () => {
    expect(screenOf("/home")).toEqual({ route: "HOME" });
    expect(screenOf("/profile/")).toEqual({ route: "PROFILE" });
    expect(screenOf("/company/visibility")).toEqual({
      route: "COMPANY_VISIBILITY",
    });
    expect(screenOf(`/company/${ID}`)).toEqual({
      route: "COMPANY",
      companyId: ID,
    });
    expect(screenOf(`/relationships/investor/${ID}`)).toEqual({
      route: "RELATIONSHIP_INVESTOR",
      investorOrganisationId: ID,
    });
    expect(screenOf("/onboarding/founder")).toEqual({ route: "ONBOARDING" });
  });

  it("never sends what is not an id, and anything unknown is OTHER", () => {
    expect(screenOf("/company/not-an-id")).toEqual({ route: "OTHER" });
    expect(screenOf("/u/zino-aviation")).toEqual({ route: "OTHER" });
    expect(screenOf("/")).toEqual({ route: "OTHER" });
  });

  it("every screen it builds passes the run request's contract", () => {
    for (const path of [
      "/home",
      "/discover",
      "/capital",
      "/pitch",
      `/company/${ID}`,
      `/relationships/company/${ID}`,
      "/anything",
    ]) {
      expect(QScreenContextSchema.safeParse(screenOf(path)).success, path).toBe(
        true,
      );
    }
  });
});
