import {
  IDEMPOTENCY_KEY_HEADER,
  qMeetingAssistantPath,
  QMeetingAssistantDtoSchema,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Whether Q is coming to the caller's call, and its notes. A Q API session. */
export function getMeetingAssistant(session: ApiSession, meetingId: string) {
  return call(
    session,
    "GET",
    qMeetingAssistantPath(meetingId),
    QMeetingAssistantDtoSchema,
  );
}

/** The organiser brings Q to their call; one key per press. */
export function bringMeetingAssistant(
  session: ApiSession,
  meetingId: string,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    qMeetingAssistantPath(meetingId),
    QMeetingAssistantDtoSchema,
    { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** The organiser takes Q back out before the call. */
export function dismissMeetingAssistant(
  session: ApiSession,
  meetingId: string,
) {
  return call(
    session,
    "DELETE",
    qMeetingAssistantPath(meetingId),
    QMeetingAssistantDtoSchema,
  );
}
