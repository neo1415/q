import { describe, expect, it } from "vitest";

import { mandateStatement, ownProfileFact } from "../src/q/own-profile.js";

/**
 * Owner 19 Nov 2026 (run abc106b5): an investor whose sectors were set was
 * told to state their sectors and geography. Their declared preferences
 * (sectors, customer types, geographies) had reached Q as one unlabelled
 * "focus" list. Each is now said under what it is, and the profile says
 * what it lists is already declared. Unknown stays unknown: nothing is
 * claimed for a vocabulary they did not declare.
 */

const pref = (vocabularyCode: string, canonicalCode: string) => ({
  vocabularyCode,
  canonicalCode,
  preferenceStrength: "NICE",
  isExclusion: false,
});

// The shape of the owner's live mandate (codes only, no personal data).
const READ = {
  displayName: "Example Capital",
  investorType: "ANGEL",
  mandates: [
    {
      status: "ACTIVE",
      cheque: { currency: "EUR", min: "50000", max: "100000000" },
      stage: { minStageCode: "pre_seed", maxStageCode: "series_a" },
      constraints: [],
      taxonomyPreferences: [
        pref("industry", "enterprise_software"),
        pref("industry", "fintech"),
        pref("business_model", "b2b_saas"),
        pref("customer_type", "consumer"),
        pref("customer_type", "enterprise"),
        pref("geography", "africa"),
        pref("geography", "united_kingdom"),
        { ...pref("industry", "insurance"), isExclusion: true },
      ],
    },
  ],
};

describe("their declared profile names each preference as what it is", () => {
  it("says sectors, business models, customers and geographies apart", () => {
    const statement = ownProfileFact(READ)?.statement ?? "";
    expect(statement).toContain("sectors enterprise_software, fintech");
    expect(statement).toContain("business models b2b_saas");
    expect(statement).toContain("customer types consumer, enterprise");
    expect(statement).toContain("geographies africa, united_kingdom");
    expect(statement).toContain("excludes insurance");
    expect(statement).not.toMatch(/\bfocus\b/u);
    expect(statement).toContain(
      "already on their profile: never ask or advise them to add or state it",
    );
  });

  it("claims no sectors when none were declared, and keeps an unknown vocabulary", () => {
    const statement =
      mandateStatement({
        mandates: [
          {
            stage: { minStageCode: "seed", maxStageCode: null },
            taxonomyPreferences: [
              pref("geography", "kenya"),
              pref("theme", "climate"),
            ],
          },
        ],
      }) ?? "";
    expect(statement).not.toContain("sectors");
    expect(statement).toContain("geographies kenya");
    expect(statement).toContain("focus climate");
  });

  it("an empty mandate is still said to have no criteria, never 'already declared'", () => {
    const statement =
      ownProfileFact({
        displayName: "Example Capital",
        mandates: [{ status: "DRAFT", taxonomyPreferences: [] }],
      })?.statement ?? "";
    expect(statement).toContain("no criteria declared yet");
    expect(statement).not.toContain("already on their profile");
  });
});
