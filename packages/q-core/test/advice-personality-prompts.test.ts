import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V17,
  COMPANY_ANALYST_V18,
  createDefaultPromptRegistry,
  Q_SYSTEM_V2,
  Q_SYSTEM_VOICE_V2,
  Q_VOICE_SECTION,
  V18_ADVICE_LINE,
  V18_MANDATE_LINE,
  V18_NO_SCORE,
  VOICE_V2_MANNER,
} from "../src/index.js";

/**
 * Autopilot P2/P3 (2026-10-06): fit as Capital Q's computed score out of 10
 * (ADR 0059) with advice that leads with a recommendation, and Q's own
 * manner in both charters.
 */
describe("COMPANY_ANALYST v18: fit out of 10 and sharper advice", () => {
  const registry = createDefaultPromptRegistry();

  it("was the active analyst until v19, on v17's schema, with the three lines", () => {
    const active = registry.getActive("COMPANY_ANALYST").definition;
    expect(active.version).toBe(20);
    expect(COMPANY_ANALYST_V18.output).toBe(COMPANY_ANALYST_V17.output);
    const template = COMPANY_ANALYST_V18.template;
    expect(template).toContain(V18_NO_SCORE);
    expect(template).toContain(V18_MANDATE_LINE);
    expect(template).toContain(V18_ADVICE_LINE);
    // v17's blanket "No score or verdict" is gone; percentages stay banned.
    expect(template).not.toContain("No score or verdict.");
    expect(V18_MANDATE_LINE).toContain("never %");
    expect(V18_MANDATE_LINE).toContain("fit_top_candidates");
  });

  it("asks for a recommendation, the reasons, the biggest risk and the next step", () => {
    for (const part of [
      "recommendation first",
      "reasons",
      "biggest risk",
      "next step",
      "inference",
    ]) {
      expect(V18_ADVICE_LINE).toContain(part);
    }
  });
});

describe("Q_SYSTEM v2 / Q_SYSTEM_VOICE v2: one personality in text and voice", () => {
  const registry = createDefaultPromptRegistry();

  it("carry Q's manner (Q_SYSTEM v2 active; the voice charter is v3, which keeps it)", () => {
    expect(registry.getActive("Q_SYSTEM").definition.version).toBe(2);
    expect(registry.getActive("Q_SYSTEM_VOICE").definition.version).toBe(3);
    expect(Q_SYSTEM_V2.template).toContain(Q_VOICE_SECTION);
    expect(Q_SYSTEM_VOICE_V2.template).toContain(VOICE_V2_MANNER);
    // The person's chosen personality sets the register, not the substance.
    expect(Q_VOICE_SECTION).toContain("never the substance");
    expect(VOICE_V2_MANNER).toContain("never the substance");
  });

  it("stays lean: the manner adds little to either charter", () => {
    expect(Q_VOICE_SECTION.length).toBeLessThan(500);
    expect(VOICE_V2_MANNER.length).toBeLessThan(260);
  });
});
