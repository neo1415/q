import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ADMIN_BILLING_ACCOUNT_PATH,
  ADMIN_BILLING_ASSIGN_PATH,
  ADMIN_BILLING_FEE_RATE_PATH,
  ADMIN_BILLING_FEES_ACCRUE_PATH,
  ADMIN_BILLING_FEES_EXPORT_PATH,
  ADMIN_BILLING_FEES_PATH,
  ADMIN_BILLING_OVERRIDE_PATH,
  AdminBillingAccountDtoSchema,
  AdminBillingAssignRequestSchema,
  AdminBillingChangedDtoSchema,
  AdminBillingOverrideRequestSchema,
  createProblemDetails,
  FeeAccrualDtoSchema,
  FeeLedgerDtoSchema,
  FeeLedgerExportDtoSchema,
  FeeRateRequestSchema,
  PROBLEM_CONTENT_TYPE,
  UuidSchema,
  type KnownErrorCode,
} from "@capital-q/contracts";
import {
  BillingOrganisationNotFoundError,
  BillingPlanNotFoundError,
  feeLedgerCsv,
  type BillingAccounts,
  type FeeLedger,
} from "@capital-q/billing";
import type {
  AdminGrant,
  AdminPermission,
  PlatformAdmin,
} from "@capital-q/platform-admin";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The operations console's billing controls (ADR 0033 + 0034): an
 * organisation's plan, usage and history; assign a plan or a trial;
 * override one limit; the facilitation-fee ledger. Same posture as the rest
 * of the console: anyone without the permission gets the 404 of a path that
 * does not exist, a write needs a live step-up, and every change is
 * recorded in platform_ops.admin_actions with its reason.
 */

export type AdminBillingRoutesDependencies = ActorContextDependencies & {
  readonly admin: Pick<PlatformAdmin, "authorize" | "recordAction">;
  readonly accounts: BillingAccounts;
  readonly fees: FeeLedger;
  /** COUNT features for one organisation (gateways), for the account view. */
  readonly countsFor?:
    | ((organisationId: string) => Promise<Readonly<Record<string, number>>>)
    | undefined;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerAdminBillingRoutes(
  app: FastifyInstance,
  dependencies: AdminBillingRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { admin, accounts, fees } = dependencies;

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
    await send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    return null;
  }

  function organisationOf(request: FastifyRequest): string | null {
    const parsed = UuidSchema.safeParse(
      (request.params as Record<string, unknown>)["organisationId"],
    );
    return parsed.success ? parsed.data : null;
  }

  async function detail(organisationId: string) {
    return AdminBillingAccountDtoSchema.parse(
      await accounts.accountDetail(
        organisationId,
        (await dependencies.countsFor?.(organisationId)) ?? {},
      ),
    );
  }

  function refused(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
  ) {
    if (
      error instanceof BillingOrganisationNotFoundError ||
      error instanceof BillingPlanNotFoundError
    ) {
      return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    }
    throw error;
  }

  app.get(
    ADMIN_BILLING_ACCOUNT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.read");
      if (grant === null) return reply;
      const organisationId = organisationOf(request);
      if (organisationId === null)
        return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      try {
        return await detail(organisationId);
      } catch (error: unknown) {
        return refused(request, reply, error);
      }
    },
  );

  app.post(
    ADMIN_BILLING_ASSIGN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.write");
      if (grant === null) return reply;
      const organisationId = organisationOf(request);
      const input = AdminBillingAssignRequestSchema.safeParse(
        request.body ?? {},
      );
      if (organisationId === null)
        return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      if (!input.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Choose a plan and give a reason.",
        );
      }
      const endsAt =
        input.data.endsAt === null ? null : new Date(input.data.endsAt);
      if (endsAt !== null && endsAt.getTime() <= Date.now()) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "A trial must end in the future.",
        );
      }
      try {
        const outcome = await accounts.assignPlan({
          organisationId,
          planKey: input.data.planKey,
          endsAt,
          byUserId: grant.userId,
          reason: input.data.reason,
        });
        await admin.recordAction(grant, {
          actionType:
            endsAt === null ? "billing.plan.assign" : "billing.plan.trial",
          resourceType: "organisation",
          resourceId: organisationId,
          reason: input.data.reason,
          metadata: {
            planKey: input.data.planKey,
            previousPlanKey: outcome.previousPlanKey,
            endsAt: input.data.endsAt,
          },
        });
        return AdminBillingChangedDtoSchema.parse({
          account: await detail(organisationId),
        });
      } catch (error: unknown) {
        return refused(request, reply, error);
      }
    },
  );

  app.post(
    ADMIN_BILLING_OVERRIDE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.write");
      if (grant === null) return reply;
      const organisationId = organisationOf(request);
      const input = AdminBillingOverrideRequestSchema.safeParse(
        request.body ?? {},
      );
      if (organisationId === null)
        return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      if (!input.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Give a limit and a reason.",
        );
      }
      try {
        const outcome = await accounts.setOverride({
          organisationId,
          featureKey: input.data.featureKey,
          limit: input.data.limit,
          expiresAt:
            input.data.expiresAt === null
              ? null
              : new Date(input.data.expiresAt),
          revoke: input.data.revoke,
          byUserId: grant.userId,
          reason: input.data.reason,
        });
        await admin.recordAction(grant, {
          actionType: input.data.revoke
            ? "billing.limit.revoke"
            : "billing.limit.override",
          resourceType: "organisation",
          resourceId: organisationId,
          reason: input.data.reason,
          metadata: {
            featureKey: input.data.featureKey,
            limit: input.data.limit,
            expiresAt: input.data.expiresAt,
            previousLimit: outcome.previousLimit,
            hadOverride: outcome.had,
          },
        });
        return AdminBillingChangedDtoSchema.parse({
          account: await detail(organisationId),
        });
      } catch (error: unknown) {
        return refused(request, reply, error);
      }
    },
  );

  app.get(
    ADMIN_BILLING_FEES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.fees.read");
      if (grant === null) return reply;
      return FeeLedgerDtoSchema.parse(await fees.list());
    },
  );

  app.get(
    ADMIN_BILLING_FEES_EXPORT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.fees.read");
      if (grant === null) return reply;
      const ledger = await fees.list(1000);
      await admin.recordAction(grant, {
        actionType: "billing.fees.export",
        resourceType: "fee_ledger",
        resourceId: "all",
        metadata: { entries: ledger.entries.length },
      });
      return FeeLedgerExportDtoSchema.parse({
        filename: `capital-q-facilitation-fees-${new Date().toISOString().slice(0, 10)}.csv`,
        csv: feeLedgerCsv(ledger),
      });
    },
  );

  app.post(
    ADMIN_BILLING_FEES_ACCRUE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.fees.accrue");
      if (grant === null) return reply;
      const outcome = await fees.accrue();
      await admin.recordAction(grant, {
        actionType: "billing.fees.accrue",
        resourceType: "fee_ledger",
        resourceId: "all",
        metadata: { ...outcome },
      });
      return FeeAccrualDtoSchema.parse(outcome);
    },
  );

  app.post(
    ADMIN_BILLING_FEE_RATE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "billing.fees.rate");
      if (grant === null) return reply;
      const input = FeeRateRequestSchema.safeParse(request.body ?? {});
      if (!input.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Give a rate in basis points and a reason.",
        );
      }
      const outcome = await fees.setRate({
        rateBps: input.data.rateBps,
        accrueLevels: input.data.accrueLevels,
        payerSide: input.data.payerSide,
        byUserId: grant.userId,
        reason: input.data.reason,
      });
      await admin.recordAction(grant, {
        actionType: "billing.fees.rate",
        resourceType: "fee_schedule",
        resourceId: String(outcome.version),
        reason: input.data.reason,
        metadata: {
          rateBps: input.data.rateBps,
          previousRateBps: outcome.previousRateBps,
          accrueLevels: input.data.accrueLevels,
          payerSide: input.data.payerSide,
        },
      });
      return FeeLedgerDtoSchema.parse(await fees.list());
    },
  );
}
