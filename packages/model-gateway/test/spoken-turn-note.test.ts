import { describe, expect, it } from "vitest";

import { environmentNoteParts, SPOKEN_TURN_NOTE } from "../src/q/index.js";

/**
 * Turn latency (row 15, spoken): a voice turn finishes when its whole
 * answer object is written, findings included, so the spoken note keeps
 * the object short as well as the words.
 */
describe("the spoken turn note", () => {
  it("bounds the spoken words and the findings written after them", () => {
    expect(SPOKEN_TURN_NOTE).toContain("about 60 words");
    expect(SPOKEN_TURN_NOTE).toContain("At most two findings");
  });

  it("is given to a spoken turn only", () => {
    const spoken = JSON.stringify(
      environmentNoteParts([], [], [], { spoken: true }),
    );
    const typed = JSON.stringify(environmentNoteParts([], [], []));
    expect(spoken).toContain("SPOKEN TURN");
    expect(typed).not.toContain("SPOKEN TURN");
  });
});
