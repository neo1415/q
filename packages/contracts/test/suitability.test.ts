import { describe, expect, it } from "vitest";

import {
  FIT_PARAMETERS,
  fitScoreOutOf10,
  suitabilityFromFit,
  type FitProfileDto,
} from "../src/index.js";

/**
 * ADR 0075: Suitability is a number whenever any mandate parameter is
 * known, labelled with its coverage; it equals the fit's x/10 × 10 where
 * the fit shows one; unknown is never a low number.
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
  it("shows a number with coverage when only one parameter is known", () => {
    const s = suitabilityFromFit(profile({ STAGE: "STRONG" }));
    expect(s.status).toBe("SCORED");
    expect(s.score).toBe(100);
    expect(s.coverage).toEqual({ known: 1, applicable: 9 });
    expect(s.missing.length).toBeGreaterThan(0);
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
