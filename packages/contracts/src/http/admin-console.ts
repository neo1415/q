import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * The operations console (ADR 0033, docs/specs/2026-10/admin.md §7). Every
 * path answers 404 to anyone who is not a platform admin holding the
 * permission; sensitive writes answer STEP_UP_REQUIRED without a live
 * step-up. Response shapes are strict so nothing extra leaks.
 */

export const ADMIN_ROLE_VALUES = [
  "platform_owner",
  "operator",
  "trust_and_safety",
  "support",
  "analyst",
] as const;
export const AdminRoleSchema = z.enum(ADMIN_ROLE_VALUES);

export const ADMIN_ME_PATH = "/v1/admin/me" as const;
export const ADMIN_STEP_UP_PATH = "/v1/admin/step-up" as const;
export const ADMIN_ACCOUNTS_PATH = "/v1/admin/accounts" as const;
export const ADMIN_ACCOUNT_PATH = "/v1/admin/accounts/:userId" as const;
export const ADMIN_ACCOUNT_SUSPENSION_PATH =
  "/v1/admin/accounts/:userId/suspension" as const;
export const ADMIN_ORGANISATIONS_PATH = "/v1/admin/organisations" as const;
export const ADMIN_ORGANISATION_PATH =
  "/v1/admin/organisations/:organisationId" as const;
export const ADMIN_ORGANISATION_SUSPENSION_PATH =
  "/v1/admin/organisations/:organisationId/suspension" as const;
export const ADMIN_VERIFICATION_PATH = "/v1/admin/verification/claims" as const;
export const ADMIN_VERIFICATION_DECISION_PATH =
  "/v1/admin/verification/claims/:claimId/decision" as const;
export const ADMIN_SAFETY_PATH = "/v1/admin/safety" as const;
export const ADMIN_SAFETY_REVIEW_PATH =
  "/v1/admin/safety/reports/:reportId/review" as const;
export const ADMIN_BREAK_GLASS_PATH = "/v1/admin/break-glass" as const;
export const ADMIN_BREAK_GLASS_DECISION_PATH =
  "/v1/admin/break-glass/:requestId/decision" as const;
export const ADMIN_BREAK_GLASS_CHAT_PATH =
  "/v1/admin/break-glass/:requestId/chat" as const;
export const ADMIN_Q_MONITOR_PATH = "/v1/admin/q/monitor" as const;
export const ADMIN_Q_ERRORS_PATH = "/v1/admin/q/errors" as const;
export const ADMIN_Q_RUN_PATH = "/v1/admin/q/runs/:runId" as const;
export const ADMIN_AUDIT_PATH = "/v1/admin/audit" as const;
export const ADMIN_FLAGS_PATH = "/v1/admin/flags" as const;
export const ADMIN_FLAG_PATH = "/v1/admin/flags/:key" as const;
export const ADMIN_EMAIL_PATH = "/v1/admin/email" as const;
export const ADMIN_TEAM_PATH = "/v1/admin/team" as const;
export const ADMIN_TEAM_MEMBER_PATH = "/v1/admin/team/:userId" as const;

export function adminPath(
  template: string,
  params: Readonly<Record<string, string>>,
): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  );
}

const Iso = z.string().max(40);
const Name = z.string().max(300).nullable();
const Reason = z.string().trim().min(3).max(500);

// --- me / step-up -------------------------------------------------------------

export const AdminMeDtoSchema = z
  .object({
    role: AdminRoleSchema,
    permissions: z.array(z.string().max(64)).max(64),
    permissionsVersion: z.number().int(),
    stepUpExpiresAt: Iso.nullable(),
  })
  .strict();
export type AdminMeDto = z.infer<typeof AdminMeDtoSchema>;

export const AdminStepUpRequestSchema = z
  .object({ accessToken: z.string().min(16).max(4096) })
  .strict();
export const AdminStepUpDtoSchema = z.object({ expiresAt: Iso }).strict();

// --- accounts / organisations -------------------------------------------------

export const AdminAccountRowDtoSchema = z
  .object({
    userId: UuidSchema,
    name: Name,
    email: Name,
    createdAt: Iso,
    suspended: z.boolean(),
    organisations: z.array(z.string().max(300)).max(50),
  })
  .strict();
export const AdminAccountListDtoSchema = z
  .object({ rows: z.array(AdminAccountRowDtoSchema).max(25) })
  .strict();
export type AdminAccountRowDto = z.infer<typeof AdminAccountRowDtoSchema>;

export const AdminAccountDetailDtoSchema = AdminAccountRowDtoSchema.extend({
  country: z.string().max(2).nullable(),
  memberships: z
    .array(
      z
        .object({
          organisationId: UuidSchema,
          organisationName: z.string().max(300),
          organisationType: z.string().max(64),
          status: z.string().max(32),
          roles: z.array(z.string().max(64)).max(20),
        })
        .strict(),
    )
    .max(50),
  suspensions: z
    .array(
      z
        .object({
          action: z.enum(["SUSPENDED", "UNSUSPENDED"]),
          reason: z.string().max(500),
          actorName: Name,
          occurredAt: Iso,
        })
        .strict(),
    )
    .max(50),
  qPaused: z
    .object({ at: Iso, reason: z.string().nullable() })
    .strict()
    .nullable(),
  counts: z
    .object({
      qRuns: z.number().int(),
      documents: z.number().int(),
      rehearsals: z.number().int(),
    })
    .strict(),
  adminRole: z.string().max(32).nullable(),
}).strict();
export type AdminAccountDetailDto = z.infer<typeof AdminAccountDetailDtoSchema>;

export const AdminSuspensionRequestSchema = z
  .object({ suspend: z.boolean(), reason: Reason })
  .strict();
export const AdminSuspensionDtoSchema = z
  .object({ suspended: z.boolean(), changed: z.number().int().min(0) })
  .strict();

export const AdminOrganisationRowDtoSchema = z
  .object({
    organisationId: UuidSchema,
    name: z.string().max(300),
    type: z.string().max(64),
    country: z.string().max(2).nullable(),
    members: z.number().int(),
    createdAt: Iso,
  })
  .strict();
export const AdminOrganisationListDtoSchema = z
  .object({ rows: z.array(AdminOrganisationRowDtoSchema).max(25) })
  .strict();
export type AdminOrganisationRowDto = z.infer<
  typeof AdminOrganisationRowDtoSchema
>;

export const AdminOrganisationDetailDtoSchema =
  AdminOrganisationRowDtoSchema.extend({
    website: z.string().max(500).nullable(),
    kind: z.enum(["COMPANY", "INVESTOR", "OTHER"]),
    relationships: z.number().int(),
    verification: z
      .array(
        z
          .object({
            claimType: z.string().max(32),
            status: z.string().max(32),
            method: z.string().max(64).nullable(),
            at: Iso,
          })
          .strict(),
      )
      .max(20),
    memberList: z
      .array(
        z
          .object({
            userId: UuidSchema,
            name: Name,
            status: z.string().max(32),
            suspended: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  }).strict();
export type AdminOrganisationDetailDto = z.infer<
  typeof AdminOrganisationDetailDtoSchema
>;

// --- verification -------------------------------------------------------------

export const AdminVerificationRowDtoSchema = z
  .object({
    claimId: UuidSchema,
    tenantId: UuidSchema,
    claimType: z.string().max(32),
    subjectType: z.string().max(32),
    subjectName: Name,
    subjectDomain: z.string().max(253).nullable(),
    organisationId: UuidSchema,
    organisationName: z.string().max(300),
    companyName: Name,
    website: z.string().max(500).nullable(),
    country: z.string().max(2).nullable(),
    requesterName: Name,
    requesterEmail: Name,
    synthetic: z.boolean(),
    evidenceSourceId: UuidSchema.nullable(),
    requestedAt: Iso,
  })
  .strict();
export const AdminVerificationListDtoSchema = z
  .object({ rows: z.array(AdminVerificationRowDtoSchema).max(200) })
  .strict();
export type AdminVerificationRowDto = z.infer<
  typeof AdminVerificationRowDtoSchema
>;

export const AdminVerificationDecisionRequestSchema = z
  .object({
    status: z.enum(["VERIFIED", "REVOKED"]),
    decisionBasis: z.string().trim().min(3).max(1000),
    revocationReason: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .strict();
export const AdminVerificationDecisionDtoSchema = z
  .object({
    decided: z.boolean(),
    status: z.enum(["VERIFIED", "REVOKED"]).nullable(),
  })
  .strict();

// --- safety -------------------------------------------------------------------

export const ADMIN_REVIEW_OUTCOMES = [
  "NO_ACTION",
  "WARNED",
  "ACCOUNT_SUSPENDED",
  "ESCALATED",
] as const;

export const AdminSafetyReportDtoSchema = z
  .object({
    reportId: UuidSchema,
    relationshipId: UuidSchema,
    companyName: z.string().max(300),
    investorName: z.string().max(300),
    reporterSide: z.enum(["COMPANY", "INVESTOR"]),
    reporterName: Name,
    reasonCode: z.string().max(40),
    reasonLabel: z.string().max(80),
    note: z.string().max(500).nullable(),
    aboutMessage: z.boolean(),
    createdAt: Iso,
    review: z
      .object({
        outcome: z.enum(ADMIN_REVIEW_OUTCOMES),
        note: z.string().max(1000),
        reviewerName: Name,
        at: Iso,
      })
      .strict()
      .nullable(),
    reportedMembers: z
      .array(z.object({ userId: UuidSchema, name: Name }).strict())
      .max(200),
  })
  .strict();
export type AdminSafetyReportDto = z.infer<typeof AdminSafetyReportDtoSchema>;

export const AdminSafetyDtoSchema = z
  .object({
    reports: z.array(AdminSafetyReportDtoSchema).max(200),
    blocks: z
      .array(
        z
          .object({
            blockId: UuidSchema,
            relationshipId: UuidSchema,
            companyName: z.string().max(300),
            investorName: z.string().max(300),
            blockerSide: z.enum(["COMPANY", "INVESTOR"]),
            createdAt: Iso,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type AdminSafetyDto = z.infer<typeof AdminSafetyDtoSchema>;

export const AdminReviewRequestSchema = z
  .object({
    outcome: z.enum(ADMIN_REVIEW_OUTCOMES),
    note: z.string().trim().min(3).max(1000),
    suspendUserId: UuidSchema.nullable().optional(),
  })
  .strict();

// --- break-glass --------------------------------------------------------------

export const AdminBreakGlassRowDtoSchema = z
  .object({
    requestId: UuidSchema,
    requesterUserId: UuidSchema,
    requesterName: Name,
    targetType: z.enum(["RELATIONSHIP_CHAT", "Q_RUN"]),
    targetId: UuidSchema,
    targetLabel: Name,
    reason: z.string().max(1000),
    status: z.enum(["PENDING", "APPROVED", "DENIED", "EXPIRED"]),
    approvalKind: z.enum(["SECOND_PERSON", "SOLO"]).nullable(),
    decidedByName: Name,
    decisionNote: z.string().max(500).nullable(),
    expiresAt: Iso.nullable(),
    createdAt: Iso,
    reads: z.number().int(),
    canDecide: z.enum(["SECOND_PERSON", "SOLO"]).nullable(),
  })
  .strict();
export const AdminBreakGlassListDtoSchema = z
  .object({ rows: z.array(AdminBreakGlassRowDtoSchema).max(100) })
  .strict();
export type AdminBreakGlassRowDto = z.infer<typeof AdminBreakGlassRowDtoSchema>;

export const AdminBreakGlassRequestSchema = z
  .object({
    targetType: z.enum(["RELATIONSHIP_CHAT", "Q_RUN"]),
    targetId: UuidSchema,
    reason: z.string().trim().min(20).max(1000),
  })
  .strict();
export const AdminBreakGlassCreatedDtoSchema = z
  .object({ requestId: UuidSchema })
  .strict();
export const AdminBreakGlassDecisionRequestSchema = z
  .object({ approve: z.boolean(), note: Reason })
  .strict();
export const AdminBreakGlassDecisionDtoSchema = z
  .object({ status: z.enum(["APPROVED", "DENIED"]) })
  .strict();

export const AdminBreakGlassChatDtoSchema = z
  .object({
    requestId: UuidSchema,
    expiresAt: Iso,
    reason: z.string().max(1000),
    companyName: z.string().max(300),
    investorName: z.string().max(300),
    messages: z
      .array(
        z
          .object({
            messageId: UuidSchema,
            senderName: Name,
            side: z.string().max(16),
            kind: z.string().max(32),
            body: z.string().max(20000).nullable(),
            attachmentTitle: z.string().max(300).nullable(),
            at: Iso,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type AdminBreakGlassChatDto = z.infer<
  typeof AdminBreakGlassChatDtoSchema
>;

// --- Q monitor ----------------------------------------------------------------

export const ADMIN_MONITOR_WINDOWS = ["24h", "7d", "30d"] as const;

const Count = z.number().int().min(0);

export const AdminQMonitorDtoSchema = z
  .object({
    window: z.enum(ADMIN_MONITOR_WINDOWS),
    runsByStatus: z.array(
      z.object({ status: z.string(), runs: Count }).strict(),
    ),
    runFailures: z.array(z.object({ code: z.string(), runs: Count }).strict()),
    refusals: z
      .object({
        firewallDenied: Count,
        firewallAuthorised: Count,
        policyDeniedRuns: Count,
        byReason: z.array(
          z.object({ reason: z.string(), count: Count }).strict(),
        ),
      })
      .strict(),
    calls: z
      .object({
        total: Count,
        failed: Count,
        costUsd: z.string(),
        unpriced: Count,
      })
      .strict(),
    callFailures: z.array(
      z.object({ code: z.string(), calls: Count }).strict(),
    ),
    latency: z.array(
      z
        .object({
          taskClass: z.string(),
          model: z.string(),
          calls: Count,
          failed: Count,
          p50Ms: Count,
          p95Ms: Count,
          costUsd: z.string(),
        })
        .strict(),
    ),
    costPerDay: z.array(
      z.object({ day: z.string(), costUsd: z.string(), calls: Count }).strict(),
    ),
    recentRuns: z.array(
      z
        .object({
          runId: UuidSchema,
          capability: z.string(),
          status: z.string(),
          failureCode: z.string().nullable(),
          userName: Name,
          createdAt: Iso,
          durationMs: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type AdminQMonitorDto = z.infer<typeof AdminQMonitorDtoSchema>;

export const AdminQErrorsDtoSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            kind: z.enum(["MODEL_CALL", "RUN"]),
            at: Iso,
            code: z.string(),
            taskClass: z.string().nullable(),
            model: z.string().nullable(),
            latencyMs: z.number().int().nullable(),
            runId: UuidSchema.nullable(),
            correlationId: z.string().max(128).nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type AdminQErrorsDto = z.infer<typeof AdminQErrorsDtoSchema>;

export const AdminQRunTraceDtoSchema = z
  .object({
    run: z
      .object({
        runId: UuidSchema,
        capability: z.string(),
        consequenceClass: z.string(),
        status: z.string(),
        failureCode: z.string().nullable(),
        userName: Name,
        correlationId: z.string(),
        versions: z
          .object({
            orchestration: z.string().nullable(),
            promptBundle: z.string().nullable(),
            modelPolicy: z.string().nullable(),
          })
          .strict(),
        createdAt: Iso,
        startedAt: Iso.nullable(),
        completedAt: Iso.nullable(),
        objective: z.string().max(500).nullable(),
      })
      .strict(),
    redacted: z.boolean(),
    breakGlass: z
      .object({ requestId: UuidSchema, expiresAt: Iso })
      .strict()
      .nullable(),
    events: z.array(
      z
        .object({
          sequence: z.number().int(),
          type: z.string(),
          stage: z.string().nullable(),
          payloadKeys: z.array(z.string()).max(20),
          text: z.string().max(4000).nullable(),
          at: Iso,
        })
        .strict(),
    ),
    calls: z.array(
      z
        .object({
          taskClass: z.string(),
          model: z.string(),
          attempt: z.number().int(),
          latencyMs: z.number().int(),
          inputTokens: z.number().int(),
          outputTokens: z.number().int(),
          costUsd: z.string().nullable(),
          success: z.boolean(),
          errorCode: z.string().nullable(),
          at: Iso,
        })
        .strict(),
    ),
    firewall: z.array(
      z
        .object({
          outcome: z.string(),
          reason: z.string().nullable(),
          allowed: z.array(z.string()),
          denied: z.array(
            z.object({ label: z.string(), reason: z.string() }).strict(),
          ),
          at: Iso,
        })
        .strict(),
    ),
  })
  .strict();
export type AdminQRunTraceDto = z.infer<typeof AdminQRunTraceDtoSchema>;

// --- audit --------------------------------------------------------------------

export const AdminAuditQuerySchema = z
  .object({
    source: z.enum(["ALL", "TENANT", "PLATFORM"]).optional(),
    actorUserId: UuidSchema.optional(),
    actorType: z
      .enum(["human", "q", "capital_q_system", "connected_system"])
      .optional(),
    action: z
      .string()
      .regex(/^[a-z][a-z0-9_.]{0,127}$/)
      .optional(),
    resourceType: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    resourceId: z.string().min(1).max(200).optional(),
    outcome: z.enum(["SUCCEEDED", "FAILED", "DENIED"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

export const AdminAuditRowDtoSchema = z
  .object({
    source: z.enum(["TENANT", "PLATFORM"]),
    at: Iso,
    actorType: z.string(),
    actorName: Name,
    actorRole: z.string().nullable(),
    authorityName: Name,
    actionType: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
    outcome: z.string(),
    reason: z.string().nullable(),
    breakGlass: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AdminAuditRowDto = z.infer<typeof AdminAuditRowDtoSchema>;
export const AdminAuditPageDtoSchema = z
  .object({
    rows: z.array(AdminAuditRowDtoSchema).max(200),
    nextCursor: z.string().nullable(),
  })
  .strict();

// --- flags --------------------------------------------------------------------

export const AdminFlagDtoSchema = z
  .object({
    key: z.string(),
    enabled: z.boolean(),
    description: z.string(),
    updatedByName: Name,
    reason: z.string().nullable(),
    updatedAt: Iso,
    history: z.array(
      z
        .object({
          enabled: z.boolean(),
          actorName: Name,
          reason: z.string(),
          at: Iso,
        })
        .strict(),
    ),
  })
  .strict();
export type AdminFlagDto = z.infer<typeof AdminFlagDtoSchema>;
export const AdminFlagListDtoSchema = z
  .object({ rows: z.array(AdminFlagDtoSchema).max(50) })
  .strict();
export const AdminFlagRequestSchema = z
  .object({ enabled: z.boolean(), reason: Reason })
  .strict();
export const AdminFlagChangedDtoSchema = z
  .object({ changed: z.boolean() })
  .strict();

// --- email --------------------------------------------------------------------

export const AdminEmailDtoSchema = z
  .object({
    sender: z.string().nullable(),
    senderDomain: z.string().nullable(),
    provider: z.enum(["BREVO_API", "SMTP", "NONE"]),
    freeMailbox: z.boolean(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["PASS", "MISSING", "WEAK", "UNKNOWN"]),
          detail: z.string(),
        })
        .strict(),
    ),
    checkedAt: Iso.nullable(),
    deliveries: z.array(
      z.object({ source: z.string(), sent: Count, failed: Count }).strict(),
    ),
    recentFailures: z.array(
      z
        .object({
          source: z.string(),
          errorClass: z.string(),
          recipientDomain: z.string(),
          at: Iso,
        })
        .strict(),
    ),
  })
  .strict();
export type AdminEmailDto = z.infer<typeof AdminEmailDtoSchema>;

// --- team ---------------------------------------------------------------------

export const AdminTeamMemberDtoSchema = z
  .object({
    userId: UuidSchema,
    name: Name,
    email: Name,
    role: AdminRoleSchema,
    grantedAt: Iso,
    grantedByName: Name,
  })
  .strict();
export type AdminTeamMemberDto = z.infer<typeof AdminTeamMemberDtoSchema>;
export const AdminTeamDtoSchema = z
  .object({ rows: z.array(AdminTeamMemberDtoSchema).max(100) })
  .strict();
export const AdminTeamGrantRequestSchema = z
  .object({ email: z.email().max(320), role: AdminRoleSchema, reason: Reason })
  .strict();
export const AdminTeamRevokeRequestSchema = z
  .object({ reason: Reason })
  .strict();
export const AdminTeamChangedDtoSchema = z
  .object({ userId: UuidSchema })
  .strict();
