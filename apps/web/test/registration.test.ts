import { describe, expect, it } from "vitest";

import {
  decideArrival,
  isInvitationReturn,
  organisationFieldFor,
} from "../src/auth/registration";
import { registrationDefaultsFor } from "../src/features/onboarding-kit/registration-defaults-for";

const one = [{ organisationId: "a", active: true }];
const two = [
  { organisationId: "a", active: true },
  { organisationId: "b", active: false },
];

describe("decideArrival", () => {
  it("sends a new person who chose a journey to the welcome for that journey", () => {
    expect(
      decideArrival({
        state: { kind: "NEW" },
        again: false,
        workspaces: [],
        workspaceChosen: false,
        intendedJourney: "investor",
      }),
    ).toEqual({ kind: "WELCOME", journey: "investor" });
  });

  it("asks the role question when no journey was chosen (Google, older accounts)", () => {
    expect(
      decideArrival({
        state: { kind: "NEW" },
        again: false,
        workspaces: [],
        workspaceChosen: false,
        intendedJourney: null,
      }),
    ).toEqual({ kind: "WELCOME", journey: null });
  });

  it("lets somebody with an unfinished setup in (owner 2026-10-16: no gate)", () => {
    expect(
      decideArrival({
        state: { kind: "UNFINISHED", journey: "founder" },
        again: false,
        workspaces: [],
        workspaceChosen: false,
        intendedJourney: "investor",
      }),
    ).toEqual({ kind: "HOME" });
  });

  it("asks somebody with several workspaces which one, once per browser session", () => {
    const base = {
      state: { kind: "DONE" } as const,
      again: false,
      intendedJourney: null,
    };
    expect(
      decideArrival({ ...base, workspaces: two, workspaceChosen: false }),
    ).toEqual({ kind: "CHOOSE_WORKSPACE" });
    expect(
      decideArrival({ ...base, workspaces: two, workspaceChosen: true }),
    ).toEqual({ kind: "HOME" });
    expect(
      decideArrival({ ...base, workspaces: one, workspaceChosen: false }),
    ).toEqual({ kind: "HOME" });
  });

  it("offers both journeys to somebody already somewhere who came back on purpose", () => {
    expect(
      decideArrival({
        state: { kind: "DONE" },
        again: true,
        workspaces: one,
        workspaceChosen: false,
        intendedJourney: "founder",
      }),
    ).toEqual({ kind: "WELCOME", journey: null });
  });
});

describe("registration helpers", () => {
  it("recognises only an invitation link as an invitation return", () => {
    expect(isInvitationReturn("/join/abcdefghijklmnopqrstuvwxyz012345")).toBe(
      true,
    );
    expect(isInvitationReturn("/welcome")).toBe(false);
    expect(isInvitationReturn("/join/")).toBe(false);
    expect(isInvitationReturn("/join/abc/../../home")).toBe(false);
  });

  it("names the organisation field for the journey", () => {
    expect(organisationFieldFor("founder").label).toBe("Company name");
    expect(organisationFieldFor("investor").label).toBe("Fund or firm name");
    expect(organisationFieldFor(null).label).toBe("Company or fund");
  });

  it("offers a registered organisation only to the journey it was typed for", () => {
    const details = {
      organisationName: "Savanna Seed",
      intendedJourney: "investor",
    } as const;
    expect(registrationDefaultsFor("investor", details)).toEqual({
      organisationName: "Savanna Seed",
    });
    // A fund's name is not a company's.
    expect(registrationDefaultsFor("founder", details)).toEqual({
      organisationName: null,
    });
    expect(
      registrationDefaultsFor("founder", {
        organisationName: "Harbourline",
        intendedJourney: null,
      }),
    ).toEqual({ organisationName: "Harbourline" });
  });
});
