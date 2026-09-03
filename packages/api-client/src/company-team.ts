import {
  COMPANIES_PATH,
  COMPANY_FOUNDER_PROFILE_ME_SUFFIX,
  COMPANY_TEAM_FACTS_SUFFIX,
  COMPANY_TEAM_ME_SUFFIX,
  CompanyMemberDtoSchema,
  CompanyTeamFactsDtoSchema,
  FounderProfileDtoSchema,
  type UpdateCompanyTeamFactsRequest,
  type UpdateMyFounderProfileRequest,
  type UpsertMyCompanyMembershipRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

function companyPath(companyId: string, suffix: string): string {
  return `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${suffix}`;
}

/** `GET /v1/companies/:id/team/me` -- the caller's own current relationship. */
export function getMyCompanyMembership(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyPath(companyId, COMPANY_TEAM_ME_SUFFIX),
    CompanyMemberDtoSchema,
  );
}

/** `PUT /v1/companies/:id/team/me` -- idempotent desired state of the caller's relationship. */
export function upsertMyCompanyMembership(
  session: ApiSession,
  companyId: string,
  input: UpsertMyCompanyMembershipRequest,
) {
  return call(
    session,
    "PUT",
    companyPath(companyId, COMPANY_TEAM_ME_SUFFIX),
    CompanyMemberDtoSchema,
    {
      body: input,
    },
  );
}

/** `GET /v1/companies/:id/founder-profile/me`. */
export function getMyFounderProfile(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyPath(companyId, COMPANY_FOUNDER_PROFILE_ME_SUFFIX),
    FounderProfileDtoSchema,
  );
}

/** `PATCH /v1/companies/:id/founder-profile/me` -- omit `expectedVersion` on first creation. */
export function updateMyFounderProfile(
  session: ApiSession,
  companyId: string,
  input: UpdateMyFounderProfileRequest,
) {
  return call(
    session,
    "PATCH",
    companyPath(companyId, COMPANY_FOUNDER_PROFILE_ME_SUFFIX),
    FounderProfileDtoSchema,
    { body: input },
  );
}

/** `GET /v1/companies/:id/team-facts`. */
export function getCompanyTeamFacts(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyPath(companyId, COMPANY_TEAM_FACTS_SUFFIX),
    CompanyTeamFactsDtoSchema,
  );
}

/** `PATCH /v1/companies/:id/team-facts` -- omit `expectedVersion` on first creation. */
export function updateCompanyTeamFacts(
  session: ApiSession,
  companyId: string,
  input: UpdateCompanyTeamFactsRequest,
) {
  return call(
    session,
    "PATCH",
    companyPath(companyId, COMPANY_TEAM_FACTS_SUFFIX),
    CompanyTeamFactsDtoSchema,
    {
      body: input,
    },
  );
}
