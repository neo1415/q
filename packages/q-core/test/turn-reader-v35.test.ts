import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V33_TAIL,
  TURN_READER_V34,
  TURN_READER_V35,
} from "../src/index.js";

/**
 * TURN_READER v35 (parity runs 9a63392f, e445cfb9): a decision stated about
 * one of their relationships names relationship_outcome; an opinion does not.
 */
describe("TURN_READER v35", () => {
  it("is superseded by v36, and v34 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(43);
    expect(TURN_READER_V34.status).toBe("DEPRECATED");
  });

  it("reads a stated decision as a request for relationship_outcome, never an opinion", () => {
    const template = TURN_READER_V35.template;
    expect(template).toContain(
      "A decision they state about one of their own relationships is a TOOL_REQUEST for relationship_outcome",
    );
    expect(template).toContain(
      '"we\'ve decided not to proceed with Ledgerfold for now"',
    );
    expect(template).toContain(
      'an opinion, a doubt or a question is not ("I\'m not sure about Ledgerfold", "should we pass?")',
    );
    expect(template).toContain(
      "a decision they state about one of their relationships: not proceeding, pausing, resuming, what a meeting led to",
    );
  });

  it("changes only the static prefix; the per-turn tail is v34's", () => {
    const tail = (t: string) => t.slice(t.indexOf(TURN_READER_V33_TAIL));
    expect(tail(TURN_READER_V35.template)).toBe(tail(TURN_READER_V34.template));
    const prefix = TURN_READER_V35.template.slice(
      0,
      TURN_READER_V35.template.indexOf(TURN_READER_V33_TAIL),
    );
    expect(prefix).not.toMatch(/\{\{\w+\}\}/u);
  });
});
