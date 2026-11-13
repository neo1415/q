import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  readsAsGo,
  readsAsNoNavigation,
  TURN_NAVIGATION_MODES,
  TURN_READER_V82,
  TURN_READER_V83,
  TurnNavigationIntentSchema,
  TurnReaderV83ResultSchema,
  V83_NAVIGATION,
  V83_NAVIGATION_BEFORE,
} from "../src/index.js";

/**
 * TURN_READER v83 (C10, owner directive 13 Nov 2026): whether a turn asks
 * to be taken somewhere is read by meaning in the reader's one pass, as a
 * typed navigation intent -- never decided by word rules or by a page-move
 * decision that runs on every turn.
 */
describe("TURN_READER v83", () => {
  it("is active: v82 with one NAVIGATION paragraph before REFERENCES BY NAME, on v83's schema", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(83);
    expect(registry.get("TURN_READER", 82)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV83ResultSchema,
    );
    expect(TURN_READER_V83.variables).toEqual(TURN_READER_V82.variables);
    expect(TURN_READER_V83.template.replace(`\n${V83_NAVIGATION}`, "")).toBe(
      TURN_READER_V82.template,
    );
    expect(TURN_READER_V83.template).toContain(
      `${V83_NAVIGATION}${V83_NAVIGATION_BEFORE}`,
    );
  });

  it("names the three modes, negation, parts and the live misreadings by meaning", () => {
    for (const said of [
      "always write navigation",
      "in any words and any language",
      "mode GO",
      "mode OFFER_ONLY",
      "mode NONE for everything else, even when a page also shows the answer",
      '"what stage is Ledgerline at?"',
      "Let me see it visually",
      '"now do the same for Silo Credit"',
      '"show me my pipeline"',
      '"take me to my pipeline"',
      "negated is true",
      '"don\'t open it, just tell me"',
      "mode is then NONE",
      "parts holds each ask",
    ]) {
      expect(V83_NAVIGATION).toContain(said);
    }
  });

  it("parses a navigation intent, and defaults to not read", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(TurnReaderV83ResultSchema.parse(base).navigation).toBeNull();
    for (const mode of TURN_NAVIGATION_MODES) {
      expect(
        TurnReaderV83ResultSchema.parse({
          ...base,
          navigation: { mode, negated: false },
        }).navigation,
      ).toEqual({ mode, negated: false });
    }
    // A malformed intent is no intent (code's fallback), never a lost reading.
    expect(
      TurnReaderV83ResultSchema.parse({ ...base, navigation: "go" }).navigation,
    ).toBeNull();
    // A missing or unknown mode inside reads as NONE, never as GO.
    expect(TurnNavigationIntentSchema.parse({})).toEqual({
      mode: "NONE",
      negated: false,
    });
    expect(TurnNavigationIntentSchema.parse({ mode: "JUMP" }).mode).toBe(
      "NONE",
    );
  });

  it("GO moves only when not negated; NONE and negated ask for nothing; null is not read", () => {
    expect(readsAsGo({ mode: "GO", negated: false })).toBe(true);
    expect(readsAsGo({ mode: "GO", negated: true })).toBe(false);
    expect(readsAsGo({ mode: "OFFER_ONLY", negated: false })).toBe(false);
    expect(readsAsGo(null)).toBe(false);
    expect(readsAsNoNavigation({ mode: "NONE", negated: false })).toBe(true);
    expect(readsAsNoNavigation({ mode: "GO", negated: true })).toBe(true);
    expect(readsAsNoNavigation({ mode: "OFFER_ONLY", negated: false })).toBe(
      false,
    );
    expect(readsAsNoNavigation(null)).toBe(false);
    expect(readsAsNoNavigation(undefined)).toBe(false);
  });
});
