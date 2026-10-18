import type { MeetingDto, RelationshipStateV2 } from "@capital-q/contracts";

/**
 * The booked call to ask "How did the call go?" about (2026-10-03): a
 * still-CONNECTED match whose latest booked call has ended. Without the
 * meeting bot nothing else marks a call held, so the person is asked, on
 * either side, once the booked time has passed. Answering names the call;
 * the server checks it is this relationship's own, ended, booked call.
 */
export type CallToRecord = {
  readonly meetingId: string;
  readonly startsAt: string;
};

export function callToRecord(
  state: RelationshipStateV2,
  meetings: readonly MeetingDto[],
  now: number,
): CallToRecord | null {
  if (state !== "CONNECTED") return null;
  const ended = meetings
    .filter(
      (meeting) =>
        meeting.status === "SCHEDULED" && Date.parse(meeting.endsAt) <= now,
    )
    .toSorted((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt));
  const latest = ended[0];
  return latest === undefined
    ? null
    : { meetingId: latest.id, startsAt: latest.startsAt };
}
