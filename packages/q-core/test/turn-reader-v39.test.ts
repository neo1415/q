import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V38,
  TURN_READER_V39,
} from "../src/index.js";

/** TURN_READER v39 (QA run f99e507c): a reminder is a request to act. */
describe("TURN_READER v39", () => {
  it("is the active reader and v38 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(39);
    expect(TURN_READER_V38.status).toBe("DEPRECATED");
  });

  it("changes only the TOOL_REQUEST line, in the static prefix, to name a reminder", () => {
    const before = TURN_READER_V38.template.split("\n");
    const after = TURN_READER_V39.template.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("set a reminder");
    expect(changed[0]).toContain("Remind me on Monday at 10");
    expect(TURN_READER_V39.template.indexOf("set a reminder")).toBeLessThan(
      TURN_READER_V39.template.indexOf("{{"),
    );
  });
});
