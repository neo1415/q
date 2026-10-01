import {
  BILLING_UPGRADE_PATH,
  type BillingAccountPlanDto,
  type BillingFeatureStandingDto,
  type EntitlementProblemExtension,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  accountKeyOf,
  type BillingAccount,
  type MeterSurface,
} from "./catalogue.js";

/**
 * Entitlements (ADR 0034): which plan an account is on, what it includes,
 * how much is used, and the one atomic consume. Deterministic code outside
 * any model (doc 12 §51.1: "Entitlement checks occur outside the model").
 *
 * Plan resolution: the account's unsuperseded assignment whose window
 * covers now; otherwise the ACTIVE launch default. An operator override
 * replaces the plan's limit for one feature. MONTHLY features count units
 * in the current UTC calendar month; COUNT features are counted by the
 * owning context and passed in.
 */

export type PlanRef = {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly audience: "ANY" | "FOUNDER" | "INVESTOR";
};

export type PlanSource = "LAUNCH_DEFAULT" | "ADMIN" | "TRIAL" | "STRIPE";

export type AccountPlan = {
  readonly accountKey: string;
  readonly plan: PlanRef;
  readonly source: PlanSource;
  readonly endsAt: string | null;
  readonly features: readonly BillingFeatureStandingDto[];
};

export type EntitlementRefusal = EntitlementProblemExtension;

export type EntitlementDecision =
  | {
      readonly allowed: true;
      /** Units left after this decision; null = unlimited or not metered. */
      readonly remaining: number | null;
      readonly replayed: boolean;
    }
  | { readonly allowed: false; readonly refusal: EntitlementRefusal };

export class UnknownBillingFeatureError extends Error {
  constructor(feature: string) {
    super(`unknown billing feature: ${feature}`);
    this.name = "UnknownBillingFeatureError";
  }
}

/** First day of `now`'s UTC month, as `YYYY-MM-01`. */
export function periodStartOf(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${String(y)}-${m}-01`;
}

/** First instant of the next UTC month. */
export function nextPeriodOf(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/**
 * One plain sentence a person (or Q, relaying it) can read: their plan,
 * their counts, when it resets, where to see plans. Never a sales pitch.
 */
export function entitlementSentence(input: {
  readonly reason: "NOT_IN_PLAN" | "LIMIT_REACHED";
  readonly kind: "ACCESS" | "MONTHLY" | "COUNT";
  readonly featureName: string;
  readonly planName: string;
  readonly unitSingular: string;
  readonly unitPlural: string;
  readonly limit: number | null;
  readonly used: number | null;
  readonly resetsAt: string | null;
}): string {
  const see = "You can see what each plan includes in Settings → Plan.";
  if (input.reason === "NOT_IN_PLAN" || input.limit === 0) {
    return `${input.featureName} isn't included in your ${input.planName} plan. ${see}`;
  }
  const limit = String(input.limit ?? 0);
  const used = String(input.used ?? 0);
  const units = input.limit === 1 ? input.unitSingular : input.unitPlural;
  if (input.kind === "COUNT") {
    return `Your ${input.planName} plan includes ${limit} ${units} and you have ${used}. ${see}`;
  }
  const resets =
    input.resetsAt === null
      ? ""
      : ` It resets on ${DAY_MONTH.format(new Date(input.resetsAt))}.`;
  return `Your ${input.planName} plan includes ${limit} ${units} a month and you've used ${used}.${resets} ${see}`;
}

type FeatureRow = {
  key: string;
  name: string;
  description: string;
  kind: "ACCESS" | "MONTHLY" | "COUNT";
  unit_singular: string;
  unit_plural: string;
  included: boolean | null;
  plan_limit: number | null;
  has_override: boolean;
  override_limit: number | null;
  used: number;
};

type PlanRow = {
  id: string;
  key: string;
  version: number;
  name: string;
  description: string;
  audience: "ANY" | "FOUNDER" | "INVESTOR";
  source: PlanSource;
  ends_at: Date | null;
};

export type EntitlementServiceOptions = {
  readonly sql: DatabaseExecutor;
  readonly now?: (() => Date) | undefined;
};

export function createEntitlementService(options: EntitlementServiceOptions) {
  const { sql } = options;
  const now = options.now ?? (() => new Date());

  async function planOf(accountKey: string, at: Date): Promise<PlanRow> {
    const assigned = await sql<PlanRow[]>`
      select p.id, p.key, p.version, p.name, p.description, p.audience,
             a.source, a.ends_at
        from billing.plan_assignments a
        join billing.plans p on p.id = a.plan_id
       where a.account_key = ${accountKey}
         and a.superseded_at is null
         and a.starts_at <= ${at}
         and (a.ends_at is null or a.ends_at > ${at})`;
    const row = assigned[0];
    if (row !== undefined) return row;
    const fallback = await sql<PlanRow[]>`
      select p.id, p.key, p.version, p.name, p.description, p.audience,
             'LAUNCH_DEFAULT' as source, null::timestamptz as ends_at
        from billing.plans p
       where p.is_launch_default`;
    const launch = fallback[0];
    if (launch === undefined) {
      // The migration seeds exactly one; its absence is a broken deploy,
      // never "no limits".
      throw new Error("billing: no launch default plan");
    }
    return launch;
  }

  async function featureRows(
    accountKey: string,
    planId: string,
    at: Date,
    only: string | null,
  ): Promise<FeatureRow[]> {
    const period = periodStartOf(at);
    return sql<FeatureRow[]>`
      select f.key, f.name, f.description, f.kind, f.unit_singular, f.unit_plural,
             pf.included, pf.limit_value as plan_limit,
             (o.id is not null) as has_override, o.limit_value as override_limit,
             coalesce((select sum(u.quantity)::int from billing.usage_events u
                        where u.account_key = ${accountKey} and u.feature_key = f.key
                          and u.period_start = ${period}::date and u.voided_at is null), 0) as used
        from billing.features f
        left join billing.plan_features pf on pf.plan_id = ${planId} and pf.feature_key = f.key
        left join billing.limit_overrides o
          on o.account_key = ${accountKey} and o.feature_key = f.key and o.revoked_at is null
         and (o.expires_at is null or o.expires_at > ${at})
       where (${only}::text is null or f.key = ${only}::text)
       order by f.key`;
  }

  function standingOf(
    row: FeatureRow,
    at: Date,
    count: number | null,
  ): BillingFeatureStandingDto {
    const included = row.has_override || row.included === true;
    const limit = row.has_override ? row.override_limit : row.plan_limit;
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      kind: row.kind,
      unitSingular: row.unit_singular,
      unitPlural: row.unit_plural,
      included,
      limit: row.kind === "ACCESS" ? null : limit,
      used:
        row.kind === "MONTHLY" ? row.used : row.kind === "COUNT" ? count : null,
      resetsAt: row.kind === "MONTHLY" ? nextPeriodOf(at).toISOString() : null,
      overridden: row.has_override,
    };
  }

  function refusalOf(
    plan: PlanRow,
    standing: BillingFeatureStandingDto,
  ): EntitlementRefusal {
    const reason =
      !standing.included || standing.limit === 0
        ? ("NOT_IN_PLAN" as const)
        : ("LIMIT_REACHED" as const);
    return {
      feature: standing.key,
      featureName: standing.name,
      reason,
      planKey: plan.key,
      planName: plan.name,
      limit: standing.limit,
      used: standing.used,
      resetsAt: standing.resetsAt,
      upgradePath: BILLING_UPGRADE_PATH,
      message: entitlementSentence({
        reason,
        kind: standing.kind,
        featureName: standing.name,
        planName: plan.name,
        unitSingular: standing.unitSingular,
        unitPlural: standing.unitPlural,
        limit: standing.limit,
        used: standing.used,
        resetsAt: standing.resetsAt,
      }),
    };
  }

  async function one(account: BillingAccount, feature: string, at: Date) {
    const accountKey = accountKeyOf(account);
    const plan = await planOf(accountKey, at);
    const rows = await featureRows(accountKey, plan.id, at, feature);
    const row = rows[0];
    if (row === undefined) throw new UnknownBillingFeatureError(feature);
    return { accountKey, plan, row };
  }

  return {
    /** The account's plan and every feature's standing (the usage page). */
    async summary(
      account: BillingAccount,
      counts: Readonly<Record<string, number>> = {},
    ): Promise<AccountPlan> {
      const at = now();
      const accountKey = accountKeyOf(account);
      const plan = await planOf(accountKey, at);
      const rows = await featureRows(accountKey, plan.id, at, null);
      return {
        accountKey,
        plan: {
          id: plan.id,
          key: plan.key,
          version: plan.version,
          name: plan.name,
          description: plan.description,
          audience: plan.audience,
        },
        source: plan.source,
        endsAt: plan.ends_at === null ? null : plan.ends_at.toISOString(),
        features: rows.map((row) =>
          standingOf(
            row,
            at,
            row.kind === "COUNT" ? (counts[row.key] ?? 0) : null,
          ),
        ),
      };
    },

    /**
     * May this account start one more unit (MONTHLY), have one more
     * (COUNT: pass how many exist now), or use it at all (ACCESS)?
     * Records nothing; `consume` is the authoritative step for MONTHLY.
     */
    async check(
      account: BillingAccount,
      feature: string,
      options: { readonly count?: number; readonly quantity?: number } = {},
    ): Promise<EntitlementDecision> {
      const at = now();
      const { plan, row } = await one(account, feature, at);
      const standing = standingOf(row, at, options.count ?? 0);
      const quantity = options.quantity ?? 1;
      if (!standing.included) {
        return { allowed: false, refusal: refusalOf(plan, standing) };
      }
      if (standing.kind === "ACCESS" || standing.limit === null) {
        return { allowed: true, remaining: null, replayed: false };
      }
      const used = standing.used ?? 0;
      if (used + quantity > standing.limit) {
        return { allowed: false, refusal: refusalOf(plan, standing) };
      }
      return {
        allowed: true,
        remaining: standing.limit - used - quantity,
        replayed: false,
      };
    },

    /**
     * Record `quantity` units of a MONTHLY feature, once per idempotency
     * key, refusing past the limit -- one atomic step in the database.
     */
    async consume(input: {
      readonly account: BillingAccount;
      readonly feature: string;
      readonly idempotencyKey: string;
      readonly actorUserId: string;
      readonly surface: MeterSurface;
      readonly quantity?: number | undefined;
    }): Promise<EntitlementDecision> {
      const at = now();
      const { plan, row } = await one(input.account, input.feature, at);
      const standing = standingOf(row, at, null);
      if (!standing.included) {
        return { allowed: false, refusal: refusalOf(plan, standing) };
      }
      if (standing.kind !== "MONTHLY") {
        throw new Error(`billing: ${input.feature} is not metered monthly`);
      }
      const rows = await sql<{ outcome: string; used: number }[]>`
        select outcome, used from billing.consume(
          ${input.account.organisationId}::uuid, ${input.account.userId}::uuid,
          ${input.feature}, ${standing.limit}::int, ${input.quantity ?? 1}::int,
          ${input.idempotencyKey}, ${input.actorUserId}::uuid, ${input.surface},
          ${periodStartOf(at)}::date)`;
      const result = rows[0];
      if (result === undefined)
        throw new Error("billing: consume returned nothing");
      if (result.outcome === "LIMIT_REACHED") {
        return {
          allowed: false,
          refusal: refusalOf(plan, { ...standing, used: result.used }),
        };
      }
      return {
        allowed: true,
        remaining:
          standing.limit === null
            ? null
            : Math.max(0, standing.limit - result.used),
        replayed: result.outcome === "REPLAYED",
      };
    },

    /** Give a unit back when the metered work failed after it was taken. */
    async release(input: {
      readonly account: BillingAccount;
      readonly feature: string;
      readonly idempotencyKey: string;
      readonly reason: string;
    }): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        update billing.usage_events
           set voided_at = clock_timestamp(), void_reason = ${input.reason.slice(0, 200)}
         where account_key = ${accountKeyOf(input.account)}
           and feature_key = ${input.feature}
           and idempotency_key = ${input.idempotencyKey}
           and voided_at is null
        returning id::text`;
      return rows.length > 0;
    },
  };
}

export type EntitlementService = ReturnType<typeof createEntitlementService>;

/** The DTO a person reads (their own account). */
export function accountPlanDto(
  account: BillingAccount,
  plan: AccountPlan,
  extras: {
    readonly canManage: boolean;
    readonly checkoutAvailable: boolean;
    readonly hasBillingCustomer: boolean;
  },
): BillingAccountPlanDto {
  return {
    account: account.organisationId === null ? "PERSON" : "ORGANISATION",
    plan: {
      key: plan.plan.key,
      version: plan.plan.version,
      name: plan.plan.name,
      description: plan.plan.description,
      audience: plan.plan.audience,
    },
    source: plan.source,
    endsAt: plan.endsAt,
    features: [...plan.features],
    ...extras,
  };
}
