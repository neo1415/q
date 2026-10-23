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
            count: null,
            discover: null,
            subject: null,
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
            count: null,
            discover: null,
            subject: null,
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
            count: null,
            discover: null,
            subject: null,
          },
        }),
      ).mode,
    ).toBe("EXPLICIT");
  });

  it("researches advice outside an interview (founder direction 2026-09-29)", () => {
    expect(
      directive(
        read({
          question: {
            kind: "ADVICE",
            text: "what else should I look for?",
            about: [],
            count: null,
            discover: null,
            subject: null,
          },
        }),
      ).mode,
    ).toBe("EXPLICIT");
  });

  it("answers their own records from authorised context first, and announces any change of source", () => {
    expect(
      directive(
        read({
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "based on what you know about me, what suits me?",
            about: [],
            count: null,
            discover: null,
            subject: null,
          },
        }),
      ),
    ).toEqual({ mode: "ONLY_IF_EMPTY", announceSourceChange: true });
  });

  it("asks Capital Q and the public web together about a named company or person (owner 2026-10-23)", () => {
    for (const kind of ["ADVICE", "OPTIONS", "PUBLIC_FACTS"] as const) {
      expect(
        directive(
          read({
            question: {
              kind,
              text: "tell me about Zino Aviation and its team",
              about: [],
              count: null,
              discover: null,
              subject: null,
            },
            aboutNamedOther: true,
          }),
        ),
        kind,
      ).toEqual({ mode: "EXPLICIT", announceSourceChange: false });
    }
  });

  it("keeps a named fit question on Capital Q's computed answer, their own records records-first, and never searches when research is down", () => {
    const records = read({
      question: {
        kind: "THEIR_OWN_RECORDS",
        text: "what did we discuss about Tensorgate?",
        about: [],
        count: null,
        discover: null,
        subject: null,
      },
      aboutNamedOther: true,
    });
    expect(directive(records)).toEqual({
      mode: "ONLY_IF_EMPTY",
      announceSourceChange: true,
    });
    const fit = read({
      question: {
        kind: "FIT",
        text: "does Zino Aviation fit my mandate?",
        about: [],
        count: null,
        discover: null,
        subject: null,
      },
      aboutNamedOther: true,
    });
    expect(directive(fit).mode).toBe("NEVER");
    const named = read({
      question: {
        kind: "ADVICE",
        text: "what do you make of Acme?",
        about: [],
        count: null,
        discover: null,
        subject: null,
      },
      aboutNamedOther: true,
    });
    expect(directive(named, false).mode).toBe("NEVER");
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
      question: {
        kind: "REAL_WORLD_EXAMPLE",
        text: "a real one?",
        about: [],
        count: null,
        discover: null,
        subject: null,
      },
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

describe("the prospects fallback (gap 1)", () => {
  it("is allowed exactly for a question to Q with research up", () => {
    const kinds = [
      "QUESTION_TO_Q",
      "ANSWER",
      "CORRECTION",
      "SMALL_TALK",
      "OFF_TOPIC",
    ] as const;
    for (const kind of kinds) {
      for (const available of [true, false]) {
        const result = directive(
          read({
            kind,
            question:
              kind === "QUESTION_TO_Q"
                ? {
                    kind: "OPTIONS",
                    text: "Who would likely invest in us?",
                    about: [],
                    count: null,
                    discover: null,
                    subject: null,
                  }
                : null,
          }),
          available,
        );
        expect(result.mode, `${kind}/${String(available)}`).toBe("NEVER");
        expect(result.fallback === true, `${kind}/${String(available)}`).toBe(
          kind === "QUESTION_TO_Q" && available,
        );
      }
    }
  });

  it("is withheld once research is exhausted", () => {
    let state = INITIAL_CONVERSATION_STATE;
    for (let i = 0; i < 5; i += 1) {
      state = reduceConversation(state, {
        type: "FAILED",
        operation: "RESEARCH",
      });
    }
    const result = directive(
      read({
        question: {
          kind: "ADVICE",
          text: "Who would invest in us?",
          about: [],
          count: null,
          discover: null,
          subject: null,
        },
      }),
      true,
      state,
    );
    expect(result.fallback === true).toBe(false);
  });
});

/**
 * HARDEN P0 (live 2026-10-02, Nixo): "go online, search everything … update
 * my profile" and then "only the gaps" took the research tools away (NEVER),
 * and Q said it could not search. An instruction, or a clarification of
 * one outside an interview, keeps them in Q's hands; nothing is forced.
 */
describe("an instruction keeps the research tools in hand", () => {
  it("offers research on a tool request and on a clarification outside an interview", () => {
    expect(directive(read({ kind: "TOOL_REQUEST" })).mode).toBe("OFFERED");
    expect(directive(read({ kind: "CLARIFICATION" })).mode).toBe("OFFERED");
    // Down or exhausted is still never.
    expect(directive(read({ kind: "TOOL_REQUEST" }), false).mode).toBe("NEVER");
    // A remark is still not a search.
    expect(directive(read({ kind: "SMALL_TALK" })).mode).toBe("NEVER");
  });
});
