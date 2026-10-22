import {
  ActivityPageDtoSchema,
  ME_CAPABILITIES_PATH,
  MeCapabilitiesDtoSchema,
  MemberSummaryDtoSchema,
  ORGANISATION_ACTIVITY_PATH,
  ORGANISATION_MEMBER_SUMMARY_PATH,
  type ActivityQuery,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Organisation administration reads. Every call acts on the caller's
 * ACTIVE organisation, resolved by the API; nothing here names it. The
 * API decides who may read the feed and member summaries (403 otherwise).
 */

export const getMyCapabilities = (session: ApiSession) =>
  call(session, "GET", ME_CAPABILITIES_PATH, MeCapabilitiesDtoSchema);

/** Query string for the feed; empty values are left out. Cursor, never offset. */
export function activityQueryString(query: ActivityQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? "" : `?${text}`;
}

export const getOrganisationActivity = (
  session: ApiSession,
  query: ActivityQuery = {},
) =>
  call(
    session,
    "GET",
    `${ORGANISATION_ACTIVITY_PATH}${activityQueryString(query)}`,
    ActivityPageDtoSchema,
  );

export const getOrganisationMemberSummary = (
  session: ApiSession,
  userId: string,
) =>
  call(
    session,
    "GET",
    ORGANISATION_MEMBER_SUMMARY_PATH.replace(
      ":userId",
      encodeURIComponent(userId),
    ),
    MemberSummaryDtoSchema,
  );
