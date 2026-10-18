import { describe, expect, it } from "vitest";

import {
  composeReturningOpener,
  plainOpener,
  type OpenerFacts,
} from "../src/voice/returning-opener.js";

/** Proactive Q (founder direction 2026-09-29): what is theirs, first. */
const NOW = new Date("2026-09-30T08:00:00.000Z");
const none: OpenerFacts = {
  nextCall: null,
  remindersDue: 0,
  firstReminder: null,
  notesReady: 0,
  unreadNotices: 0,
};

const FEW =
  "You have a few things waiting. Would you like to look at them now, or talk about something else?";

/**
 * Owner 2026-10-16: the server's fallback opener is the web's opener --
 * the greeting, that things wait (never a number it cannot stand behind),
 * and the two choices -- and never lists an item.
 */
describe("the returning opener", () => {
  it("says things are waiting and offers the two choices, never the list", () => {
    const line = composeReturningOpener(
      "Zino",
      {
        ...none,
        nextCall: {
          purpose: "Call with Kazikit",
          startsAt: new Date("2026-09-30T11:00:00.000Z"),
        },
        remindersDue: 2,
        firstReminder: "Follow up with Ada",
        notesReady: 1,
        notesQuestion: "How did it go?",
        unreadNotices: 3,
        scoutFinding: "Kazikit opens a Lagos office",
        instructionNews: "While you were away, I sent 4 messages.",
      },
      NOW,
    );
    expect(line).toBe(`Hi Zino. ${FEW}`);
    for (const item of [
      "Kazikit",
      "Ada",
      "notes",
      "reminder",
      "How did it go",
      "sent 4",
      "3",
    ]) {
      expect(line).not.toContain(item);
    }
  });

  it.each([
    ["a call coming up", { nextCall: { purpose: "x", startsAt: NOW } }],
    ["a reminder due", { remindersDue: 1, firstReminder: "x" }],
    ["call notes", { notesReady: 1 }],
    ["an unread notice", { unreadNotices: 1 }],
    ["a scout finding", { scoutFinding: "x" }],
  ] as const)("any one thing waiting (%s) is 'a few things'", (_, more) => {
    expect(composeReturningOpener(null, { ...none, ...more }, NOW)).toBe(
      `Welcome back. ${FEW}`,
    );
  });

  it("with nothing waiting: the greeting and one open question", () => {
    expect(composeReturningOpener("Zino", none, NOW)).toBe(
      "Hi Zino. What would you like to look at?",
    );
    // Work Q did is news, not something waiting.
    expect(
      composeReturningOpener(
        "Zino",
        { ...none, instructionNews: "While you were away, I sent 4 messages." },
        NOW,
      ),
    ).toBe("Hi Zino. What would you like to look at?");
  });

  it("with no read at all: the plain hello, which claims nothing", () => {
    expect(plainOpener("Zino")).toBe(
      "Hi Zino. What would you like to look at?",
    );
    expect(plainOpener(null)).toBe("Hi. What would you like to look at?");
  });
});

describe("by their clock (2026-10-08)", () => {
  it("greets by the person's own clock when their time zone is known (2026-10-08)", () => {
    // 08:00 UTC is 09:00 in Lagos and 04:00 in New York.
    expect(
      composeReturningOpener(
        "Zino",
        { ...none, timeZone: "Africa/Lagos" },
        NOW,
      ),
    ).toMatch(/^Good morning, Zino\. /u);
    expect(
      composeReturningOpener(
        "Zino",
        { ...none, timeZone: "America/New_York" },
        NOW,
      ),
    ).toMatch(/^Hi Zino, you're up late\. /u);
    // An unknown zone is not guessed at.
    expect(
      composeReturningOpener("Zino", { ...none, timeZone: "Not/AZone" }, NOW),
    ).toMatch(/^Hi Zino\. /u);
  });
});
