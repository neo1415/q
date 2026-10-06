import {
  AcceptInvitationResultDtoSchema,
  INVITATION_ACCEPT_PATH,
  INVITATION_PREVIEW_PATH,
  INVITATION_TOKEN_HEADER,
  InvitationPreviewDtoSchema,
  InviteResultDtoSchema,
  JOIN_REQUESTS_PATH,
  JoinRequestResultDtoSchema,
  LeaveResultDtoSchema,
  MY_ORGANISATIONS_PATH,
  MyOrganisationsDtoSchema,
  ORGANISATIONS_PATH,
  ActivateOrganisationResponseSchema,
  TEAM_INVITATION_PATH,
  TEAM_INVITATION_RESEND_PATH,
  TEAM_INVITATIONS_PATH,
  TEAM_JOIN_REQUEST_DECISION_PATH,
  TEAM_LEAVE_PATH,
  TEAM_MEMBER_REMOVE_PATH,
  TEAM_MEMBER_ROLE_PATH,
  TEAM_OWNERSHIP_OFFER_RESPONSE_PATH,
  TEAM_OWNERSHIP_OFFERS_PATH,
  TEAM_PATH,
  TeamDtoSchema,
  type InvitableRole,
  type InviteRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * G1/G2: the company or firm as a team. Every call acts on the caller's
 * active organisation, resolved by the API; nothing here names it.
 */

const at = (path: string, params: Readonly<Record<string, string>>) =>
  Object.entries(params).reduce(
    (out, [key, value]) => out.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );

export const getTeam = (session: ApiSession) =>
  call(session, "GET", TEAM_PATH, TeamDtoSchema);

export const inviteToTeam = (session: ApiSession, body: InviteRequest) =>
  call(session, "POST", TEAM_INVITATIONS_PATH, InviteResultDtoSchema, { body });

export const resendTeamInvitation = (
  session: ApiSession,
  invitationId: string,
) =>
  call(
    session,
    "POST",
    at(TEAM_INVITATION_RESEND_PATH, { invitationId }),
    TeamDtoSchema,
  );

export const revokeTeamInvitation = (
  session: ApiSession,
  invitationId: string,
) =>
  call(
    session,
    "DELETE",
    at(TEAM_INVITATION_PATH, { invitationId }),
    TeamDtoSchema,
  );

export const changeTeamRole = (
  session: ApiSession,
  membershipId: string,
  role: InvitableRole,
) =>
  call(
    session,
    "PUT",
    at(TEAM_MEMBER_ROLE_PATH, { membershipId }),
    TeamDtoSchema,
    {
      body: { role },
    },
  );

export const removeTeamMember = (
  session: ApiSession,
  membershipId: string,
  handOverTo: string | null,
) =>
  call(
    session,
    "POST",
    at(TEAM_MEMBER_REMOVE_PATH, { membershipId }),
    TeamDtoSchema,
    { body: { handOverTo } },
  );

export const leaveTeam = (session: ApiSession) =>
  call(session, "POST", TEAM_LEAVE_PATH, LeaveResultDtoSchema, { body: {} });

export const offerTeamOwnership = (session: ApiSession, membershipId: string) =>
  call(session, "POST", TEAM_OWNERSHIP_OFFERS_PATH, TeamDtoSchema, {
    body: { membershipId },
  });

export const respondToTeamOwnership = (
  session: ApiSession,
  offerId: string,
  accept: boolean,
) =>
  call(
    session,
    "POST",
    at(TEAM_OWNERSHIP_OFFER_RESPONSE_PATH, { offerId }),
    TeamDtoSchema,
    { body: { accept } },
  );

export const decideTeamJoinRequest = (
  session: ApiSession,
  requestId: string,
  approve: boolean,
) =>
  call(
    session,
    "POST",
    at(TEAM_JOIN_REQUEST_DECISION_PATH, { requestId }),
    TeamDtoSchema,
    { body: { approve } },
  );

export const getMyOrganisations = (session: ApiSession) =>
  call(session, "GET", MY_ORGANISATIONS_PATH, MyOrganisationsDtoSchema);

/** Switching: the server sets the active context from the person's own membership. */
export const switchOrganisation = (
  session: ApiSession,
  organisationId: string,
) =>
  call(
    session,
    "POST",
    `${ORGANISATIONS_PATH}/${encodeURIComponent(organisationId)}/activate`,
    ActivateOrganisationResponseSchema,
  );

/** The token travels in a header, never in a URL. Anonymous is fine. */
export const previewInvitation = (session: ApiSession, token: string) =>
  call(session, "GET", INVITATION_PREVIEW_PATH, InvitationPreviewDtoSchema, {
    headers: { [INVITATION_TOKEN_HEADER]: token },
  });

export const acceptInvitation = (session: ApiSession, token: string) =>
  call(
    session,
    "POST",
    INVITATION_ACCEPT_PATH,
    AcceptInvitationResultDtoSchema,
    {
      body: { token },
    },
  );

export const requestToJoin = (
  session: ApiSession,
  organisationId: string,
  message?: string,
) =>
  call(session, "POST", JOIN_REQUESTS_PATH, JoinRequestResultDtoSchema, {
    body:
      message === undefined ? { organisationId } : { organisationId, message },
  });
