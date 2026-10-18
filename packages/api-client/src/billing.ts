import {
  ADMIN_BILLING_FEE_RATE_PATH,
  ADMIN_BILLING_FEES_ACCRUE_PATH,
  ADMIN_BILLING_FEES_EXPORT_PATH,
  ADMIN_BILLING_FEES_PATH,
  adminBillingAccountPath,
  adminBillingAssignPath,
  adminBillingOverridePath,
  AdminBillingAccountDtoSchema,
  AdminBillingChangedDtoSchema,
  BILLING_CHECKOUT_PATH,
  BILLING_PLAN_PATH,
  BILLING_PLANS_PATH,
  BILLING_PORTAL_PATH,
  BillingAccountPlanDtoSchema,
  BillingCatalogueDtoSchema,
  BillingRedirectDtoSchema,
  EntitlementProblemExtensionSchema,
  FeeAccrualDtoSchema,
  FeeLedgerDtoSchema,
  FeeLedgerExportDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  type EntitlementProblemExtension,
  ADMIN_BILLING_USAGE_PATH,
  AdminUsageDtoSchema,
} from "@capital-q/contracts";

import { ApiProblemError } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** BILLING (ADR 0034): the person's own plan and usage, and buying. */

export function getMyPlan(session: ApiSession) {
  return call(session, "GET", BILLING_PLAN_PATH, BillingAccountPlanDtoSchema);
}

export function getPlanCatalogue(session: ApiSession) {
  return call(session, "GET", BILLING_PLANS_PATH, BillingCatalogueDtoSchema);
}

export function startPlanCheckout(
  session: ApiSession,
  planKey: string,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    BILLING_CHECKOUT_PATH,
    BillingRedirectDtoSchema,
    {
      body: { planKey },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

export function openBillingPortal(session: ApiSession) {
  return call(session, "POST", BILLING_PORTAL_PATH, BillingRedirectDtoSchema);
}

/**
 * The plan's refusal carried by an ENTITLEMENT_REQUIRED problem, or null
 * for any other error -- so a screen can say what the plan includes and
 * offer the plans instead of a generic failure.
 */
export function entitlementOf(
  error: unknown,
): EntitlementProblemExtension | null {
  if (!(error instanceof ApiProblemError)) return null;
  if (error.code !== "ENTITLEMENT_REQUIRED") return null;
  const parsed = EntitlementProblemExtensionSchema.safeParse(
    error.problem?.entitlement,
  );
  return parsed.success ? parsed.data : null;
}

// --- operations console -------------------------------------------------

export function getAdminBillingAccount(
  session: ApiSession,
  organisationId: string,
) {
  return call(
    session,
    "GET",
    adminBillingAccountPath(organisationId),
    AdminBillingAccountDtoSchema,
  );
}

export function assignAdminBillingPlan(
  session: ApiSession,
  organisationId: string,
  body: {
    readonly planKey: string;
    readonly endsAt: string | null;
    readonly reason: string;
  },
) {
  return call(
    session,
    "POST",
    adminBillingAssignPath(organisationId),
    AdminBillingChangedDtoSchema,
    { body },
  );
}

export function setAdminBillingOverride(
  session: ApiSession,
  organisationId: string,
  body: {
    readonly featureKey: string;
    readonly limit: number | null;
    readonly expiresAt: string | null;
    readonly revoke: boolean;
    readonly reason: string;
  },
) {
  return call(
    session,
    "POST",
    adminBillingOverridePath(organisationId),
    AdminBillingChangedDtoSchema,
    { body },
  );
}

/** Platform admin: model cost this month by tenant, person and driver. */
export function getAdminUsage(session: ApiSession) {
  return call(session, "GET", ADMIN_BILLING_USAGE_PATH, AdminUsageDtoSchema);
}

export function getAdminFeeLedger(session: ApiSession) {
  return call(session, "GET", ADMIN_BILLING_FEES_PATH, FeeLedgerDtoSchema);
}

export function exportAdminFeeLedger(session: ApiSession) {
  return call(
    session,
    "GET",
    ADMIN_BILLING_FEES_EXPORT_PATH,
    FeeLedgerExportDtoSchema,
  );
}

export function accrueAdminFees(session: ApiSession) {
  return call(
    session,
    "POST",
    ADMIN_BILLING_FEES_ACCRUE_PATH,
    FeeAccrualDtoSchema,
  );
}

export function setAdminFeeRate(
  session: ApiSession,
  body: {
    readonly rateBps: number;
    readonly accrueLevels: readonly ("SOFT" | "FIRM" | "INVESTED")[];
    readonly payerSide: "COMPANY" | "INVESTOR";
    readonly reason: string;
  },
) {
  return call(
    session,
    "POST",
    ADMIN_BILLING_FEE_RATE_PATH,
    FeeLedgerDtoSchema,
    {
      body,
    },
  );
}
