import { describe, expect, it } from "vitest";

import { environmentNotesFor } from "../src/q/index.js";

/**
 * The scope the firewall was granting and nothing was reading.
 *
 * Every plan carried GENERAL_MODEL_KNOWLEDGE and no note ever mentioned
 * it, so Q read the charter's true rule — general knowledge is never
 * company-specific evidence — as "never use general knowledge", and
 * answered "who is the president of Nigeria" with a sentence about
 * authorised context. The invariant is unchanged; what is new is that the
 * permission is stated when it has been granted.
 */
describe("what Q may say from ordinary knowledge", () => {
  it("is silent about general knowledge unless the plan granted it", () => {
    const withoutIt = environmentNotesFor([], [], []);
    expect(withoutIt).not.toMatch(/general knowledge/i);
  });

  it("tells Q to answer the question itself when the plan granted it", () => {
    const notes = environmentNotesFor([], [], [], { generalKnowledge: true });
    expect(notes).toMatch(/answer outright/i);
    expect(notes).toMatch(/Give the actual answer first/i);
    // The two failures actually seen: a refusal, and a reply that only
    // remarks on where an answer would come from.
    expect(notes).toMatch(/never refuse it/i);
    expect(notes).toMatch(/never reply with only a remark/i);
  });

  it("keeps the invariant: never evidence about a subject", () => {
    const notes = environmentNotesFor([], [], [], { generalKnowledge: true });
    expect(notes).toMatch(/never evidence about a subject/i);
    expect(notes).toMatch(/never grounds for a conclusion/i);
  });
});
