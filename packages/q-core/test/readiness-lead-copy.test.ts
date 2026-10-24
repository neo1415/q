import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  READINESS_LEAD_ARABIC_STEPS,
  readinessLeadCopy,
  V52_NEXT_STEPS,
} from "../src/index.js";

describe("the readiness lead's copy (lane ml)", () => {
  it("is English by default and Arabic when chosen", () => {
    expect(readinessLeadCopy(null).planHeading).toMatch(/^What to do next/u);
    expect(readinessLeadCopy("en").step("Choose your sector")).toBe(
      "Choose your sector",
    );
    expect(readinessLeadCopy("ar").planHeading).toBe(
      "الخطوات التالية لجولة التمويل، الأهم أولاً:",
    );
    expect(readinessLeadCopy("ar").step("Choose your sector")).toBe(
      "اختر قطاعك",
    );
    // A trailing full stop is the same step, and keeps its stop.
    expect(readinessLeadCopy("ar").step("Start identity verification.")).toBe(
      "ابدأ توثيق الهوية.",
    );
    expect(readinessLeadCopy("ar").step("Something new")).toBe("Something new");
  });

  it("keeps the instrument names in English inside the Arabic", () => {
    expect(
      readinessLeadCopy("ar").step(
        "Choose SAFE, note or equity, and the cap or valuation if set.",
      ),
    ).toContain("SAFE");
    expect(READINESS_LEAD_ARABIC_STEPS.length).toBeGreaterThanOrEqual(56);
  });
});

describe("TURN_READER v52: next steps read by meaning", () => {
  it("is the active reader and carries the nextSteps rule", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(63);
    expect(active.definition.template).toContain(V52_NEXT_STEPS);
    expect(V52_NEXT_STEPS).toMatch(/false for every other question/u);
    expect(V52_NEXT_STEPS).toMatch(/explain a SAFE/u);
  });
});
