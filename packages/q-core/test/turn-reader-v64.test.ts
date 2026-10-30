import { describe, expect, it } from "vitest";

import {
  TURN_READER_V63,
  TURN_READER_V64,
  TurnReaderV64ResultSchema,
  V64_REHEARSAL_OPEN,
  V64_MY_PIPELINE,
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
    expect(active.definition.version).toBe(72);
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

  // Coordinator 2026-10-24 (TURN-READER-V64-NOTES.md): an investor's "Show
  // my pipeline" was answered with capital. By meaning, for anyone.
  it("reads anyone's 'my pipeline' as the CRM pipeline, never capital, compare or fit", () => {
    expect(TURN_READER_V64.template).toContain(V64_MY_PIPELINE);
    expect(V64_MY_PIPELINE).toMatch(/NAVIGATE with destination CRM_PIPELINE/u);
    expect(V64_MY_PIPELINE).toMatch(/never compare and never fit/u);
    expect(V64_MY_PIPELINE).toMatch(/what have I committed\?/u);
    // The founder rule it extends is kept, said once.
    expect(
      TURN_READER_V64.template.split('fundraising pipeline" is their').length,
    ).toBe(2);
  });
});
