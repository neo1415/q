import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V32,
  TURN_READER_V33,
  TURN_READER_V33_TAIL,
} from "../src/index.js";

/** TURN_READER v33 (speed, 2026-10-02): every per-turn value last. */
describe("TURN_READER v33", () => {
  it("is the active reader and v32 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(38);
    expect(TURN_READER_V32.status).toBe("DEPRECATED");
  });

  it("puts every variable in the tail, after all the static instructions", () => {
    const template = TURN_READER_V33.template;
    const firstVariable = template.search(/\{\{\w+\}\}/u);
    expect(firstVariable).toBeGreaterThan(
      template.indexOf(TURN_READER_V33_TAIL) - 1,
    );
    expect(
      template.endsWith(
        "{{utterance}}\n\nRespond with a single JSON object matching the TurnReaderResult schema.",
      ),
    ).toBe(true);
    // Each variable appears exactly once.
    for (const name of [
      "actionGroups",
      "modality",
      "recentTurns",
      "utterance",
    ]) {
      expect(template.split(`{{${name}}}`).length - 1, name).toBe(1);
    }
  });
});
