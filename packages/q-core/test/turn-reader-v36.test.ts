import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V33_TAIL,
  TURN_READER_V35,
  TURN_READER_V36,
} from "../src/index.js";

/**
 * TURN_READER v36 (QA parity runs a6b19977, 11cae894, 06289687): a stated
 * decision is read TOOL_REQUEST (v35) and now also names relationship_outcome
 * in askedAction, with its arguments shown for appAction.
 */
describe("TURN_READER v36", () => {
  it("is superseded by v37, and v35 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(42);
    expect(TURN_READER_V35.status).toBe("DEPRECATED");
  });

  it("names relationship_outcome for a stated decision, misheard names included", () => {
    const template = TURN_READER_V36.template;
    expect(template).toContain(
      "is relationship_outcome, even said as news and even when it names no meeting",
    );
    expect(template).toContain('a misheard "Ledgefold" for Ledgerfold');
    expect(template).toContain(
      '{"relationship": "Ledgerfold", "operation": "NOT_PROCEED"}',
    );
    expect(template).toContain('"meetingOutcome": "DILIGENCE"');
    // v35's kind rule is kept, opinions included.
    expect(template).toContain(
      "A decision they state about one of their own relationships is a TOOL_REQUEST for relationship_outcome",
    );
  });

  it("changes only the static prefix; the per-turn tail is v35's", () => {
    const tail = (t: string) => t.slice(t.indexOf(TURN_READER_V33_TAIL));
    expect(tail(TURN_READER_V36.template)).toBe(tail(TURN_READER_V35.template));
    const prefix = TURN_READER_V36.template.slice(
      0,
      TURN_READER_V36.template.indexOf(TURN_READER_V33_TAIL),
    );
    expect(prefix).not.toMatch(/\{\{\w+\}\}/u);
  });
});
