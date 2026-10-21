import { describe, expect, it } from "vitest";

import { environmentNoteParts, SPOKEN_TURN_NOTE } from "../src/q/index.js";

/**
 * Turn latency (row 15, spoken): the words are short; the findings keep
 * their evidence (owner 2026-10-21: nothing important cut for speed).
 * The voice speaks the answer as it streams, so findings written after it
 * never hold the audio.
 */
describe("the spoken turn note", () => {
  it("bounds the spoken words and keeps three findings", () => {
    expect(SPOKEN_TURN_NOTE).toContain("about 60 words");
    expect(SPOKEN_TURN_NOTE).toContain("At most three findings.");
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
