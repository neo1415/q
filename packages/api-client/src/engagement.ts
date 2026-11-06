import {
  ANALYTICS_SETTINGS_PATH,
  AnalyticsSettingsDtoSchema,
  ENGAGEMENT_EVENTS_PATH,
  RecordEngagementBatchResponseSchema,
  VIEWING_PRIVACY_PATH,
  ViewingPrivacyDtoSchema,
  type RecordEngagementBatchRequest,
  type UpdateAnalyticsSettingsRequest,
  type ViewingVisibility,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Engagement analytics (Q Workspace §8): a batch of what was on screen. */
export function recordEngagement(
  session: ApiSession,
  batch: RecordEngagementBatchRequest,
) {
  return call(
    session,
    "POST",
    ENGAGEMENT_EVENTS_PATH,
    RecordEngagementBatchResponseSchema,
    { body: batch },
  );
}

/** The person's own viewing-privacy setting (§6.7.13). */
export function getViewingPrivacy(session: ApiSession) {
  return call(session, "GET", VIEWING_PRIVACY_PATH, ViewingPrivacyDtoSchema);
}

export function setViewingPrivacy(
  session: ApiSession,
  visibility: ViewingVisibility,
) {
  return call(session, "PUT", VIEWING_PRIVACY_PATH, ViewingPrivacyDtoSchema, {
    body: { visibility },
  });
}

/** Admin: the analytics privacy settings (Q Workspace §8). */
export function getAdminAnalyticsSettings(session: ApiSession) {
  return call(
    session,
    "GET",
    ANALYTICS_SETTINGS_PATH,
    AnalyticsSettingsDtoSchema,
  );
}

export function updateAdminAnalyticsSettings(
  session: ApiSession,
  body: UpdateAnalyticsSettingsRequest,
) {
  return call(
    session,
    "PUT",
    ANALYTICS_SETTINGS_PATH,
    AnalyticsSettingsDtoSchema,
    { body },
  );
}
