// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BillingFeatureStandingDto } from "@capital-q/contracts";

import { EntitlementNotice } from "@/features/billing/entitlement-notice";
import {
  allowanceLine,
  remainingOf,
  resetLine,
  sourceLine,
  usedPercent,
} from "@/features/billing/plan-words";

/**
 * BILLING (ADR 0034): the plan page and gated features say the plan in
 * words -- counts in text, never colour alone -- and a refusal always
 * offers the way to the plans instead of hiding the feature.
 */

const REHEARSALS: BillingFeatureStandingDto = {
  key: "q.rehearsals",
  name: "Rehearsals",
  description: "Rehearse a meeting.",
  kind: "MONTHLY",
  unitSingular: "rehearsal",
  unitPlural: "rehearsals",
  included: true,
  limit: 20,
  used: 3,
  resetsAt: "2026-11-01T00:00:00.000Z",
  overridden: false,
};

describe("plan words", () => {
  it("says use, what is left and the reset", () => {
    expect(allowanceLine(REHEARSALS)).toBe(
      "3 of 20 rehearsals used this month",
    );
    expect(remainingOf(REHEARSALS)).toBe(17);
    expect(usedPercent(REHEARSALS)).toBe(15);
    expect(resetLine(REHEARSALS)).toBe("Resets on 1 November");
  });

  it("says unlimited, a single unit and not included plainly", () => {
    expect(allowanceLine({ ...REHEARSALS, limit: null })).toBe(
      "Unlimited · 3 rehearsals this month",
    );
    expect(allowanceLine({ ...REHEARSALS, limit: 1, used: 0 })).toBe(
      "0 of 1 rehearsal used this month",
    );
    expect(allowanceLine({ ...REHEARSALS, included: false, limit: null })).toBe(
      "Not included in your plan",
    );
    expect(
      allowanceLine({
        ...REHEARSALS,
        key: "gateq.gateways",
        kind: "COUNT",
        unitSingular: "gateway",
        unitPlural: "gateways",
        limit: 3,
        used: 1,
        resetsAt: null,
      }),
    ).toBe("1 of 3 gateways");
  });

  it("says a plan value as a number, never a meter (BILLING-2)", () => {
    const volume: BillingFeatureStandingDto = {
      ...REHEARSALS,
      key: "discover.recommendation_volume",
      name: "Recommendations per feed",
      kind: "VALUE",
      unitSingular: "recommendation",
      unitPlural: "recommendations",
      limit: 200,
      used: null,
      resetsAt: null,
    };
    expect(allowanceLine(volume)).toBe("Up to 200 recommendations");
    expect(usedPercent(volume)).toBeNull();
  });

  it("names where the plan came from", () => {
    expect(
      sourceLine({
        source: "LAUNCH_DEFAULT",
        planName: "Launch",
        endsAt: null,
      }),
    ).toBe("Launch plan · free while Capital Q launches");
    expect(
      sourceLine({
        source: "TRIAL",
        planName: "Fund",
        endsAt: "2026-10-15T00:00:00.000Z",
      }),
    ).toBe("Fund trial until 15 October");
  });
});

describe("EntitlementNotice", () => {
  it("says the plan's own sentence and offers the plans", () => {
    render(
      <EntitlementNotice
        entitlement={{
          feature: "q.rehearsals",
          featureName: "Rehearsals",
          reason: "LIMIT_REACHED",
          planKey: "free",
          planName: "Free",
          limit: 1,
          used: 1,
          resetsAt: "2026-11-01T00:00:00.000Z",
          upgradePath: "/settings/plan",
          message:
            "Your Free plan includes 1 rehearsal a month and you've used 1. It resets on 1 November. You can see what each plan includes in Settings → Plan.",
        }}
      />,
    );
    expect(
      screen.getByText("You've used this month's rehearsals"),
    ).toBeTruthy();
    expect(screen.getByText(/includes 1 rehearsal a month/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See plans" }).getAttribute("href"),
    ).toBe("/settings/plan");
  });
});
