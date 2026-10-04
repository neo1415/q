import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V33,
  TURN_READER_V33_TAIL,
  TURN_READER_V34,
} from "../src/index.js";

/**
 * TURN_READER v34 (QA parity run 1ec08a4b, 2026-10-02): SET_VISIBILITY is a
 * company's only; a fund's visibility is its app action.
 */
describe("TURN_READER v34", () => {
  it("is the active reader and v33 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(42);
    expect(TURN_READER_V33.status).toBe("DEPRECATED");
  });

  it("keeps SET_VISIBILITY for a company and names the fund's own action", () => {
    const template = TURN_READER_V34.template;
    expect(template).toContain(
      "- SET_VISIBILITY: they want their company (a startup, never a fund or investor organisation) seen",
    );
    expect(template).toContain(
      "who may see their fund or investor organisation",
    );
    expect(template).toContain(
      '"make our fund visible to founders" is set_investor_visibility',
    );
  });

  it("changes only those lines, all before the per-turn tail", () => {
    const template = TURN_READER_V34.template;
    const tail = template.indexOf(TURN_READER_V33_TAIL);
    expect(tail).toBe(
      TURN_READER_V33.template.indexOf(TURN_READER_V33_TAIL) +
        template.length -
        TURN_READER_V33.template.length,
    );
    expect(template.slice(tail)).toBe(
      TURN_READER_V33.template.slice(
        TURN_READER_V33.template.indexOf(TURN_READER_V33_TAIL),
      ),
    );
    expect(template.slice(0, tail)).not.toMatch(/\{\{\w+\}\}/u);
  });
});
