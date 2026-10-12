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

  it("carries list_q_work's jobs: the reviewer's changes and the questions word for word (live 2026-10-12)", () => {
    // Asked in a new conversation "what were the diligence questions your
    // team prepared for Ledgerfold, and what did the reviewer change?",
    // Q said neither was on record: list_q_work had returned both in
    // `jobs`, and this fact (how the turn reads list_q_work) dropped them.
    const questions = [
      "Of the 31 pilot ledgers you report, how many are in paid production today, and what is the median contract value?",
      "Your memo cites reconciliation error rates falling to 0.4%; which customers measured that, and over what period?",
      "Which licence or regulatory approval does Ledgerfold rely on to hold or move client funds, and who issued it?",
      "What share of revenue comes from your three largest customers, and when do their current contracts renew?",
      "How many months of runway do you have at today's burn, and what does the round you are raising extend that to?",
    ];
    const fact = ownDayFact({
      now: NOW,
      timeZone: "Africa/Lagos",
      schedule: null,
      approvals: {
        items: [{ summary: "Send Ledgerfold five founder questions" }],
      },
      work: {
        items: [],
        errands: [],
        jobs: [
          {
            jobId: "366de9de-0000-4000-8000-000000000001",
            goal: "Research Ledgerfold again",
            state: "FAILED",
            finishedAt: "2026-10-02T06:50:00.000Z",
            inThisConversation: false,
            review: null,
            diligence: null,
          },
          {
            jobId: "43b7bdb4-bcb6-431c-85f5-aef2e40f5d65",
            goal: "Research Ledgerfold, write a memo, have it reviewed and prepare founder diligence questions",
            state: "COMPLETED",
            finishedAt: "2026-10-02T06:00:00.000Z",
            inThisConversation: false,
            review: {
              outcome: "REVISED",
              documentTitle: "Ledgerfold memo",
              findings: [
                {
                  kind: "UNSUPPORTED",
                  section: "Traction",
                  problem: "The 0.4% error rate is stated without a source.",
                },
              ],
              fromVersion: 1,
              toVersion: 2,
              revisionNote:
                "Traction: The 0.4% error rate is stated without a source. Fix: mark it as the founder's claim.",
              sectionsChanged: ["Traction"],
            },
            diligence: { questions, filedForApproval: true },
          },
        ],
      },
      rehearsals: [],
    }).statement;
    expect(fact).toContain(
      'Reviewer revised "Ledgerfold memo" from version 1 to 2.',
    );
    expect(fact).toContain(
      "Traction (unsupported): The 0.4% error rate is stated without a source.",
    );
    expect(fact).toContain("Fix: mark it as the founder's claim.");
    expect(fact).toContain("Sections whose text changed: Traction.");
    for (const question of questions) expect(fact).toContain(question);
    expect(fact).toContain("filed for their approval; not sent");
    // The failed job's missing review is unknown, not invented.
    expect(fact).toContain(
      "Reviewer's critique and changes: not recorded (unknown).",
    );
    expect(fact.length).toBeLessThanOrEqual(8_000);
  });
});
