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
  it("defaults to the product specification §6.7", () => {
    expect(AnalyticsSettingsSchema.parse(ANALYTICS_SETTINGS_DEFAULTS)).toEqual(
      ANALYTICS_SETTINGS_DEFAULTS,
    );
    for (const [key, text] of Object.entries(ANALYTICS_SETTING_DESCRIPTIONS)) {
      expect(
        text.beyondSpec(
          ANALYTICS_SETTINGS_DEFAULTS[key as keyof AnalyticsSettings],
        ),
        key,
      ).toBe(false);
    }
  });

  it("never lets the Anonymous override exist without paid reveal", () => {
    expect(with_({ paidRevealOverridesAnonymous: true })).toBe(false);
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
