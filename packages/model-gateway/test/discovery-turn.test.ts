import { describe, expect, it } from "vitest";

import { DISCOVERY_EXIT_CHIP, DISCOVERY_UNSURE_CHIP } from "@capital-q/q-core";

import {
  answerShapeNoteOf,
  discoveryAsked,
  discoveryBlocks,
  modelOfferAllowed,
} from "../src/q/index.js";

/**
 * HQ-5: discovery's decision reaches the answer as code's note in the
 * plan's place, a card with the exit chip, one question said and no offer.
 */
describe("discovery in the answer (HQ-5)", () => {
  const ask = {
    kind: "ASK" as const,
    gap: "TRACTION",
    question: "Who was the last customer to pay you, and roughly what for?",
    known: ["the company's stage"],
    asked: 1,
    chips: [DISCOVERY_EXIT_CHIP, DISCOVERY_UNSURE_CHIP],
  };
  const base = { capability: "ANSWER" as const, underspecified: true };

  it("replaces the plan's note with discovery's", () => {
    const note = answerShapeNoteOf({ ...base, discovery: ask });
    expect(note).toContain(ask.question);
    expect(note).not.toContain("SHAPE OF THIS ANSWER");
    const exit = answerShapeNoteOf({
      ...base,
      discovery: { kind: "EXIT", reason: "ASKED_TO_SKIP", known: [] },
    });
    expect(exit).toContain("Ask no question");
    // A document keeps its own path.
    expect(
      answerShapeNoteOf({ ...base, writingDocument: true, discovery: ask }),
    ).toBeNull();
  });

  it("shows the question with the exit chip, only on a question turn", () => {
    expect(discoveryBlocks({ discovery: ask })).toEqual([
      {
        kind: "CLARIFICATION_REQUEST",
        question: ask.question,
        options: [DISCOVERY_EXIT_CHIP, DISCOVERY_UNSURE_CHIP],
      },
    ]);
    expect(
      discoveryBlocks({
        discovery: { kind: "EXIT", reason: "CAP", known: [] },
      }),
    ).toEqual([]);
    expect(discoveryBlocks({})).toEqual([]);
  });

  it("says one question and offers nothing beside it", () => {
    expect(modelOfferAllowed({ ...base, discovery: ask })).toBe(false);
    expect(
      discoveryAsked(
        { discovery: ask },
        `A paying customer. What stage are you at? ${ask.question}`,
      ),
    ).toBe(`A paying customer. ${ask.question}`);
    // Not discovery: the words are left as written.
    expect(discoveryAsked({}, "Where? Why?")).toBe("Where? Why?");
  });
});
