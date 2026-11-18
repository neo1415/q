import { describe, expect, it } from "vitest";

import type { QTurnReading } from "@capital-q/model-gateway/q";

import { ownStatementClearOf } from "../src/execution-reading.js";

/**
 * ADR 0081 (owner decision 105): a founder's own figure is recorded with no
 * card only when the reading lets their words be taken as their own. A
 * low-confidence or garbled voice transcript, a re-heard turn, or a turn
 * about a named other company still asks first.
 */
const reading = (over: Record<string, unknown> = {}): QTurnReading =>
  ({
    kind: "STATEMENT",
    confidence: "HIGH",
    transcript: "CLEAR",
    aboutNamedOther: false,
    namedOther: null,
    question: null,
    tool: null,
    ...over,
  }) as unknown as QTurnReading;

const typed = {};
const spoken = { utteranceRef: "utt-1" };

describe("ownStatementClearOf", () => {
  it("typed and clearly spoken statements are clear", () => {
    expect(ownStatementClearOf(reading(), typed)).toBe(true);
    expect(ownStatementClearOf(reading(), spoken)).toBe(true);
    expect(
      ownStatementClearOf(reading({ kind: "QUESTION_TO_Q" }), spoken),
    ).toBe(true);
  });

  it("low confidence, a noisy or garbled transcript, or a re-heard turn is not", () => {
    expect(ownStatementClearOf(null, typed)).toBe(false);
    expect(ownStatementClearOf(reading({ confidence: "LOW" }), typed)).toBe(
      false,
    );
    expect(
      ownStatementClearOf(reading({ kind: "UNCLEAR_TRANSCRIPT" }), spoken),
    ).toBe(false);
    expect(
      ownStatementClearOf(reading({ transcript: "FRAGMENT" }), typed),
    ).toBe(false);
    expect(ownStatementClearOf(reading({ transcript: "NOISY" }), spoken)).toBe(
      false,
    );
    expect(
      ownStatementClearOf(reading(), { utteranceRef: "utt-1:heard" }),
    ).toBe(false);
  });

  it("words for someone else, or about a named other company, are not", () => {
    expect(ownStatementClearOf(reading({ addressedToQ: false }), spoken)).toBe(
      false,
    );
    expect(ownStatementClearOf(reading({ aboutNamedOther: true }), typed)).toBe(
      false,
    );
    expect(
      ownStatementClearOf(
        reading({ namedOther: { name: "Acme", kind: "COMPANY" } }),
        typed,
      ),
    ).toBe(false);
  });
});
