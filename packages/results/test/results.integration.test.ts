import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  FounderResultsSchema,
  InvestorResultsSchema,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createResultsReader } from "../src/index.js";

/**
 * Results against local Supabase Postgres. What is proven: a founder's and
 * an investor's figures come from their own records only (another
 * company's relationship and another investor's browsing never count);
 * investors' browsing of a company is shown only at 3 organisations or
 * more; unknown raise reads null. Rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

const WINDOW = { from: "2000-01-01", to: "2100-01-01", label: "All" };

type Side = {
  readonly actor: ActorContext;
  readonly tenantId: string;
  readonly orgId: string;
  readonly entityId: string;
};

async function person(tx: TransactionContext) {
  const auth = randomUUID();
  await tx.sql`insert into auth.users (id) values (${auth})`;
  const [row] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (row === undefined) throw new Error("no profile");
  return row.id;
}

async function org(
  tx: TransactionContext,
  kind: "company" | "investment_firm",
  name: string,
): Promise<Side> {
  const tenantId = randomUUID();
  const orgId = randomUUID();
  const userId = await person(tx);
  const membershipId = randomUUID();
  const tag = orgId.slice(0, 8);
  await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${name})`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${orgId}, ${tenantId}, ${kind}, ${name}, ${`r-${tag}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
  await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
    values (${membershipId}, ${tenantId}, ${orgId}, ${userId})`;
  const entityId = randomUUID();
  if (kind === "company") {
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code)
      values (${entityId}, ${tenantId}, ${orgId}, ${name}, ${`r-${tag}`}, 'seed')`;
  } else {
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${entityId}, ${tenantId}, ${orgId}, 'VC', ${name})`;
  }
  return {
    actor: {
      userId: UserIdSchema.parse(userId),
      tenantId: TenantIdSchema.parse(tenantId),
      organisationId: OrganisationIdSchema.parse(orgId),
      membershipId: MembershipIdSchema.parse(membershipId),
      actorType: "HUMAN",
    },
    tenantId,
    orgId,
    entityId,
  };
}

async function relate(
  tx: TransactionContext,
  company: Side,
  investor: Side,
  state: string,
) {
  const id = randomUUID();
  await tx.sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
    values (${id}, ${company.tenantId}, ${company.entityId}, ${investor.entityId}, ${state})`;
  return id;
}

async function event(
  tx: TransactionContext,
  relationshipId: string,
  tenantId: string,
  sequence: number,
  type: string,
) {
  await tx.sql`insert into network.relationship_events
      (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type,
       visibility_scope, correlation_id)
    values (${tenantId}, ${relationshipId}, ${sequence}, ${type}, 'SYSTEM', ${randomUUID()},
            'SYSTEM', 'relationship_shared', ${`cor_${randomUUID()}`})`;
}

async function interaction(
  tx: TransactionContext,
  investor: Side,
  company: Side,
  type: string,
) {
  await tx.sql`insert into recommendation.interaction_events
      (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
       interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
    values (${investor.tenantId}, ${investor.actor.userId}, ${investor.entityId}, ${company.entityId},
            ${company.tenantId}, ${type}, 'ATTENTION', 'interaction.v1', 'RECOMMENDATION_FEED',
            ${`cid-${randomUUID().slice(0, 12)}`}, now())`;
}

describe("@capital-q/results against local Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function scenario(body: (tx: TransactionContext) => Promise<void>) {
    try {
      await db.transactions.run(async (tx) => {
        await body(tx);
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  it("counts a founder's own records only and floors other people's browsing", async () => {
    await scenario(async (tx) => {
      const nixo = await org(tx, "company", "Nixo");
      const other = await org(tx, "company", "Other Co");
      const vp = await org(tx, "investment_firm", "Ventures Platform");
      const voltron = await org(tx, "investment_firm", "Voltron");
      const rel = await relate(tx, nixo, vp, "CONNECTED");
      await relate(tx, nixo, voltron, "INTEREST_EXPRESSED");
      const otherRel = await relate(tx, other, vp, "CONNECTED");
      await event(tx, rel, nixo.tenantId, 1, "connection_accepted");
      await event(tx, rel, nixo.tenantId, 2, "meeting_held");
      await event(tx, otherRel, other.tenantId, 1, "meeting_held");
      await interaction(tx, vp, nixo, "PROFILE_OPEN");
      await interaction(tx, voltron, nixo, "PROFILE_OPEN");
      await interaction(tx, vp, other, "PROFILE_OPEN");

      const reader = createResultsReader({ sql: tx.sql });
      const results = await reader.read(nixo.actor, WINDOW);
      if (results.side !== "FOUNDER") throw new Error(results.side);
      expect(results.organisationName).toBe("Nixo");
      expect(results.raise).toBeNull();
      expect(results.engagement.connections).toBe(1);
      expect(results.engagement.meetingsHeld).toBe(1);
      expect(results.engagement.profileOpens).toEqual({
        value: null,
        belowFloor: true,
      });
      expect(results.pipeline.byState).toEqual(
        expect.arrayContaining([
          { state: "CONNECTED", count: 1 },
          { state: "INTEREST_EXPRESSED", count: 1 },
        ]),
      );
      expect(results.pipeline.rows.map((r) => r.investorName).sort()).toEqual([
        "Ventures Platform",
        "Voltron",
      ]);
      // Dashboard reads: only firms with a recorded step; no interest yet
      // means no response time (unknown, not 0).
      expect(results.investorsEngaged).toBe(1);
      expect(results.diligence).toEqual({ requested: 0, fulfilled: 0 });
      expect(results.responseTime).toEqual({
        medianHours: null,
        answered: 0,
        waiting: 0,
      });
      expect(FounderResultsSchema.safeParse(results).success).toBe(true);

      // A third investor firm crosses the floor.
      const third = await org(tx, "investment_firm", "Third");
      await interaction(tx, third, nixo, "PROFILE_OPEN");
      const again = await reader.read(nixo.actor, WINDOW);
      if (again.side !== "FOUNDER") throw new Error(again.side);
      expect(again.engagement.profileOpens).toEqual({
        value: 3,
        belowFloor: false,
      });
    });
  });

  it("builds an investor's funnel from their own browsing and relationships", async () => {
    await scenario(async (tx) => {
      const vp = await org(tx, "investment_firm", "Ventures Platform");
      const voltron = await org(tx, "investment_firm", "Voltron");
      const nixo = await org(tx, "company", "Nixo");
      const chow = await org(tx, "company", "Chowdeck");
      await interaction(tx, vp, nixo, "IMPRESSION");
      await interaction(tx, vp, chow, "IMPRESSION");
      await interaction(tx, vp, nixo, "SAVE");
      await interaction(tx, voltron, chow, "SAVE");
      const rel = await relate(tx, nixo, vp, "CONNECTED");
      await event(tx, rel, nixo.tenantId, 1, "connection_accepted");
      await event(tx, rel, nixo.tenantId, 2, "meeting_held");
      await relate(tx, chow, voltron, "CONNECTED");

      const results = await createResultsReader({ sql: tx.sql }).read(
        vp.actor,
        WINDOW,
      );
      if (results.side !== "INVESTOR") throw new Error(results.side);
      expect(results.funnel).toEqual({
        seen: 2,
        saved: 1,
        interest: 0,
        connected: 1,
        met: 1,
        committed: 0,
      });
      expect(results.meetings.held).toBe(1);
      expect(results.pipelineFit.map((row) => row.companyName)).toEqual([
        "Nixo",
      ]);
      expect(results.hasMandate).toBe(false);
      expect(results.pipelineFit[0]?.reasons).toEqual([]);
      expect(results.pipelineFit[0]?.companyId).toEqual(expect.any(String));
      // Their own relationships only: Voltron's Chowdeck is not here.
      expect(results.pipeline?.byState).toEqual([
        { state: "CONNECTED", count: 1 },
      ]);
      expect(results.interest).toEqual({ sent: 0, accepted: 0, declined: 0 });
      expect(results.commitments).toEqual([]);
      expect(InvestorResultsSchema.safeParse(results).success).toBe(true);
    });
  });

  it("answers NONE for someone with no company or firm", async () => {
    await scenario(async (tx) => {
      const userId = await person(tx);
      const results = await createResultsReader({ sql: tx.sql }).read(
        {
          userId: UserIdSchema.parse(userId),
          actorType: "HUMAN",
        } as ActorContext,
        WINDOW,
      );
      expect(results).toEqual({ side: "NONE" });
    });
  });
});
