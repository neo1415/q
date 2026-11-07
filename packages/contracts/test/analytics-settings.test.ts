import { describe, expect, it } from "vitest";

import {
  ANALYTICS_SETTING_DESCRIPTIONS,
  ANALYTICS_SETTINGS_DEFAULTS,
  AnalyticsSettingsSchema,
  type AnalyticsSettings,
} from "../src/index.js";

const with_ = (patch: Partial<AnalyticsSettings>) =>
  AnalyticsSettingsSchema.safeParse({
    ...ANALYTICS_SETTINGS_DEFAULTS,
    ...patch,
  }).success;

describe("analytics settings (Q Workspace §8)", () => {
  it("defaults to §6.7 except the owner's Founder Pro viewer identity, which says so", () => {
    expect(AnalyticsSettingsSchema.parse(ANALYTICS_SETTINGS_DEFAULTS)).toEqual(
      ANALYTICS_SETTINGS_DEFAULTS,
    );
    const beyond = Object.entries(ANALYTICS_SETTING_DESCRIPTIONS)
      .filter(([key, text]) =>
        text.beyondSpec(
          ANALYTICS_SETTINGS_DEFAULTS[key as keyof AnalyticsSettings],
        ),
      )
      .map(([key]) => key);
    expect(beyond).toEqual(["paidIdentityReveal"]);
    expect(ANALYTICS_SETTINGS_DEFAULTS).toMatchObject({
      paidRevealOverridesAnonymous: false,
      perPersonPassiveAnalytics: false,
      passiveViewNotifications: false,
      headlineFloor: 3,
      sliceFloor: 5,
      passiveBatch: "WEEKLY",
    });
    expect(
      ANALYTICS_SETTING_DESCRIPTIONS.paidRevealOverridesAnonymous.locked,
    ).toBe(true);
  });

  it("never lets a floor go below 3 for totals or 5 for breakdowns", () => {
    expect(with_({ headlineFloor: 2 })).toBe(false);
    expect(with_({ sliceFloor: 4 })).toBe(false);
    expect(with_({ headlineFloor: 10, sliceFloor: 12 })).toBe(true);
  });

  it("never lets the Anonymous override exist without paid reveal", () => {
    expect(
      with_({ paidIdentityReveal: false, paidRevealOverridesAnonymous: true }),
    ).toBe(false);
    expect(
      with_({ paidIdentityReveal: true, paidRevealOverridesAnonymous: true }),
    ).toBe(true);
  });

  it("always allows the default and anything more private", () => {
    expect(with_({ allowedVisibilities: ["ORGANISATION_ONLY"] })).toBe(false);
    expect(
      with_({ allowedVisibilities: ["ORGANISATION_ONLY", "ANONYMOUS"] }),
    ).toBe(true);
    expect(
      with_({
        defaultVisibility: "FULL_IDENTITY",
        allowedVisibilities: ["FULL_IDENTITY", "ANONYMOUS"],
      }),
    ).toBe(false);
    expect(
      with_({
        allowedVisibilities: ["ANONYMOUS", "ANONYMOUS", "ORGANISATION_ONLY"],
      }),
    ).toBe(false);
  });

  it("marks what goes beyond §6.7", () => {
    const beyond = ANALYTICS_SETTING_DESCRIPTIONS;
    expect(beyond.namedPassiveViewers.beyondSpec(true)).toBe(true);
    expect(beyond.paidIdentityReveal.beyondSpec(true)).toBe(true);
    expect(beyond.paidRevealOverridesAnonymous.beyondSpec(true)).toBe(true);
    expect(beyond.perPersonPassiveAnalytics.beyondSpec(true)).toBe(true);
    expect(beyond.passiveViewNotifications.beyondSpec(true)).toBe(true);
    expect(beyond.defaultVisibility.beyondSpec("FULL_IDENTITY")).toBe(true);
  });
});
