import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";

import {
  createBillingAccounts,
  createEntitlementService,
  createFeeLedger,
  createWebhookApplier,
  FEATURE_GATEWAYS,
  FEATURE_READINESS_BLUEPRINT,
  FEATURE_REHEARSALS,
  VALUE_RECOMMENDATION_VOLUME,
  type BillingAccount,
} from "../src/index.js";

/**
 * The billing schema against local Supabase Postgres (migration
 * 20261116010000). Every case runs in one transaction that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type World = {
  readonly admin: string;
  readonly member: string;
  readonly orgA: string;
  readonly orgB: string;
  readonly relationshipId: string;
  readonly tenantA: string;
  readonly founder: string;
  readonly investor: string;
};

async function person(tx: TransactionContext, email: string) {
  const auth = randomUUID();
  await tx.sql`insert into auth.users (id, email) values (${auth}, ${email})`;
  const [row] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (row === undefined) throw new Error("profile trigger missing");
  return row.id;
}

async function world(tx: TransactionContext): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const admin = await person(tx, `bill-admin-${tag}@example.invalid`);
  const member = await person(tx, `bill-member-${tag}@example.invalid`);
  const founder = await person(tx, `bill-founder-${tag}@example.invalid`);
  const investor = await person(tx, `bill-investor-${tag}@example.invalid`);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  await tx.sql`insert into identity.tenants (id, name) values (${tenantA}, 'Bill A'), (${tenantB}, 'Bill B')`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
    (${orgA}, ${tenantA}, 'company', 'Bill Co', ${`bill-co-${tag}`}),
    (${orgB}, ${tenantB}, 'investment_firm', 'Bill Capital', ${`bill-cap-${tag}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values
    (${tenantA}, ${orgA}), (${tenantB}, ${orgB})`;
  const companyId = randomUUID();
  const investorId = randomUUID();
  await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
    values (${companyId}, ${tenantA}, ${orgA}, 'Bill Co', ${`bill-co-${tag}`})`;
  await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (${investorId}, ${tenantB}, ${orgB}, 'VC', 'Bill Capital')`;
  const relationshipId = randomUUID();
  await tx.sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
    values (${relationshipId}, ${tenantA}, ${companyId}, ${investorId}, 'CONNECTED')`;
  return {
    admin,
    member,
    orgA,
    orgB,
    relationshipId,
    tenantA,
    founder,
    investor,
  };
}

function inOne(tx: TransactionContext): TransactionManager {
  return { run: (work) => work(tx) };
}

describe("@capital-q/billing against local Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function scenario(
    body: (
      w: World,
      tx: TransactionContext,
      now: { at: Date },
    ) => Promise<void>,
  ) {
    try {
      await db.transactions.run(async (tx) => {
        await body(await world(tx), tx, { at: new Date() });
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  function services(tx: TransactionContext, clock?: { at: Date }) {
    const entitlements = createEntitlementService({
      sql: tx.sql,
      ...(clock === undefined ? {} : { now: () => clock.at }),
    });
    return {
      entitlements,
      accounts: createBillingAccounts({
        sql: tx.sql,
        transactions: inOne(tx),
        entitlements,
      }),
      fees: createFeeLedger({ sql: tx.sql, transactions: inOne(tx) }),
      webhooks: createWebhookApplier({ transactions: inOne(tx) }),
    };
  }

  it("an account with no assignment is on the launch default (nobody loses access)", async () => {
    await scenario(async (w, tx) => {
      const { entitlements } = services(tx);
      const summary = await entitlements.summary({
        organisationId: w.orgA,
        userId: w.member,
      });
      expect(summary.plan.key).toBe("launch");
      expect(summary.source).toBe("LAUNCH_DEFAULT");
      const rehearsals = summary.features.find(
        (f) => f.key === FEATURE_REHEARSALS,
      );
      expect(rehearsals).toMatchObject({ included: true, limit: 30, used: 0 });
    });
  });

  it("BILLING-2: the blueprint is on Launch and Founder Pro, off on Free; recommendation volume is today's 200 on every plan", async () => {
    await scenario(async (w, tx) => {
      const { entitlements, accounts } = services(tx);
      const account: BillingAccount = {
        organisationId: w.orgA,
        userId: w.member,
      };
      expect(
        await entitlements.check(account, FEATURE_READINESS_BLUEPRINT),
      ).toMatchObject({ allowed: true });
      expect(
        await entitlements.valueOf(account, VALUE_RECOMMENDATION_VOLUME),
      ).toBe(200);
      const volumes = await tx.sql<
        { key: string; limit_value: number | null; included: boolean }[]
      >`
        select p.key, pf.limit_value, pf.included from billing.plan_features pf
          join billing.plans p on p.id = pf.plan_id
         where pf.feature_key = ${VALUE_RECOMMENDATION_VOLUME}`;
      expect(volumes).toHaveLength(5);
      expect(
        volumes.every((row) => row.included && row.limit_value === 200),
      ).toBe(true);

      await accounts.assignPlan({
        organisationId: w.orgA,
        planKey: "free",
        endsAt: null,
        byUserId: w.admin,
        reason: "Fixture: free plan",
      });
      const refused = await entitlements.check(
        account,
        FEATURE_READINESS_BLUEPRINT,
      );
      expect(refused.allowed).toBe(false);
      if (!refused.allowed) {
        expect(refused.refusal.reason).toBe("NOT_IN_PLAN");
        expect(refused.refusal.message).toBe(
          "Capital Readiness Blueprint isn't included in your Free plan. You can see what each plan includes in Settings → Plan.",
        );
      }
      // A VALUE is configuration: never a refusal, and an operator can set it.
      expect(
        await entitlements.check(account, VALUE_RECOMMENDATION_VOLUME),
      ).toMatchObject({ allowed: true });
      await accounts.setOverride({
        organisationId: w.orgA,
        featureKey: VALUE_RECOMMENDATION_VOLUME,
        limit: 50,
        expiresAt: null,
        revoke: false,
        byUserId: w.admin,
        reason: "Fixture: pilot",
      });
      expect(
        await entitlements.valueOf(account, VALUE_RECOMMENDATION_VOLUME),
      ).toBe(50);
      await expect(
        entitlements.valueOf(account, FEATURE_REHEARSALS),
      ).rejects.toThrow(/not a plan value/);
    });
  });

  it("a plan is in force from the millisecond it was assigned, though starts_at holds microseconds", async () => {
    await scenario(async (w, tx) => {
      const clock = { at: new Date() };
      const { entitlements, accounts } = services(tx, clock);
      await accounts.assignPlan({
        organisationId: w.orgA,
        planKey: "free",
        endsAt: null,
        byUserId: w.admin,
        reason: "Fixture: free plan",
      });
      const [row] = await tx.sql<{ starts_at: Date }[]>`
        select starts_at from billing.plan_assignments
         where account_key = ${`o:${w.orgA}`} and superseded_at is null`;
      if (row === undefined) throw new Error("assignment missing");
      // The JS Date truncates starts_at to its millisecond: a check made in
      // that same millisecond must already see the new plan.
      clock.at = row.starts_at;
      const summary = await entitlements.summary({
        organisationId: w.orgA,
        userId: w.member,
      });
      expect(summary.plan.key).toBe("free");
    });
  });

  it("consume is idempotent per key, refuses past the limit, and a void gives the unit back", async () => {
    await scenario(async (w, tx) => {
      const { entitlements, accounts } = services(tx);
      await accounts.assignPlan({
        organisationId: w.orgA,
        planKey: "free",
        endsAt: null,
        byUserId: w.admin,
        reason: "Fixture: free plan",
      });
      const account: BillingAccount = {
        organisationId: w.orgA,
        userId: w.member,
      };
      const first = await entitlements.consume({
        account,
        feature: FEATURE_REHEARSALS,
        idempotencyKey: "rehearsal-key-1",
        actorUserId: w.member,
        surface: "Q_API",
      });
      expect(first).toEqual({ allowed: true, remaining: 0, replayed: false });
      const again = await entitlements.consume({
        account,
        feature: FEATURE_REHEARSALS,
        idempotencyKey: "rehearsal-key-1",
        actorUserId: w.member,
        surface: "Q_API",
      });
      expect(again).toMatchObject({ allowed: true, replayed: true });
      const second = await entitlements.consume({
        account,
        feature: FEATURE_REHEARSALS,
        idempotencyKey: "rehearsal-key-2",
        actorUserId: w.member,
        surface: "Q_API",
      });
      expect(second.allowed).toBe(false);
      if (!second.allowed) {
        expect(second.refusal).toMatchObject({
          reason: "LIMIT_REACHED",
          planKey: "free",
          limit: 1,
          used: 1,
        });
        expect(second.refusal.message).toContain(
          "Your Free plan includes 1 rehearsal a month",
        );
      }
      expect(
        await entitlements.release({
          account,
          feature: FEATURE_REHEARSALS,
          idempotencyKey: "rehearsal-key-1",
          reason: "start failed",
        }),
      ).toBe(true);
      const third = await entitlements.consume({
        account,
        feature: FEATURE_REHEARSALS,
        idempotencyKey: "rehearsal-key-3",
        actorUserId: w.member,
        surface: "Q_API",
      });
      expect(third.allowed).toBe(true);
      // Another organisation's meter is its own.
      const other = await entitlements.check(
        { organisationId: w.orgB, userId: w.member },
        FEATURE_REHEARSALS,
      );
      expect(other).toMatchObject({ allowed: true, remaining: 29 });
      const [{ rows } = { rows: 0 }] = await tx.sql<{ rows: number }[]>`
        select count(*)::int as rows from billing.usage_events where account_key = ${`o:${w.orgA}`}`;
      expect(rows).toBe(2);
    });
  });

  it("history is never rewritten: usage, assignments and overrides refuse edits and deletes", async () => {
    await scenario(async (w, tx) => {
      const { entitlements } = services(tx);
      const account: BillingAccount = {
        organisationId: w.orgA,
        userId: w.member,
      };
      await entitlements.consume({
        account,
        feature: FEATURE_REHEARSALS,
        idempotencyKey: "rehearsal-key-x",
        actorUserId: w.member,
        surface: "API",
      });
      await expect(
        tx.sql.savepoint(
          (sp) => sp`update billing.usage_events set quantity = 5`,
        ),
      ).rejects.toThrow(/append-only|history/);
      await expect(
        tx.sql.savepoint((sp) => sp`delete from billing.usage_events`),
      ).rejects.toThrow(/history/);
      await expect(
        tx.sql.savepoint(
          (sp) => sp`delete from billing.plans where key = 'free'`,
        ),
      ).rejects.toThrow(/retired/);
    });
  });

  it("an operator trial ends by time and the account returns to the default; overrides replace one limit", async () => {
    await scenario(async (w, tx, clock) => {
      const { entitlements, accounts } = services(tx, clock);
      const ends = new Date(clock.at.getTime() + 86_400_000);
      await accounts.assignPlan({
        organisationId: w.orgA,
        planKey: "fund",
        endsAt: ends,
        byUserId: w.admin,
        reason: "Fixture: two-week trial",
      });
      clock.at = new Date(Date.now() + 1000);
      const account = { organisationId: w.orgA, userId: w.member };
      expect((await entitlements.summary(account)).plan.key).toBe("fund");
      expect((await entitlements.summary(account)).source).toBe("TRIAL");
      clock.at = new Date(ends.getTime() + 1000);
      expect((await entitlements.summary(account)).plan.key).toBe("launch");

      await accounts.setOverride({
        organisationId: w.orgA,
        featureKey: FEATURE_GATEWAYS,
        limit: 1,
        expiresAt: null,
        revoke: false,
        byUserId: w.admin,
        reason: "Fixture: cap",
      });
      expect(
        await entitlements.check(account, FEATURE_GATEWAYS, { count: 0 }),
      ).toMatchObject({ allowed: true });
      const refused = await entitlements.check(account, FEATURE_GATEWAYS, {
        count: 1,
      });
      expect(refused.allowed).toBe(false);
      if (!refused.allowed)
        expect(refused.refusal.message).toContain(
          "includes 1 gateway and you have 1",
        );
      const detail = await accounts.accountDetail(w.orgA, {
        [FEATURE_GATEWAYS]: 1,
      });
      expect(detail.history[0]).toMatchObject({
        planKey: "fund",
        source: "TRIAL",
      });
      expect(
        detail.current.features.find((f) => f.key === FEATURE_GATEWAYS)
          ?.overridden,
      ).toBe(true);
    });
  });

  it("Stripe events: applied once, older events never win, cancellation returns to the default", async () => {
    await scenario(async (w, tx) => {
      const { entitlements, webhooks } = services(tx);
      const sub = (status: string, lookup = "founder_pro_monthly") => ({
        id: "sub_fixture_1",
        status,
        customer: "cus_fixture_1",
        metadata: { account_key: `o:${w.orgA}` },
        items: { data: [{ price: { lookup_key: lookup } }] },
        cancel_at: null,
      });
      const created = {
        id: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        created: new Date(Date.now() - 60_000),
        object: sub("active"),
      };
      expect(await webhooks(created)).toBe("APPLIED");
      expect(await webhooks(created)).toBe("REPLAYED");
      const account = { organisationId: w.orgA, userId: w.member };
      expect((await entitlements.summary(account)).plan.key).toBe(
        "founder_pro",
      );
      expect((await entitlements.summary(account)).source).toBe("STRIPE");

      const deleted = {
        id: `evt_${randomUUID()}`,
        type: "customer.subscription.deleted",
        created: new Date(),
        object: sub("canceled"),
      };
      // An older "updated" arriving after the deletion must not resurrect the plan.
      const stale = {
        id: `evt_${randomUUID()}`,
        type: "customer.subscription.updated",
        created: new Date(Date.now() - 30_000),
        object: sub("active", "fund_monthly"),
      };
      expect(await webhooks(deleted)).toBe("APPLIED");
      expect(await webhooks(stale)).toBe("APPLIED");
      expect((await entitlements.summary(account)).plan.key).toBe("launch");
      const [customer] = await tx.sql<{ provider_customer_id: string }[]>`
        select provider_customer_id from billing.customers where account_key = ${`o:${w.orgA}`}`;
      expect(customer?.provider_customer_id).toBe("cus_fixture_1");
      expect(
        await webhooks({
          id: `evt_${randomUUID()}`,
          type: "invoice.paid",
          created: new Date(),
          object: {},
        }),
      ).toBe("IGNORED");
    });
  });

  it("fees: confirmed INVESTED only, RATE_NOT_SET until a rate, exact numeric, void when superseded", async () => {
    await scenario(async (w, tx) => {
      const { fees } = services(tx);
      // The fee schedule is global and append-only: on a shared local DB a
      // rate set earlier (admin console, another run) is the latest version
      // and would make this start ACCRUED. Establish "no rate yet" as the
      // newest version inside this rolled-back transaction.
      await tx.sql`insert into billing.fee_schedules (version, rate_bps, accrue_levels, payer_side, reason)
        select coalesce(max(version), 0) + 1, null, array['INVESTED'], 'COMPANY', 'Fixture: no rate yet'
          from billing.fee_schedules`;
      const commitment = randomUUID();
      await tx.sql`insert into network.commitments
          (id, tenant_id, relationship_id, amount, currency_code, level, status, stated_by_side,
           stated_by_user_id, confirmed_by_user_id, confirmed_at, idempotency_key)
        values (${commitment}, ${w.tenantA}, ${w.relationshipId}, 250000.10, 'USD', 'INVESTED', 'CONFIRMED',
                'INVESTOR', ${w.investor}, ${w.founder}, now(), ${`fix-${randomUUID()}`})`;
      // Stated but unconfirmed money is never billed.
      const stated = randomUUID();
      const relationship2 = randomUUID();
      await tx.sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        select ${relationship2}, r.tenant_id, r.company_id, io.id, 'CONNECTED'
          from network.relationships r,
               lateral (select id from core.investor_organisations where id <> r.investor_organisation_id limit 1) io
         where r.id = ${w.relationshipId}`;
      await tx.sql`insert into network.commitments
          (id, tenant_id, relationship_id, amount, currency_code, level, status, stated_by_side, stated_by_user_id, idempotency_key)
        values (${stated}, ${w.tenantA}, ${relationship2}, 999, 'USD', 'INVESTED', 'STATED', 'INVESTOR', ${w.investor}, ${`fix-${randomUUID()}`})`;

      expect((await fees.accrue()).added).toBeGreaterThanOrEqual(1);
      let ledger = await fees.list();
      let entry = ledger.entries.find((e) => e.commitmentId === commitment);
      expect(entry).toMatchObject({
        status: "RATE_NOT_SET",
        feeAmount: null,
        amount: "250000.10",
      });
      expect(ledger.entries.some((e) => e.commitmentId === stated)).toBe(false);

      await fees.setRate({
        rateBps: 150,
        accrueLevels: ["INVESTED"],
        payerSide: "COMPANY",
        byUserId: w.admin,
        reason: "Fixture: 1.5%",
      });
      ledger = await fees.list();
      entry = ledger.entries.find((e) => e.commitmentId === commitment);
      expect(entry).toMatchObject({
        status: "ACCRUED",
        rateBps: 150,
        feeAmount: "3750.00",
      });
      expect(await fees.accrue()).toMatchObject({ added: 0 });

      await tx.sql`update network.commitments set status = 'SUPERSEDED', confirmed_at = null, confirmed_by_user_id = null where id = ${commitment}`;
      expect((await fees.accrue()).voided).toBeGreaterThanOrEqual(1);
      entry = (await fees.list()).entries.find(
        (e) => e.commitmentId === commitment,
      );
      expect(entry?.status).toBe("VOID");
      await expect(
        tx.sql.savepoint(
          (sp) =>
            sp`update billing.fee_entries set status = 'ACCRUED' where commitment_id = ${commitment}`,
        ),
      ).rejects.toThrow(/not allowed/);
    });
  });
});
