import { describe, expect, it } from "vitest";

import { agreedTimesChecked } from "../src/composition/call-prep.js";

/**
 * Owner live 18 Nov 2026 (Zino Aviation x Tensorgate, run 14aa8772): "I've
 * missed the meeting with these guys on Monday" was answered "No meeting is
 * booked with Tensorgate yet". The meetings table held nothing ahead; the
 * time had been agreed in the relationship's messages. Replayed from the
 * stored messages (communication.messages, relationship ea7388fd); no live
 * call.
 */

// What Tensorgate wrote, as the prep's material read it (their messages).
const MESSAGES = [
  "Hello — thank you for following up. Monday 16 November at 10:00 a.m. Africa/Lagos works for me for the 30-minute introductory call. I’m also working through the outstanding diligence requests, including the data-room access, the three requested items, and the tax filings and Delaware good standing. I look forward to speaking with you.",
  "Best, Daniel",
].join("\n");

const QUOTE =
  "Monday 16 November at 10:00 a.m. Africa/Lagos works for me for the 30-minute introductory call.";
// 11:21:21 UTC on Wednesday 18 November.
const NOW = Date.parse("2026-11-18T11:21:21.000Z");

describe("a time agreed in the messages, checked by code (defect 2)", () => {
  it("Daniel's confirmation is kept, from the messages, and has passed", () => {
    expect(
      agreedTimesChecked({
        agreed: [{ startsAt: "2026-11-16T10:00:00+01:00", quote: QUOTE }],
        messages: MESSAGES,
        cancelled: [],
        now: NOW,
      }),
    ).toEqual([
      { startsAt: "2026-11-16T10:00:00+01:00", quote: QUOTE, passed: true },
    ]);
  });

  it("words the messages do not hold are never said", () => {
    expect(
      agreedTimesChecked({
        agreed: [
          {
            startsAt: "2026-11-16T10:00:00+01:00",
            quote: "Monday at 10 works, see you then",
          },
        ],
        messages: MESSAGES,
        cancelled: [],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("a start the meetings record cancelled is not said as agreed", () => {
    expect(
      agreedTimesChecked({
        agreed: [{ startsAt: "2026-11-16T10:00:00+01:00", quote: QUOTE }],
        messages: MESSAGES,
        cancelled: ["2026-11-16T09:00:00.000Z"],
        now: NOW,
      }),
    ).toEqual([]);
  });
});
