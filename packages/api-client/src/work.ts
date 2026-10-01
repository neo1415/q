import {
  NOTIFICATION_SETTINGS_PATH,
  NotificationSettingsDtoSchema,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTION_PATH,
  PUSH_SUBSCRIPTION_REMOVE_PATH,
  PushKeyDtoSchema,
  Q_PRESENCE_PATH,
  Q_WORK_PATH,
  QWorkAcceptedDtoSchema,
  QWorkDetailDtoSchema,
  qWorkItemPath,
  qWorkLaneAnswerPath,
  qWorkLanePath,
  qWorkLaneReportPath,
  QWorkListDtoSchema,
  QWorkReportDtoSchema,
  type NotificationSettingsRequest,
  type PushSubscriptionRequest,
  type QWorkLaneAnswerRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/**
 * AUTO (ADR 0029): Q's delegated work (a Q API session) and Web Push with
 * notification settings (an API session).
 */

export function listQWork(session: ApiSession) {
  return call(session, "GET", Q_WORK_PATH, QWorkListDtoSchema);
}

export function getQWork(session: ApiSession, delegationId: string) {
  return call(
    session,
    "GET",
    qWorkItemPath(delegationId),
    QWorkDetailDtoSchema,
  );
}

export function stopQWork(
  session: ApiSession,
  delegationId: string,
  laneId: string | null,
) {
  return call(
    session,
    "DELETE",
    laneId === null
      ? qWorkItemPath(delegationId)
      : qWorkLanePath(delegationId, laneId),
    QWorkAcceptedDtoSchema,
  );
}

export function answerQWork(
  session: ApiSession,
  delegationId: string,
  laneId: string,
  answer: QWorkLaneAnswerRequest,
) {
  return call(
    session,
    "POST",
    qWorkLaneAnswerPath(delegationId, laneId),
    QWorkAcceptedDtoSchema,
    { body: answer },
  );
}

export function getQWorkReport(
  session: ApiSession,
  delegationId: string,
  laneId: string,
) {
  return call(
    session,
    "GET",
    qWorkLaneReportPath(delegationId, laneId),
    QWorkReportDtoSchema,
  );
}

/** The report as PDF bytes, for a download route to pass through. */
export async function getQWorkReportPdf(
  session: ApiSession,
  delegationId: string,
  laneId: string,
): Promise<ArrayBuffer> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${qWorkLaneReportPath(delegationId, laneId)}`,
    {
      headers: {
        accept: "application/pdf",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
  return response.arrayBuffer();
}

export function setQPresence(session: ApiSession, away: boolean) {
  return call(session, "PUT", Q_PRESENCE_PATH, QWorkAcceptedDtoSchema, {
    body: { away },
  });
}

export function getPushKey(session: ApiSession) {
  return call(session, "GET", PUSH_KEY_PATH, PushKeyDtoSchema);
}

async function noContent(
  session: ApiSession,
  method: "PUT" | "POST",
  path: string,
  body: unknown,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${path}`,
    {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
}

export function subscribePush(
  session: ApiSession,
  subscription: PushSubscriptionRequest,
) {
  return noContent(session, "PUT", PUSH_SUBSCRIPTION_PATH, subscription);
}

export function unsubscribePush(session: ApiSession, endpoint: string) {
  return noContent(session, "POST", PUSH_SUBSCRIPTION_REMOVE_PATH, {
    endpoint,
  });
}

export function getNotificationSettings(session: ApiSession) {
  return call(
    session,
    "GET",
    NOTIFICATION_SETTINGS_PATH,
    NotificationSettingsDtoSchema,
  );
}

export function saveNotificationSettings(
  session: ApiSession,
  settings: NotificationSettingsRequest,
) {
  return call(
    session,
    "PUT",
    NOTIFICATION_SETTINGS_PATH,
    NotificationSettingsDtoSchema,
    { body: settings },
  );
}
