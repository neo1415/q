import { describe, expect, it } from "vitest";

import type { QTurnReading } from "@capital-q/model-gateway/q";

import { executionClassOfTurn } from "../src/execution-reading.js";

/**
 * RC3 (Q voice audit, 15 Nov 2026): the class a turn takes is read from the
 * reader's fields plus what code knows of the conversation -- a short
 * follow-up about Q's last result reuses its evidence; one that names
 * something Q has not said, or carries files, does not.
 */
const reading = (over: Record<string, unknown>): QTurnReading =>
  ({
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    references: [],
    qualitative: [],
    question: null,
    suggestions: [],
    tool: null,
    answerKind: "FOLLOW_UP",
    ...over,
  }) as unknown as QTurnReading;

const history = [
  {
    id: "m1",
    role: "USER" as const,
    content: "Which of my matches fits best?",
  },
  {
    id: "m2",
    role: "Q" as const,
    content: "Tensorgate is the strongest fit; Shiftwell is second.",
  },
  { id: "m3", role: "USER" as const, content: "why?" },
];

describe("execution class of a turn", () => {
  it("routes a short follow-up about Q's last result to the follow-up lane", () => {
    expect(
      executionClassOfTurn({
        read: reading({}),
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("CONTEXTUAL_FOLLOW_UP");
    // "what about the second one?" about a company Q already named.
    expect(
      executionClassOfTurn({
        read: reading({
          aboutNamedOther: true,
          namedOther: { kind: "COMPANY", name: "Shiftwell" },
        }),
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("CONTEXTUAL_FOLLOW_UP");
  });

  it("keeps the full path when new information is needed", () => {
    expect(
      executionClassOfTurn({
        read: reading({
          aboutNamedOther: true,
          namedOther: { kind: "COMPANY", name: "Halyard Security" },
        }),
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("COMPLEX_ANALYSIS");
    expect(
      executionClassOfTurn({
        read: reading({}),
        history,
        latestId: "m3",
        carriesDocuments: true,
      }),
    ).toBe("COMPLEX_ANALYSIS");
    // Nothing Q said yet: nothing to follow up on.
    expect(
      executionClassOfTurn({
        read: reading({}),
        history: history.slice(2),
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("COMPLEX_ANALYSIS");
    expect(
      executionClassOfTurn({
        read: null,
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("COMPLEX_ANALYSIS");
  });

  it("routes an approval of a waiting card and a web ask to their own lanes", () => {
    expect(
      executionClassOfTurn({
        read: reading({ replyTo: { kind: "WAITING_CARD", card: null } }),
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("CONSEQUENTIAL_ACTION");
    expect(
      executionClassOfTurn({
        read: reading({ asksForWeb: true }),
        history,
        latestId: "m3",
        carriesDocuments: false,
      }),
    ).toBe("PUBLIC_RESEARCH");
  });
});
