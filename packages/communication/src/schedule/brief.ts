import type { MeetingRecord, ReminderRecord } from "./store.js";

/**
 * The meeting prep brief (BIZ-008), composed at T-24h for the organiser.
 *
 * Deterministic and model-free: it arranges what the organiser can already
 * see (the call, who is invited, their own open reminders on this
 * relationship) and points them to Q for depth. It states no fact about
 * the counterparty it was not given, and says so when it has little.
 */

export const PREP_BRIEF_COMPOSER_VERSION = "prep-brief.v1";

function when(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export function composePrepBrief(input: {
  readonly meeting: MeetingRecord;
  readonly counterpartName: string;
  readonly openReminders: readonly ReminderRecord[];
}): string {
  const { meeting } = input;
  const attendees = meeting.participants
    .filter((participant) => participant.role === "ATTENDEE")
    .map((participant) => participant.displayName);
  const minutes = Math.round(
    (meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000,
  );
  const lines = [
    `Prep brief: ${meeting.purpose}`,
    "",
    `When: ${when(meeting.startsAt, meeting.timeZone)} (${String(minutes)} minutes)`,
    `With: ${input.counterpartName}${attendees.length > 0 ? ` (${attendees.join(", ")})` : ""}`,
    meeting.meetLink === null
      ? "Link: in your calendar invite"
      : `Link: ${meeting.meetLink}`,
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
