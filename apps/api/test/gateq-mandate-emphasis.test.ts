import { describe, expect, it } from "vitest";

import type { InvestorMandateSnapshot } from "@capital-q/investors";

import { emphasisFromMandate } from "../src/gateq/mandate-emphasis.js";

/**
 * Live 2026-10-17: the Partech Africa test mandate (shape copied from the
 * hosted record; ids synthetic). Only dimensions cross into the interview.
 */
const constraint = (
  dimension: string,
  importance: string,
  values: readonly string[],
  extra: { isHardExclusion?: boolean; automatedUse?: string } = {},
) => ({
  id: "c",
  tenantId: "t",
  mandateId: "m",
  dimension,
  operator: "IN",
  value: { kind: "codes", values },
  importance,
  isHardExclusion: extra.isHardExclusion ?? false,
  automatedUse: extra.automatedUse ?? "ELIGIBLE",
});

const partech = {
  constraints: [
    constraint("stage", "MUST", ["seed", "series_a", "series_b"]),
    constraint("investment_role", "STRONG", ["lead", "co_invest"]),
    constraint("founder.business_attribute", "NICE", [
      "technical_founding_capability",
    ]),
    constraint("green_flag", "STRONG", [
      "strong_revenue_growth",
      "enterprise_customers",
    ]),
    constraint(
      "red_flag",
      "HARD_EXCLUSION",
      ["gambling", "tobacco", "weapons", "adult_content"],
      { isHardExclusion: true },
    ),
    constraint("custom.text", "STRONG", [], { automatedUse: "MANUAL_ONLY" }),
  ],
  taxonomyPreferences: [
    {
      vocabularyCode: "industry",
      preferenceStrength: "STRONG",
      isExclusion: false,
    },
    {
      vocabularyCode: "business_model",
      preferenceStrength: "STRONG",
      isExclusion: false,
    },
    {
      vocabularyCode: "customer_type",
      preferenceStrength: "STRONG",
      isExclusion: false,
    },
  ],
} as unknown as InvestorMandateSnapshot;

describe("emphasisFromMandate", () => {
  it("turns Partech's mandate into what to ask about, most important first", () => {
    expect(emphasisFromMandate(partech)).toEqual([
      "claims.revenue",
      "claims.traction",
      "company.customers",
      "company.business_model",
      "company.team",
    ]);
  });

  it("never reads exclusions, avoided preferences or the investor's own free text", () => {
    const onlyExcluded = {
      constraints: [
        constraint("green_flag", "AVOID", ["strong_revenue_growth"]),
        constraint("green_flag", "STRONG", ["high_retention"], {
          automatedUse: "MANUAL_ONLY",
        }),
      ],
      taxonomyPreferences: [
        {
          vocabularyCode: "business_model",
          preferenceStrength: "STRONG",
          isExclusion: true,
        },
      ],
    } as unknown as InvestorMandateSnapshot;
    expect(emphasisFromMandate(onlyExcluded)).toEqual([]);
  });

  it("carries no mandate value, only dimension names", () => {
    expect(JSON.stringify(emphasisFromMandate(partech))).not.toMatch(
      /seed|lead|gambling|strong_revenue_growth|technical/,
    );
  });
});
