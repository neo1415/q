import type {
  AdminBillingAccountDto,
  BillingCatalogueDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { accountKeyOf } from "./catalogue.js";
import type { EntitlementService } from "./entitlements.js";

/**
 * The catalogue people may choose from, and the operator's account controls
 * (assign a plan, grant a trial, override a limit). The operations console
 * decides who may call these and audits every change with its reason
 * (platform_ops.admin_actions); this module only keeps the rows honest:
 * the previous assignment is superseded, never rewritten.
 */

export class BillingPlanNotFoundError extends Error {
  constructor() {
    super("plan not found");
    this.name = "BillingPlanNotFoundError";
  }
}

export class BillingOrganisationNotFoundError extends Error {
  constructor() {
    super("organisation not found");
    this.name = "BillingOrganisationNotFoundError";
  }
}

export function createBillingAccounts(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly entitlements: EntitlementService;
}) {
  const { sql, transactions, entitlements } = options;

  async function catalogue(): Promise<BillingCatalogueDto> {
    const plans = await sql<
      {
        id: string;
        key: string;
        version: number;
        name: string;
        description: string;
        audience: "ANY" | "FOUNDER" | "INVESTOR";
        self_serve: boolean;
      }[]
    >`
      select id, key, version, name, description, audience, self_serve
        from billing.plans
       where status = 'ACTIVE'
       order by is_launch_default desc, self_serve, key`;
    const features = await sql<
      {
        plan_id: string;
        key: string;
        name: string;
        kind: "ACCESS" | "MONTHLY" | "COUNT";
        unit_plural: string;
        included: boolean;
        limit_value: number | null;
      }[]
    >`
      select pf.plan_id, f.key, f.name, f.kind, f.unit_plural, pf.included, pf.limit_value
        from billing.plan_features pf
        join billing.features f on f.key = pf.feature_key
       order by f.key`;
    return {
      plans: plans.map((plan) => ({
        key: plan.key,
        version: plan.version,
        name: plan.name,
        description: plan.description,
        audience: plan.audience,
        selfServe: plan.self_serve,
        features: features
          .filter((feature) => feature.plan_id === plan.id)
          .map((feature) => ({
            key: feature.key,
            name: feature.name,
            kind: feature.kind,
            unitPlural: feature.unit_plural,
            included: feature.included,
            limit: feature.limit_value,
          })),
      })),
    };
  }

  async function organisationName(organisationId: string): Promise<string> {
    const rows = await sql<{ display_name: string }[]>`
      select display_name from identity.organisations where id = ${organisationId}`;
    const row = rows[0];
    if (row === undefined) throw new BillingOrganisationNotFoundError();
    return row.display_name;
  }

  async function customerOf(accountKey: string): Promise<string | null> {
    const rows = await sql<{ provider_customer_id: string }[]>`
      select provider_customer_id from billing.customers
       where provider = 'STRIPE' and account_key = ${accountKey}`;
    return rows[0]?.provider_customer_id ?? null;
  }

  async function accountDetail(
    organisationId: string,
    counts: Readonly<Record<string, number>> = {},
  ): Promise<AdminBillingAccountDto> {
    const name = await organisationName(organisationId);
    const account = { organisationId, userId: organisationId };
    const summary = await entitlements.summary(account, counts);
    const history = await sql<
      {
        key: string;
        name: string;
        source: "ADMIN" | "TRIAL" | "STRIPE";
        starts_at: Date;
        ends_at: Date | null;
        superseded_at: Date | null;
        reason: string | null;
      }[]
    >`
      select p.key, p.name, a.source, a.starts_at, a.ends_at, a.superseded_at, a.reason
        from billing.plan_assignments a
        join billing.plans p on p.id = a.plan_id
       where a.account_key = ${accountKeyOf(account)}
       order by a.created_at desc
       limit 50`;
    const plans = await sql<{ key: string; name: string }[]>`
      select key, name from billing.plans where status = 'ACTIVE' order by key`;
    return {
      organisationId,
      organisationName: name,
      current: {
        account: "ORGANISATION",
        plan: {
          key: summary.plan.key,
          version: summary.plan.version,
          name: summary.plan.name,
          description: summary.plan.description,
          audience: summary.plan.audience,
        },
        source: summary.source,
        endsAt: summary.endsAt,
        features: [...summary.features],
        hasBillingCustomer: (await customerOf(accountKeyOf(account))) !== null,
      },
      history: history.map((row) => ({
        planKey: row.key,
        planName: row.name,
        source: row.source,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at === null ? null : row.ends_at.toISOString(),
        supersededAt:
          row.superseded_at === null ? null : row.superseded_at.toISOString(),
        reason: row.reason,
      })),
      plans,
    };
  }

  /**
   * An operator puts an organisation on a plan: indefinitely (ADMIN) or
   * until `endsAt` (TRIAL; the account then returns to the default). The
   * current assignment is superseded in the same transaction.
   */
  async function assignPlan(input: {
    readonly organisationId: string;
    readonly planKey: string;
    readonly endsAt: Date | null;
    readonly byUserId: string;
    readonly reason: string;
  }): Promise<{ readonly previousPlanKey: string | null }> {
    await organisationName(input.organisationId);
    return transactions.run(async (tx) => {
      const plans = await tx.sql<{ id: string }[]>`
        select id from billing.plans where key = ${input.planKey} and status = 'ACTIVE'`;
      const plan = plans[0];
      if (plan === undefined) throw new BillingPlanNotFoundError();
      const previous = await tx.sql<{ key: string }[]>`
        update billing.plan_assignments a
           set superseded_at = clock_timestamp()
          from billing.plans p
         where p.id = a.plan_id
           and a.account_key = ${`o:${input.organisationId}`}
           and a.superseded_at is null
        returning p.key`;
      await tx.sql`
        insert into billing.plan_assignments
          (organisation_id, plan_id, source, ends_at, assigned_by_user_id, reason)
        values (${input.organisationId}, ${plan.id},
                ${input.endsAt === null ? "ADMIN" : "TRIAL"}, ${input.endsAt},
                ${input.byUserId}, ${input.reason})`;
      return { previousPlanKey: previous[0]?.key ?? null };
    });
  }

  /** Replace (or remove) one feature's limit for an organisation. */
  async function setOverride(input: {
    readonly organisationId: string;
    readonly featureKey: string;
    readonly limit: number | null;
    readonly expiresAt: Date | null;
    readonly revoke: boolean;
    readonly byUserId: string;
    readonly reason: string;
  }): Promise<{
    readonly previousLimit: number | null;
    readonly had: boolean;
  }> {
    await organisationName(input.organisationId);
    return transactions.run(async (tx) => {
      const features = await tx.sql<{ key: string }[]>`
        select key from billing.features where key = ${input.featureKey}`;
      if (features[0] === undefined) throw new BillingPlanNotFoundError();
      const previous = await tx.sql<{ limit_value: number | null }[]>`
        update billing.limit_overrides
           set revoked_at = clock_timestamp(), revoked_by_user_id = ${input.byUserId}
         where account_key = ${`o:${input.organisationId}`}
           and feature_key = ${input.featureKey} and revoked_at is null
        returning limit_value`;
      if (!input.revoke) {
        await tx.sql`
          insert into billing.limit_overrides
            (organisation_id, feature_key, limit_value, expires_at, granted_by_user_id, reason)
          values (${input.organisationId}, ${input.featureKey}, ${input.limit},
                  ${input.expiresAt}, ${input.byUserId}, ${input.reason})`;
      }
      return {
        previousLimit: previous[0]?.limit_value ?? null,
        had: previous[0] !== undefined,
      };
    });
  }

  return { catalogue, accountDetail, assignPlan, setOverride, customerOf };
}

export type BillingAccounts = ReturnType<typeof createBillingAccounts>;
