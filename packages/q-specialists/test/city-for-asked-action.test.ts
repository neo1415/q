import { describe, expect, it } from "vitest";

import { cityForAskedAction } from "../src/answer.js";

/**
 * Live 2026-10-16: the turn was unread, the answer asked "Which city or
 * time zone should I use for Friday at 10:00?" itself, and "Lagos." was
 * answered as small talk. The city continues the request it was asked for.
 */
const history = [
  {
    id: "u1",
    role: "USER",
    content:
      "Set me a reminder for Friday at 10am to review the cash forecast.",
  },
  {
    id: "q1",
    role: "Q",
    content:
      "Which city or time zone should I use for Friday at 10:00? I can also save it to your profile so I won't need to ask again.",
  },
  { id: "u2", role: "USER", content: "Lagos." },
];

describe("cityForAskedAction", () => {
  it("binds the city to the reminder Q asked it for", () => {
    expect(cityForAskedAction(history, history[2]!)).toEqual({
      tool: "propose_reminder",
      utterance:
        "Set me a reminder for Friday at 10am to review the cash forecast.",
      zone: "Africa/Lagos",
    });
  });

  it("a call to book is bound to the meeting tool", () => {
    const call = [
      {
        id: "u1",
        role: "USER",
        content: "Book a call with Nixo on Tuesday at 2pm",
      },
      { id: "q1", role: "Q", content: "What time zone are you in?" },
      { id: "u2", role: "USER", content: "I'm in Abuja" },
    ];
    expect(cityForAskedAction(call, call[2]!)?.tool).toBe("propose_meeting");
  });

  it("nothing when Q did not ask for a city, or the reply names no place", () => {
    const notAsked = [
      history[0]!,
      { id: "q1", role: "Q", content: "Done. I'll remind you." },
      history[2]!,
    ];
    expect(cityForAskedAction(notAsked, notAsked[2]!)).toBeNull();
    const noPlace = [
      ...history.slice(0, 2),
      { id: "u2", role: "USER", content: "thanks" },
    ];
    expect(cityForAskedAction(noPlace, noPlace[2]!)).toBeNull();
  });
});
