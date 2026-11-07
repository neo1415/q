import { z } from "zod";

import {
  ANALYTICS_SETTINGS_PATH,
  AnalyticsSettingsDtoSchema,
  COMPANY_ENGAGEMENT_PATH,
  CompanyEngagementDtoSchema,
  INVESTOR_VIEWS_PATH,
  InvestorViewingDtoSchema,
  MY_ENGAGEMENT_PATH,
  MY_INVESTOR_VIEWING_PATH,
  type RecordInvestorViewRequest,
  MyEngagementDtoSchema,
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

/** A founder's company engagement, as the analytics projection shows it. */
export function getCompanyEngagement(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    COMPANY_ENGAGEMENT_PATH.replace(
      ":companyId",
      encodeURIComponent(companyId),
    ),
    CompanyEngagementDtoSchema,
  );
}

/** The person's own engagement: what they viewed and founders' answers. */
export function getMyEngagement(session: ApiSession) {
  return call(session, "GET", MY_ENGAGEMENT_PATH, MyEngagementDtoSchema);
}

/** A founder's view of an investor's profile; the answer never says whether it counted. */
export function recordInvestorView(
  session: ApiSession,
  view: RecordInvestorViewRequest,
) {
  return call(session, "POST", INVESTOR_VIEWS_PATH, z.object({}).loose(), {
    body: view,
  });
}

/** Who viewed the signed-in investor's firm: aggregates only. */
export function getMyInvestorViewing(session: ApiSession) {
  return call(
    session,
    "GET",
    MY_INVESTOR_VIEWING_PATH,
    InvestorViewingDtoSchema,
  );
}
