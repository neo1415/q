import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  CompanyClaims,
  PlatformCompanyPublishing,
} from "@capital-q/companies";
import type { TeamService } from "@capital-q/organisations";

import {
  ADMIN_ACCOUNT_PATH,
  ADMIN_ACCOUNT_SUSPENSION_PATH,
  ADMIN_ACCOUNTS_PATH,
  ADMIN_ATTRIBUTION_PATH,
  ADMIN_AUDIT_PATH,
  ADMIN_BREAK_GLASS_CHAT_PATH,
  ADMIN_BREAK_GLASS_DECISION_PATH,
  ADMIN_BREAK_GLASS_PATH,
  ADMIN_COMPANY_CLAIM_DECISION_PATH,
  ADMIN_COMPANY_CLAIMS_PATH,
  ADMIN_COMPANY_PUBLISH_PATH,
  AdminClaimDecisionRequestSchema,
  AdminCompanyPublishRequestSchema,
  AdminCompanyPublishResultDtoSchema,
  ClaimDecisionResultDtoSchema,
  PendingClaimListDtoSchema,
  ADMIN_DISPUTES_PATH,
  ADMIN_EMAIL_PATH,
  ADMIN_FLAG_PATH,
  ADMIN_FLAGS_PATH,
  ADMIN_ME_PATH,
  ADMIN_ORGANISATION_PATH,
  ADMIN_ORGANISATION_SUSPENSION_PATH,
  ADMIN_ORGANISATIONS_PATH,
  ADMIN_OVERVIEW_PATH,
  ADMIN_PAUSED_PATH,
  ADMIN_Q_ERRORS_PATH,
  ADMIN_Q_MONITOR_PATH,
  ADMIN_Q_RUN_PATH,
  ADMIN_REINSTATE_PATH,
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
  AdminAuditQuerySchema,
  AdminBreakGlassChatDtoSchema,
  AdminBreakGlassCreatedDtoSchema,
  AdminBreakGlassDecisionDtoSchema,
  AdminBreakGlassDecisionRequestSchema,
  AdminBreakGlassListDtoSchema,
  AdminBreakGlassRequestSchema,
  AdminEmailDtoSchema,
  AdminFlagChangedDtoSchema,
  AdminFlagListDtoSchema,
  AdminFlagRequestSchema,
  AdminMeDtoSchema,
  AdminOrganisationDetailDtoSchema,
  AdminOrganisationListDtoSchema,
  AdminOverviewDtoSchema,
  AdminQErrorsDtoSchema,
  AdminQMonitorDtoSchema,
  AdminQRunTraceDtoSchema,
  AdminReviewRequestSchema,
  AdminSafetyDtoSchema,
  AdminStepUpDtoSchema,
  AdminStepUpRequestSchema,
  AdminSuspensionDtoSchema,
  AdminSuspensionRequestSchema,
  AdminTeamChangedDtoSchema,
  AdminTeamDtoSchema,
  AdminTeamGrantRequestSchema,
  AdminTeamRevokeRequestSchema,
  AdminVerificationDecisionDtoSchema,
  AdminVerificationDecisionRequestSchema,
  AdminVerificationListDtoSchema,
  AttributionListDtoSchema,
  CorrelationIdSchema,
  createProblemDetails,
  DisputeListDtoSchema,
  PausedListDtoSchema,
  PROBLEM_CONTENT_TYPE,
  ReinstatedDtoSchema,
  UuidSchema,
  type CorrelationId,
  type KnownErrorCode,
  // ADMIN-3 block
  ADMIN_KYB_DOCUMENT_PATH,
  ADMIN_REVIEW_DECISION_PATH,
  ADMIN_REVIEWS_PATH,
  AdminKybDocumentDtoSchema,
  AdminReviewDecisionDtoSchema,
  AdminReviewDecisionRequestSchema,
  AdminReviewListDtoSchema,
  // end ADMIN-3 block
} from "@capital-q/contracts";
import {
  ADMIN_PERMISSIONS_VERSION,
  isKillSwitch,
  isMonitorWindow,
  permissionsOf,
  type AdminGrant,
  type AdminPermission,
  type PlatformAdmin,
} from "@capital-q/platform-admin";
import type { AuthenticatedPrincipal } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Capital Q's operations console (ADR 0033). Every route asks the platform
 * admin service for a grant first: anyone who is not an admin holding the
 * permission gets the same 404 as a path that does not exist, so the
 * console is not even discoverable; a sensitive write without a live
 * step-up gets STEP_UP_REQUIRED. Nothing a client sends decides access.
 */

export type OperatorVerificationDecider = (command: {
  readonly tenantId: string;
  readonly claimId: string;
  readonly operatorUserId: string;
  readonly status: "VERIFIED" | "REVOKED";
  readonly decisionBasis: string;
  readonly revocationReason: string | null;
  readonly correlationId: CorrelationId;
}) => Promise<
  | { readonly kind: "DECIDED"; readonly status: "VERIFIED" | "REVOKED" }
  | { readonly kind: "NOTHING_TO_DECIDE" }
>;

export type AdminRoutesDependencies = ActorContextDependencies & {
  readonly admin: PlatformAdmin;
  /** Verifies a fresh re-authentication's access token with the Auth server. */
  readonly freshTokens?:
    | {
        readonly authenticate: (
          accessToken: string,
        ) => Promise<AuthenticatedPrincipal | null>;
      }
    | undefined;
  readonly decideVerification?: OperatorVerificationDecider | undefined;
  readonly newCorrelationId?: (() => CorrelationId) | undefined;
  // ADMIN-3 block: closing the KYB submission behind a decided claim, and a
  // one-minute signed read of its document for the deciding operator.
  readonly closeKyb?:
    | ((input: {
        readonly claimId: string;
        readonly approved: boolean;
        readonly reason: string;
        readonly decidedByUserId: string;
      }) => Promise<boolean>)
    | undefined;
  readonly kybDownload?:
    | ((document: {
        readonly tenantId: string;
        readonly documentId: string;
        readonly versionId: string;
      }) => Promise<{ readonly url: string; readonly expiresAt: string }>)
    | undefined;
  // end ADMIN-3 block
  /**
   * P14: claims on companies nobody holds (a platform admin decides, and an
   * approval admits the requester as owner), and making such a company's
   * profile public. Absent: those routes answer not found after the guard.
   */
  readonly companyClaims?:
    Pick<CompanyClaims, "pending" | "decide"> | undefined;
  readonly admitClaim?: TeamService["admitClaim"] | undefined;
  readonly publishCompany?: PlatformCompanyPublishing | undefined;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({
    code,
    requestId: request.id,
    detail,
  });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

const notFound = (request: FastifyRequest, reply: FastifyReply) =>
  send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");

function param(request: FastifyRequest, name: string): string | null {
  const value = (request.params as Record<string, unknown>)[name];
  const parsed = UuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { admin } = dependencies;
  const correlation =
    dependencies.newCorrelationId ??
    (() => CorrelationIdSchema.parse(`cor_${crypto.randomUUID()}`));

  /** The grant, or null after the refusal has been sent. */
  async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: AdminPermission,
  ): Promise<AdminGrant | null> {
    const access = await admin.authorize(
      getActorContext(request).userId,
      permission,
    );
    if (access.kind === "GRANTED") {
      void reply.header("Cache-Control", "no-store");
      return access.grant;
    }
    if (access.kind === "STEP_UP_REQUIRED") {
      await send(
        request,
        reply,
        "STEP_UP_REQUIRED",
        "Confirm your password to continue.",
      );
      return null;
    }
    await notFound(request, reply);
    return null;
  }

  async function body<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    schema: {
      readonly safeParse: (
        value: unknown,
      ) => { success: true; data: T } | { success: false };
    },
  ): Promise<T | null> {
    const parsed = schema.safeParse(request.body ?? {});
    if (parsed.success) return parsed.data;
    await send(
      request,
      reply,
      "VALIDATION_FAILED",
      "Check the form and try again.",
    );
    return null;
  }

  // --- who am I --------------------------------------------------------------

  app.get(ADMIN_ME_PATH, { onRequest: withContext }, async (request, reply) => {
    const userId = getActorContext(request).userId;
    const role = await admin.roleOf(userId);
    if (role === null) return notFound(request, reply);
    const stepUp = await admin.liveStepUp(userId);
    void reply.header("Cache-Control", "no-store");
    return AdminMeDtoSchema.parse({
      userId,
      role,
      permissions: permissionsOf(role),
      permissionsVersion: ADMIN_PERMISSIONS_VERSION,
      stepUpExpiresAt: stepUp?.expiresAt ?? null,
    });
  });

  app.post(
    ADMIN_STEP_UP_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const userId = getActorContext(request).userId;
      if ((await admin.roleOf(userId)) === null)
        return notFound(request, reply);
      const input = await body(request, reply, AdminStepUpRequestSchema);
      if (input === null) return reply;
      const fresh =
        dependencies.freshTokens === undefined
          ? null
          : await dependencies.freshTokens.authenticate(input.accessToken);
      const outcome =
        fresh === null
          ? { kind: "STALE" as const }
          : await admin.recordStepUp({
              userId,
              freshAuthUserId: fresh.authUserId,
              authentication: admin.freshAuthenticationOf(input.accessToken),
            });
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind !== "RECORDED") {
        return send(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "That password did not confirm it's you. Try again.",
        );
      }
      void reply.header("Cache-Control", "no-store");
      return AdminStepUpDtoSchema.parse({ expiresAt: outcome.expiresAt });
    },
  );

  // --- ledger (existing console) --------------------------------------------

  app.get(
    ADMIN_OVERVIEW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "overview.read");
      if (grant === null) return reply;
      return AdminOverviewDtoSchema.parse(await admin.overview(grant));
    },
  );

  app.get(
    ADMIN_ATTRIBUTION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "ledger.read");
      if (grant === null) return reply;
      return AttributionListDtoSchema.parse({
        rows: await admin.attribution(grant),
      });
    },
  );

  app.get(
    ADMIN_DISPUTES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "ledger.read");
      if (grant === null) return reply;
      return DisputeListDtoSchema.parse({ rows: await admin.disputes(grant) });
    },
  );

  app.get(
    ADMIN_PAUSED_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.read");
      if (grant === null) return reply;
      return PausedListDtoSchema.parse({ rows: await admin.paused(grant) });
    },
  );

  // An operator lifts a pause Q put on an account (founder 2026-09-30).
  app.post(
    ADMIN_REINSTATE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const userId = param(request, "userId");
      const grant = await guard(request, reply, "accounts.reinstate_q");
      if (grant === null) return reply;
      if (userId === null || !(await admin.reinstate(grant, userId))) {
        return notFound(request, reply);
      }
      return ReinstatedDtoSchema.parse({ reinstated: true });
    },
  );

  // --- accounts and organisations -------------------------------------------

  app.get(
    ADMIN_ACCOUNTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.read");
      if (grant === null) return reply;
      const q = (request.query as { q?: unknown }).q;
      const term = typeof q === "string" ? q.trim() : "";
      return AdminAccountListDtoSchema.parse({
        rows: term.length < 2 ? [] : await admin.searchAccounts(grant, term),
      });
    },
  );

  app.get(
    ADMIN_ACCOUNT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.read");
      if (grant === null) return reply;
      const userId = param(request, "userId");
      const detail =
        userId === null ? null : await admin.accountDetail(grant, userId);
      if (detail === null) return notFound(request, reply);
      return AdminAccountDetailDtoSchema.parse(detail);
    },
  );

  app.post(
    ADMIN_ACCOUNT_SUSPENSION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.suspend");
      if (grant === null) return reply;
      const userId = param(request, "userId");
      if (userId === null) return notFound(request, reply);
      const input = await body(request, reply, AdminSuspensionRequestSchema);
      if (input === null) return reply;
      const outcome = await admin.setSuspension(grant, {
        userId,
        suspend: input.suspend,
        reason: input.reason,
      });
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind === "SELF") {
        return send(
          request,
          reply,
          "PERMISSION_DENIED",
          "You can't suspend your own account.",
        );
      }
      return AdminSuspensionDtoSchema.parse({
        suspended: input.suspend,
        changed: outcome.kind === "DONE" ? 1 : 0,
      });
    },
  );

  app.get(
    ADMIN_ORGANISATIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.read");
      if (grant === null) return reply;
      const q = (request.query as { q?: unknown }).q;
      const term = typeof q === "string" ? q.trim() : "";
      return AdminOrganisationListDtoSchema.parse({
        rows:
          term.length < 2 ? [] : await admin.searchOrganisations(grant, term),
      });
    },
  );

  app.get(
    ADMIN_ORGANISATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.read");
      if (grant === null) return reply;
      const organisationId = param(request, "organisationId");
      const detail =
        organisationId === null
          ? null
          : await admin.organisationDetail(grant, organisationId);
      if (detail === null) return notFound(request, reply);
      return AdminOrganisationDetailDtoSchema.parse(detail);
    },
  );

  app.post(
    ADMIN_ORGANISATION_SUSPENSION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "accounts.suspend");
      if (grant === null) return reply;
      const organisationId = param(request, "organisationId");
      if (organisationId === null) return notFound(request, reply);
      const input = await body(request, reply, AdminSuspensionRequestSchema);
      if (input === null) return reply;
      const outcome = await admin.suspendOrganisationMembers(grant, {
        organisationId,
        suspend: input.suspend,
        reason: input.reason,
      });
      if (outcome === null) return notFound(request, reply);
      return AdminSuspensionDtoSchema.parse({
        suspended: input.suspend,
        changed: outcome.changed,
      });
    },
  );

  // --- verification ----------------------------------------------------------

  app.get(
    ADMIN_VERIFICATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "verification.read");
      if (grant === null) return reply;
      return AdminVerificationListDtoSchema.parse({
        rows: await admin.verificationQueue(grant),
      });
    },
  );

  app.post(
    ADMIN_VERIFICATION_DECISION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "verification.decide");
      if (grant === null) return reply;
      const claimId = param(request, "claimId");
      const decide = dependencies.decideVerification;
      if (claimId === null || decide === undefined)
        return notFound(request, reply);
      const input = await body(
        request,
        reply,
        AdminVerificationDecisionRequestSchema,
      );
      if (input === null) return reply;
      const tenantId = await admin.claimTenant(claimId);
      if (tenantId === null) return notFound(request, reply);
      const outcome = await decide({
        tenantId,
        claimId,
        operatorUserId: grant.userId,
        status: input.status,
        decisionBasis: input.decisionBasis,
        revocationReason: input.revocationReason ?? null,
        correlationId: correlation(),
      });
      // ADMIN-3: the KYB submission that asked for this claim closes with it.
      if (outcome.kind === "DECIDED" && dependencies.closeKyb !== undefined) {
        await dependencies.closeKyb({
          claimId,
          approved: outcome.status === "VERIFIED",
          reason: input.revocationReason ?? input.decisionBasis,
          decidedByUserId: grant.userId,
        });
      }
      await admin.recordAction(grant, {
        actionType: "verification.claim.decided",
        resourceType: "verification_claim",
        resourceId: claimId,
        reason: input.decisionBasis,
        outcome: outcome.kind === "DECIDED" ? "SUCCEEDED" : "FAILED",
        metadata: { status: input.status },
      });
      return AdminVerificationDecisionDtoSchema.parse({
        decided: outcome.kind === "DECIDED",
        status: outcome.kind === "DECIDED" ? outcome.status : null,
      });
    },
  );

  // --- ADMIN-3: human reviews and KYB documents -------------------------------

  app.get(
    ADMIN_REVIEWS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "reviews.read");
      if (grant === null) return reply;
      const all = (request.query as { all?: unknown }).all === "1";
      return AdminReviewListDtoSchema.parse({
        rows: await admin.reviewQueue(grant, all),
      });
    },
  );

  app.post(
    ADMIN_REVIEW_DECISION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "reviews.decide");
      if (grant === null) return reply;
      const reviewId = param(request, "reviewId");
      if (reviewId === null) return notFound(request, reply);
      const input = await body(
        request,
        reply,
        AdminReviewDecisionRequestSchema,
      );
      if (input === null) return reply;
      const outcome = await admin.decideReview(grant, { reviewId, ...input });
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind === "SELF") {
        return send(
          request,
          reply,
          "PERMISSION_DENIED",
          "Another admin must decide a review you asked for.",
        );
      }
      return AdminReviewDecisionDtoSchema.parse({ decided: true });
    },
  );

  app.get(
    ADMIN_KYB_DOCUMENT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "verification.read");
      if (grant === null) return reply;
      const submissionId = param(request, "submissionId");
      const document =
        submissionId === null
          ? null
          : await admin.kybDocument(grant, submissionId);
      if (document === null || dependencies.kybDownload === undefined) {
        return notFound(request, reply);
      }
      const link = await dependencies.kybDownload(document);
      await admin.recordAction(grant, {
        actionType: "verification.kyb.document_opened",
        resourceType: "kyb_submission",
        resourceId: submissionId ?? document.documentId,
      });
      return AdminKybDocumentDtoSchema.parse(link);
    },
  );

  // --- trust & safety --------------------------------------------------------

  app.get(
    ADMIN_SAFETY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "safety.read");
      if (grant === null) return reply;
      const all = (request.query as { all?: unknown }).all === "1";
      return AdminSafetyDtoSchema.parse(await admin.safetyQueue(grant, all));
    },
  );

  app.post(
    ADMIN_SAFETY_REVIEW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "safety.decide");
      if (grant === null) return reply;
      const reportId = param(request, "reportId");
      if (reportId === null) return notFound(request, reply);
      const input = await body(request, reply, AdminReviewRequestSchema);
      if (input === null) return reply;
      const outcome = await admin.reviewReport(grant, {
        reportId,
        outcome: input.outcome,
        note: input.note,
        suspendUserId: input.suspendUserId ?? null,
      });
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind === "INVALID_SUBJECT") {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Choose a member of the reported side to suspend.",
        );
      }
      return { reviewed: true };
    },
  );

  app.get(
    ADMIN_BREAK_GLASS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "safety.read");
      if (grant === null) return reply;
      return AdminBreakGlassListDtoSchema.parse({
        rows: await admin.listBreakGlass(grant),
      });
    },
  );

  app.post(
    ADMIN_BREAK_GLASS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "breakglass.request");
      if (grant === null) return reply;
      const input = await body(request, reply, AdminBreakGlassRequestSchema);
      if (input === null) return reply;
      const created = await admin.requestBreakGlass(grant, input);
      if (created === null) return notFound(request, reply);
      return AdminBreakGlassCreatedDtoSchema.parse(created);
    },
  );

  app.post(
    ADMIN_BREAK_GLASS_DECISION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "breakglass.approve");
      if (grant === null) return reply;
      const requestId = param(request, "requestId");
      if (requestId === null) return notFound(request, reply);
      const input = await body(
        request,
        reply,
        AdminBreakGlassDecisionRequestSchema,
      );
      if (input === null) return reply;
      const outcome = await admin.decideBreakGlass(grant, {
        requestId,
        ...input,
      });
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind === "SECOND_PERSON_REQUIRED") {
        return send(
          request,
          reply,
          "PERMISSION_DENIED",
          "Another admin must decide this request.",
        );
      }
      return AdminBreakGlassDecisionDtoSchema.parse({ status: outcome.status });
    },
  );

  app.get(
    ADMIN_BREAK_GLASS_CHAT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "breakglass.request");
      if (grant === null) return reply;
      const requestId = param(request, "requestId");
      const chat =
        requestId === null
          ? null
          : await admin.readChatUnderBreakGlass(grant, requestId);
      if (chat === null) return notFound(request, reply);
      return AdminBreakGlassChatDtoSchema.parse(chat);
    },
  );

  // --- Q monitor -------------------------------------------------------------

  app.get(
    ADMIN_Q_MONITOR_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "q.monitor.read");
      if (grant === null) return reply;
      const window = (request.query as { window?: unknown }).window;
      return AdminQMonitorDtoSchema.parse(
        await admin.qMonitor(grant, isMonitorWindow(window) ? window : "24h"),
      );
    },
  );

  app.get(
    ADMIN_Q_ERRORS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "q.monitor.read");
      if (grant === null) return reply;
      return AdminQErrorsDtoSchema.parse({ rows: await admin.qErrors(grant) });
    },
  );

  app.get(
    ADMIN_Q_RUN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "q.trace.read");
      if (grant === null) return reply;
      const runId = param(request, "runId");
      const trace = runId === null ? null : await admin.qRunTrace(grant, runId);
      if (trace === null) return notFound(request, reply);
      return AdminQRunTraceDtoSchema.parse(trace);
    },
  );

  // --- audit -----------------------------------------------------------------

  app.get(
    ADMIN_AUDIT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "audit.read");
      if (grant === null) return reply;
      const parsed = AdminAuditQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return send(request, reply, "VALIDATION_FAILED", "Check the filters.");
      }
      const { action, ...query } = parsed.data;
      return AdminAuditPageDtoSchema.parse(
        await admin.searchAudit(grant, { ...query, actionPrefix: action }),
      );
    },
  );

  // --- kill switches ---------------------------------------------------------

  app.get(
    ADMIN_FLAGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "flags.read");
      if (grant === null) return reply;
      return AdminFlagListDtoSchema.parse({
        rows: await admin.listFlags(grant),
      });
    },
  );

  app.post(
    ADMIN_FLAG_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "flags.write");
      if (grant === null) return reply;
      const key = (request.params as { key?: unknown }).key;
      if (!isKillSwitch(key)) return notFound(request, reply);
      const input = await body(request, reply, AdminFlagRequestSchema);
      if (input === null) return reply;
      const outcome = await admin.setFlag(grant, { key, ...input });
      if (outcome === "NOT_FOUND") return notFound(request, reply);
      return AdminFlagChangedDtoSchema.parse({
        changed: outcome === "CHANGED",
      });
    },
  );

  // --- email -----------------------------------------------------------------

  app.get(
    ADMIN_EMAIL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "email.read");
      if (grant === null) return reply;
      const refresh = (request.query as { refresh?: unknown }).refresh === "1";
      return AdminEmailDtoSchema.parse(await admin.emailPanel(grant, refresh));
    },
  );

  // --- team ------------------------------------------------------------------

  app.get(
    ADMIN_TEAM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "overview.read");
      if (grant === null) return reply;
      return AdminTeamDtoSchema.parse({ rows: await admin.listTeam(grant) });
    },
  );

  const teamOutcome = (
    request: FastifyRequest,
    reply: FastifyReply,
    outcome: Awaited<ReturnType<PlatformAdmin["setTeamRole"]>>,
  ) => {
    switch (outcome.kind) {
      case "DONE":
        return AdminTeamChangedDtoSchema.parse({ userId: outcome.userId });
      case "UNCHANGED":
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "They already have that role.",
        );
      case "SELF":
        return send(
          request,
          reply,
          "PERMISSION_DENIED",
          "You can't change your own role.",
        );
      case "LAST_OWNER":
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "Capital Q must keep at least one platform owner.",
        );
      case "NOT_FOUND":
        return send(
          request,
          reply,
          "RESOURCE_NOT_FOUND",
          "No Capital Q account uses that email.",
        );
    }
  };

  app.post(
    ADMIN_TEAM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "roles.manage");
      if (grant === null) return reply;
      const input = await body(request, reply, AdminTeamGrantRequestSchema);
      if (input === null) return reply;
      return teamOutcome(request, reply, await admin.setTeamRole(grant, input));
    },
  );

  app.delete(
    ADMIN_TEAM_MEMBER_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "roles.manage");
      if (grant === null) return reply;
      const userId = param(request, "userId");
      if (userId === null) return notFound(request, reply);
      const input = await body(request, reply, AdminTeamRevokeRequestSchema);
      if (input === null) return reply;
      return teamOutcome(
        request,
        reply,
        await admin.revokeTeamRole(grant, { userId, reason: input.reason }),
      );
    },
  );

  // --- P14: company claims and publishing ---------------------------------

  app.get(
    ADMIN_COMPANY_CLAIMS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "claims.read");
      if (grant === null) return reply;
      const claims = dependencies.companyClaims;
      return PendingClaimListDtoSchema.parse({
        claims:
          claims === undefined ? [] : await claims.pending({ unclaimed: true }),
      });
    },
  );

  app.post(
    ADMIN_COMPANY_CLAIM_DECISION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "claims.decide");
      if (grant === null) return reply;
      const requestId = param(request, "requestId");
      const claims = dependencies.companyClaims;
      if (requestId === null || claims === undefined) {
        return notFound(request, reply);
      }
      const input = await body(request, reply, AdminClaimDecisionRequestSchema);
      if (input === null) return reply;
      // Only a claim on a company nobody holds; anything else is not found.
      const decided = await claims.decide({
        requestId,
        approve: input.approve,
        deciderUserId: grant.userId,
        via: "PLATFORM_ADMIN",
        reason: input.reason,
      });
      if (decided === null) return notFound(request, reply);
      const correlationId = correlation();
      if (decided.status === "APPROVED" && dependencies.admitClaim) {
        await dependencies.admitClaim({
          organisationId: decided.organisationId,
          userId: decided.requesterUserId,
          role: "OWNER",
          decidedByUserId: grant.userId,
          claimRequestId: requestId,
          correlationId,
        });
      }
      await admin.recordAction(grant, {
        actionType:
          decided.status === "APPROVED" ? "claim.approved" : "claim.declined",
        resourceType: "company_claim",
        resourceId: requestId,
        reason: input.reason,
        metadata: { companyId: decided.companyId },
      });
      return ClaimDecisionResultDtoSchema.parse({ status: decided.status });
    },
  );

  app.post(
    ADMIN_COMPANY_PUBLISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "companies.publish");
      if (grant === null) return reply;
      const companyId = param(request, "companyId");
      const publish = dependencies.publishCompany;
      if (companyId === null || publish === undefined) {
        return notFound(request, reply);
      }
      const input = await body(
        request,
        reply,
        AdminCompanyPublishRequestSchema,
      );
      if (input === null) return reply;
      const outcome = await publish({
        actor: getActorContext(request),
        companyId,
        publicExternal: input.publicExternal,
        reason: input.reason,
        correlationId: correlation(),
      });
      if (outcome === "NOT_FOUND") return notFound(request, reply);
      if (outcome === "CHANGED") {
        await admin.recordAction(grant, {
          actionType: input.publicExternal
            ? "company.made_public_external"
            : "company.returned_to_network",
          resourceType: "company",
          resourceId: companyId,
          reason: input.reason,
        });
      }
      return AdminCompanyPublishResultDtoSchema.parse({
        outcome,
        visibility:
          outcome === "CLAIMED"
            ? null
            : input.publicExternal
              ? "public_external"
              : "network_visible",
      });
    },
  );
}
