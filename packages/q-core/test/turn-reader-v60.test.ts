import { describe, expect, it } from "vitest";

import {
  TURN_READER_V59,
  TURN_READER_V60,
  V59_ACT_ON_IS_NOT_OPEN,
  V60_ANSWERING_INTEREST,
  V60_BOARD_ASK,
  TurnReaderV60ResultSchema,
  V60_ASKING_IS_NOT_OPEN,
  V60_SCREENS_ANY_LANGUAGE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA 2026-10-23 (F-36, F-41, F-33), with the exact phrasings: a screen in
 * any language is NAVIGATE; asking about a shown record is a question; an
 * investor's interest is answered, never handed over.
 */
describe("TURN_READER v60", () => {
  it("is the active reader, v59 kept whole plus three readings", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(60);
    expect(TURN_READER_V59.status).toBe("DEPRECATED");
    const added = `${V60_SCREENS_ANY_LANGUAGE}${V60_ASKING_IS_NOT_OPEN}${V60_ANSWERING_INTEREST}${V60_BOARD_ASK}`;
    expect(TURN_READER_V60.template).toContain(
      `${V59_ACT_ON_IS_NOT_OPEN}${added}`,
    );
    expect(TURN_READER_V60.template.replace(added, "")).toBe(
      TURN_READER_V59.template,
    );
    expect(TURN_READER_V60.output.kind).toBe("STRUCTURED");
  });

  it("names each finding's own words, read by meaning", () => {
    expect(V60_SCREENS_ANY_LANGUAGE).toContain(
      '"افتح صفحة الاكتشاف" is NAVIGATE DISCOVER',
    );
    expect(V60_SCREENS_ANY_LANGUAGE).toMatch(/named in any language/u);
    expect(V60_ASKING_IS_NOT_OPEN).toContain(
      "tell me more about the second one",
    );
    expect(V60_ASKING_IS_NOT_OPEN).toMatch(/open is null/u);
    expect(V60_ANSWERING_INTEREST).toContain(
      "reply to Rift Valley Seed Fund: accept their interest",
    );
    expect(V60_ANSWERING_INTEREST).toMatch(/handOver is null/u);
  });

  it("reads boardAsk for their own work board, with the work-board lane's cases (S1)", () => {
    // The lane's eval cases: each phrasing is named in the rule, by meaning.
    for (const said of [
      "save that plan to my board",
      "put this on my board",
      "keep Kestrel on my board",
      "break it into tasks",
      "save the plan and split it into to-dos",
      "work on those items for me",
      "start on the hiring task",
      "what's on my board?",
      "guarda esto en mi tablero",
    ]) {
      expect(V60_BOARD_ASK, said).toContain(said);
    }
    expect(V60_BOARD_ASK).toMatch(/BREAKDOWN over SAVE/u);
    expect(V60_BOARD_ASK).toMatch(/GateQ inbox or board/u);
    // Null-safe: absent or malformed reads as null, never costs the reading.
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(TurnReaderV60ResultSchema.parse(base).boardAsk).toBeNull();
    expect(
      TurnReaderV60ResultSchema.parse({ ...base, boardAsk: "PIN" }).boardAsk,
    ).toBeNull();
    expect(
      TurnReaderV60ResultSchema.parse({ ...base, boardAsk: "BREAKDOWN" })
        .boardAsk,
    ).toBe("BREAKDOWN");
  });
});
