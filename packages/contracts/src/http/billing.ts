import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { createProblemDetails } from "./problem-factory.js";

/**
 * Plans, entitlements and usage (BILLING, docs/specs/2026-10/billing.md,
 * ADR 0034). Feature and plan keys are reference data from the `billing`
 * catalogue, so they travel as validated strings, never enums.
 */

export const BILLING_PLAN_PATH = "/v1/billing/plan" as const;
export const BILLING_PLANS_PATH = "/v1/billing/plans" as const;
export const BILLING_CHECKOUT_PATH = "/v1/billing/checkout" as const;
export const BILLING_PORTAL_PATH = "/v1/billing/portal" as const;
export const BILLING_STRIPE_WEBHOOK_PATH = "/v1/webhooks/stripe" as const;

/** Where a person sees what each plan includes. */
export const BILLING_UPGRADE_PATH = "/settings/plan" as const;

export const BillingFeatureKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
  .max(64);
export const BillingPlanKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(40);

export const BillingFeatureKindSchema = z.enum([
  "ACCESS",
  "MONTHLY",
  "COUNT",
  // BILLING-2 (ADR 0036): a number a plan sets, never a refusal.
  "VALUE",
]);

export const EntitlementRefusalReasonSchema = z.enum([
  "NOT_IN_PLAN",
  "LIMIT_REACHED",
]);

/**
 * The `entitlement` member of an ENTITLEMENT_REQUIRED problem: the caller's
 * own plan and counts, and where to see the plans. Never anyone else's.
 */
export const EntitlementProblemExtensionSchema = z
  .object({
    feature: BillingFeatureKeySchema,
    featureName: z.string().min(1).max(80),
    reason: EntitlementRefusalReasonSchema,
    planKey: BillingPlanKeySchema,
    planName: z.string().min(1).max(60),
    limit: z.number().int().nonnegative().nullable(),
    used: z.number().int().nonnegative().nullable(),
    resetsAt: z.string().nullable(),
    upgradePath: z.literal(BILLING_UPGRADE_PATH),
    /** One plain sentence for the person (and for Q to relay). */
    message: z.string().min(1).max(400),
  })
  .strict();
export type EntitlementProblemExtension = z.infer<
  typeof EntitlementProblemExtensionSchema
>;

export const BillingFeatureStandingDtoSchema = z
  .object({
    key: BillingFeatureKeySchema,
    name: z.string(),
    description: z.string(),
    kind: BillingFeatureKindSchema,
    unitSingular: z.string(),
    unitPlural: z.string(),
    included: z.boolean(),
    /** Null: unlimited (or ACCESS). */
    limit: z.number().int().nonnegative().nullable(),
    /** This month's use for MONTHLY; how many exist for COUNT; null for ACCESS. */
    used: z.number().int().nonnegative().nullable(),
    resetsAt: z.string().nullable(),
    /** An operator changed this account's limit. */
    overridden: z.boolean(),
  })
  .strict();
export type BillingFeatureStandingDto = z.infer<
  typeof BillingFeatureStandingDtoSchema
>;

export const BillingPlanSourceSchema = z.enum([
  "LAUNCH_DEFAULT",
  "ADMIN",
  "TRIAL",
  "STRIPE",
]);

export const BillingPlanRefDtoSchema = z
  .object({
    key: BillingPlanKeySchema,
    version: z.number().int().positive(),
    name: z.string(),
    description: z.string(),
    audience: z.enum(["ANY", "FOUNDER", "INVESTOR"]),
  })
  .strict();

export const BillingAccountPlanDtoSchema = z
  .object({
    account: z.enum(["ORGANISATION", "PERSON"]),
    plan: BillingPlanRefDtoSchema,
    source: BillingPlanSourceSchema,
    endsAt: z.string().nullable(),
    features: z.array(BillingFeatureStandingDtoSchema).max(50),
    /** Whether this person may buy or change the plan for the account. */
    canManage: z.boolean(),
    /** Online checkout is configured on this deployment. */
    checkoutAvailable: z.boolean(),
    /** The account has a payment-provider customer (manage billing). */
    hasBillingCustomer: z.boolean(),
  })
  .strict();
export type BillingAccountPlanDto = z.infer<typeof BillingAccountPlanDtoSchema>;

export const BillingCatalogueDtoSchema = z
  .object({
    plans: z
      .array(
        BillingPlanRefDtoSchema.extend({
          selfServe: z.boolean(),
          features: z
            .array(
              z
                .object({
                  key: BillingFeatureKeySchema,
                  name: z.string(),
                  kind: BillingFeatureKindSchema,
                  unitPlural: z.string(),
                  included: z.boolean(),
                  limit: z.number().int().nonnegative().nullable(),
                })
                .strict(),
            )
            .max(50),
        }).strict(),
      )
      .max(20),
  })
  .strict();
export type BillingCatalogueDto = z.infer<typeof BillingCatalogueDtoSchema>;

export const BillingCheckoutRequestSchema = z
  .object({ planKey: BillingPlanKeySchema })
  .strict();
export const BillingRedirectDtoSchema = z
  .object({ url: z.string().url().max(2000) })
  .strict();
export type BillingRedirectDto = z.infer<typeof BillingRedirectDtoSchema>;

// --- admin ------------------------------------------------------------------

export const ADMIN_BILLING_ACCOUNT_PATH =
  "/v1/admin/billing/accounts/:organisationId" as const;
export const adminBillingAccountPath = (organisationId: string) =>
  `/v1/admin/billing/accounts/${encodeURIComponent(organisationId)}`;
export const ADMIN_BILLING_ASSIGN_PATH =
  "/v1/admin/billing/accounts/:organisationId/plan" as const;
export const adminBillingAssignPath = (organisationId: string) =>
  `${adminBillingAccountPath(organisationId)}/plan`;
export const ADMIN_BILLING_OVERRIDE_PATH =
  "/v1/admin/billing/accounts/:organisationId/overrides" as const;
export const adminBillingOverridePath = (organisationId: string) =>
  `${adminBillingAccountPath(organisationId)}/overrides`;
export const ADMIN_BILLING_FEES_PATH = "/v1/admin/billing/fees" as const;
export const ADMIN_BILLING_FEES_ACCRUE_PATH =
  "/v1/admin/billing/fees/accrue" as const;
export const ADMIN_BILLING_FEES_EXPORT_PATH =
  "/v1/admin/billing/fees/export" as const;
export const FeeLedgerExportDtoSchema = z
  .object({ filename: z.string().min(1).max(100), csv: z.string() })
  .strict();
export const ADMIN_BILLING_FEE_RATE_PATH =
  "/v1/admin/billing/fee-rate" as const;

export const AdminBillingAccountDtoSchema = z
  .object({
    organisationId: UuidSchema,
    organisationName: z.string(),
    current: BillingAccountPlanDtoSchema.omit({
      canManage: true,
      checkoutAvailable: true,
    }),
    history: z
      .array(
        z
          .object({
            planKey: BillingPlanKeySchema,
            planName: z.string(),
            source: z.enum(["ADMIN", "TRIAL", "STRIPE"]),
            startsAt: z.string(),
            endsAt: z.string().nullable(),
            supersededAt: z.string().nullable(),
            reason: z.string().nullable(),
          })
          .strict(),
      )
      .max(50),
    plans: z
      .array(z.object({ key: BillingPlanKeySchema, name: z.string() }).strict())
      .max(20),
  })
  .strict();
export type AdminBillingAccountDto = z.infer<
  typeof AdminBillingAccountDtoSchema
>;

const Reason = z.string().trim().min(3).max(500);

export const AdminBillingAssignRequestSchema = z
  .object({
    planKey: BillingPlanKeySchema,
    /** A trial: the plan ends at this time and the account returns to the default. */
    endsAt: z.string().datetime().nullable().default(null),
    reason: Reason,
  })
  .strict();

export const AdminBillingOverrideRequestSchema = z
  .object({
    featureKey: BillingFeatureKeySchema,
    /** Null: unlimited. Absent with `revoke`: remove the override. */
    limit: z.number().int().min(0).max(1_000_000).nullable(),
    expiresAt: z.string().datetime().nullable().default(null),
    revoke: z.boolean().default(false),
    reason: Reason,
  })
  .strict();

export const AdminBillingChangedDtoSchema = z
  .object({ account: AdminBillingAccountDtoSchema })
  .strict();

export const FeeEntryDtoSchema = z
  .object({
    id: UuidSchema,
    commitmentId: UuidSchema,
    relationshipId: UuidSchema,
    companyName: z.string(),
    investorName: z.string(),
    level: z.enum(["SOFT", "FIRM", "INVESTED"]),
    amount: z.string(),
    currencyCode: z.string(),
    confirmedAt: z.string(),
    rateBps: z.number().int().nullable(),
    feeAmount: z.string().nullable(),
    payerSide: z.enum(["COMPANY", "INVESTOR"]),
    status: z.enum(["RATE_NOT_SET", "ACCRUED", "INVOICED", "VOID"]),
    scheduleVersion: z.number().int(),
  })
  .strict();
export type FeeEntryDto = z.infer<typeof FeeEntryDtoSchema>;

export const FeeLedgerDtoSchema = z
  .object({
    schedule: z
      .object({
        version: z.number().int(),
        rateBps: z.number().int().nullable(),
        accrueLevels: z.array(z.enum(["SOFT", "FIRM", "INVESTED"])),
        payerSide: z.enum(["COMPANY", "INVESTOR"]),
        effectiveFrom: z.string(),
      })
      .strict(),
    entries: z.array(FeeEntryDtoSchema).max(1000),
  })
  .strict();
export type FeeLedgerDto = z.infer<typeof FeeLedgerDtoSchema>;

export const FeeRateRequestSchema = z
  .object({
    rateBps: z.number().int().min(0).max(10_000),
    accrueLevels: z
      .array(z.enum(["SOFT", "FIRM", "INVESTED"]))
      .min(1)
      .max(3)
      .default(["INVESTED"]),
    payerSide: z.enum(["COMPANY", "INVESTOR"]).default("COMPANY"),
    reason: Reason,
  })
  .strict();

export const FeeAccrualDtoSchema = z
  .object({
    added: z.number().int(),
    priced: z.number().int(),
    voided: z.number().int(),
  })
  .strict();

/**
 * The one ENTITLEMENT_REQUIRED body every gated entry point answers with:
 * the standard problem plus the caller's own plan and counts.
 */
export function createEntitlementProblem(input: {
  readonly requestId: string;
  readonly entitlement: EntitlementProblemExtension;
}) {
  return {
    ...createProblemDetails({
      code: "ENTITLEMENT_REQUIRED",
      requestId: input.requestId,
      detail: input.entitlement.message,
    }),
    entitlement: input.entitlement,
  };
}

/**
 * Admin (platform admin only): model cost this month per tenant and per
 * person, and what costs most (lead 2026-10-03). Decimal USD strings from
 * the append-only usage ledger; operational cost, never a charge.
 */
export const ADMIN_BILLING_USAGE_PATH = "/v1/admin/billing/usage" as const;

const AdminUsd = z.string().regex(/^\d{1,9}(\.\d{1,8})?$/u);

export const AdminUsageDtoSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    totalUsd: AdminUsd,
    tenants: z
      .array(
        z
          .object({
            tenantId: UuidSchema,
            name: z.string().max(200).nullable(),
            usd: AdminUsd,
            calls: z.number().int().min(0),
          })
          .strict(),
      )
      .max(50),
    users: z
      .array(
        z
          .object({
            tenantId: UuidSchema,
            userId: UuidSchema.nullable(),
            name: z.string().max(200).nullable(),
            usd: AdminUsd,
            calls: z.number().int().min(0),
          })
          .strict(),
      )
      .max(50),
    drivers: z
      .array(
        z
          .object({
            purpose: z.string().max(40),
            taskClass: z.string().max(40),
            model: z.string().max(120),
            usd: AdminUsd,
            calls: z.number().int().min(0),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type AdminUsageDto = z.infer<typeof AdminUsageDtoSchema>;
