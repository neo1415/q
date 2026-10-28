import { describe, expect, it } from "vitest";

import type { QResponseMessage } from "@capital-q/contracts";

import {
  boundedCompletedMessage,
  fitsRunEvent,
  jsonbTextLength,
  RUN_EVENT_PAYLOAD_MAX,
} from "../src/q/completed-event.js";

/**
 * Production 2026-10-28 (run 33a9f3c7, investor Savanna Seed): "What's in
 * my pipeline?" failed with "Q couldn't finish that" because the
 * completed-message event, carrying ten fit cards, overran
 * run_events' 16384-character payload bound and the whole transaction
 * rolled back. The event is bounded; the record keeps everything.
 */
function message(
  over: Partial<QResponseMessage> & { readonly text: string },
): QResponseMessage {
  return {
    messageId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    role: "Q",
    createdAt: "2026-10-28T09:27:32.000Z",
    ...over,
  } as QResponseMessage;
}

const card = (index: number) => ({
  key: `c${String(index)}`,
  name: `Company ${String(index)}`,
  line: "A seed-stage company in Nigeria doing something long enough to count",
  about: "x".repeat(150),
  raise: "$1.5 million (from their pitch)",
  hue: 1,
  fit: null,
  reasons: Array.from({ length: 6 }, () => "y".repeat(150)),
  measures: [],
  view: "Meet: ask who leads the round and why now",
  said: "z".repeat(280),
  sourceCount: 3,
  subject: null,
});

const cards = (count: number) =>
  [
    {
      kind: "ANSWER_CARDS",
      shape: "RANKED",
      title: "Your pipeline",
      cards: Array.from({ length: count }, (_, index) => card(index)),
      followUps: [],
    },
  ] as unknown as QResponseMessage["blocks"];

describe("jsonbTextLength", () => {
  it("never under-counts Postgres' jsonb text (a space after each ':' and ',')", () => {
    const value = { a: 1, b: [1, 2], c: "x:y,z" };
    // Postgres prints {"a": 1, "b": [1, 2], "c": "x:y,z"} = 36 characters.
    expect(jsonbTextLength(value)).toBeGreaterThanOrEqual(36);
  });
});

describe("boundedCompletedMessage", () => {
  it("keeps a message that fits, blocks and all", () => {
    const given = message({
      text: "You have 12 relationships on Capital Q.",
      blocks: cards(1),
    });
    const bounded = boundedCompletedMessage(given);
    expect(bounded.trimmed).toBe("NONE");
    expect(bounded.message).toBe(given);
  });

  it("drops the blocks from the event when they overrun the bound; the text stays", () => {
    const given = message({
      text: "You have 12 relationships on Capital Q.",
      blocks: cards(10),
    });
    expect(fitsRunEvent({ message: given })).toBe(false);
    const bounded = boundedCompletedMessage(given);
    expect(bounded.trimmed).toBe("BLOCKS");
    expect(bounded.message.text).toBe(given.text);
    expect("blocks" in bounded.message).toBe(false);
    expect(fitsRunEvent({ message: bounded.message })).toBe(true);
  });

  it("cuts text that alone overruns the bound, to what fits", () => {
    const given = message({ text: "w".repeat(RUN_EVENT_PAYLOAD_MAX * 2) });
    const bounded = boundedCompletedMessage(given);
    expect(bounded.trimmed).toBe("BLOCKS_AND_TEXT");
    expect(bounded.message.text?.length ?? 0).toBeGreaterThan(0);
    expect(fitsRunEvent({ message: bounded.message })).toBe(true);
  });
});
