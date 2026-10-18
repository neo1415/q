import {
  Q_DAILY_PATH,
  Q_DAILY_PREFERENCES_PATH,
  Q_DAILY_REQUESTS_PATH,
  QDailyEditionSchema,
  QDailyHomeDtoSchema,
  QDailyPreferencesSchema,
  QDailyRequestDtoSchema,
  qDailyEditionPath,
  type SetQDailyPreferencesRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The Q Daily (DAILY): the person's own latest edition, archive page and
 * preferences. A Q API session; the Q API reads by the session's actor.
 */
export function getQDaily(session: ApiSession, before?: string) {
  const query =
    before === undefined ? "" : `?before=${encodeURIComponent(before)}`;
  return call(session, "GET", `${Q_DAILY_PATH}${query}`, QDailyHomeDtoSchema);
}

export function getQDailyEdition(session: ApiSession, editionId: string) {
  return call(
    session,
    "GET",
    qDailyEditionPath(editionId),
    QDailyEditionSchema,
  );
}

export function getQDailyPreferences(session: ApiSession) {
  return call(
    session,
    "GET",
    Q_DAILY_PREFERENCES_PATH,
    QDailyPreferencesSchema,
  );
}

export function setQDailyPreferences(
  session: ApiSession,
  patch: SetQDailyPreferencesRequest,
) {
  return call(
    session,
    "PUT",
    Q_DAILY_PREFERENCES_PATH,
    QDailyPreferencesSchema,
    { body: patch },
  );
}

/** "Prepare my edition": queued once; refused too soon or when off. */
export function requestQDailyEdition(session: ApiSession) {
  return call(session, "POST", Q_DAILY_REQUESTS_PATH, QDailyRequestDtoSchema, {
    body: {},
  });
}
