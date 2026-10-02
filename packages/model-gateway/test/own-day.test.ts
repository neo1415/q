import { describe, expect, it } from "vitest";

import { ownDayFact } from "../src/q/own-day.js";

/**
 * Their day (founder demo 2026-10-02): "what are my tasks for today?" got
 * "I don't have a task list" and put today's 12:30 UTC call tomorrow; "how
 * have I been doing in my rehearsals?" got "no rehearsal results".
 */
const NOW = new Date("2026-10-02T07:10:00Z");
const SCHEDULE = {
  meetings: [
    {
      purpose: "Nixo intro",
      startsAt: "2026-10-02T12:30:00.000Z",
      with: ["Priya"],
    },
  ],
  reminders: [{ title: "Prep questions", dueAt: "2026-10-02T09:00:00.000Z" }],
};

describe("their own day, read for them", () => {
  it("says today's call and reminder as today, in their zone, with now", () => {
    const fact = ownDayFact({
      now: NOW,
      timeZone: "Africa/Lagos",
      schedule: SCHEDULE,
      approvals: { items: [{ summary: "Reminder: Prep questions" }] },
      work: {
        items: [],
        errands: [{ counterpartName: "Kazikit", status: "RUNNING" }],
      },
      rehearsals: [
        {
          withName: "Nixo",
          endedAt: "2026-10-02T06:38:02Z",
          score: 46,
          outcome: "DECLINED",
          overall: "Strong questions, weak structure.",
          tip: "Open with a clear structure.",
        },
      ],
    }).statement;
    expect(fact).toContain("Now for them: Fri 2 Oct, 08:10 Africa/Lagos.");
    expect(fact).toContain("today 13:30: Nixo intro with Priya");
    expect(fact).toContain("today 10:00: Prep questions");
    expect(fact).toContain(
      "Waiting for their approval (1): Reminder: Prep questions.",
    );
    expect(fact).toContain("Kazikit (RUNNING)");
    expect(fact).toContain(
      "with Nixo (Fri 2 Oct, 07:38, score 46/100, outcome declined)",
    );
    expect(fact).toContain("Top tip: Open with a clear structure.");
  });

  it("says the zone is unknown rather than pretending UTC is theirs", () => {
    const fact = ownDayFact({
      now: NOW,
      timeZone: null,
      schedule: SCHEDULE,
      approvals: null,
      work: null,
      rehearsals: [],
    }).statement;
    expect(fact).toContain("UTC (their own time zone is not known)");
    expect(fact).toContain("today 12:30: Nixo intro");
    expect(fact).toContain("Rehearsals finished: none yet.");
  });
});
