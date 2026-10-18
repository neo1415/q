import { describe, expect, it } from "vitest";

import {
  ARABIC_ONBOARDING_COPY,
  ENGLISH_ONBOARDING_COPY,
  ONBOARDING_COPY_CATALOGS,
  onboardingCopyFor,
} from "../src/index.js";

/**
 * Lane ml: Arabic onboarding copy is one more catalog in ob1's
 * locale-keyed table, never a parallel one, and it makes the same promises
 * as the English copy.
 */
describe("Arabic onboarding copy", () => {
  it("is chosen for any Arabic locale; others fall back to English", () => {
    expect(ONBOARDING_COPY_CATALOGS["ar"]).toBe(ARABIC_ONBOARDING_COPY);
    expect(onboardingCopyFor("ar")).toBe(ARABIC_ONBOARDING_COPY);
    expect(onboardingCopyFor("ar-AE")).toBe(ARABIC_ONBOARDING_COPY);
    expect(onboardingCopyFor("en-GB")).toBe(ENGLISH_ONBOARDING_COPY);
    expect(onboardingCopyFor("fr")).toBe(ENGLISH_ONBOARDING_COPY);
  });

  it("asks before saving and keeps names and figures exactly as recorded", () => {
    const line = ARABIC_ONBOARDING_COPY.confirmGroup({
      items: [
        { label: "Company", display: "Harbourline Cargo" },
        { label: "Raise", display: "USD 2.5m" },
      ],
      sources: ["DOCUMENT"],
    });
    expect(line).toContain("Harbourline Cargo");
    expect(line).toContain("USD 2.5m");
    expect(line).toContain("من مستندك");
    expect(line).toMatch(/هل أحفظ/u);
  });

  it("says saved only of what was saved, and nothing when nothing was", () => {
    expect(ARABIC_ONBOARDING_COPY.saved([])).toBe("لم يُحفظ شيء جديد.");
    expect(ARABIC_ONBOARDING_COPY.saved(["Sector", "Stage"])).toBe(
      "تم الحفظ: Sector وStage.",
    );
  });

  it("acknowledges a private document without claiming to have read it", () => {
    const line = ARABIC_ONBOARDING_COPY.documentAcknowledged({
      filename: "cap-table.xlsx",
      outstanding: [],
    });
    expect(line).toContain("cap-table.xlsx");
    expect(line).toContain("لم أقرأ محتواه");
  });

  it("proposes public findings as a question, marked unverified at source", () => {
    expect(
      ARABIC_ONBOARDING_COPY.researchProposal({
        label: "Description",
        display: "Cold-chain logistics",
        where: "on their website",
      }),
    ).toMatch(/هل ما زال دقيقاً؟$/u);
    expect(
      ARABIC_ONBOARDING_COPY.confirmGroup({
        items: [{ label: "Description", display: "x" }],
        sources: ["PUBLIC_RESEARCH"],
      }),
    ).toContain("غير موثّقة");
  });
});
