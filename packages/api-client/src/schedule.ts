import {
  CreateReminderRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  MEETING_BRIEF_PATH,
  MEETING_CANCEL_PATH,
  MeetingBriefDtoSchema,
  MeetingDtoSchema,
  MeetingListSchema,
  MeetingSlotsResponseSchema,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_PATH,
  NotificationListSchema,
  RELATIONSHIP_MEETING_JOIN_PATH,
  RELATIONSHIP_MEETING_SLOTS_PATH,
  RELATIONSHIP_MEETINGS_PATH,
  REMINDER_DISMISS_PATH,
  REMINDERS_PATH,
  ReminderDtoSchema,
  ReminderListSchema,
  type CreateReminderRequest,
  type JoinMeetingRequest,
  type MeetingSlotsRequest,
  type ScheduleMeetingRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** Meetings, reminders and notifications (BIZ-008). No call carries a token. */

const withId = (template: string, name: string, id: string) =>
  template.replace(`:${name}`, encodeURIComponent(id));

async function noContent(
  session: ApiSession,
  path: string,
  body?: unknown,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${path}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
}

export function listRelationshipMeetings(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    withId(RELATIONSHIP_MEETINGS_PATH, "relationshipId", relationshipId),
    MeetingListSchema,
  );
}

export function findMeetingSlots(
  session: ApiSession,
  relationshipId: string,
  request: MeetingSlotsRequest,
) {
  return call(
    session,
    "POST",
    withId(RELATIONSHIP_MEETING_SLOTS_PATH, "relationshipId", relationshipId),
    MeetingSlotsResponseSchema,
    { body: request },
  );
}

export function scheduleMeeting(
  session: ApiSession,
  relationshipId: string,
  request: ScheduleMeetingRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    withId(RELATIONSHIP_MEETINGS_PATH, "relationshipId", relationshipId),
    MeetingDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** meet-47: Q joins a Google Meet already running; the same link now is one call. */
export function joinMeetingCall(
  session: ApiSession,
  relationshipId: string,
  request: JoinMeetingRequest,
) {
  return call(
    session,
    "POST",
    withId(RELATIONSHIP_MEETING_JOIN_PATH, "relationshipId", relationshipId),
    MeetingDtoSchema,
    { body: request },
  );
}

export function cancelMeeting(session: ApiSession, meetingId: string) {
  return noContent(
    session,
    withId(MEETING_CANCEL_PATH, "meetingId", meetingId),
  );
}

export function getMeetingBrief(session: ApiSession, meetingId: string) {
  return call(
    session,
    "GET",
    withId(MEETING_BRIEF_PATH, "meetingId", meetingId),
    MeetingBriefDtoSchema,
  );
}

export function listReminders(session: ApiSession) {
  return call(session, "GET", REMINDERS_PATH, ReminderListSchema);
}

export function createReminder(
  session: ApiSession,
  request: CreateReminderRequest,
  idempotencyKey: string,
) {
  return call(session, "POST", REMINDERS_PATH, ReminderDtoSchema, {
    body: CreateReminderRequestSchema.parse(request),
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

export function dismissReminder(session: ApiSession, reminderId: string) {
  return noContent(
    session,
    withId(REMINDER_DISMISS_PATH, "reminderId", reminderId),
  );
}

export function listNotifications(session: ApiSession) {
  return call(session, "GET", NOTIFICATIONS_PATH, NotificationListSchema);
}

export function markNotificationsRead(
  session: ApiSession,
  ids: readonly string[],
) {
  return noContent(session, NOTIFICATIONS_READ_PATH, { ids });
}
