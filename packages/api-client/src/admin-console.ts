import { z } from "zod";

import {
  ADMIN_ACCOUNT_PATH,
  ADMIN_ACCOUNT_SUSPENSION_PATH,
  ADMIN_ACCOUNTS_PATH,
  ADMIN_AUDIT_PATH,
  ADMIN_BREAK_GLASS_CHAT_PATH,
  ADMIN_BREAK_GLASS_DECISION_PATH,
  ADMIN_BREAK_GLASS_PATH,
  ADMIN_EMAIL_PATH,
  ADMIN_FLAG_PATH,
  ADMIN_FLAGS_PATH,
  ADMIN_ME_PATH,
  ADMIN_ORGANISATION_PATH,
  ADMIN_ORGANISATION_SUSPENSION_PATH,
  ADMIN_ORGANISATIONS_PATH,
  ADMIN_Q_ERRORS_PATH,
  ADMIN_Q_MONITOR_PATH,
  ADMIN_Q_RUN_PATH,
  ADMIN_SAFETY_PATH,
  ADMIN_SAFETY_REVIEW_PATH,
  ADMIN_STEP_UP_PATH,
  ADMIN_TEAM_MEMBER_PATH,
  ADMIN_TEAM_PATH,
  ADMIN_VERIFICATION_DECISION_PATH,
  ADMIN_VERIFICATION_PATH,
  AdminAccountDetailDtoSchema,
  AdminAccountListDtoSchema,
  AdminAuditPageDtoSchema,
  AdminBreakGlassChatDtoSchema,
  AdminBreakGlassCreatedDtoSchema,
  AdminBreakGlassDecisionDtoSchema,
  AdminBreakGlassListDtoSchema,
  AdminEmailDtoSchema,
  AdminFlagChangedDtoSchema,
  AdminFlagListDtoSchema,
  AdminMeDtoSchema,
  AdminOrganisationDetailDtoSchema,
  AdminOrganisationListDtoSchema,
  AdminQErrorsDtoSchema,
  AdminQMonitorDtoSchema,
  AdminQRunTraceDtoSchema,
  AdminSafetyDtoSchema,
  AdminStepUpDtoSchema,
  AdminSuspensionDtoSchema,
  AdminTeamChangedDtoSchema,
  AdminTeamDtoSchema,
  AdminVerificationDecisionDtoSchema,
  AdminVerificationListDtoSchema,
  adminPath,
  type AdminAuditQuery,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The operations console (ADR 0033). Every call is a 404 for anyone who is
 * not a platform admin holding the permission; sensitive writes throw
 * STEP_UP_REQUIRED until the admin confirms it's them.
 */

const Reviewed = z.object({ reviewed: z.literal(true) }).strict();

const query = (
  params: Readonly<Record<string, string | number | undefined>>,
) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? "" : `?${text}`;
};

export const getAdminMe = (session: ApiSession) =>
  call(session, "GET", ADMIN_ME_PATH, AdminMeDtoSchema);

export const postAdminStepUp = (session: ApiSession, accessToken: string) =>
  call(session, "POST", ADMIN_STEP_UP_PATH, AdminStepUpDtoSchema, {
    body: { accessToken },
  });

export const searchAdminAccounts = (session: ApiSession, q: string) =>
  call(
    session,
    "GET",
    `${ADMIN_ACCOUNTS_PATH}${query({ q })}`,
    AdminAccountListDtoSchema,
  );

export const getAdminAccount = (session: ApiSession, userId: string) =>
  call(
    session,
    "GET",
    adminPath(ADMIN_ACCOUNT_PATH, { userId }),
    AdminAccountDetailDtoSchema,
  );

export const setAdminAccountSuspension = (
  session: ApiSession,
  userId: string,
  body: { readonly suspend: boolean; readonly reason: string },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_ACCOUNT_SUSPENSION_PATH, { userId }),
    AdminSuspensionDtoSchema,
    { body },
  );

export const searchAdminOrganisations = (session: ApiSession, q: string) =>
  call(
    session,
    "GET",
    `${ADMIN_ORGANISATIONS_PATH}${query({ q })}`,
    AdminOrganisationListDtoSchema,
  );

export const getAdminOrganisation = (
  session: ApiSession,
  organisationId: string,
) =>
  call(
    session,
    "GET",
    adminPath(ADMIN_ORGANISATION_PATH, { organisationId }),
    AdminOrganisationDetailDtoSchema,
  );

export const setAdminOrganisationSuspension = (
  session: ApiSession,
  organisationId: string,
  body: { readonly suspend: boolean; readonly reason: string },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_ORGANISATION_SUSPENSION_PATH, { organisationId }),
    AdminSuspensionDtoSchema,
    { body },
  );

export const getAdminVerificationQueue = (session: ApiSession) =>
  call(session, "GET", ADMIN_VERIFICATION_PATH, AdminVerificationListDtoSchema);

export const decideAdminVerification = (
  session: ApiSession,
  claimId: string,
  body: {
    readonly status: "VERIFIED" | "REVOKED";
    readonly decisionBasis: string;
    readonly revocationReason?: string | null;
  },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_VERIFICATION_DECISION_PATH, { claimId }),
    AdminVerificationDecisionDtoSchema,
    { body },
  );

export const getAdminSafety = (session: ApiSession, all = false) =>
  call(
    session,
    "GET",
    `${ADMIN_SAFETY_PATH}${all ? "?all=1" : ""}`,
    AdminSafetyDtoSchema,
  );

export const reviewAdminReport = (
  session: ApiSession,
  reportId: string,
  body: {
    readonly outcome:
      "NO_ACTION" | "WARNED" | "ACCOUNT_SUSPENDED" | "ESCALATED";
    readonly note: string;
    readonly suspendUserId?: string | null;
  },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_SAFETY_REVIEW_PATH, { reportId }),
    Reviewed,
    {
      body,
    },
  );

export const getAdminBreakGlass = (session: ApiSession) =>
  call(session, "GET", ADMIN_BREAK_GLASS_PATH, AdminBreakGlassListDtoSchema);

export const requestAdminBreakGlass = (
  session: ApiSession,
  body: {
    readonly targetType: "RELATIONSHIP_CHAT" | "Q_RUN";
    readonly targetId: string;
    readonly reason: string;
  },
) =>
  call(
    session,
    "POST",
    ADMIN_BREAK_GLASS_PATH,
    AdminBreakGlassCreatedDtoSchema,
    { body },
  );

export const decideAdminBreakGlass = (
  session: ApiSession,
  requestId: string,
  body: { readonly approve: boolean; readonly note: string },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_BREAK_GLASS_DECISION_PATH, { requestId }),
    AdminBreakGlassDecisionDtoSchema,
    { body },
  );

export const readAdminBreakGlassChat = (
  session: ApiSession,
  requestId: string,
) =>
  call(
    session,
    "GET",
    adminPath(ADMIN_BREAK_GLASS_CHAT_PATH, { requestId }),
    AdminBreakGlassChatDtoSchema,
  );

export const getAdminQMonitor = (
  session: ApiSession,
  window: "24h" | "7d" | "30d",
) =>
  call(
    session,
    "GET",
    `${ADMIN_Q_MONITOR_PATH}${query({ window })}`,
    AdminQMonitorDtoSchema,
  );

export const getAdminQErrors = (session: ApiSession) =>
  call(session, "GET", ADMIN_Q_ERRORS_PATH, AdminQErrorsDtoSchema);

export const getAdminQRun = (session: ApiSession, runId: string) =>
  call(
    session,
    "GET",
    adminPath(ADMIN_Q_RUN_PATH, { runId }),
    AdminQRunTraceDtoSchema,
  );

export const searchAdminAudit = (
  session: ApiSession,
  filters: AdminAuditQuery,
) =>
  call(
    session,
    "GET",
    `${ADMIN_AUDIT_PATH}${query({ ...filters })}`,
    AdminAuditPageDtoSchema,
  );

export const getAdminFlags = (session: ApiSession) =>
  call(session, "GET", ADMIN_FLAGS_PATH, AdminFlagListDtoSchema);

export const setAdminFlag = (
  session: ApiSession,
  key: string,
  body: { readonly enabled: boolean; readonly reason: string },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_FLAG_PATH, { key }),
    AdminFlagChangedDtoSchema,
    { body },
  );

export const getAdminEmail = (session: ApiSession, refresh = false) =>
  call(
    session,
    "GET",
    `${ADMIN_EMAIL_PATH}${refresh ? "?refresh=1" : ""}`,
    AdminEmailDtoSchema,
  );

export const getAdminTeam = (session: ApiSession) =>
  call(session, "GET", ADMIN_TEAM_PATH, AdminTeamDtoSchema);

export const grantAdminRole = (
  session: ApiSession,
  body: {
    readonly email: string;
    readonly role: string;
    readonly reason: string;
  },
) =>
  call(session, "POST", ADMIN_TEAM_PATH, AdminTeamChangedDtoSchema, { body });

export const revokeAdminRole = (
  session: ApiSession,
  userId: string,
  reason: string,
) =>
  call(
    session,
    "DELETE",
    adminPath(ADMIN_TEAM_MEMBER_PATH, { userId }),
    AdminTeamChangedDtoSchema,
    { body: { reason } },
  );
