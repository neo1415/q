import { describe, expect, it } from "vitest";

import {
  INITIAL_CONVERSATION_STATE,
  noteAnswerFailure,
  readingFromTurnReader,
  reduceConversation,
  researchDirectiveFor,
  TurnReaderResultSchema,
  type TurnReaderResult,
} from "../src/index.js";

/**
 * The conversation core for Home, the Q sheet and voice outside the
 * interview (CQ-QX-005): research only when the turn asked for something
 * real, and a failure named once by its subsystem.
 */

const read = (overrides: Partial<TurnReaderResult>): TurnReaderResult =>
  TurnReaderResultSchema.parse({
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    ...overrides,
  });

const directive = (
  result: TurnReaderResult,
  available = true,
  state = INITIAL_CONVERSATION_STATE,
) =>
  researchDirectiveFor(state, readingFromTurnReader(result), {
    available,
    aboutNamedOther: result.aboutNamedOther,
  });

describe("research is intentional outside the interview too", () => {
  it("runs for a real-world example or public facts, and for an explicit request", () => {
    expect(
      directive(
        read({
          question: {
            kind: "REAL_WORLD_EXAMPLE",
            text: "a real investor like me?",
            about: [],
          },
        }),
      ).mode,
    ).toBe("EXPLICIT");
    expect(
      directive(
        read({
          question: {
            kind: "PUBLIC_FACTS",
            text: "any news on Acme?",
            about: [],
          },
        }),
      ).mode,
    ).toBe("EXPLICIT");
    expect(
      directive(
        read({
          kind: "RESEARCH_REQUEST",
          question: {
            kind: "PUBLIC_FACTS",
            text: "search the web for it",
            about: [],
          },
        }),
      ).mode,
    ).toBe("EXPLICIT");
  });

  it("never runs for advice, even advice about what to look for", () => {
    expect(
      directive(
        read({
          question: {
            kind: "ADVICE",
            text: "what else should I look for?",
            about: [],
          },
        }),
      ).mode,
    ).toBe("NEVER");
  });

  it("answers their own records from authorised context first, and announces any change of source", () => {
    expect(
      directive(
        read({
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "based on what you know about me, what suits me?",
            about: [],
          },
        }),
      ),
    ).toEqual({ mode: "ONLY_IF_EMPTY", announceSourceChange: true });
  });

  it("reads a named company from Capital Q first, and the web only if Capital Q holds nothing", () => {
    expect(
      directive(
        read({
          question: {
            kind: "ADVICE",
            text: "what do you make of Acme?",
            about: [],
          },
          aboutNamedOther: true,
        }),
      ),
    ).toEqual({ mode: "ONLY_IF_EMPTY", announceSourceChange: false });
  });

  it("never runs on an answer, an aside or noise, nor when research is down", () => {
    for (const kind of [
      "ANSWER",
      "SMALL_TALK",
      "UNCLEAR_TRANSCRIPT",
    ] as const) {
      expect(directive(read({ kind })).mode, kind).toBe("NEVER");
    }
    const example = read({
      question: { kind: "REAL_WORLD_EXAMPLE", text: "a real one?", about: [] },
    });
    expect(directive(example, false).mode).toBe("NEVER");
    const down = reduceConversation(
      reduceConversation(INITIAL_CONVERSATION_STATE, {
        type: "FAILED",
        operation: "RESEARCH",
      }),
      { type: "FAILED", operation: "RESEARCH" },
    );
    expect(directive(example, true, down).mode).toBe("NEVER");
  });
});

describe("a failed answer is named once, by its subsystem", () => {
  it("notifies on the first failure and on the one that stops the retries, and is quiet between", () => {
    let state = INITIAL_CONVERSATION_STATE;
    const notices: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const noted = noteAnswerFailure(state, "MODEL");
      state = noted.state;
      notices.push(noted.notice);
    }
    expect(notices[0]).toMatch(/reasoning service/i);
    expect(notices[1]).toMatch(/stop trying/i);
    expect(notices[0]).not.toBe(notices[1]);
    expect(notices.slice(2)).toEqual([null, null]);
    for (const notice of notices) {
      expect(notice ?? "").not.toMatch(/say it again\?|didn't catch/i);
    }
  });
});
