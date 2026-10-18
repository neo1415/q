import { describe, expect, it } from "vitest";

import type { MeetingDto } from "@capital-q/contracts";

import { callToRecord } from "@/features/relationships/call-to-record";

const meeting = (
  id: string,
  startsAt: string,
  status: MeetingDto["status"] = "SCHEDULED",
): MeetingDto => ({
  id,
  relationshipId: "33333333-0000-4000-8000-000000000009",
  purpose: "First call",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
  timeZone: "Africa/Lagos",
  status,
  organisedByYou: false,
  organiserName: "Amara",
  meetLink: null,
  attendees: [],
  hasBrief: false,
});

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

describe("which booked call to ask about", () => {
  it("asks about the latest call that has ended, on a CONNECTED match", () => {
    expect(
      callToRecord(
        "CONNECTED",
        [
          meeting("a", "2026-10-04T09:00:00.000Z"),
          meeting("b", "2026-10-06T09:00:00.000Z"),
          meeting("c", "2026-10-09T09:00:00.000Z"),
        ],
        NOW,
      ),
    ).toEqual({ meetingId: "b", startsAt: "2026-10-06T09:00:00.000Z" });
  });

  it("asks nothing before a call ends, for a cancelled call, or past CONNECTED", () => {
    expect(
      callToRecord(
        "CONNECTED",
        [meeting("c", "2026-10-09T09:00:00.000Z")],
        NOW,
      ),
    ).toBeNull();
    expect(
      callToRecord(
        "CONNECTED",
        [meeting("x", "2026-10-04T09:00:00.000Z", "CANCELLED")],
        NOW,
      ),
    ).toBeNull();
    expect(
      callToRecord(
        "MEETING_HELD",
        [meeting("a", "2026-10-04T09:00:00.000Z")],
        NOW,
      ),
    ).toBeNull();
  });
});
