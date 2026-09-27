import "server-only";

import { listRelationshipMeetings, listReminders } from "@capital-q/api-client";
import type { MeetingDto, ReminderDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

import { RelationshipScheduleControls } from "./relationship-schedule-controls";

/**
 * Calls and reminders on a relationship page (BIZ-008; R11, R33: every
 * capability Q has also has its screen). Read on the server as the person;
 * a non-party gets nothing, because the API answers them as it answers a
 * relationship that does not exist.
 */
export async function RelationshipSchedule({
  relationshipId,
  counterpart,
  connected,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly connected: boolean;
}) {
  const session = await apiSession();
  if (session === null) return null;
  let meetings: readonly MeetingDto[];
  let reminders: readonly ReminderDto[];
  try {
    const [meetingList, reminderList] = await Promise.all([
      listRelationshipMeetings(session, relationshipId),
      listReminders(session),
    ]);
    meetings = meetingList.items;
    reminders = reminderList.items.filter(
      (reminder) =>
        reminder.relationshipId === relationshipId &&
        reminder.meetingId === null,
    );
  } catch {
    return null;
  }
  return (
    <RelationshipScheduleControls
      relationshipId={relationshipId}
      counterpart={counterpart}
      connected={connected}
      initialMeetings={meetings}
      initialReminders={reminders}
    />
  );
}
