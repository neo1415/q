import { describe, expect, it } from "vitest";

import { proposalStatusLine } from "../src/q/conversation-receipts.js";

/**
 * Live 2026-10-02 (Zino, 12:32-12:43): "have you booked?" was answered
 * "No… still waiting for your approval… Q looks after Nixo for you is
 * saved." An errand's status is where the errand stands, from its own
 * record, and a card's title is never used as if it were a status.
 */
describe("the status of work an approval started", () => {
  const ERRAND = {
    kind: "ACTION" as const,
    id: "p1",
    actionType: "errand.start",
    summary: "Q looks after Nixo for you",
  };

  it("'have you booked?' after the errand was approved: where it stands, never '<title> is saved'", () => {
    const line = proposalStatusLine([
      {
        ...ERRAND,
        status: "SAVED",
        progress:
          "Q is looking after Nixo for you: waiting for them to accept, so nothing is booked yet.",
      },
    ]);
    expect(line).toBe(
      "Q is looking after Nixo for you: waiting for them to accept, so nothing is booked yet.",
    );
    expect(line).not.toMatch(/is saved|waiting for your approval/);
  });

  it("still waiting for approval: the card's title quoted, never as a sentence of its own", () => {
    expect(proposalStatusLine([{ ...ERRAND, status: "PENDING" }])).toBe(
      '"Q looks after Nixo for you" is waiting for your approval, not saved yet. Tap Approve on its card, or tell me to go ahead.',
    );
  });

  it("an errand running and another card waiting: both, each in its own words", () => {
    expect(
      proposalStatusLine([
        {
          ...ERRAND,
          status: "SAVED",
          progress:
            "Q is looking after Nixo for you: messaging them to agree a time; nothing is booked yet.",
        },
        {
          kind: "ACTION",
          id: "p2",
          actionType: "chat.message.send",
          summary: "Message Nixo",
          status: "PENDING",
        },
      ]),
    ).toBe(
      'Q is looking after Nixo for you: messaging them to agree a time; nothing is booked yet. "Message Nixo" is waiting for your approval, not saved yet.',
    );
  });
});
