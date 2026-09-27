import { describe, expect, it } from "vitest";

import {
  QScreenContextSchema,
  QVoiceScreenUpdateSchema,
} from "@capital-q/contracts";

import {
  currentScreen,
  currentViewing,
  screenOf,
  setScreenFocusSource,
} from "../src/features/q/screen";

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
    expect(screenOf("/relationships")).toEqual({ route: "RELATIONSHIPS" });
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

/**
 * R35: the Discover card in front of the person, read at every turn (not
 * only when Q opened), so a question typed into an open dock or spoken on
 * a live line is about the card and the moment on screen now.
 */
describe("the card on screen in Discover", () => {
  const PITCH = "d0000000-0000-4000-8000-000000000001";
  const OTHER = "c0000000-0000-4000-8000-000000000002";

  it("reports the company, and the pitch moment when one is playing or paused", () => {
    let focus:
      | {
          kind: "PITCH_MOMENT";
          companyId: string;
          companyLabel: string;
          mediaAssetId: string;
          positionSeconds: number;
        }
      | { kind: "SCREEN_COMPANY"; companyId: string; companyLabel: string }
      | null = {
      kind: "PITCH_MOMENT",
      companyId: ID,
      companyLabel: "Northwind",
      mediaAssetId: PITCH,
      positionSeconds: 62.7,
    };
    setScreenFocusSource(() => focus);
    try {
      expect(currentScreen("/discover")).toEqual({
        route: "DISCOVER",
        companyId: ID,
      });
      expect(currentViewing()).toEqual({
        kind: "PITCH_PLAYBACK",
        companyId: ID,
        mediaAssetId: PITCH,
        positionSeconds: 62,
      });
      expect(
        QVoiceScreenUpdateSchema.safeParse({
          ...currentScreen("/discover"),
          viewing: currentViewing(),
        }).success,
      ).toBe(true);
      // The next card, poster only: still "this company", no moment.
      focus = { kind: "SCREEN_COMPANY", companyId: OTHER, companyLabel: "B" };
      expect(currentScreen("/discover")).toEqual({
        route: "DISCOVER",
        companyId: OTHER,
      });
      expect(currentViewing()).toBeUndefined();
      // A route that names its own company keeps it.
      expect(currentScreen(`/company/${ID}`).companyId).toBe(ID);
      // Nothing in focus, or a page that has gone: the route alone.
      focus = null;
      expect(currentScreen("/discover")).toEqual({ route: "DISCOVER" });
    } finally {
      setScreenFocusSource(null);
    }
    expect(currentScreen("/discover")).toEqual({ route: "DISCOVER" });
  });
});
