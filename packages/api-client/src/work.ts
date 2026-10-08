import {
  NOTIFICATION_SETTINGS_PATH,
  NotificationSettingsDtoSchema,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTION_PATH,
  PUSH_SUBSCRIPTION_REMOVE_PATH,
  PushKeyDtoSchema,
  Q_PRESENCE_PATH,
  Q_USAGE_PATH,
  Q_WORK_PATH,
  QUsageDtoSchema,
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
  Q_WORK_DONE_PATH,
  Q_WORK_SINCE_PATH,
  QWorkSinceDtoSchema,
  Q_WORK_SUGGESTION_DISMISSALS_PATH,
  Q_WORK_SUGGESTIONS_PATH,
  QWorkDonePageDtoSchema,
  QWorkSuggestionListDtoSchema,
  qWorkDelegationPath,
  qWorkPausePath,
  qWorkResumePath,
  Q_WORKFORCE_JOBS_PATH,
  Q_WORKFORCE_OVERVIEW_PATH,
  qWorkforceJobPath,
  qWorkforceDraftRetryPath,
  Q_BRIEFING_COMMAND_PATH,
  BriefingCommandResultDtoSchema,
  type BriefingCommandRequest,
  IDEMPOTENCY_KEY_HEADER,
  WorkforceDraftRetryResultDtoSchema,
  WorkforceJobDetailDtoSchema,
  WorkforceJobListDtoSchema,
  WorkforceOverviewDtoSchema,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/**
 * AUTO (ADR 0030): Q's delegated work (a Q API session) and Web Push with
 * notification settings (an API session).
 */

/** The person's own usage this month (a Q API session). Read-only. */
export function getMyUsage(session: ApiSession) {
  return call(session, "GET", Q_USAGE_PATH, QUsageDtoSchema);
}

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

// --- WORK-58: Q's work page -------------------------------------------------

/** `GET /v1/q/work/suggestions` (Q API): up to five, read by code. */
export function listQWorkSuggestions(session: ApiSession) {
  return call(
    session,
    "GET",
    Q_WORK_SUGGESTIONS_PATH,
    QWorkSuggestionListDtoSchema,
  );
}

/** `GET /v1/q/work/done` (Q API): what Q finished, a page at a time. */
export function listQWorkDone(
  session: ApiSession,
  page: { readonly cursor?: string | undefined; readonly limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (page.cursor !== undefined) query.set("cursor", page.cursor);
  if (page.limit !== undefined) query.set("limit", String(page.limit));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    `${Q_WORK_DONE_PATH}${suffix}`,
    QWorkDonePageDtoSchema,
  );
}

/** `GET /v1/q/work/since` (Q API): what happened since they were last here. */
export function getQWorkSince(session: ApiSession, since: string) {
  const query = new URLSearchParams({ since });
  return call(
    session,
    "GET",
    `${Q_WORK_SINCE_PATH}?${query.toString()}`,
    QWorkSinceDtoSchema,
  );
}

/** `POST /v1/q/work/suggestions/dismissals` (API, ADR 0040): "Not now". */
export function dismissQWorkSuggestion(session: ApiSession, key: string) {
  return call(
    session,
    "POST",
    Q_WORK_SUGGESTION_DISMISSALS_PATH,
    QWorkAcceptedDtoSchema,
    { body: { key } },
  );
}

/** `POST /v1/q/work/:id/pause` or `/resume` (API, ADR 0040). */
export function setQWorkPaused(
  session: ApiSession,
  delegationId: string,
  paused: boolean,
) {
  return call(
    session,
    "POST",
    paused ? qWorkPausePath(delegationId) : qWorkResumePath(delegationId),
    QWorkAcceptedDtoSchema,
    { body: {} },
  );
}

/**
 * `POST /v1/q/work/:id/delegation` (API): the person's own switch for
 * scoped delegation on one of their instructions.
 */
export function setQWorkDelegation(
  session: ApiSession,
  delegationId: string,
  enabled: boolean,
) {
  return call(
    session,
    "POST",
    qWorkDelegationPath(delegationId),
    QWorkAcceptedDtoSchema,
    { body: { enabled } },
  );
}

// WORKFORCE block (founder brief J5): Q's workforce, read-only (a Q API session).
export function listWorkforceJobs(
  session: ApiSession,
  query: { readonly cursor?: string | undefined; readonly limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return call(
    session,
    "GET",
    `${Q_WORKFORCE_JOBS_PATH}${suffix}`,
    WorkforceJobListDtoSchema,
  );
}

export function getWorkforceJob(session: ApiSession, jobId: string) {
  return call(
    session,
    "GET",
    qWorkforceJobPath(jobId),
    WorkforceJobDetailDtoSchema,
  );
}

export function getWorkforceOverview(session: ApiSession) {
  return call(
    session,
    "GET",
    Q_WORKFORCE_OVERVIEW_PATH,
    WorkforceOverviewDtoSchema,
  );
}
/**
 * `POST /v1/q/workforce/drafts/:draftId/retry` (Q API): "Ask Q to try
 * again" on a held message. A pass comes back OFFERED as an approval card.
 */
export function retryWorkforceDraft(
  session: ApiSession,
  draftId: string,
  relationshipId: string | null,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    qWorkforceDraftRetryPath(draftId),
    WorkforceDraftRetryResultDtoSchema,
    {
      body: { relationshipId },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}
/**
 * `POST /v1/q/briefing/command` (Q API): the person's own words about the
 * briefing's cards, read into card verbs. Changes nothing by itself.
 */
export function readBriefingCommand(
  session: ApiSession,
  request: BriefingCommandRequest,
) {
  return call(
    session,
    "POST",
    Q_BRIEFING_COMMAND_PATH,
    BriefingCommandResultDtoSchema,
    { body: request },
  );
}
// end WORKFORCE block
