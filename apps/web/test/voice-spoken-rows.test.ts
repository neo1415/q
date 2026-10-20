import { describe, expect, it } from "vitest";

import { isNearBottom } from "../src/features/q/follow-newest";
import { spokenNotYetStored, threadInOrder } from "../src/features/q/spoken";

/**
 * Spoken rows beside the stored thread (live test 2026-09-27, failure 9):
 * one utterance is one row and one reply is one row, whether the row is
 * still the live transcript or has become the stored conversation.
 */
describe("spoken rows once the conversation is stored", () => {
  const spoken = [
    { id: "u1", role: "user" as const, text: "Make me a pitch deck." },
    {
      id: "q1",
      role: "q" as const,
      // What the voice said: the answer, trimmed for listening.
      text: "The deck should be about Zino Aviation. It is ready.",
    },
  ];

  it("shows the spoken reply until the stored reply to the same utterance exists", () => {
    expect(
      spokenNotYetStored(spoken, [
        { kind: "PERSON", text: "Make me a pitch deck" },
      ]).map((line) => line.id),
    ).toEqual(["q1"]);
  });

  it("gives way to the stored reply, which is one row, though its words differ", () => {
    expect(
      spokenNotYetStored(spoken, [
        { kind: "PERSON", text: "Make me a pitch deck" },
        {
          kind: "Q",
          text: "The deck should be about Zino Aviation (ZINO AVIATION LTD). It is ready; download it from the card.",
        },
      ]),
    ).toEqual([]);
  });

  it("keeps a reply whose utterance is not stored yet", () => {
    expect(
      spokenNotYetStored(
        [
          ...spoken,
          { id: "u2", role: "user", text: "And a one-pager?" },
          { id: "q2", role: "q", text: "Yes, here it is." },
        ],
        [
          { kind: "PERSON", text: "Make me a pitch deck" },
          { kind: "Q", text: "The stored deck answer." },
        ],
      ).map((line) => line.id),
    ).toEqual(["u2", "q2"]);
  });
});

describe("one thread in the order things were said (founder report 2026-10-01)", () => {
  const stored = [
    { id: "t1", text: "What's my runway?" },
    { id: "t2", text: "About nine months." },
    { id: "t3", text: "And burn?" },
    { id: "t4", text: "About 40k a month." },
  ];
  it("keeps a greeting heard before anything first, not at the bottom", () => {
    const order = threadInOrder(stored, [
      { id: "g", text: "Welcome back.", after: null },
    ]).map((line) => line.id);
    expect(order).toEqual(["g", "t1", "t2", "t3", "t4"]);
  });

  it("keeps a spoken-only line where it was heard", () => {
    const order = threadInOrder(stored, [
      { id: "s1", text: "Alright, leaving it as it is.", after: "t2" },
      { id: "s2", text: "Mm.", after: "t2" },
    ]).map((line) => line.id);
    expect(order).toEqual(["t1", "t2", "s1", "s2", "t3", "t4"]);
  });

  it("puts a line whose turn is not in view, or unknown, at the end", () => {
    const order = threadInOrder(stored, [
      { id: "x", text: "Still there?", after: "gone" },
      { id: "y", text: "Yes.", after: undefined },
    ]).map((line) => line.id);
    expect(order).toEqual(["t1", "t2", "t3", "t4", "x", "y"]);
  });
});

describe("following the newest message", () => {
  it("counts the last stretch of a thread as the bottom", () => {
    expect(
      isNearBottom({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 450 }),
    ).toBe(true);
    expect(
      isNearBottom({ scrollHeight: 2000, scrollTop: 800, clientHeight: 450 }),
    ).toBe(false);
  });
});

/**
 * Founder report 2026-10-20: a reply reported in pieces showed each piece
 * as its own row, split around the stored answer.
 */
describe("a spoken reply in pieces", () => {
  const pieces = [
    {
      id: "u1",
      role: "user" as const,
      text: "Who should I pitch?",
      after: "t1",
    },
    { id: "q1", role: "q" as const, text: "I'm pulling your", after: "t1" },
    { id: "q2", role: "q" as const, text: "best fit investors", after: "t1" },
    { id: "q3", role: "q" as const, text: "now.", after: "t1" },
  ];

  it("is one row under the first piece's id", () => {
    expect(spokenNotYetStored(pieces, [])).toEqual([
      pieces[0],
      {
        id: "q1",
        role: "q",
        text: "I'm pulling your best fit investors now.",
        after: "t1",
      },
    ]);
  });

  it("gives way as a whole once the stored reply exists", () => {
    expect(
      spokenNotYetStored(pieces, [
        { kind: "PERSON", text: "Who should I pitch?" },
        { kind: "Q", text: "For Nixo, the most beneficial investors..." },
      ]),
    ).toEqual([]);
  });

  it("keeps two replies heard at different places apart", () => {
    expect(
      spokenNotYetStored(
        [
          { id: "q1", role: "q" as const, text: "Welcome back.", after: null },
          { id: "q2", role: "q" as const, text: "Here it is.", after: "t2" },
        ],
        [],
      ).map((line) => line.id),
    ).toEqual(["q1", "q2"]);
  });
});
