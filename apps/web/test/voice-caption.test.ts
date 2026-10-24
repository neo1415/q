import { describe, expect, it } from "vitest";

import { captionTail } from "../src/features/voice/caption";

/** QA QO-19: Q's spoken words as captions on the voice room. */
describe("a caption of what Q is saying", () => {
  it("is the line itself when it fits, spaces tidied", () => {
    expect(captionTail("  Savanna   is connected.\n")).toBe(
      "Savanna is connected.",
    );
  });

  it("is the newest words of a long line, from a whole word", () => {
    const line = `${"Earlier words. ".repeat(20)}Want to rehearse it? I'll play Savanna Seed Partners.`;
    const caption = captionTail(line, 60);
    expect(caption.startsWith("…")).toBe(true);
    expect(caption.endsWith("I'll play Savanna Seed Partners.")).toBe(true);
    expect(caption.length).toBeLessThanOrEqual(61);
    expect(caption.slice(1, 2)).not.toBe(" ");
  });

  it("is empty when Q has said nothing yet", () => {
    expect(captionTail("")).toBe("");
  });
});
