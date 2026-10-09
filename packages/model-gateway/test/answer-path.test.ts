import { describe, expect, it } from "vitest";

import { answerPathOf, type AnswerPathInput } from "../src/q/answer-path.js";

/**
 * K8: the cheapest correct path, chosen by code from the reading and what
 * is prepared; uncertain turns keep the full path.
 */

const input = (overrides: Partial<AnswerPathInput>): AnswerPathInput => ({
  turnKind: "QUESTION_TO_Q",
  questionKind: undefined,
  preparedSubject: undefined,
  discover: false,
  fit: false,
  attention: false,
  writingDocument: false,
  askedAction: false,
  researchMode: "NEVER",
  aboutNamedOther: false,
  prepared: { mandate: true, onScreenRecord: true, qWork: true },
  ...overrides,
});

describe("answerPathOf (K8)", () => {
  it("A: companies of a kind and computed fit are direct app queries", () => {
    expect(answerPathOf(input({ discover: true })).path).toBe("APP_QUERY");
    expect(answerPathOf(input({ fit: true })).path).toBe("APP_QUERY");
  });

  it.each([
    ["MANDATE", "what is my mandate"],
    ["ON_SCREEN_RECORD", "what company am I looking at"],
    ["Q_WORK", "what have my agents completed"],
  ] as const)(
    "B: %s (%s) is answered from prepared context",
    (subject, _words) => {
      expect(
        answerPathOf(
          input({
            questionKind: "THEIR_OWN_RECORDS",
            preparedSubject: subject,
          }),
        ),
      ).toEqual({ path: "PREPARED_CONTEXT", because: subject });
    },
  );

  it("B falls back to the full path when the context was not prepared", () => {
    expect(
      answerPathOf(
        input({
          preparedSubject: "MANDATE",
          prepared: { mandate: false, onScreenRecord: true, qWork: true },
        }),
      ),
    ).toEqual({ path: "DEEP_ANALYSIS", because: "MANDATE_NOT_READ" });
  });

  it("C: their own records and options are targeted retrieval", () => {
    expect(
      answerPathOf(input({ questionKind: "THEIR_OWN_RECORDS" })).path,
    ).toBe("TARGETED_RETRIEVAL");
    expect(answerPathOf(input({ questionKind: "OPTIONS" })).path).toBe(
      "TARGETED_RETRIEVAL",
    );
  });

  it("D: advice, research, documents, actions and unread turns take the full path", () => {
    for (const overrides of [
      { questionKind: "ADVICE" },
      { questionKind: "REAL_WORLD_EXAMPLE", researchMode: "EXPLICIT" as const },
      { writingDocument: true },
      { askedAction: true },
      { turnKind: "TOOL_REQUEST" },
      {},
    ]) {
      expect(answerPathOf(input(overrides)).path).toBe("DEEP_ANALYSIS");
    }
  });
});
