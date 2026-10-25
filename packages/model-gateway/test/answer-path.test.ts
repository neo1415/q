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
  prepared: {
    mandate: true,
    onScreenRecord: true,
    qWork: true,
    ownCompany: true,
  },
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
    ["OWN_COMPANY", "what does Capital Q have on my company"],
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
          prepared: {
            mandate: false,
            onScreenRecord: true,
            qWork: true,
            ownCompany: true,
          },
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

  describe("S6: the GateQ application selected on screen", () => {
    const dossier = {
      mandate: true,
      onScreenRecord: false,
      qWork: true,
      ownCompany: false,
      focusDossier: true,
    };

    it("answers a review of the read dossier over it, even though advice takes research", () => {
      // Live 2026-10-15 ddf0738b: ADVICE + EXPLICIT went the full path.
      expect(
        answerPathOf(
          input({
            questionKind: "ADVICE",
            researchMode: "EXPLICIT",
            prepared: dossier,
          }),
        ),
      ).toEqual({ path: "PREPARED_CONTEXT", because: "GATEQ_DOSSIER" });
      expect(
        answerPathOf(
          input({ preparedSubject: "ON_SCREEN_RECORD", prepared: dossier }),
        ).path,
      ).toBe("PREPARED_CONTEXT");
    });

    it("keeps the full path when the dossier was not read", () => {
      expect(
        answerPathOf(
          input({
            questionKind: "ADVICE",
            researchMode: "EXPLICIT",
            prepared: { ...dossier, focusDossier: false },
          }),
        ),
      ).toEqual({ path: "DEEP_ANALYSIS", because: "RESEARCH" });
    });

    it("keeps the full path for the web, someone else, an action or a document", () => {
      for (const overrides of [
        { questionKind: "PUBLIC_FACTS", researchMode: "EXPLICIT" as const },
        {
          questionKind: "REAL_WORLD_EXAMPLE",
          researchMode: "EXPLICIT" as const,
        },
        { turnKind: "RESEARCH_REQUEST", questionKind: "ADVICE" },
        { questionKind: "ADVICE", aboutNamedOther: true },
        { questionKind: "ADVICE", askedAction: true },
        { questionKind: "ADVICE", writingDocument: true },
      ]) {
        expect(
          answerPathOf(input({ ...overrides, prepared: dossier })).path,
        ).toBe("DEEP_ANALYSIS");
      }
    });

    it("still answers fit by code", () => {
      expect(
        answerPathOf(
          input({ questionKind: "ADVICE", fit: true, prepared: dossier }),
        ).path,
      ).toBe("APP_QUERY");
    });
  });
});

// Coordinator 2026-10-25 (I21, live 5a3490b6: "how do the top two stack
// up?" took a tool round that re-read both companies code had read).
describe("a comparison code resolved (I21)", () => {
  const compared = {
    mandate: true,
    onScreenRecord: false,
    qWork: true,
    ownCompany: false,
    comparison: true,
  };

  it("is answered over its table, with no tool round, however it was read", () => {
    for (const overrides of [
      { questionKind: "ADVICE" },
      { questionKind: undefined },
      { fit: true },
      { aboutNamedOther: true },
      { researchMode: "OFFERED" as const },
    ]) {
      expect(answerPathOf(input({ ...overrides, prepared: compared }))).toEqual(
        { path: "PREPARED_CONTEXT", because: "COMPARISON" },
      );
    }
  });

  it("keeps the full path for the web, an action or a document", () => {
    for (const overrides of [
      { researchMode: "EXPLICIT" as const },
      { askedAction: true },
      { writingDocument: true },
    ]) {
      expect(
        answerPathOf(input({ ...overrides, prepared: compared })).path,
      ).toBe("DEEP_ANALYSIS");
    }
  });

  it("without a resolved comparison nothing changes", () => {
    expect(
      answerPathOf(
        input({
          questionKind: "ADVICE",
          prepared: { ...compared, comparison: false },
        }),
      ).path,
    ).toBe("DEEP_ANALYSIS");
  });
});
