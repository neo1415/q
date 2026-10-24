import { describe, expect, it } from "vitest";

import { announcesUpload } from "../src/voice/interview-agent.js";

/**
 * QA O1 (24 Oct): the workspace's own messages about a file are not
 * answers, so Q's read-back never opens with "I haven't saved that yet".
 * These are the messages the web workspace writes (see
 * q-onboarding-workspace.tsx); anything the person types is not one.
 */
describe("the workspace's messages about a file", () => {
  it("are recognised, both when added and when the reading lands", () => {
    for (const told of [
      "I've just uploaded deck.pdf. Read back what you found in it and check it with me.",
      "I've just uploaded deck.pdf; it's still being read. Say you're reading it now and will show what you found in a minute, then carry on.",
      "I've just added deck.pdf",
      "I've finished reading deck.pdf. Read back what you found in it and check it with me.",
    ]) {
      expect(announcesUpload(told), told).toBe(true);
    }
  });

  it("a person's own answer is not one", () => {
    for (const said of [
      "We just uploaded our deck to the data room last week",
      "I've raised $500k so far",
      "Finished reading your question: we're seed stage",
    ]) {
      expect(announcesUpload(said), said).toBe(false);
    }
  });
});
