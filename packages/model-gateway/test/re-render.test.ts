import { describe, expect, it } from "vitest";

import { reRenderAskOf } from "../src/q/re-render.js";

/**
 * Lane S 2026-10-15 (lane A: "put those three in a table" ran public web
 * research on "how to put tables side by side in Word"): a re-render of
 * what was shown is read by code and never reaches the web.
 */
describe("a request to show what was shown in another form", () => {
  it("is read from the words when it points at what was shown", () => {
    for (const said of [
      "put those three in a table",
      "Put those three in a table.",
      "Can you show them as a list?",
      "lay these out side by side",
      "make that a table",
      "show the three companies in a table",
      "give me the results as bullet points",
      "put them in order of fit",
    ]) {
      expect(reRenderAskOf(said, true)).toBe(true);
    }
  });

  it("is not a how-to question, a web request, a fresh ask, or with nothing shown", () => {
    for (const said of [
      "how do I put tables side by side in Word?",
      "search the web for those three and put them in a table",
      "put those in a Word table",
      "show me fintech companies in Nigeria",
      "what are the main risks here?",
      "find three companies that fit my mandate",
    ]) {
      expect(reRenderAskOf(said, true)).toBe(false);
    }
    expect(reRenderAskOf("put those three in a table", false)).toBe(false);
  });
});
