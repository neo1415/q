import { describe, expect, it } from "vitest";

import { scheduleBlock } from "../src/q/result-blocks.js";

/**
 * Live 2026-10-28: the SCHEDULE block is built by code from list_schedule's
 * own result. Today's items when there are any, else the next seven days;
 * calls soonest first; the brief flag from the read; nothing from a guess.
 */

const NOW = new Date("2026-10-28T09:00:00.000Z");
const RELATIONSHIP = "91000000-0000-4000-8000-000000000001";

const call = (id: string, startsAt: string, brief: string | null) => ({
  id,
  relationshipId: RELATIONSHIP,
  purpose: `Call ${id}`,
  startsAt,
  local: startsAt,
  organisedByYou: false,
  with: ["Ada"],
  brief,
});

describe("scheduleBlock", () => {
  it("shows today's calls and reminders in time order, in their zone", () => {
    const block = scheduleBlock({
      now: NOW,
      timeZone: "Africa/Lagos",
      schedule: {
        meetings: [
          call("late", "2026-10-28T16:00:00.000Z", null),
          call("early", "2026-10-28T11:00:00.000Z", "Ready."),
          call("next-week", "2026-11-02T11:00:00.000Z", null),
        ],
        reminders: [
          {
            id: "r1",
            title: "Send the deck",
            dueAt: "2026-10-28T13:00:00.000Z",
            relationshipId: null,
          },
        ],
      },
      approvals: { items: [{ summary: "Message Apex" }] },
    });
    expect(block?.kind).toBe("SCHEDULE");
    if (block?.kind !== "SCHEDULE") return;
    expect(block.span).toBe("TODAY");
    expect(block.timeZone).toBe("Africa/Lagos");
    expect(block.calls.map((one) => one.meetingId)).toEqual(["early", "late"]);
    expect(block.calls[0]?.briefReady).toBe(true);
    expect(block.calls[1]?.briefReady).toBe(false);
    expect(block.reminders).toHaveLength(1);
    expect(block.approvals).toEqual(["Message Apex"]);
  });

  it("falls back to the next seven days when nothing is on today, UTC when the zone is unknown", () => {
    const block = scheduleBlock({
      now: NOW,
      timeZone: null,
      schedule: {
        meetings: [call("thu", "2026-10-30T11:00:00.000Z", null)],
        reminders: [],
      },
    });
    expect(block?.kind).toBe("SCHEDULE");
    if (block?.kind !== "SCHEDULE") return;
    expect(block.span).toBe("WEEK");
    expect(block.timeZone).toBeNull();
    expect(block.calls.map((one) => one.meetingId)).toEqual(["thu"]);
    expect(block.approvals).toEqual([]);
  });

  it("draws nothing from a result that is not the schedule read", () => {
    expect(
      scheduleBlock({ now: NOW, timeZone: null, schedule: "not a read" }),
    ).toBeNull();
  });
});
