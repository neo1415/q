import { describe, expect, it } from "vitest";

import {
  ConversationTurnReadingSchema,
  decideResearch,
  disposeTurn,
  EMPTY_TURN_READING,
  INITIAL_CONVERSATION_STATE,
  mayWrite,
  noteFailure,
  reduceAll,
  reduceConversation,
  resumeTarget,
  traceVerdict,
  type ConversationTurnReading,
  type TurnTrace,
} from "../src/index.js";

/**
 * The conversational state and what a reading may do to it (CQ-QX-005
 * §2, §4, §10, §11, §16). Only an ANSWER or an explicit CORRECTION may
 * write; a suggestion stays a suggestion; research runs only when asked
 * for; an interruption returns to the question it interrupted.
 */

const reading = (
  overrides: Partial<ConversationTurnReading>,
): ConversationTurnReading => ({ ...EMPTY_TURN_READING, ...overrides });

describe("what a reading may do", () => {
  it("lets only an answer or a correction write, and only at high confidence", () => {
    expect(mayWrite(reading({ kind: "ANSWER" }))).toBe(true);
    expect(mayWrite(reading({ kind: "CORRECTION" }))).toBe(true);
    for (const kind of [
      "CLARIFICATION",
      "QUESTION_TO_Q",
      "RESEARCH_REQUEST",
      "TOOL_REQUEST",
      "UNCLEAR_TRANSCRIPT",
      "OFF_TOPIC",
      "SMALL_TALK",
      "CONTROL",
    ] as const) {
      expect(mayWrite(reading({ kind })), kind).toBe(false);
      expect(disposeTurn(reading({ kind })).write, kind).toBe(false);
    }
    expect(
      disposeTurn(reading({ kind: "ANSWER", confidence: "HIGH" })).write,
    ).toBe(true);
    const medium = disposeTurn(
      reading({ kind: "ANSWER", confidence: "MEDIUM" }),
    );
    expect(medium.write).toBe(false);
    expect(medium.confirm).toBe(true);
    const low = disposeTurn(reading({ kind: "ANSWER", confidence: "LOW" }));
    expect(low.write).toBe(false);
    expect(low.clarify).toBe(true);
  });

  it("treats a question to Q as something to answer, never as a failed answer", () => {
    const d = disposeTurn(
      reading({
        kind: "QUESTION_TO_Q",
        question: {
          kind: "ADVICE",
          text: "What do you think I should look for?",
          about: [],
        },
      }),
    );
    expect(d.answer).toBe(true);
    expect(d.write).toBe(false);
    expect(d.clarify).toBe(false);
    expect(d.transcription).toBe(false);
  });

  it("keeps transcript trouble apart from reasoning trouble", () => {
    const noise = disposeTurn(
      reading({ kind: "UNCLEAR_TRANSCRIPT", transcript: "FRAGMENT" }),
    );
    expect(noise.transcription).toBe(true);
    expect(noise.clarify).toBe(false);
    // An intelligible sentence the reader could not place is not a
    // hearing problem, whatever it turns out to be.
    const placed = disposeTurn(
      reading({ kind: "ANSWER", confidence: "LOW", transcript: "CLEAR" }),
    );
    expect(placed.transcription).toBe(false);
    expect(placed.clarify).toBe(true);
  });

  it("parses a model's reading into the closed shape with quiet defaults", () => {
    const parsed = ConversationTurnReadingSchema.parse({
      kind: "ANSWER",
      confidence: "HIGH",
      transcript: "CLEAR",
    });
    expect(parsed.references).toEqual([]);
    expect(parsed.question).toBeNull();
    expect(() =>
      ConversationTurnReadingSchema.parse({
        kind: "SOMETHING_ELSE",
        confidence: "HIGH",
        transcript: "CLEAR",
      }),
    ).toThrow();
  });
});

describe("the reducer", () => {
  it("remembers the question Q asked and the options it showed, and clears it when recorded", () => {
    const asked = reduceConversation(INITIAL_CONVERSATION_STATE, {
      type: "ASKED",
      asked: {
        topic: "I5.founder_preferences",
        question: "Which capabilities matter?",
        options: [{ key: "a", label: "A" }],
      },
    });
    expect(asked.topic).toBe("I5.founder_preferences");
    expect(asked.asked?.options).toHaveLength(1);
    const recorded = reduceConversation(asked, {
      type: "RECORDED",
      topics: ["I5.founder_preferences"],
      selections: { "I5.founder_preferences": ["a"] },
    });
    expect(recorded.asked).toBeNull();
    expect(recorded.selections["I5.founder_preferences"]).toEqual(["a"]);
  });

  it("holds a suggestion as a proposal and never as a selection", () => {
    const state = reduceAll(INITIAL_CONVERSATION_STATE, [
      {
        type: "PROPOSED",
        suggestions: [
          {
            target: "I6.green_flags",
            value: ["capital_efficiency"],
            because: "pre-seed with a small cheque",
          },
        ],
      },
    ]);
    expect(state.proposals).toHaveLength(1);
    expect(state.selections["I6.green_flags"]).toBeUndefined();
    const decided = reduceConversation(state, {
      type: "PROPOSAL_DECIDED",
      target: "I6.green_flags",
    });
    expect(decided.proposals).toHaveLength(0);
  });

  it("returns to the question that was open when a question to Q, or research, interrupts it", () => {
    const state = reduceAll(INITIAL_CONVERSATION_STATE, [
      {
        type: "ASKED",
        asked: { topic: "I2.stages", question: "Which stages?", options: [] },
      },
      {
        type: "QUESTION_RECEIVED",
        kind: "ADVICE",
        text: "What should I look for?",
      },
    ]);
    expect(state.answering?.kind).toBe("ADVICE");
    expect(resumeTarget(state)).toBe("I2.stages");
    const researching = reduceConversation(state, {
      type: "RESEARCH_STARTED",
      question: "an example of an aviation-focused investor",
      resumeTopic: "I2.stages",
    });
    expect(researching.research?.resumeTopic).toBe("I2.stages");
    const back = reduceAll(researching, [
      { type: "RESEARCH_FINISHED" },
      { type: "RESUMED" },
    ]);
    expect(back.research).toBeNull();
    expect(back.answering).toBeNull();
    expect(resumeTarget(back)).toBe("I2.stages");
  });

  it("clears parse and write failures when something is actually recorded", () => {
    const failing = reduceAll(INITIAL_CONVERSATION_STATE, [
      { type: "FAILED", operation: "PARSE" },
      { type: "FAILED", operation: "PARSE" },
      { type: "FAILED", operation: "RESEARCH" },
    ]);
    const recorded = reduceConversation(failing, {
      type: "RECORDED",
      topics: ["x"],
    });
    expect(recorded.failures.PARSE).toBe(0);
    // Research being down has nothing to do with an answer landing.
    expect(recorded.failures.RESEARCH).toBe(1);
  });
});

describe("the research policy", () => {
  const asked = reduceConversation(INITIAL_CONVERSATION_STATE, {
    type: "ASKED",
    asked: { topic: "I5.founder_preferences", question: "?", options: [] },
  });

  it("never runs on an answer, a correction or a clarification, whatever is on the record", () => {
    for (const kind of ["ANSWER", "CORRECTION", "CLARIFICATION"] as const) {
      expect(
        decideResearch(asked, reading({ kind }), { available: true }),
      ).toEqual({
        run: false,
        because: "ANSWER_TURN",
      });
    }
  });

  it("runs only when a real-world example or public facts are asked for, and resumes the open question", () => {
    const decision = decideResearch(
      asked,
      reading({
        kind: "QUESTION_TO_Q",
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "Can you give me an example of a real investor similar to me?",
          about: [],
        },
      }),
      { available: true },
    );
    expect(decision.run).toBe(true);
    if (decision.run) {
      expect(decision.resumeTopic).toBe("I5.founder_preferences");
      expect(decision.announceSourceChange).toBe(false);
    }
    expect(
      decideResearch(
        asked,
        reading({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "ADVICE",
            text: "What else should I look for?",
            about: [],
          },
        }),
        { available: true },
      ),
    ).toEqual({ run: false, because: "NOT_ASKED" });
  });

  it("answers 'based on what you know about me' from authorised context, and names the change of source if it must go public", () => {
    const about = reading({
      kind: "QUESTION_TO_Q",
      question: {
        kind: "THEIR_OWN_RECORDS",
        text: "Based on what you know about me, what fits?",
        about: [],
      },
    });
    expect(decideResearch(asked, about, { available: true })).toEqual({
      run: false,
      because: "CONTEXT_SUFFICIENT",
    });
    const gone = decideResearch(asked, about, {
      available: true,
      contextSufficient: false,
    });
    expect(gone.run).toBe(true);
    if (gone.run) expect(gone.announceSourceChange).toBe(true);
  });

  it("stops asking a research route that is down, and never doubles a run in flight", () => {
    const example = reading({
      kind: "RESEARCH_REQUEST",
      question: {
        kind: "REAL_WORLD_EXAMPLE",
        text: "a real example",
        about: [],
      },
    });
    expect(decideResearch(asked, example, { available: false })).toEqual({
      run: false,
      because: "UNAVAILABLE",
    });
    const down = {
      ...asked,
      failures: noteFailure(
        noteFailure(asked.failures, "RESEARCH"),
        "RESEARCH",
      ),
    };
    expect(decideResearch(down, example, { available: true })).toEqual({
      run: false,
      because: "EXHAUSTED",
    });
    const running = reduceConversation(asked, {
      type: "RESEARCH_STARTED",
      question: "x",
      resumeTopic: null,
    });
    expect(decideResearch(running, example, { available: true })).toEqual({
      run: false,
      because: "ALREADY_RUNNING",
    });
  });
});

describe("the turn trace", () => {
  const trace = (overrides: Partial<TurnTrace>): TurnTrace => ({
    raw: "it doesn't really matter as long as they've got the grit",
    normalised: "it doesn't really matter as long as they've got the grit",
    transcript: "CLEAR",
    classification: { kind: "ANSWER", confidence: "HIGH", question: null },
    extracted: {
      targets: [],
      references: [],
      qualitative: [],
      suggestions: [],
      tensions: 0,
    },
    persisted: {
      recorded: [],
      held: [],
      skipped: [],
      refused: [],
      carried: [],
    },
    repair: null,
    research: null,
    failures: INITIAL_CONVERSATION_STATE.failures,
    ...overrides,
  });

  it("says where a turn went wrong, keeping transcript and reasoning apart", () => {
    expect(traceVerdict(trace({}))).toBe("OK");
    expect(traceVerdict(trace({ transcript: "FRAGMENT" }))).toBe("TRANSCRIPT");
    expect(traceVerdict(trace({ repair: "REPHRASE" }))).toBe("REASONING");
    expect(
      traceVerdict(
        trace({
          persisted: {
            recorded: [],
            held: [],
            skipped: [],
            refused: ["I2.stages"],
            carried: [],
          },
        }),
      ),
    ).toBe("WRITE");
  });
});
