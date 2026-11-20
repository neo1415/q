import { describe, expect, it } from "vitest";

import { ANSWER_SHAPES_V1 } from "@capital-q/q-core";

import {
  answerShapeNoteOf,
  answerTaskClass,
  environmentNoteParts,
} from "../src/q/index.js";

/**
 * HQ-1 (conversation audit §2.2): the answer's shape reaches the analyst in
 * this turn's notes (after the cached prefix), picked by code from the
 * reading. It is form only: the task class (and so the budget and the
 * reasoning) is the reading's as before.
 */
describe("the answer shape in the turn notes (HQ-1)", () => {
  const base = { capability: "ANSWER" as const };

  it("names the shape the reading picks", () => {
    expect(answerShapeNoteOf({ ...base, answerKind: "LOOKUP" })).toContain(
      ANSWER_SHAPES_V1.QUICK.template,
    );
    expect(answerShapeNoteOf({ ...base, answerKind: "ANALYSIS" })).toContain(
      ANSWER_SHAPES_V1.ANALYSIS.template,
    );
    expect(
      answerShapeNoteOf({
        ...base,
        answerKind: "ANALYSIS",
        questionKind: "ADVICE",
      }),
    ).toContain(ANSWER_SHAPES_V1.ADVICE.template);
    expect(
      answerShapeNoteOf({
        ...base,
        answerKind: "ANALYSIS",
        underspecified: true,
        costlyIfWrong: true,
      }),
    ).toContain(ANSWER_SHAPES_V1.CLARIFY.template);
  });

  it("shapes nothing for a document, an unread turn, a series, another capability or no reading", () => {
    for (const request of [
      { ...base, answerKind: "ANALYSIS", writingDocument: true },
      { ...base, answerKind: "ANALYSIS", turnUnread: true },
      { ...base, answerKind: "ANALYSIS", questionSequence: { kind: "ASK" } },
      { capability: "COMPARE" as const, answerKind: "ANALYSIS" },
      { ...base, answerKind: "DOCUMENT" },
      base,
    ]) {
      expect(answerShapeNoteOf(request)).toBeNull();
    }
  });

  it("rides in this turn's part of the notes, never the standing part", () => {
    const shape = answerShapeNoteOf({ ...base, answerKind: "ANALYSIS" }) ?? "";
    const parts = environmentNoteParts([], [], [], { answerShape: shape });
    const without = environmentNoteParts([], [], [], {});
    expect(parts.turn).toContain(shape);
    expect(parts.standing).not.toContain("SHAPE OF THIS ANSWER");
    expect(parts.standing).toBe(without.standing);
  });

  it("never changes the task class: the work read decides it, as before", () => {
    const analysis = { ...base, answerKind: "ANALYSIS" };
    expect(
      answerTaskClass({ ...analysis, underspecified: true } as typeof analysis),
    ).toBe(answerTaskClass(analysis));
  });
});
