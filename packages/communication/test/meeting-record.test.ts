import { describe, expect, it } from "vitest";

import { meetingAssistantView } from "../src/index.js";

/**
 * ADR 0027 + spec 6.9.6: both sides of a call read what was said; Q's own
 * analysis stays with the person it was written for.
 */
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const MEETING = "00000000-0000-4000-8000-0000000000b1";

const row = {
  id: "00000000-0000-4000-8000-0000000000c1",
  meeting_id: MEETING,
  tenant_id: "00000000-0000-4000-8000-0000000000d1",
  user_id: OWNER,
  provider_bot_id: null,
  status: "DONE" as const,
  failure: null,
  summary: "They pushed hard on churn; your answer was thin.",
  flags: [{ kind: "RISK", text: "Churn answer was thin", speaker: null }],
  follow_ups: [{ text: "Send churn cohort data", owner: null }],
  transcript: [{ speaker: "Kemi", text: "We could do 500k." }],
  attendees: [{ name: "Kemi", side: "INVESTOR" }],
  agreements: ["Second call next week"],
  commitments: [
    {
      party: "Kemi",
      amount: "$500k",
      firmness: "EXPLORATORY",
      quote: "We could do 500k.",
    },
  ],
  declined_by_user_id: null,
  declined_by_name: null,
  declined_at: null,
  updated_at: new Date("2026-09-30T10:00:00Z"),
};

describe("the meeting record", () => {
  it("gives the owner the whole record", () => {
    const view = meetingAssistantView(row, MEETING, OWNER);
    expect(view.summary).toBe(row.summary);
    expect(view.flags).toHaveLength(1);
    expect(view.followUps).toHaveLength(1);
    expect(view.transcript).toHaveLength(1);
  });

  it("gives the other side what was said, never Q's analysis for the owner", () => {
    const view = meetingAssistantView(row, MEETING, OTHER);
    expect(view.summary).toBeNull();
    expect(view.flags).toEqual([]);
    expect(view.followUps).toEqual([]);
    expect(view.transcript).toEqual(row.transcript);
    expect(view.attendees).toEqual(row.attendees);
    expect(view.agreements).toEqual(row.agreements);
    expect(view.commitments).toEqual(row.commitments);
  });

  it("says who declined recording, to everyone on the call", () => {
    const declined = {
      ...row,
      status: "DECLINED" as const,
      declined_by_user_id: OTHER,
      declined_by_name: "Kemi",
      declined_at: new Date("2026-09-30T09:00:00Z"),
    };
    expect(meetingAssistantView(declined, MEETING, OWNER).declined).toEqual({
      byYou: false,
      byName: "Kemi",
      at: "2026-09-30T09:00:00.000Z",
    });
    expect(meetingAssistantView(declined, MEETING, OTHER).declined?.byYou).toBe(
      true,
    );
    expect(meetingAssistantView(row, MEETING, OWNER).declined).toBeNull();
  });
});
