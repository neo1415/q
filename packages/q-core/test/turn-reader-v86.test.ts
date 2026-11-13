import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V85,
  TURN_READER_V86,
  TurnCompanyMediaAskSchema,
  TurnReaderV86ResultSchema,
  V85_NAVIGATION_DESTINATION,
  V86_COMPANY_MEDIA,
} from "../src/index.js";

/**
 * TURN_READER v86 (A8, owner directive 13 Nov 2026): whether the answer
 * shows the company it is about with its own picture, and its pitch when
 * they ask to watch it, read by meaning -- never by keyword rules.
 */
describe("TURN_READER v86", () => {
  it("is v85 with one COMPANY MEDIA paragraph after NAVIGATION DESTINATION, on v86's schema (deprecated by v87)", () => {
    const registry = createDefaultPromptRegistry();
    const active = { ...TURN_READER_V86 };
    expect(registry.get("TURN_READER", 86)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("TURN_READER", 85)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV86ResultSchema,
    );
    expect(TURN_READER_V86.variables).toEqual(TURN_READER_V85.variables);
    expect(TURN_READER_V86.template.replace(`\n${V86_COMPANY_MEDIA}`, "")).toBe(
      TURN_READER_V85.template,
    );
    expect(TURN_READER_V86.template).toContain(
      `${V85_NAVIGATION_DESTINATION}\n${V86_COMPANY_MEDIA}`,
    );
  });

  it("names the pitch and picture cases by meaning, in any language, with the negatives", () => {
    for (const said of [
      "companyMedia.pitch true when they ask to see, watch or play",
      "in any language",
      '"show me their pitch"',
      '"can I watch Clinicrest\'s pitch?"',
      "is not a request to watch it",
      "companyMedia.picture true when the turn asks about a company as a whole",
      '"tell me about Ledgerline"',
      "false for one figure or fact",
      "Leave companyMedia out when both would be false",
    ]) {
      expect(V86_COMPANY_MEDIA).toContain(said);
    }
  });

  it("parses the ask leniently: a malformed value is none, never a lost reading", () => {
    expect(TurnCompanyMediaAskSchema.parse({ pitch: true })).toEqual({
      pitch: true,
      picture: false,
    });
    const base = {
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
    };
    expect(TurnReaderV86ResultSchema.parse(base).companyMedia).toBeNull();
    expect(
      TurnReaderV86ResultSchema.parse({ ...base, companyMedia: "yes please" })
        .companyMedia,
    ).toBeNull();
    expect(
      TurnReaderV86ResultSchema.parse({
        ...base,
        companyMedia: { pitch: "maybe", picture: true },
      }).companyMedia,
    ).toEqual({ pitch: false, picture: true });
  });
});
