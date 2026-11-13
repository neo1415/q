import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  readsAsContext,
  readsAsGo,
  readsAsNoNavigation,
  TURN_NAVIGATION_MODES_V84,
  TURN_READER_V83,
  TURN_READER_V84,
  TurnNavigationIntentV84Schema,
  TurnReaderV84ResultSchema,
  TurnReaderV87ResultSchema,
  V83_NAVIGATION,
  V84_NAVIGATION,
} from "../src/index.js";

/**
 * TURN_READER v84 (C10 owner correction, 13 Nov 2026): v83's navigation
 * intent plus CONTEXT, so Q keeps bringing the page the conversation is
 * about into the adjacent workspace pane without a literal "open".
 */
describe("TURN_READER v84", () => {
  it("v83 with its NAVIGATION paragraph replaced (v87 is active, on its schema)", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(87);
    expect(registry.get("TURN_READER", 83)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV87ResultSchema,
    );
    expect(TURN_READER_V84.variables).toEqual(TURN_READER_V83.variables);
    expect(TURN_READER_V84.template).not.toContain(V83_NAVIGATION);
    expect(
      TURN_READER_V84.template.replace(V84_NAVIGATION, V83_NAVIGATION),
    ).toBe(TURN_READER_V83.template);
  });

  it("names the four modes, the contextual pages, the inline cases and negation", () => {
    for (const said of [
      "always write navigation",
      "in any words and any language",
      "mode GO",
      "mode CONTEXT when, without asking to go anywhere",
      "materially help what they are doing now: a new topic or task, not a passing mention",
      '"which of my deals are stalled?"',
      '"who should I follow up with this week?"',
      "A follow-up about the subject already being worked on is CONTEXT too",
      "mode OFFER_ONLY",
      "mode NONE when the answer is best given inline",
      "research on the public web",
      '"how has Ledgerline\'s MRR moved since June? Let me see it visually"',
      '"now do the same for Silo Credit"',
      '"what stage is Ledgerline at?" may be OFFER_ONLY or NONE',
      '"don\'t move the page"',
      "mode is then NONE",
      "parts holds each ask",
      '"show me Clinicrest\'s deck"',
    ]) {
      expect(V84_NAVIGATION).toContain(said);
    }
  });

  it("parses all four modes; a missing or unknown mode is NONE; a malformed intent is not read", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(TurnReaderV84ResultSchema.parse(base).navigation).toBeNull();
    for (const mode of TURN_NAVIGATION_MODES_V84) {
      expect(
        TurnReaderV84ResultSchema.parse({
          ...base,
          navigation: { mode, negated: false },
        }).navigation,
      ).toEqual({ mode, negated: false });
    }
    expect(
      TurnReaderV84ResultSchema.parse({ ...base, navigation: 7 }).navigation,
    ).toBeNull();
    expect(TurnNavigationIntentV84Schema.parse({ mode: "JUMP" }).mode).toBe(
      "NONE",
    );
  });

  it("CONTEXT is neither GO nor no navigation; negated CONTEXT is no navigation", () => {
    const context = { mode: "CONTEXT" as const, negated: false };
    expect(readsAsContext(context)).toBe(true);
    expect(readsAsGo(context)).toBe(false);
    expect(readsAsNoNavigation(context)).toBe(false);
    expect(readsAsContext({ ...context, negated: true })).toBe(false);
    expect(readsAsNoNavigation({ ...context, negated: true })).toBe(true);
    expect(readsAsContext(null)).toBe(false);
  });
});
