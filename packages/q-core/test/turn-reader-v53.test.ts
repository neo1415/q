import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  TURN_READER_V52,
  TURN_READER_V53,
  V52_NEXT_STEPS,
  V53_Q_PITCH,
  createDefaultPromptRegistry,
} from "../src/index.js";

/** Q Pitch v6 (owner 2026-10-16): the tour starts from a request, by meaning. */
describe("TURN_READER v53: Q_PITCH read by meaning", () => {
  it("is the active reader, on top of v52's rules (lane ml's nextSteps kept)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(53);
    expect(TURN_READER_V52.status).toBe("DEPRECATED");
    expect(TURN_READER_V53.template).toContain(V52_NEXT_STEPS);
    expect(TURN_READER_V53.template).toContain(V53_Q_PITCH);
    expect(TURN_READER_V53.template.replace(V53_Q_PITCH, "")).toBe(
      TURN_READER_V52.template,
    );
  });

  it("names Q_PITCH, a destination the contract accepts", () => {
    expect(Q_NAVIGATE_DESTINATIONS).toContain("Q_PITCH");
    expect(V53_Q_PITCH).toMatch(/destination Q_PITCH/u);
  });

  it("is read from meaning in any language, with the pitch-deck questions excluded", () => {
    expect(V53_Q_PITCH).toMatch(/in any words and any language/u);
    expect(V53_Q_PITCH).toMatch(/présente-nous Capital Q/u);
    expect(V53_Q_PITCH).toMatch(/what is a pitch deck\?/u);
    expect(V53_Q_PITCH).toMatch(/It is not Q_PITCH/u);
  });
});
