import { describe, expect, it } from "vitest";

import {
  answerPlanOf,
  CHOICE_UNCLEAR_NOTE,
  EMPTY_TURN_READING,
  exclusionNote,
  INITIAL_CONVERSATION_STATE,
  nextExclusions,
  researchDirectiveFor,
  type ConversationTurnReading,
} from "../src/index.js";

/**
 * VOICE-FIX: a scripted replay of the owner's live voice session (20 Nov
 * 2026, 22:18-22:24 UTC, voice 40e55b83), with the readings the readers
 * gave each turn (q turn read logs), through code's own decisions. No
 * provider is called. Before the fix every turn read as ADVICE went to the
 * public web (15-44 s, every search provider resting).
 */

type Turn = {
  readonly said: string;
  readonly reading: ConversationTurnReading;
  readonly flags: {
    readonly nextSteps?: boolean;
    readonly seeksGuidance?: boolean;
    readonly asksForWeb?: boolean;
  };
};

const question = (
  kind: NonNullable<ConversationTurnReading["question"]>["kind"],
  text: string,
): ConversationTurnReading => ({
  ...EMPTY_TURN_READING,
  kind: "QUESTION_TO_Q",
  question: {
    kind,
    text,
    about: [],
    count: null,
    discover: null,
    subject: null,
  },
});

const REPLAY: readonly Turn[] = [
  {
    said: "Where were we before",
    reading: question("THEIR_OWN_RECORDS", "Where were we before"),
    flags: {},
  },
  {
    said: "I'm not really sure what the next I should do",
    reading: question("ADVICE", "what should I do next"),
    flags: { nextSteps: true, seeksGuidance: true },
  },
  {
    said: "I want to do something I've not done before",
    reading: question("ADVICE", "something I have not done before"),
    flags: { nextSteps: true },
  },
  {
    said: "what else can I do that is fun or interesting in Capital Q",
    reading: question("OPTIONS", "what else can I do on Capital Q"),
    flags: {},
  },
  {
    said: "Why are you opening rehearsal with Tensorgate again",
    reading: question("THEIR_OWN_RECORDS", "why the Tensorgate rehearsal"),
    flags: {},
  },
];

describe("VOICE-FIX replay: no web research for their own next steps", () => {
  it.each(REPLAY)("$said: never the public web", ({ reading, flags }) => {
    const directive = researchDirectiveFor(
      INITIAL_CONVERSATION_STATE,
      reading,
      { available: true, spoken: true, ...flags },
    );
    expect(directive.mode).toBe("NEVER");
  });

  it("advice that is not about their own next steps still researches, as decided (2026-09-29)", () => {
    expect(
      researchDirectiveFor(
        INITIAL_CONVERSATION_STATE,
        question("ADVICE", "how should a seed round be priced this year"),
        { available: true, spoken: true },
      ).mode,
    ).toBe("EXPLICIT");
  });

  it("asking for the web, by meaning, is still honoured on their own next steps", () => {
    expect(
      researchDirectiveFor(
        INITIAL_CONVERSATION_STATE,
        question("ADVICE", "what should I do next, check online"),
        { available: true, spoken: true, nextSteps: true, asksForWeb: true },
      ).mode,
    ).toBe("EXPLICIT");
  });

  it("a spoken correction never searches; a typed one keeps the tools offered", () => {
    const correction: ConversationTurnReading = {
      ...EMPTY_TURN_READING,
      kind: "CORRECTION",
    };
    expect(
      researchDirectiveFor(INITIAL_CONVERSATION_STATE, correction, {
        available: true,
        spoken: true,
      }).mode,
    ).toBe("NEVER");
    expect(
      researchDirectiveFor(INITIAL_CONVERSATION_STATE, correction, {
        available: true,
      }).mode,
    ).toBe("OFFERED");
  });

  it("not sure what to do next opens discovery on the first turn", () => {
    expect(
      answerPlanOf({
        answerKinds: ["CHAT"],
        questionKind: "ADVICE",
        turnKind: "QUESTION_TO_Q",
        seeksGuidance: true,
      })?.shape,
    ).toBe("DISCOVERY");
  });
});

describe("VOICE-FIX replay: a stated exclusion is held", () => {
  it("'not Tensorgate' holds until they name it again themselves", () => {
    let held = nextExclusions([], {
      excludes: ["TensorGate"],
      words: "N-No, not TensorGate. Just something new on Capital Q",
    });
    expect(held).toEqual(["TensorGate"]);
    // "I don't want to do anything about them": the same one, once.
    held = nextExclusions(held, {
      excludes: ["Tensorgate"],
      words: "I don't want to do anything about them",
    });
    expect(held).toEqual(["TensorGate"]);
    // A bare yes changes nothing.
    held = nextExclusions(held, { excludes: [], words: "Yes" });
    expect(held).toEqual(["TensorGate"]);
    expect(exclusionNote(held)).toContain('"TensorGate"');
    expect(exclusionNote(held)).toContain("unless they name one again");
    // They bring it back.
    held = nextExclusions(held, {
      excludes: [],
      words: "ok, let's go back to Tensorgate",
    });
    expect(held).toEqual([]);
    expect(exclusionNote(held)).toBeNull();
  });

  it("keeps at most a few, newest last", () => {
    let held: readonly string[] = [];
    for (let i = 0; i < 12; i += 1) {
      held = nextExclusions(held, {
        excludes: [`Company ${String(i)}`],
        words: "",
      });
    }
    expect(held).toHaveLength(8);
    expect(held.at(-1)).toBe("Company 11");
  });

  it("a yes to several options asks which, acting on nothing", () => {
    expect(CHOICE_UNCLEAR_NOTE).toContain("ask in one short question which");
    expect(CHOICE_UNCLEAR_NOTE).toContain(
      "Do not open, prepare, start or choose",
    );
  });
});
