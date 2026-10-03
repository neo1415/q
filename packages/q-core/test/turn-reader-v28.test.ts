import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V27,
  TURN_READER_V28,
  TURN_READER_V28_DIRECT,
  TurnReaderV28ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v28 (HARDEN P0, live 2026-10-02, Zino): a direct, specific
 * request is a tool request, never a hand-over; a requested time is read
 * as a window from now.
 */
describe("TURN_READER v28", () => {
  it("v27 is deprecated (v29 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(38);
    expect(TURN_READER_V27.status).toBe("DEPRECATED");
    expect(TURN_READER_V28.status).toBe("DEPRECATED");
  });

  it("keeps a message or a meeting at a time out of the hand-over, and loses nothing of v27", () => {
    expect(TURN_READER_V28.template).toContain(TURN_READER_V28_DIRECT);
    expect(TURN_READER_V28.template).toContain(
      "book a meeting with X in the next five minutes",
    );
    expect(TURN_READER_V28.template).toContain(
      '"in the next five minutes" is {fromMinutes: 0, toMinutes: 5}',
    );
    for (const line of TURN_READER_V27.template.split("\n")) {
      expect(TURN_READER_V28.template).toContain(line);
    }
  });

  it("reads timeWindow as null when a model leaves it out", () => {
    const parsed = TurnReaderV28ResultSchema.parse({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
    });
    expect(parsed.timeWindow).toBe(null);
    expect(
      TurnReaderV28ResultSchema.parse({
        ...parsed,
        timeWindow: { fromMinutes: 0, toMinutes: 5 },
      }).timeWindow,
    ).toEqual({ fromMinutes: 0, toMinutes: 5 });
  });
});
