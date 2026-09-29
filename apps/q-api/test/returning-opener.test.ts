import { describe, expect, it } from "vitest";

import {
  composeReturningOpener,
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

describe("the returning opener", () => {
  it("leads with a call coming up and offers to prep", () => {
    const line = composeReturningOpener(
      "Zino",
      {
        ...none,
        nextCall: {
          purpose: "Call with Kazikit",
          startsAt: new Date("2026-09-30T11:00:00.000Z"),
        },
        remindersDue: 2,
      },
      NOW,
    );
    expect(line).toBe(
      'Hi Zino. You have "Call with Kazikit" in about 3 hours. And 2 reminders due today. Want me to prep you for it?',
    );
  });

  it("offers notes, then a reminder, then what came in", () => {
    expect(
      composeReturningOpener("Zino", { ...none, notesReady: 1 }, NOW),
    ).toContain("My notes from your last call are ready");
    expect(
      composeReturningOpener(
        null,
        { ...none, remindersDue: 1, firstReminder: "Follow up with Ada" },
        NOW,
      ),
    ).toBe(
      'Welcome back. You asked me to remind you: "Follow up with Ada". Want to deal with it now?',
    );
    expect(
      composeReturningOpener("Zino", { ...none, unreadNotices: 3 }, NOW),
    ).toContain("3 things came in");
  });

  it("still offers something when nothing is waiting", () => {
    expect(composeReturningOpener("Zino", none, NOW)).toBe(
      "Hi Zino. Want me to see what's new for you, or is there something on your mind?",
    );
  });
});
