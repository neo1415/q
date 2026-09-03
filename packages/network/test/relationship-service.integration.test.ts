import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  type CompanyId,
} from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
import {
  createPostgresInvestorOrganisationQueryPort,
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";
import { z } from "zod";

import { NETWORK_EVENTS } from "../src/events/index.js";
import {
  createNetworkService,
  createRelationshipEventRegistry,
  defineRelationshipEvent,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RelationshipPartyNotFoundError,
  type NetworkService,
} from "../src/index.js";

/**
 * The relationship spine against the real local database. Most tests run in
 * one rolled-back transaction with a savepoint-backed TransactionManager;
 * the two concurrency tests must commit (separate connections) and clean up
 * after themselves. Covers: one pair, Discover/GateQ convergence, cross-
 * tenant anchor, ordering, rollback, visibility persistence, privacy of
 * event payloads, and creation atomicity.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SENTINEL = "PRIVATE-RELATIONSHIP-EVENT-DATA-DO-NOT-EMIT";

class Rollback extends Error {}

/** Test-only event type so scopes and payload privacy can be exercised. */
const TestNoteEvent = defineRelationshipEvent({
  type: "test_fixture_note",
  payloadSchema: z.object({ note: z.string().max(4000) }).strict(),
  allowedVisibilityScopes: [
    "investor_private",
    "founder_private",
    "relationship_shared",
  ],
  description: "Test fixture only; never registered in production.",
});
const testRegistry = createRelationshipEventRegistry([
  ...RELATIONSHIP_EVENT_DEFINITIONS,
  TestNoteEvent,
]);
const outboxRegistry = createEventRegistry([...NETWORK_EVENTS]);

type World = {
  readonly tx: TransactionContext;
  readonly service: NetworkService;
  readonly founder: ActorContext;
  readonly investorRep: ActorContext;
  readonly tenantC: string;
  readonly tenantI: string;
  readonly companyA: CompanyId;
  readonly companyB: CompanyId;
  readonly investorA: InvestorOrganisationId;
  readonly investorB: InvestorOrganisationId;
  readonly investorMembershipId: string;
  readonly investorUserId: string;
  readonly investorOrg: string;
  readonly founderUserId: string;
};

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

function buildService(
  sql: TransactionContext["sql"],
  transactions: TransactionManager,
  outbox: OutboxWriter,
): NetworkService {
  return createNetworkService({
    sql,
    transactions,
    companies: createPostgresCompanyQueryPort({ sql }),
    investors: createPostgresInvestorOrganisationQueryPort({ sql }),
    outbox,
    audit: createPostgresMaterialActionAuditWriter(),
    registry: testRegistry,
  });
}

describe("@capital-q/network against local PostgreSQL", () => {
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

  // Fixture builders -----------------------------------------------------------------

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    type: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, ${type}, ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ): Promise<CompanyId> {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`co-${id.slice(0, 8)}`})`;
    return CompanyIdSchema.parse(id);
  }

  async function insertInvestor(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ): Promise<InvestorOrganisationId> {
    const id = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${id}, ${tenantId}, ${organisationId}, 'VC', ${name})`;
    return InvestorOrganisationIdSchema.parse(id);
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<{
    principal: AuthenticatedPrincipal;
    membershipId: string;
    userId: string;
  }> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
      userId: profile.id,
    };
  }

  async function resolveActor(
    tx: TransactionContext,
    principal: AuthenticatedPrincipal,
  ): Promise<ActorContext> {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  /** Two tenants: the company side (C) and the investor side (I). */
  async function seedWorld(tx: TransactionContext) {
    const tenantC = await insertTenant(tx, "Network Company Tenant");
    const tenantI = await insertTenant(tx, "Network Investor Tenant");
    const companyOrg = await insertOrganisation(
      tx,
      tenantC,
      "company",
      "NexaRail",
    );
    const companyOrgB = await insertOrganisation(
      tx,
      tenantC,
      "company",
      "Other Co",
    );
    const investorOrg = await insertOrganisation(
      tx,
      tenantI,
      "investment_firm",
      "Apex Ventures",
    );
    const investorOrgB = await insertOrganisation(
      tx,
      tenantI,
      "investment_firm",
      "Beta Capital",
    );
    const companyA = await insertCompany(
      tx,
      tenantC,
      companyOrg,
      "NexaRail Technologies",
    );
    const companyB = await insertCompany(
      tx,
      tenantC,
      companyOrgB,
      "Other Company",
    );
    const investorA = await insertInvestor(
      tx,
      tenantI,
      investorOrg,
      "Apex Ventures",
    );
    const investorB = await insertInvestor(
      tx,
      tenantI,
      investorOrgB,
      "Beta Capital",
    );
    const founderMember = await insertMember(tx, tenantC, companyOrg);
    const investorMember = await insertMember(tx, tenantI, investorOrg);
    return {
      tenantC,
      tenantI,
      companyA,
      companyB,
      investorA,
      investorB,
      founder: await resolveActor(tx, founderMember.principal),
      investorRep: await resolveActor(tx, investorMember.principal),
      investorMembershipId: investorMember.membershipId,
      investorUserId: investorMember.userId,
      investorOrg,
      founderUserId: founderMember.userId,
    };
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
    } = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const seeded = await seedWorld(tx);
        const realOutbox = createOutboxWriter({ registry: outboxRegistry });
        const service = buildService(
          tx.sql,
          nestedTransactions(tx),
          options.outbox === undefined
            ? realOutbox
            : options.outbox(realOutbox),
        );
        await work({ tx, service, ...seeded });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  // -------------------------------------------------------------------------
  // Canonical pair
  // -------------------------------------------------------------------------

  it("creates one canonical relationship anchored in the company tenant, with a sequence-1 private discovered event, audit and outbox", async () => {
    await withWorld(
      async ({
        tx,
        service,
        investorRep,
        tenantC,
        tenantI,
        companyA,
        investorA,
      }) => {
        const correlationId = CORRELATION();
        const { relationship, created } = await service.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER", id: "slate:item-42" },
          visibilityScope: "investor_private",
          correlationId,
        });
        expect(created).toBe(true);
        expect([companyA, investorA, investorRep.userId]).not.toContain(
          relationship.id,
        );
        // Company tenant is the anchor; the investor stays in its own tenant; one row.
        expect(relationship.tenantId).toBe(tenantC);
        expect(tenantC).not.toBe(tenantI);
        expect(relationship.currentState).toBe("DISCOVERED");
        expect(relationship.lastEventSequence).toBe(1);
        expect(relationship.stateUpdatedAt).toBe(
          relationship.firstDiscoveredAt,
        );
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships where company_id = ${companyA} and investor_organisation_id = ${investorA}`,
          ),
        ).toBe(1);

        const events = await service.query.listEvents(relationship.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          sequence: 1,
          eventType: "discovered",
          actor: { type: "HUMAN", id: investorRep.userId },
          source: { type: "DISCOVER", id: "slate:item-42" },
          visibilityScope: "investor_private",
          payload: { sourceReference: "slate:item-42" },
          correlationId,
        });
        expect(events[0]?.occurredAt).toBe(relationship.firstDiscoveredAt);

        const audits = await tx.sql<
          { action_type: string; resource_id: string; metadata: unknown }[]
        >`
          select action_type, resource_id, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action_type: "relationship.created",
          resource_id: relationship.id,
          metadata: {
            companyId: companyA,
            investorOrganisationId: investorA,
            sourceType: "DISCOVER",
          },
        });
        const outbox = await tx.sql<
          {
            event_type: string;
            tenant_id: string;
            payload: { data: unknown };
          }[]
        >`
          select event_type, tenant_id, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(outbox).toHaveLength(1);
        expect(outbox[0]?.event_type).toBe("network.relationship.created");
        expect(outbox[0]?.tenant_id).toBe(tenantC);
        expect(outbox[0]?.payload.data).toEqual({
          relationshipId: relationship.id,
          companyId: companyA,
          investorOrganisationId: investorA,
        });
        // Nothing beyond the relationship: no interest, match, meeting or deal tables exist.
        const tables = await tx.sql<{ n: string }[]>`
          select table_name as n from information_schema.tables
           where table_schema = 'network' and table_name not in ('relationships', 'relationship_events')`;
        expect(tables).toEqual([]);
      },
    );
  });

  it("returns the same relationship for the same pair from Discover then GateQ, keeps first_discovered_at, appends no second origin event, emits no second created event", async () => {
    await withWorld(
      async ({ tx, service, investorRep, founder, companyA, investorA }) => {
        const first = await service.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        // Force a visibly earlier first discovery to prove it does not move.
        await tx.sql`update network.relationships set first_discovered_at = '2026-09-03T00:00:00Z' where id = ${first.relationship.id}`;
        const second = await service.ensureRelationship({
          actor: founder,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "GATEQ", id: "gateq:application-7" },
          visibilityScope: "founder_private",
          correlationId: CORRELATION(),
        });
        expect(second.created).toBe(false);
        expect(second.relationship.id).toBe(first.relationship.id);
        expect(second.relationship.firstDiscoveredAt).toBe(
          "2026-09-03T00:00:00.000Z",
        );
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships where company_id = ${companyA} and investor_organisation_id = ${investorA}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationship_events where relationship_id = ${first.relationship.id}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where event_type = 'network.relationship.created' and payload -> 'data' ->> 'relationshipId' = ${first.relationship.id}`,
          ),
        ).toBe(1);
        await expect(
          service.query.findByParties(companyA, investorA),
        ).resolves.toMatchObject({ id: first.relationship.id });
      },
    );
  });

  it("different investor or different company means a different relationship; unknown parties are refused before anything is written", async () => {
    await withWorld(
      async ({
        tx,
        service,
        investorRep,
        companyA,
        companyB,
        investorA,
        investorB,
      }) => {
        const base = {
          actor: investorRep,
          source: { type: "DISCOVER" as const },
          visibilityScope: "investor_private" as const,
        };
        const aa = await service.ensureRelationship({
          ...base,
          companyId: companyA,
          investorOrganisationId: investorA,
          correlationId: CORRELATION(),
        });
        const ab = await service.ensureRelationship({
          ...base,
          companyId: companyA,
          investorOrganisationId: investorB,
          correlationId: CORRELATION(),
        });
        const ba = await service.ensureRelationship({
          ...base,
          companyId: companyB,
          investorOrganisationId: investorA,
          correlationId: CORRELATION(),
        });
        expect(
          new Set([aa.relationship.id, ab.relationship.id, ba.relationship.id])
            .size,
        ).toBe(3);
        await expect(
          service.ensureRelationship({
            ...base,
            companyId: CompanyIdSchema.parse(randomUUID()),
            investorOrganisationId: investorA,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(RelationshipPartyNotFoundError);
        await expect(
          service.ensureRelationship({
            ...base,
            companyId: companyA,
            investorOrganisationId:
              InvestorOrganisationIdSchema.parse(randomUUID()),
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(RelationshipPartyNotFoundError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships`,
          ),
        ).toBe(3);
      },
    );
  });

  it("survives capital objective replacement and investor representative change: same RelationshipId", async () => {
    await withWorld(
      async ({
        tx,
        service,
        investorRep,
        founder,
        tenantC,
        tenantI,
        companyA,
        investorA,
        investorMembershipId,
        investorOrg,
      }) => {
        const { relationship } = await service.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        // Seed raise closed as REPLACED, Series A opened (fixture-level capital objectives).
        const seed = randomUUID();
        await tx.sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, status, closed_at, created_by_user_id)
          values (${seed}, ${tenantC}, ${companyA}, 2000000, 'USD', 'REPLACED', clock_timestamp(), ${founder.userId})`;
        await tx.sql`insert into core.capital_objectives (tenant_id, company_id, target_amount, currency_code, target_stage, created_by_user_id)
          values (${tenantC}, ${companyA}, 6000000, 'USD', 'series_a', ${founder.userId})`;
        // Representative Sarah leaves, David takes over (fixture-level rows).
        await tx.sql`insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title, is_current, ended_at)
          values (${tenantI}, ${investorA}, ${investorOrg}, ${investorRep.userId}, ${investorMembershipId}, 'Partner', false, clock_timestamp())`;
        const again = await service.ensureRelationship({
          actor: founder,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "GATEQ" },
          visibilityScope: "founder_private",
          correlationId: CORRELATION(),
        });
        expect(again.relationship.id).toBe(relationship.id);
        expect(again.created).toBe(false);
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships`,
          ),
        ).toBe(1);
      },
    );
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  it("appends ordered events with the exact scopes chosen; a rolled-back append leaves no gap; payload text never reaches outbox or audit", async () => {
    await withWorld(
      async ({ tx, service, investorRep, founder, companyA, investorA }) => {
        const { relationship } = await service.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        const scopes = [
          "investor_private",
          "founder_private",
          "relationship_shared",
        ] as const;
        for (const [index, scope] of scopes.entries()) {
          const event = await tx.sql.savepoint((inner) =>
            service.events.append(
              { sql: inner },
              {
                relationshipId: relationship.id,
                eventType: "test_fixture_note",
                actor: {
                  type: "HUMAN",
                  id: index === 1 ? founder.userId : investorRep.userId,
                },
                source: { type: "MANUAL" },
                visibilityScope: scope,
                payload: { note: `${SENTINEL} ${scope}` },
                correlationId: CORRELATION(),
              },
            ),
          );
          expect(event.sequence).toBe(index + 2);
          expect(event.visibilityScope).toBe(scope);
        }
        // A failed append releases its sequence with the savepoint.
        await expect(
          tx.sql.savepoint(async (inner) => {
            await service.events.append(
              { sql: inner },
              {
                relationshipId: relationship.id,
                eventType: "test_fixture_note",
                actor: { type: "HUMAN", id: investorRep.userId },
                source: { type: "MANUAL" },
                visibilityScope: "investor_private",
                payload: { note: "doomed" },
                correlationId: CORRELATION(),
              },
            );
            throw new Error("abort append");
          }),
        ).rejects.toThrow("abort append");
        const after = await service.events.append(tx, {
          relationshipId: relationship.id,
          eventType: "test_fixture_note",
          actor: { type: "HUMAN", id: investorRep.userId },
          source: { type: "MANUAL" },
          visibilityScope: "investor_private",
          payload: { note: "after rollback" },
          correlationId: CORRELATION(),
        });
        expect(after.sequence).toBe(5);

        const events = await service.query.listEvents(relationship.id);
        expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
        expect(events.map((e) => e.visibilityScope)).toEqual([
          "investor_private",
          "investor_private",
          "founder_private",
          "relationship_shared",
          "investor_private",
        ]);
        expect(events.map((e) => e.eventType)).toEqual([
          "discovered",
          "test_fixture_note",
          "test_fixture_note",
          "test_fixture_note",
          "test_fixture_note",
        ]);
        const page = await service.query.listEvents(relationship.id, {
          afterSequence: 3,
          limit: 1,
        });
        expect(page.map((e) => e.sequence)).toEqual([4]);
        const [row] = await tx.sql<
          { last_event_sequence: string; current_state: string }[]
        >`
        select last_event_sequence::text, current_state from network.relationships where id = ${relationship.id}`;
        expect(row).toEqual({
          last_event_sequence: "5",
          current_state: "DISCOVERED",
        });

        // The marker lives in the protected history only.
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationship_events where payload::text like ${`%${SENTINEL}%`}`,
          ),
        ).toBe(3);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${SENTINEL}%`}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${SENTINEL}%`}`,
          ),
        ).toBe(0);
      },
    );
  });

  it("refuses unknown event types, disallowed scopes and oversized payloads without allocating a sequence", async () => {
    await withWorld(
      async ({ tx, service, investorRep, companyA, investorA }) => {
        const { relationship } = await service.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        const base = {
          relationshipId: relationship.id,
          actor: { type: "HUMAN" as const, id: investorRep.userId },
          source: { type: "MANUAL" as const },
          correlationId: CORRELATION(),
        };
        await expect(
          service.events.append(tx, {
            ...base,
            eventType: "investment_won",
            visibilityScope: "investor_private",
            payload: {},
          }),
        ).rejects.toThrow(/not registered/);
        await expect(
          service.events.append(tx, {
            ...base,
            eventType: "discovered",
            visibilityScope: "relationship_shared",
            payload: {},
          }),
        ).rejects.toThrow(/not allowed/);
        await expect(
          service.events.append(tx, {
            ...base,
            eventType: "test_fixture_note",
            visibilityScope: "investor_private",
            payload: { note: "x".repeat(9000) },
          }),
        ).rejects.toThrow(/not valid/);
        const [row] = await tx.sql<{ last_event_sequence: string }[]>`
        select last_event_sequence::text from network.relationships where id = ${relationship.id}`;
        expect(row?.last_event_sequence).toBe("1");
      },
    );
  });

  it("rolls back the relationship, its history, audit and idempotent state when the created event cannot be enqueued", async () => {
    await withWorld(
      async ({ tx, service, investorRep, companyA, investorA }) => {
        const correlationId = CORRELATION();
        await expect(
          service.ensureRelationship({
            actor: investorRep,
            companyId: companyA,
            investorOrganisationId: investorA,
            source: { type: "DISCOVER" },
            visibilityScope: "investor_private",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationship_events`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`,
          ),
        ).toBe(0);
      },
      {
        outbox: () => ({
          enqueue: () => Promise.reject(new Error("outbox unavailable")),
        }),
      },
    );
  });

  // -------------------------------------------------------------------------
  // Real concurrency (committed, then cleaned up)
  // -------------------------------------------------------------------------

  it("two concurrent transactions ensuring the same pair produce one relationship, one origin event, one created event; concurrent appends never share a sequence", async () => {
    const seeded = await db.transactions.run(async (tx) => seedWorld(tx));
    const created: string[] = [];
    try {
      const run = () =>
        db.transactions.run(async (tx) => {
          const service = buildService(
            tx.sql,
            { run: (work) => work(tx) },
            createOutboxWriter({ registry: outboxRegistry }),
          );
          return service.ensureRelationship({
            actor: seeded.investorRep,
            companyId: seeded.companyA,
            investorOrganisationId: seeded.investorA,
            source: { type: "DISCOVER" },
            visibilityScope: "investor_private",
            correlationId: CORRELATION(),
          });
        });
      const [a, b] = await Promise.all([run(), run()]);
      created.push(a.relationship.id);
      expect(b.relationship.id).toBe(a.relationship.id);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      const [rows] = await db.sql<
        { relationships: number; events: number; outbox: number }[]
      >`
        select (select count(*)::int from network.relationships where company_id = ${seeded.companyA}) as relationships,
               (select count(*)::int from network.relationship_events where relationship_id = ${a.relationship.id}) as events,
               (select count(*)::int from events.outbox where event_type = 'network.relationship.created' and payload -> 'data' ->> 'relationshipId' = ${a.relationship.id}) as outbox`;
      expect(rows).toEqual({ relationships: 1, events: 1, outbox: 1 });

      const append = (note: string) =>
        db.transactions.run(async (tx) => {
          const service = buildService(
            tx.sql,
            { run: (work) => work(tx) },
            createOutboxWriter({ registry: outboxRegistry }),
          );
          return service.events.append(tx, {
            relationshipId: a.relationship.id,
            eventType: "test_fixture_note",
            actor: { type: "HUMAN", id: seeded.investorRep.userId },
            source: { type: "MANUAL" },
            visibilityScope: "investor_private",
            payload: { note },
            correlationId: CORRELATION(),
          });
        });
      const appended = await Promise.all(
        ["one", "two", "three", "four"].map(append),
      );
      const sequences = appended.map((e) => e.sequence).sort((x, y) => x - y);
      expect(sequences).toEqual([2, 3, 4, 5]);
      expect(new Set(sequences).size).toBe(4);
    } finally {
      await db.sql`delete from network.relationship_events where relationship_id = any(${created}::uuid[])`;
      await db.sql`delete from network.relationships where id = any(${created}::uuid[])`;
      await db.sql`delete from events.outbox where payload -> 'data' ->> 'relationshipId' = any(${created}::text[])`;
      await db.sql`delete from audit.material_actions where resource_type = 'relationship' and resource_id = any(${created}::text[])`;
      await db.sql`delete from core.investor_organisations where tenant_id = ${seeded.tenantI}`;
      await db.sql`delete from core.companies where tenant_id = ${seeded.tenantC}`;
      await db.sql`delete from identity.user_active_contexts where user_id in (${seeded.founderUserId}, ${seeded.investorUserId})`;
      await db.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id in (${seeded.tenantC}, ${seeded.tenantI}))`;
      await db.sql`delete from identity.organisation_memberships where tenant_id in (${seeded.tenantC}, ${seeded.tenantI})`;
      await db.sql`delete from identity.tenant_organisations where tenant_id in (${seeded.tenantC}, ${seeded.tenantI})`;
      await db.sql`delete from identity.organisations where tenant_id in (${seeded.tenantC}, ${seeded.tenantI})`;
      const authUsers = await db.sql<
        { auth_user_id: string }[]
      >`select auth_user_id from identity.user_profiles where id in (${seeded.founderUserId}, ${seeded.investorUserId})`;
      await db.sql`delete from identity.user_profiles where id in (${seeded.founderUserId}, ${seeded.investorUserId})`;
      await db.sql`delete from auth.users where id = any(${authUsers.map((u) => u.auth_user_id)}::uuid[])`;
      await db.sql`delete from identity.tenants where id in (${seeded.tenantC}, ${seeded.tenantI})`;
    }
  });
});
