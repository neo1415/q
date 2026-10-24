import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V7,
  TURN_SKIM_V8,
  TurnSkimV8ResultSchema,
  V8_KINDS,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Owner's own conversation (2026-10-24): "three Saudi family offices that
 * back fintech" must search for family offices, by meaning. The skim says
 * the kinds of investor as said; a company named as whom they are for is
 * never a search term.
 */
describe("TURN_SKIM v8: the kinds of investor asked for", () => {
  it("is the active skim", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    expect(active.definition.version).toBe(8);
    expect(TURN_SKIM_V7.status).toBe("DEPRECATED");
    expect(TURN_SKIM_V8.template).toContain(V8_KINDS);
  });

  it("reads kinds, and is lenient when absent or malformed", () => {
    const investors = {
      regions: ["Saudi"],
      sector: "fintech",
      stage: null,
      aboutMyCompany: false,
    };
    const base = {
      kind: "DISCOVER_INVESTORS",
      confidence: "HIGH",
      count: 3,
    };
    expect(
      TurnSkimV8ResultSchema.parse({
        ...base,
        investors: { ...investors, kinds: ["family offices"] },
      }).investors?.kinds,
    ).toEqual(["family offices"]);
    expect(
      TurnSkimV8ResultSchema.parse({ ...base, investors }).investors?.kinds,
    ).toEqual([]);
    expect(
      TurnSkimV8ResultSchema.parse({
        ...base,
        investors: { ...investors, kinds: "family offices" },
      }).investors?.kinds,
    ).toEqual([]);
  });
});
