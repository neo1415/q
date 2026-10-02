import { describe, expect, it } from "vitest";

import {
  TURN_READER_V17,
  TURN_READER_V18,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * v18: accepting what Q offered to do in its last turn is asking for it
 * (harden spec §4). Nothing of v17 is lost.
 */
describe("TURN_READER v18", () => {
  it("is superseded by v19 and v20, which only add screens", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(32);
  });

  it("keeps every v17 line and adds only the acceptance rule", () => {
    const v17 = TURN_READER_V17.template.split("\n");
    const v18 = TURN_READER_V18.template.split("\n");
    for (const line of v17) expect(v18).toContain(line);
    const added = v18.filter((line) => !v17.includes(line));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("only accepts something Q offered to do");
    expect(added[0]).toContain("never ANSWER");
  });
});
