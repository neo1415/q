import { describe, expect, it } from "vitest";

import {
  TURN_READER_V63,
  TURN_READER_V64,
  TurnReaderV64ResultSchema,
  V64_REHEARSAL_OPEN,
  V64_REHEARSE_IS_NOT_PREP,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA F-98 (live 2026-10-24, founder): "Let us rehearse my call with Savanna
 * Seed Partners" was read as meetingPrep and answered with the prep brief
 * again. A rehearsal is a record they ask to open, by meaning.
 */
describe("TURN_READER v64: a rehearsal they ask for is opened, not prepared", () => {
  it("is the active reader: v63 plus REHEARSAL and the meetingPrep exception", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(64);
    expect(TURN_READER_V63.status).toBe("DEPRECATED");
    expect(TURN_READER_V64.template).toContain(V64_REHEARSAL_OPEN);
    expect(TURN_READER_V64.template).toContain(V64_REHEARSE_IS_NOT_PREP);
    expect(V64_REHEARSAL_OPEN).toMatch(/by what it means in any words/u);
    expect(V64_REHEARSE_IS_NOT_PREP).toMatch(/is not meetingPrep/u);
  });

  it("reads REHEARSAL as a record to open, and keeps every earlier kind", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    for (const open of ["REHEARSAL", "MEETING", "CHAT", "PITCH"]) {
      expect(
        TurnReaderV64ResultSchema.parse({
          ...base,
          reference: { open, name: "Savanna Seed Partners" },
        }).reference?.open,
      ).toBe(open);
    }
  });
});
