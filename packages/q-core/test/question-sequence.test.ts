import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  stepQuestionSequence,
  TURN_READER_V10,
  TURN_READER_V11,
  TurnReaderV11ResultSchema,
  type QuestionSequence,
  type QuestionSequenceTurnReading,
  type TurnKind,
} from "../src/index.js";

/**
 * R35: a series of questions the person asked for is held by code and
 * moved on after each answer, until done or stopped. The reader records
 * the request; nothing here reads the person's words.
 */

const start = (
  count: number,
  topic = "my mandate",
): QuestionSequenceTurnReading => ({
  kind: "TOOL_REQUEST",
  sequence: { action: "START", count, topic },
});
const answer: QuestionSequenceTurnReading = { kind: "ANSWER", sequence: null };
const stop: QuestionSequenceTurnReading = {
  kind: "CONTROL",
  sequence: { action: "STOP", count: null, topic: null },
};

function run(readings: readonly QuestionSequenceTurnReading[]) {
  let current: QuestionSequence | null = null;
  const steps = readings.map((reading) => {
    const turn = stepQuestionSequence(current, reading);
    current = turn.next;
    return turn.step;
  });
  return { steps, current };
}

describe("stepQuestionSequence", () => {
  it("asks each of N questions in turn, then closes the series", () => {
    const { steps, current } = run([start(3), answer, answer, answer, answer]);
    expect(steps.map((s) => s?.kind ?? null)).toEqual([
      "ASK",
      "ASK",
      "ASK",
      "FINISHED",
      null,
    ]);
    expect(
      steps.flatMap((s) => (s !== null && s.kind === "ASK" ? [s.number] : [])),
    ).toEqual([1, 2, 3]);
    expect(current).toBeNull();
  });

  it("continues for any N up to the maximum", () => {
    for (const n of [1, 2, 5, 10]) {
      const readings = [start(n), ...Array.from({ length: n }, () => answer)];
      const { steps } = run(readings);
      expect(steps.filter((s) => s?.kind === "ASK")).toHaveLength(n);
      expect(steps.at(-1)?.kind).toBe("FINISHED");
    }
  });

  it("stops when asked, and asks nothing after", () => {
    const { steps, current } = run([start(4), answer, stop, answer]);
    expect(steps.map((s) => s?.kind ?? null)).toEqual([
      "ASK",
      "ASK",
      "STOPPED",
      null,
    ]);
    expect(current).toBeNull();
  });

  it("re-asks the open question when the turn is not an answer, without counting it", () => {
    const aside: QuestionSequenceTurnReading = {
      kind: "QUESTION_TO_Q",
      sequence: null,
    };
    const { steps } = run([start(2), aside, null, answer, answer]);
    expect(steps).toEqual([
      { kind: "ASK", topic: "my mandate", number: 1, total: 2 },
      { kind: "REASK", topic: "my mandate", number: 1, total: 2 },
      { kind: "REASK", topic: "my mandate", number: 1, total: 2 },
      { kind: "ASK", topic: "my mandate", number: 2, total: 2 },
      { kind: "FINISHED", topic: "my mandate", total: 2 },
    ]);
  });

  it("never restarts the count when an answer repeats the original request", () => {
    const echoed: QuestionSequenceTurnReading = {
      kind: "ANSWER",
      sequence: { action: "START", count: 3, topic: "my mandate" },
    };
    const { steps } = run([start(3), echoed]);
    expect(steps[1]).toEqual({
      kind: "ASK",
      topic: "my mandate",
      number: 2,
      total: 3,
    });
  });

  it("a new request replaces the series in hand", () => {
    const { steps } = run([start(3), start(2, "my raise")]);
    expect(steps[1]).toEqual({
      kind: "ASK",
      topic: "my raise",
      number: 1,
      total: 2,
    });
  });

  it("does nothing without a series, whatever the turn", () => {
    const kinds: readonly TurnKind[] = [
      "ANSWER",
      "QUESTION_TO_Q",
      "CONTROL",
      "SMALL_TALK",
    ];
    for (const kind of kinds) {
      expect(stepQuestionSequence(null, { kind, sequence: null })).toEqual({
        step: null,
        next: null,
      });
    }
    expect(stepQuestionSequence(null, stop)).toEqual({
      step: null,
      next: null,
    });
  });

  it("quotes a topic safely", () => {
    const turn = stepQuestionSequence(null, start(2, 'my "fund"\n  thesis'));
    expect(turn.step).toMatchObject({ topic: "my fund thesis" });
  });
});

describe("TURN_READER v11", () => {
  it("is the active reader and extends v10 with the sequence rules", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(11);
    expect(TURN_READER_V11.template).toContain("SEQUENCE (null unless");
    expect(TURN_READER_V11.template).toContain("RELATIONSHIPS (");
    expect(TURN_READER_V11.template.length).toBeGreaterThan(
      TURN_READER_V10.template.length,
    );
  });

  it("accepts START and STOP with exactly their own parameters", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
    };
    const parse = (sequence: unknown) =>
      TurnReaderV11ResultSchema.safeParse({ ...base, sequence }).success;
    expect(parse({ action: "START", count: 3, topic: "my mandate" })).toBe(
      true,
    );
    expect(parse({ action: "STOP", count: null, topic: null })).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse({ action: "START", count: null, topic: "x" })).toBe(false);
    expect(parse({ action: "START", count: 11, topic: "x" })).toBe(false);
    expect(parse({ action: "STOP", count: 2, topic: null })).toBe(false);
    // Older readings, without the field, still parse as "no series".
    const old = TurnReaderV11ResultSchema.parse(base);
    expect(old.sequence).toBeNull();
  });
});
