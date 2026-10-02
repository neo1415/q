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
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createPostgresInvestorOrganisationQueryPort,
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { NETWORK_EVENTS } from "../src/events/index.js";
import {
  ConnectionNotAcceptedError,
  ConnectionNotPermittedError,
  createConnectionService,
  createInterestService,
  InterestAlreadyAnsweredError,
  RelationshipAlreadyConnectedError,
  InterestNotFoundError,
  type ConnectionService,
  type InboundPreference,
  type InterestService,
} from "../src/index.js";

/**
 * Founder Connection Requests (ADR 0023) against the real local database,
 * one rolled-back transaction per test. The real Postgres policy decides
 * the capabilities; the founder-facing investor read is a map the test
 * controls (visibility plus the investor's inbound preference), and the
 * QUALIFIED check is a set, standing in for mandate eligibility.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly connections: ConnectionService;
  readonly interests: InterestService;
  readonly preference: Map<string, InboundPreference>;
  readonly qualified: Set<string>;
  readonly founder: ActorContext;
  readonly companyViewer: ActorContext;
  readonly investorRep: ActorContext;
  readonly investorViewer: ActorContext;
  readonly otherInvestorRep: ActorContext;
  readonly companyA: CompanyId;
  readonly investorA: InvestorOrganisationId;
  readonly investorB: InvestorOrganisationId;
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

describe("Founder Connection Requests against local PostgreSQL", () => {
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

  /** A member with the given role, or with no role at all. */
  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    role: "organisation_admin" | "organisation_member" | null,
  ): Promise<AuthenticatedPrincipal> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    if (role !== null) {
      await tx.sql`insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id from permissions.roles r where r.code = ${role}`;
    }
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
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

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantC = await insertTenant(tx, "Connection Company Tenant");
        const tenantI = await insertTenant(tx, "Connection Investor Tenant");
        const companyOrg = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Kora",
        );
        const investorOrg = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Apex",
        );
        const investorOrgB = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Birch",
        );
        const companyA = await insertCompany(tx, tenantC, companyOrg, "Kora");
        const investorA = await insertInvestor(
          tx,
          tenantI,
          investorOrg,
          "Apex",
        );
        const investorB = await insertInvestor(
          tx,
          tenantI,
          investorOrgB,
          "Birch",
        );
        const founder = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrg, "organisation_admin"),
        );
        const companyViewer = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrg, null),
        );
        const investorRep = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrg, "organisation_member"),
        );
        const investorViewer = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrg, null),
        );
        const otherInvestorRep = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrgB, "organisation_member"),
        );

        const preference = new Map<string, InboundPreference>([
          [investorA, "OPEN"],
          [investorB, "OPEN"],
        ]);
        const qualified = new Set<string>();
        const options = {
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
          investors: createPostgresInvestorOrganisationQueryPort({
            sql: tx.sql,
          }),
          outbox: createOutboxWriter({
            registry: createEventRegistry([...NETWORK_EVENTS]),
          }),
          audit: createPostgresMaterialActionAuditWriter(),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          investorSubject: {
            investorOrganisationFor: async (actor: ActorContext) => {
              if (actor.organisationId === undefined) return null;
              const [row] = await tx.sql<{ id: string }[]>`
                select id from core.investor_organisations
                 where tenant_id = ${actor.tenantId} and organisation_id = ${actor.organisationId}`;
              return row === undefined
                ? null
                : { investorOrganisationId: row.id };
            },
          },
          companyVisibility: {
            isVisibleToInvestor: () => Promise.resolve(true),
          },
          founderSubject: {
            companyFor: async (actor: ActorContext) => {
              if (actor.organisationId === undefined) return null;
              const [row] = await tx.sql<{ id: string }[]>`
                select id from core.companies
                 where tenant_id = ${actor.tenantId} and organisation_id = ${actor.organisationId}`;
              return row === undefined ? null : { companyId: row.id };
            },
          },
          investorReach: {
            visibleInvestor: (_actor: ActorContext, id: string) =>
              Promise.resolve(
                preference.has(id)
                  ? { inboundPreference: preference.get(id) ?? null }
                  : null,
              ),
            companyQualifies: (companyId: string, id: string) =>
              Promise.resolve(qualified.has(`${companyId}:${id}`)),
          },
        };
        await work({
          tx,
          connections: createConnectionService(options),
          interests: createInterestService(options),
          preference,
          qualified,
          founder,
          companyViewer,
          investorRep,
          investorViewer,
          otherInvestorRep,
          companyA,
          investorA,
          investorB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const request = (
    connections: ConnectionService,
    actor: ActorContext,
    investorOrganisationId: string,
    idempotencyKey = `connect:${randomUUID()}`,
  ) =>
    connections.requestConnection({
      actor,
      investorOrganisationId,
      idempotencyKey,
      correlationId: CORRELATION(),
    });

  it("a founder sends a request to an OPEN investor: one relationship, a COMPANY interest, a shared event, audit", async () => {
    await withWorld(
      async ({ tx, connections, founder, companyA, investorA }) => {
        const result = await request(connections, founder, investorA);
        expect(result.deduplicated).toBe(false);
        expect(result.interest).toMatchObject({
          companyId: companyA,
          investorOrganisationId: investorA,
          status: "EXPRESSED",
          expressedByParty: "COMPANY",
          expressedByUserId: founder.userId,
        });
        const events = await tx.sql<
          { event_type: string; visibility_scope: string; payload: unknown }[]
        >`
        select event_type, visibility_scope, payload from network.relationship_events
         where relationship_id = ${result.interest.relationshipId} order by sequence`;
        expect(events.map((e) => [e.event_type, e.visibility_scope])).toEqual([
          ["discovered", "founder_private"],
          ["interest_expressed", "relationship_shared"],
        ]);
        expect(events[1]?.payload).toEqual({
          interestId: result.interest.id,
          expressedByParty: "COMPANY",
        });
        const [audit] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from audit.material_actions
         where action_type = 'relationship.connection_requested'
           and resource_id = ${result.interest.id}`;
        expect(audit?.n).toBe(1);

        const status = await connections.connectionStatus({
          actor: founder,
          investorOrganisationId: investorA,
        });
        expect(status.canRequest).toBe(false);
        expect(status.request?.id).toBe(result.interest.id);
      },
    );
  });

  it("replays with the same key, and a second key while one is open is a no-op", async () => {
    await withWorld(async ({ tx, connections, founder, investorA }) => {
      const key = `connect:${randomUUID()}`;
      const first = await request(connections, founder, investorA, key);
      const replay = await request(connections, founder, investorA, key);
      const again = await request(connections, founder, investorA);
      expect(replay).toMatchObject({ deduplicated: true });
      expect(replay.interest.id).toBe(first.interest.id);
      expect(again).toMatchObject({ deduplicated: true });
      expect(again.interest.id).toBe(first.interest.id);
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from network.interests
         where relationship_id = ${first.interest.relationshipId}`;
      expect(row?.n).toBe(1);
    });
  });

  it("CLOSED, not stated, and QUALIFIED without passing the rules are refused; QUALIFIED and passing is sent", async () => {
    await withWorld(
      async ({
        connections,
        preference,
        qualified,
        founder,
        companyA,
        investorA,
      }) => {
        preference.set(investorA, "CLOSED");
        await expect(
          request(connections, founder, investorA),
        ).rejects.toMatchObject({
          reason: "CLOSED",
        });
        preference.set(investorA, null);
        await expect(
          request(connections, founder, investorA),
        ).rejects.toBeInstanceOf(ConnectionNotAcceptedError);
        preference.set(investorA, "QUALIFIED");
        await expect(
          request(connections, founder, investorA),
        ).rejects.toMatchObject({
          reason: "NOT_QUALIFIED",
        });
        const status = await connections.connectionStatus({
          actor: founder,
          investorOrganisationId: investorA,
        });
        expect(status).toEqual({
          canRequest: false,
          notAccepted: "NOT_QUALIFIED",
          request: null,
        });
        qualified.add(`${companyA}:${investorA}`);
        const sent = await request(connections, founder, investorA);
        expect(sent.deduplicated).toBe(false);
      },
    );
  });

  it("an investor the founder may not see is not found, and a member without a role cannot send", async () => {
    await withWorld(
      async ({
        tx,
        connections,
        preference,
        founder,
        companyViewer,
        investorA,
      }) => {
        preference.delete(investorA);
        await expect(
          request(connections, founder, investorA),
        ).rejects.toBeInstanceOf(InterestNotFoundError);
        preference.set(investorA, "OPEN");
        await expect(
          request(connections, companyViewer, investorA),
        ).rejects.toBeInstanceOf(ConnectionNotPermittedError);
        const [row] = await tx.sql<{ n: number }[]>`
          select count(*)::int as n from network.relationships
           where investor_organisation_id = ${investorA}`;
        expect(row?.n).toBe(0);
      },
    );
  });

  it("an investor reads its inbox and accepts: the match exists and the founder is connected", async () => {
    await withWorld(
      async ({
        tx,
        connections,
        interests,
        founder,
        investorRep,
        investorA,
      }) => {
        const sent = await request(connections, founder, investorA);
        const inbox = await connections.listConnectionRequests({
          actor: investorRep,
        });
        expect(inbox.map((row) => row.interest.id)).toEqual([sent.interest.id]);

        const key = `answer:${randomUUID()}`;
        const answer = {
          actor: investorRep,
          interestId: sent.interest.id,
          decision: "ACCEPTED" as const,
          surface: "INBOX" as const,
          idempotencyKey: key,
          correlationId: CORRELATION(),
        };
        const accepted = await connections.respondToConnectionRequest(answer);
        expect(accepted.interest.response?.decision).toBe("ACCEPTED");
        const replay = await connections.respondToConnectionRequest(answer);
        expect(replay.deduplicated).toBe(true);
        await expect(
          connections.respondToConnectionRequest({
            ...answer,
            decision: "DECLINED",
            idempotencyKey: `answer:${randomUUID()}`,
          }),
        ).rejects.toBeInstanceOf(InterestAlreadyAnsweredError);

        const [party] = await tx.sql<{ responded_by_party: string }[]>`
          select responded_by_party from network.interest_responses
           where interest_id = ${sent.interest.id}`;
        expect(party?.responded_by_party).toBe("INVESTOR");
        const [match] = await tx.sql<{ n: number }[]>`
          select count(*)::int as n from network.matches
           where relationship_id = ${sent.interest.relationshipId}`;
        expect(match?.n).toBe(1);
        // Answered requests stay in the inbox, with their answer.
        const after = await connections.listConnectionRequests({
          actor: investorRep,
        });
        expect(after.map((row) => row.interest.response?.decision)).toEqual([
          "ACCEPTED",
        ]);

        const forCompany = await interests.relationshipForCompany({
          actor: founder,
          investorOrganisationId: investorA,
        });
        expect(forCompany?.projection.state).toBe("CONNECTED");
      },
    );
  });

  it("once connected, another request is refused and nothing is recorded (live anomalies 2026-10-02)", async () => {
    await withWorld(
      async ({
        tx,
        connections,
        interests,
        founder,
        investorRep,
        investorA,
      }) => {
        const sent = await request(connections, founder, investorA);
        await connections.respondToConnectionRequest({
          actor: investorRep,
          interestId: sent.interest.id,
          decision: "ACCEPTED",
          surface: "INBOX",
          idempotencyKey: `answer:${randomUUID()}`,
          correlationId: CORRELATION(),
        });
        const count = async () =>
          (
            await tx.sql<{ n: number }[]>`
              select count(*)::int as n from network.relationship_events
               where relationship_id = ${sent.interest.relationshipId}`
          )[0]?.n ?? 0;
        const before = await count();
        await expect(
          connections.requestConnection({
            actor: founder,
            investorOrganisationId: investorA,
            idempotencyKey: `again:${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(RelationshipAlreadyConnectedError);
        expect(await count()).toBe(before);
        const status = await interests.relationshipForCompany({
          actor: founder,
          investorOrganisationId: investorA,
        });
        expect(status?.projection.anomalies).toEqual([]);
      },
    );
  });

  it("the founder cannot answer their own request, the next step waits for the investor, and another investor cannot answer it", async () => {
    await withWorld(
      async ({
        connections,
        interests,
        founder,
        investorViewer,
        otherInvestorRep,
        investorRep,
        investorA,
      }) => {
        const sent = await request(connections, founder, investorA);
        const answer = {
          interestId: sent.interest.id,
          decision: "ACCEPTED" as const,
          surface: "INBOX" as const,
          idempotencyKey: `answer:${randomUUID()}`,
          correlationId: CORRELATION(),
        };
        // The company-side answer path takes only an investor's interest.
        await expect(
          interests.respondToInterest({ ...answer, actor: founder }),
        ).rejects.toThrow();
        await expect(
          connections.respondToConnectionRequest({
            ...answer,
            actor: otherInvestorRep,
          }),
        ).rejects.toBeInstanceOf(InterestNotFoundError);
        await expect(
          connections.respondToConnectionRequest({
            ...answer,
            actor: investorViewer,
          }),
        ).rejects.toThrow();

        const forCompany = await interests.relationshipForCompany({
          actor: founder,
          investorOrganisationId: investorA,
        });
        expect(forCompany?.nextStep).toBe("AWAIT_ANSWER");
        const forInvestor = await interests.relationshipForInvestor({
          actor: investorRep,
          companyId: sent.interest.companyId,
        });
        expect(forInvestor?.nextStep).toBe("ANSWER_INTEREST");
      },
    );
  });
});
