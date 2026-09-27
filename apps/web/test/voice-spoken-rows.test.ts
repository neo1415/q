import { describe, expect, it } from "vitest";

import { spokenNotYetStored } from "../src/features/q/spoken";

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
