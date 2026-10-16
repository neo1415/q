import { describe, expect, it } from "vitest";

import { bareCityReply, cityForAskedAction } from "../src/answer.js";

/**
 * Live 2026-10-16: the turn was unread, the answer asked "Which city or
 * time zone should I use for Friday at 10:00?" itself, and "Lagos." was
 * answered as small talk. The city continues the request it was asked for.
 */
type Line = { id: string; role: string; content: string };

const REQUEST: Line = {
  id: "u1",
  role: "USER",
  content: "Set me a reminder for Friday at 10am to review the cash forecast.",
};
const ASKED: Line = {
  id: "q1",
  role: "Q",
  content:
    "Which city or time zone should I use for Friday at 10:00? I can also save it to your profile so I won't need to ask again.",
};
const LAGOS: Line = { id: "u2", role: "USER", content: "Lagos." };

describe("cityForAskedAction", () => {
  it("binds the city to the reminder Q asked it for", () => {
    expect(cityForAskedAction([REQUEST, ASKED, LAGOS], LAGOS)).toEqual({
      tool: "propose_reminder",
      utterance: REQUEST.content,
      zone: "Africa/Lagos",
    });
  });

  it("a call to book is bound to the meeting tool", () => {
    const reply: Line = { id: "u2", role: "USER", content: "I'm in Abuja" };
    const call: Line[] = [
      {
        id: "u1",
        role: "USER",
        content: "Book a call with Nixo on Tuesday at 2pm",
      },
      { id: "q1", role: "Q", content: "What time zone are you in?" },
      reply,
    ];
    expect(cityForAskedAction(call, reply)?.tool).toBe("propose_meeting");
  });

  it("nothing when Q did not ask for a city, or the reply names no place", () => {
    const done: Line = {
      id: "q1",
      role: "Q",
      content: "Done. I'll remind you.",
    };
    expect(cityForAskedAction([REQUEST, done, LAGOS], LAGOS)).toBeNull();
    const thanks: Line = { id: "u2", role: "USER", content: "thanks" };
    expect(cityForAskedAction([REQUEST, ASKED, thanks], thanks)).toBeNull();
  });
});

describe("bareCityReply (live 2026-10-16: 'Lagos.' got 'Your setup is complete…')", () => {
  it("a bare place after Q's city question is the place, as said", () => {
    expect(bareCityReply([REQUEST, ASKED, LAGOS], LAGOS)).toEqual({
      said: "Lagos",
      zone: "Africa/Lagos",
    });
  });

  it("not after another question, and not inside a longer sentence", () => {
    const done: Line = { id: "q1", role: "Q", content: "Anything else?" };
    expect(bareCityReply([REQUEST, done, LAGOS], LAGOS)).toBeNull();
    const long: Line = {
      id: "u2",
      role: "USER",
      content: "Tell me which investors in Lagos fund logistics companies",
    };
    expect(bareCityReply([REQUEST, ASKED, long], long)).toBeNull();
  });
});
