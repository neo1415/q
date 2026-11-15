import type { MeetingRecord, ReminderRecord } from "./store.js";
import { meetingTimeLabel } from "./when.js";

/**
 * The meeting prep brief (BIZ-008), composed at T-24h for each person on
 * the call (v3, live 15 Nov 2026 D-Q4: the organiser's side and the other
 * side alike).
 *
 * Deterministic and model-free: it arranges what this person can already
 * see (the call, who is on it from the other side, their own open
 * reminders on this relationship) and points them to Q for depth. It
 * states no fact about the counterparty it was not given, and says so
 * when it has little. Each person's brief is built from their own
 * reminders only: nothing of one side's is in the other's (Context
 * Firewall).
 */

// v2 (2026-11-14): the time worded by the shared meeting-time formatter.
// v3 (2026-11-15): one per person on the call; an honest link line.
export const PREP_BRIEF_COMPOSER_VERSION = "prep-brief.v3";

/** The link line, honest about a call with no calendar invite (D-Q4). */
export function prepBriefLinkLine(input: {
  readonly meetLink: string | null;
  readonly calendarEvent: boolean;
}): string {
  if (input.meetLink !== null) return `Link: ${input.meetLink}`;
  return input.calendarEvent
    ? "Link: in your calendar invite"
    : "Link: none yet. No calendar invite was sent; share a video link in the chat, or connect Google Calendar in Settings to add a Meet link.";
}

export function composePrepBrief(input: {
  readonly meeting: MeetingRecord;
  /** The other side, as this person knows them. */
  readonly counterpartName: string;
  readonly openReminders: readonly ReminderRecord[];
  /** Whose brief: the people listed are the other side's. Absent: the organiser. */
  readonly forTenantId?: string | undefined;
  /** Whether a calendar event (and its invite) exists. Absent: true. */
  readonly calendarEvent?: boolean | undefined;
}): string {
  const { meeting } = input;
  const mine = input.forTenantId ?? meeting.organiserTenantId;
  const attendees = meeting.participants
    .filter((participant) => participant.participantTenantId !== mine)
    .map((participant) => participant.displayName);
  const minutes = Math.round(
    (meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000,
  );
  const lines = [
    `Prep brief: ${meeting.purpose}`,
    "",
    `When: ${meetingTimeLabel(meeting.startsAt, meeting.timeZone)} (${String(minutes)} minutes)`,
    `With: ${input.counterpartName}${attendees.length > 0 ? ` (${attendees.join(", ")})` : ""}`,
    prepBriefLinkLine({
      meetLink: meeting.meetLink,
      calendarEvent: input.calendarEvent ?? true,
    }),
    "",
    "Your open follow-ups on this relationship:",
    ...(input.openReminders.length === 0
      ? ["- none"]
      : input.openReminders
          .slice(0, 10)
          .map((reminder) => `- ${reminder.title}`)),
    "",
    "Ask Q on the relationship page for what has changed, the evidence behind it, and questions worth asking.",
  ];
  return lines.join("\n").slice(0, 8000);
}
