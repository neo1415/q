import { describe, expect, it } from "vitest";

import {
  FIT_PARAMETERS,
  fitScoreOutOf10,
  investabilityMethodLabel,
  suitabilityFromFit,
  type FitProfileDto,
} from "../src/index.js";

/**
 * Suitability is the fit's own x/10 × 10, shown exactly where the fit
 * shows its number (3+ known parameters, a band other than Not enough
 * information); otherwise no number. Unknown is never a low number.
 */

function profile(
  outcomes: Partial<
    Record<(typeof FIT_PARAMETERS)[number], "STRONG" | "PARTIAL" | "MISMATCH">
  >,
): FitProfileDto {
  return {
    companyId: "00000000-0000-4000-8000-000000000001",
    configVersion: "ranking-config.v4",
    configLabel: "4",
    band: "NOT_ENOUGH_INFORMATION",
    confidence: "LOW",
    parameters: FIT_PARAMETERS.map((parameter) => ({
      parameter,
      outcome: outcomes[parameter] ?? "UNKNOWN",
      reason: "Reason.",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    })),
    topReasons: [],
    mainMismatch: null,
    hardRule: null,
    computedAt: "2026-10-16T12:00:00.000Z",
  };
}

describe("suitability", () => {
  it("no number from one or two known parameters (metrics audit P0-4)", () => {
    for (const known of [
      { STAGE: "STRONG" as const },
      { STAGE: "STRONG" as const, SECTOR: "STRONG" as const },
    ]) {
      const s = suitabilityFromFit(profile(known));
      expect(s.status).toBe("NOT_ENOUGH_INFORMATION");
      expect(s.score).toBeNull();
      expect(s.coverage.known).toBe(Object.keys(known).length);
      expect(s.missing.length).toBeGreaterThan(0);
    }
  });

  it("never shows a number beside a fit of Not enough information", () => {
    const p = profile({
      STAGE: "STRONG",
      SECTOR: "STRONG",
      GEOGRAPHY: "STRONG",
    });
    expect(p.band).toBe("NOT_ENOUGH_INFORMATION");
    expect(suitabilityFromFit(p).score).toBeNull();
  });

  it("equals the fit's own score where the fit shows one", () => {
    const p = {
      ...profile({
        STAGE: "STRONG",
        SECTOR: "PARTIAL",
        GEOGRAPHY: "MISMATCH",
      }),
      band: "PARTIAL_FIT" as const,
    };
    expect(suitabilityFromFit(p).score).toBe(
      Math.round(Number(fitScoreOutOf10(p)) * 10),
    );
  });

  it("nothing known: no number, never zero", () => {
    const s = suitabilityFromFit(profile({}));
    expect(s.status).toBe("NOT_ENOUGH_INFORMATION");
    expect(s.score).toBeNull();
  });
});

describe("investabilityMethodLabel (metrics audit P1-6)", () => {
  it("names the method version that produced the score", () => {
    expect(
      investabilityMethodLabel("investiq/v2+investability-inputs.v5"),
    ).toBe("FDN InvestIQ v2");
    expect(
      investabilityMethodLabel("investiq/v1+investability-inputs.v1"),
    ).toBe("FDN InvestIQ v1");
    expect(investabilityMethodLabel("unknown")).toBe("FDN InvestIQ");
  });
});
