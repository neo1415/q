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
  AuthorizationDeniedError,
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
  createInterestService,
  createNetworkService,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipStateProjector,
  InterestAlreadyAnsweredError,
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestNotFoundError,
  InterestNotPermittedError,
  type InterestService,
  type NetworkService,
} from "../src/index.js";

/**
 * Express Interest (CQ-NET-010) against the real local database, in one
 * rolled-back transaction per test with a savepoint-backed
 * TransactionManager. The real Postgres authorization policy decides the
 * capability; the two composition-root ports (investor subject, company
 * visibility) are the thinnest honest doubles: the first reads the real
 * investor row for the actor's organisation, the second is a set the test
 * controls, standing in for the network preview's disclosure rule.
 *
 * Covers: authorised positive path; one relationship row, one
 * `interest_expressed` event, one interest, one audit, one outbox event;
 * replay with the same key; a second key is a no-op; key reuse for another
 * company is a conflict; convergence onto an existing relationship; a
 * founder (no investor organisation), a role without the capability and a
 * company not visible to the investor are refused with nothing written.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly interests: InterestService;
  readonly network: NetworkService;
  readonly visible: Set<string>;
  readonly founder: ActorContext;
  /** A member of the company's organisation with no role. */
  readonly companyViewer: ActorContext;
  /** The founder of another company in the same tenant. */
  readonly otherFounder: ActorContext;
  readonly investorRep: ActorContext;
  readonly investorViewer: ActorContext;
  readonly tenantC: string;
  readonly companyA: CompanyId;
  readonly companyB: CompanyId;
  readonly investorA: InvestorOrganisationId;
  readonly investorOrg: string;
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

describe("Express Interest against local PostgreSQL", () => {
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
        const tenantC = await insertTenant(tx, "Interest Company Tenant");
        const tenantI = await insertTenant(tx, "Interest Investor Tenant");
        const companyOrg = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Kora",
        );
        const companyOrgB = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Other",
        );
        const investorOrg = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Apex",
        );
        const companyA = await insertCompany(tx, tenantC, companyOrg, "Kora");
        const companyB = await insertCompany(
          tx,
          tenantC,
          companyOrgB,
          "Other Co",
        );
        const investorA = await insertInvestor(
          tx,
          tenantI,
          investorOrg,
          "Apex",
        );
        const founder = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrg, "organisation_admin"),
        );
        const companyViewer = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrg, null),
        );
        const otherFounder = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrgB, "organisation_admin"),
        );
        const investorRep = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrg, "organisation_member"),
        );
        const investorViewer = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrg, null),
        );

        const visible = new Set<string>([companyA, companyB]);
        const outbox = createOutboxWriter({
          registry: createEventRegistry([...NETWORK_EVENTS]),
        });
        const base = {
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
          investors: createPostgresInvestorOrganisationQueryPort({
            sql: tx.sql,
          }),
          outbox,
          audit: createPostgresMaterialActionAuditWriter(),
        };
        const interests = createInterestService({
          ...base,
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          investorSubject: {
            investorOrganisationFor: async (actor) => {
              if (actor.organisationId === undefined) return null;
              const rows = await tx.sql<{ id: string }[]>`
                select id from core.investor_organisations
                 where tenant_id = ${actor.tenantId} and organisation_id = ${actor.organisationId}`;
              const [row] = rows;
              return row === undefined
                ? null
                : { investorOrganisationId: row.id };
            },
          },
          companyVisibility: {
            isVisibleToInvestor: (_actor, companyId) =>
              Promise.resolve(visible.has(companyId)),
          },
        });
        await work({
          tx,
          interests,
          network: createNetworkService(base),
          visible,
          founder,
          companyViewer,
          otherFounder,
          investorRep,
          investorViewer,
          tenantC,
          companyA,
          companyB,
          investorA,
          investorOrg,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const counts = async (
    tx: TransactionContext,
    companyId: string,
    investorOrganisationId: string,
  ) => {
    const [row] = await tx.sql<
      {
        relationships: number;
        discovered: number;
        interest_events: number;
        interests: number;
        outbox: number;
      }[]
    >`
      select
        (select count(*)::int from network.relationships r
          where r.company_id = ${companyId} and r.investor_organisation_id = ${investorOrganisationId}) as relationships,
        (select count(*)::int from network.relationship_events e
           join network.relationships r on r.id = e.relationship_id
          where r.company_id = ${companyId} and r.investor_organisation_id = ${investorOrganisationId}
            and e.event_type = 'discovered') as discovered,
        (select count(*)::int from network.relationship_events e
           join network.relationships r on r.id = e.relationship_id
          where r.company_id = ${companyId} and r.investor_organisation_id = ${investorOrganisationId}
            and e.event_type = 'interest_expressed') as interest_events,
        (select count(*)::int from network.interests i
           join network.relationships r on r.id = i.relationship_id
          where r.company_id = ${companyId} and r.investor_organisation_id = ${investorOrganisationId}) as interests,
        (select count(*)::int from events.outbox o
          where o.event_type = 'network.relationship.interest_expressed'
            and o.payload -> 'data' ->> 'companyId' = ${companyId}) as outbox`;
    return row;
  };

  it("an authorised investor member expresses interest: one relationship, one interest_expressed event, one interest, audit and outbox", async () => {
    await withWorld(
      async ({ tx, interests, investorRep, tenantC, companyA, investorA }) => {
        const correlationId = CORRELATION();
        const result = await interests.expressInterest({
          actor: investorRep,
          companyId: companyA,
          surface: "RECOMMENDATION_FEED",
          idempotencyKey: `interest:${randomUUID()}`,
          correlationId,
        });

        expect(result.deduplicated).toBe(false);
        expect(result.interest).toMatchObject({
          companyId: companyA,
          investorOrganisationId: investorA,
          status: "EXPRESSED",
          expressedByParty: "INVESTOR",
          expressedByUserId: investorRep.userId,
          expressedInOrganisationId: investorRep.organisationId,
          tenantId: tenantC,
        });
        expect(await counts(tx, companyA, investorA)).toEqual({
          relationships: 1,
          discovered: 1,
          interest_events: 1,
          interests: 1,
          outbox: 1,
        });

        const events = await tx.sql<
          {
            sequence: number;
            event_type: string;
            visibility_scope: string;
            source_type: string;
            actor_id: string;
            payload: unknown;
            id: string;
          }[]
        >`
          select e.sequence::int as sequence, e.event_type, e.visibility_scope, e.source_type,
                 e.actor_id::text as actor_id, e.payload, e.id::text as id
            from network.relationship_events e
           where e.relationship_id = ${result.interest.relationshipId}
           order by e.sequence`;
        expect(events.map((e) => [e.sequence, e.event_type])).toEqual([
          [1, "discovered"],
          [2, "interest_expressed"],
        ]);
        // The investor's discovery stays private; the interest is addressed
        // to the company.
        expect(events[0]?.visibility_scope).toBe("investor_private");
        expect(events[1]).toMatchObject({
          visibility_scope: "relationship_shared",
          source_type: "RECOMMENDATION",
          actor_id: investorRep.userId,
          payload: { interestId: result.interest.id },
          id: result.interest.relationshipEventId,
        });

        // Interest ≠ Match ≠ state: the projection is untouched.
        const [relationship] = await tx.sql<{ current_state: string }[]>`
          select current_state from network.relationships where id = ${result.interest.relationshipId}`;
        expect(relationship?.current_state).toBe("DISCOVERED");

        const audits = await tx.sql<{ action_type: string }[]>`
          select action_type from audit.material_actions
           where correlation_id = ${correlationId.slice(4)}::uuid order by action_type`;
        expect(audits.map((a) => a.action_type)).toEqual([
          "relationship.created",
          "relationship.interest_expressed",
        ]);
      },
    );
  });

  it("replays the same key to the same result, and a second key is a no-op: still one event", async () => {
    await withWorld(
      async ({ tx, interests, investorRep, companyA, investorA }) => {
        const key = `interest:${randomUUID()}`;
        const command = {
          actor: investorRep,
          companyId: companyA,
          surface: "RECOMMENDATION_FEED" as const,
          idempotencyKey: key,
          correlationId: CORRELATION(),
        };
        const first = await interests.expressInterest(command);
        const replay = await interests.expressInterest({
          ...command,
          // A retry that reports another surface is still the same request.
          surface: "COMPANY_PROFILE",
          correlationId: CORRELATION(),
        });
        expect(replay.deduplicated).toBe(true);
        expect(replay.interest.id).toBe(first.interest.id);

        const again = await interests.expressInterest({
          ...command,
          idempotencyKey: `interest:${randomUUID()}`,
          correlationId: CORRELATION(),
        });
        expect(again.deduplicated).toBe(true);
        expect(again.interest.id).toBe(first.interest.id);

        expect(await counts(tx, companyA, investorA)).toEqual({
          relationships: 1,
          discovered: 1,
          interest_events: 1,
          interests: 1,
          outbox: 1,
        });
        const own = await interests.getOwnInterest({
          actor: investorRep,
          companyId: companyA,
        });
        expect(own?.id).toBe(first.interest.id);
      },
    );
  });

  it("refuses a key reused for another company with IDEMPOTENCY_CONFLICT", async () => {
    await withWorld(
      async ({ tx, interests, investorRep, companyA, companyB, investorA }) => {
        const key = `interest:${randomUUID()}`;
        await interests.expressInterest({
          actor: investorRep,
          companyId: companyA,
          surface: "RECOMMENDATION_FEED",
          idempotencyKey: key,
          correlationId: CORRELATION(),
        });
        await expect(
          interests.expressInterest({
            actor: investorRep,
            companyId: companyB,
            surface: "RECOMMENDATION_FEED",
            idempotencyKey: key,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InterestIdempotencyConflictError);
        expect((await counts(tx, companyB, investorA))?.relationships).toBe(0);
      },
    );
  });

  it("converges on a relationship Discover already created: no second row, no second origin event", async () => {
    await withWorld(
      async ({ tx, interests, network, investorRep, companyA, investorA }) => {
        const { relationship } = await network.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        const result = await interests.expressInterest({
          actor: investorRep,
          companyId: companyA,
          surface: "COMPANY_PROFILE",
          idempotencyKey: `interest:${randomUUID()}`,
          correlationId: CORRELATION(),
        });
        expect(result.interest.relationshipId).toBe(relationship.id);
        expect(await counts(tx, companyA, investorA)).toMatchObject({
          relationships: 1,
          discovered: 1,
          interest_events: 1,
        });
      },
    );
  });

  it("refuses a founder with no investor organisation, and writes nothing", async () => {
    await withWorld(async ({ tx, interests, founder, companyB }) => {
      await expect(
        interests.expressInterest({
          actor: founder,
          companyId: companyB,
          surface: "COMPANY_PROFILE",
          idempotencyKey: `interest:${randomUUID()}`,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(InterestNotPermittedError);
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from network.relationships where company_id = ${companyB}`;
      expect(row?.n).toBe(0);
    });
  });

  it("refuses a member whose role does not carry investor.interest.express", async () => {
    await withWorld(
      async ({ tx, interests, investorViewer, companyA, investorA }) => {
        await expect(
          interests.expressInterest({
            actor: investorViewer,
            companyId: companyA,
            surface: "RECOMMENDATION_FEED",
            idempotencyKey: `interest:${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        expect((await counts(tx, companyA, investorA))?.relationships).toBe(0);
      },
    );
  });

  it("answers not-found for a company the investor may not see, and for one that does not exist, writing nothing", async () => {
    await withWorld(
      async ({ tx, interests, visible, investorRep, companyA, investorA }) => {
        visible.delete(companyA);
        for (const companyId of [companyA, randomUUID(), "not-a-uuid"]) {
          await expect(
            interests.expressInterest({
              actor: investorRep,
              companyId,
              surface: "RECOMMENDATION_FEED",
              idempotencyKey: `interest:${randomUUID()}`,
              correlationId: CORRELATION(),
            }),
          ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
        }
        await expect(
          interests.getOwnInterest({ actor: investorRep, companyId: companyA }),
        ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
        // Q's approval gate asks the same question and hears the same no.
        expect(
          await interests.mayExpressInterest({
            actor: investorRep,
            companyId: companyA,
          }),
        ).toBe(false);
        expect(await counts(tx, companyA, investorA)).toMatchObject({
          relationships: 0,
          interests: 0,
        });
      },
    );
  });

  it("reads no interest for a visible company nobody has expressed interest in", async () => {
    await withWorld(
      async ({ interests, investorRep, founder, investorViewer, companyB }) => {
        // The gate's question, without writing: yes for the member, no for a
        // founder and for a role without the capability.
        expect(
          await interests.mayExpressInterest({
            actor: investorRep,
            companyId: companyB,
          }),
        ).toBe(true);
        expect(
          await interests.mayExpressInterest({
            actor: founder,
            companyId: companyB,
          }),
        ).toBe(false);
        expect(
          await interests.mayExpressInterest({
            actor: investorViewer,
            companyId: companyB,
          }),
        ).toBe(false);
        expect(
          await interests.getOwnInterest({
            actor: investorRep,
            companyId: companyB,
          }),
        ).toBeNull();
      },
    );
  });

  // -------------------------------------------------------------------------
  // CQ-NET-011: the company's answer
  // -------------------------------------------------------------------------

  const expressed = async (world: World) =>
    (
      await world.interests.expressInterest({
        actor: world.investorRep,
        companyId: world.companyA,
        surface: "RECOMMENDATION_FEED",
        idempotencyKey: `interest:${randomUUID()}`,
        correlationId: CORRELATION(),
      })
    ).interest;

  const history = async (tx: TransactionContext, relationshipId: string) =>
    tx.sql<
      {
        sequence: number;
        event_type: string;
        visibility_scope: string;
        payload: unknown;
      }[]
    >`
      select e.sequence::int as sequence, e.event_type, e.visibility_scope, e.payload
        from network.relationship_events e
       where e.relationship_id = ${relationshipId}
       order by e.sequence`;

  it("the founder sees the interest pending and accepts it: one connection_accepted on the SAME relationship, one match, and the investor sees connected", async () => {
    await withWorld(async (world) => {
      const { tx, interests, founder, investorRep, companyA } = world;
      const interest = await expressed(world);

      const inbox = await interests.listIncomingInterest({
        actor: founder,
        companyId: companyA,
      });
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.interest.id).toBe(interest.id);
      expect(inbox[0]?.interest.response).toBeNull();
      expect(inbox[0]?.investor.displayName).toBe("Apex");

      const correlationId = CORRELATION();
      const key = `answer:${randomUUID()}`;
      const accepted = await interests.respondToInterest({
        actor: founder,
        interestId: interest.id,
        decision: "ACCEPTED",
        surface: "INBOX",
        idempotencyKey: key,
        correlationId,
      });
      expect(accepted.deduplicated).toBe(false);
      expect(accepted.interest.relationshipId).toBe(interest.relationshipId);
      expect(accepted.interest.response?.decision).toBe("ACCEPTED");
      expect(accepted.interest.connection?.status).toBe("ACTIVE");

      const events = await history(tx, interest.relationshipId);
      expect(events.map((e) => e.event_type)).toEqual([
        "discovered",
        "interest_expressed",
        "connection_accepted",
      ]);
      expect(events[2]).toMatchObject({
        sequence: 3,
        visibility_scope: "relationship_shared",
        payload: {
          interestId: interest.id,
          matchId: accepted.interest.connection?.id,
        },
      });
      const [rows] = await tx.sql<
        {
          relationships: number;
          matches: number;
          responses: number;
          outbox: number;
          current_state: string;
        }[]
      >`
        select (select count(*)::int from network.relationships where company_id = ${companyA}) as relationships,
               (select count(*)::int from network.matches where relationship_id = ${interest.relationshipId}) as matches,
               (select count(*)::int from network.interest_responses where interest_id = ${interest.id}) as responses,
               (select count(*)::int from events.outbox where event_type = 'network.relationship.matched'
                  and payload -> 'data' ->> 'interestId' = ${interest.id}) as outbox,
               (select current_state from network.relationships where id = ${interest.relationshipId}) as current_state`;
      expect(rows).toEqual({
        relationships: 1,
        matches: 1,
        responses: 1,
        outbox: 1,
        // Nothing here computes state: the projector (CQ-NET-012) will.
        current_state: "DISCOVERED",
      });
      const audits = await tx.sql<{ action_type: string }[]>`
        select action_type from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits.map((a) => a.action_type)).toEqual([
        "relationship.interest_accepted",
      ]);

      // The investor reads the answer from the server.
      const own = await interests.getOwnInterest({
        actor: investorRep,
        companyId: companyA,
      });
      expect(own?.response?.decision).toBe("ACCEPTED");
      expect(own?.connection?.id).toBe(accepted.interest.connection?.id);

      // Replay and a second key: the same answer, nothing new.
      for (const idempotencyKey of [key, `answer:${randomUUID()}`]) {
        const again = await interests.respondToInterest({
          actor: founder,
          interestId: interest.id,
          decision: "ACCEPTED",
          surface: "INBOX",
          idempotencyKey,
          correlationId: CORRELATION(),
        });
        expect(again.deduplicated).toBe(true);
        expect(again.interest.connection?.id).toBe(
          accepted.interest.connection?.id,
        );
      }
      expect(await history(tx, interest.relationshipId)).toHaveLength(3);

      // An answer is never overwritten, and a key cannot change its meaning.
      await expect(
        interests.respondToInterest({
          actor: founder,
          interestId: interest.id,
          decision: "DECLINED",
          surface: "INBOX",
          idempotencyKey: `answer:${randomUUID()}`,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(InterestAlreadyAnsweredError);
      await expect(
        interests.respondToInterest({
          actor: founder,
          interestId: interest.id,
          decision: "DECLINED",
          surface: "INBOX",
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(InterestIdempotencyConflictError);
    });
  });

  it("a decline is recorded honestly, carries no reason, and opens nothing", async () => {
    await withWorld(async (world) => {
      const { tx, interests, founder, investorRep, companyA } = world;
      const interest = await expressed(world);
      const declined = await interests.respondToInterest({
        actor: founder,
        interestId: interest.id,
        decision: "DECLINED",
        surface: "INBOX",
        idempotencyKey: `answer:${randomUUID()}`,
        correlationId: CORRELATION(),
      });
      expect(declined.interest.response?.decision).toBe("DECLINED");
      expect(declined.interest.connection).toBeNull();
      const events = await history(tx, interest.relationshipId);
      expect(events.at(-1)).toMatchObject({
        event_type: "interest_declined",
        visibility_scope: "relationship_shared",
        payload: { interestId: interest.id },
      });
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from network.matches where relationship_id = ${interest.relationshipId}`;
      expect(row?.n).toBe(0);
      const own = await interests.getOwnInterest({
        actor: investorRep,
        companyId: companyA,
      });
      expect(own?.response?.decision).toBe("DECLINED");
      expect(own?.connection).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // CQ-NET-012: the state projection, and "where are we"
  // -------------------------------------------------------------------------

  it("projects state from history: idempotent, compare-and-set, rebuildable, and each party sees only its own history", async () => {
    await withWorld(async (world) => {
      const {
        tx,
        interests,
        founder,
        otherFounder,
        investorRep,
        companyA,
        investorA,
      } = world;
      const relationships = createPostgresRelationshipRepository();
      const projector = createRelationshipStateProjector({
        sql: tx.sql,
        repositories: {
          relationships,
          events: createPostgresRelationshipEventRepository(),
        },
      });
      const cached = async (relationshipId: string) =>
        (
          await tx.sql<
            {
              current_state: string;
              projected_sequence: number;
              projector_version: string;
              state_updated_at: Date;
            }[]
          >`
            select current_state, projected_sequence::int as projected_sequence,
                   projector_version, state_updated_at
              from network.relationships where id = ${relationshipId}`
        )[0];

      const interest = await expressed(world);
      const relationshipId = interest.relationshipId;

      // Nothing projected yet: the command wrote history, not state.
      expect(await cached(relationshipId)).toMatchObject({
        current_state: "DISCOVERED",
        projected_sequence: 0,
        projector_version: "none",
      });

      // Each party's view is folded from what that party may read.
      expect(
        await interests.relationshipForCompany({
          actor: founder,
          investorOrganisationId: investorA,
        }),
      ).toMatchObject({
        projection: { state: "INTEREST_EXPRESSED" },
        nextStep: "ANSWER_INTEREST",
      });
      const investorView = await interests.relationshipForInvestor({
        actor: investorRep,
        companyId: companyA,
      });
      expect(investorView).toMatchObject({
        projection: { state: "INTEREST_EXPRESSED" },
        nextStep: "AWAIT_ANSWER",
      });
      // The investor's story starts at its private discovery; the company's does not.
      expect(investorView?.projection.milestones.map((m) => m.state)).toEqual([
        "DISCOVERED",
        "INTEREST_EXPRESSED",
      ]);
      expect(
        await interests.relationshipForCompany({
          actor: otherFounder,
          investorOrganisationId: investorA,
        }),
      ).toBeNull();

      await interests.respondToInterest({
        actor: founder,
        interestId: interest.id,
        decision: "ACCEPTED",
        surface: "INBOX",
        idempotencyKey: `answer:${randomUUID()}`,
        correlationId: CORRELATION(),
      });

      // The projector folds the whole history, once.
      const first = await projector.project(relationshipId);
      expect(first.changed).toBe(true);
      expect(first.projection?.state).toBe("CONNECTED");
      const row = await cached(relationshipId);
      expect(row).toMatchObject({
        current_state: "CONNECTED",
        projected_sequence: 3,
        projector_version: "relationship-state.v1",
      });
      expect(row?.state_updated_at.toISOString()).toBe(
        first.projection?.stateSince,
      );

      // Replay: nothing changes.
      expect((await projector.project(relationshipId)).changed).toBe(false);

      // A late, shorter fold can never move the cache backwards.
      expect(
        await relationships.recordProjection(tx.sql, {
          relationshipId,
          state: "INTEREST_EXPRESSED",
          stateSince: new Date().toISOString(),
          throughSequence: 2,
          version: "relationship-state.v1",
        }),
      ).toBe(false);
      expect((await cached(relationshipId))?.current_state).toBe("CONNECTED");

      // Rebuild from history: wipe the cache (as a new projector version
      // would find it) and fold again.
      await tx.sql`
        update network.relationships
           set current_state = 'DISCOVERED', projected_sequence = 0, projector_version = 'none'
         where id = ${relationshipId}`;
      const rebuilt = await projector.rebuild({ batchSize: 50 });
      expect(rebuilt.scanned).toBeGreaterThanOrEqual(1);
      expect(await cached(relationshipId)).toMatchObject({
        current_state: "CONNECTED",
        projected_sequence: 3,
      });

      // Both parties now read connected, and the same next step.
      for (const view of [
        await interests.relationshipForCompany({
          actor: founder,
          investorOrganisationId: investorA,
        }),
        await interests.relationshipForInvestor({
          actor: investorRep,
          companyId: companyA,
        }),
      ]) {
        expect(view).toMatchObject({
          projection: { state: "CONNECTED" },
          nextStep: "SCHEDULE_MEETING",
        });
      }
    });
  });

  it("lists each side's own relationships, and a private discovery is not in the company's list (CQ-WEB-030)", async () => {
    await withWorld(async (world) => {
      const {
        network,
        interests,
        founder,
        otherFounder,
        investorRep,
        companyA,
        companyB,
        investorA,
      } = world;
      // Company B: the investor only discovered it, privately.
      await network.ensureRelationship({
        actor: investorRep,
        companyId: companyB,
        investorOrganisationId: investorA,
        source: { type: "DISCOVER" },
        visibilityScope: "investor_private",
        correlationId: CORRELATION(),
      });
      // Company A: interest expressed.
      await expressed(world);

      const investorList = await interests.listRelationshipsForInvestor({
        actor: investorRep,
      });
      expect(
        investorList
          .map((l) => [l.counterpartName, l.projection.state, l.nextStep])
          .sort(),
      ).toEqual([
        ["Kora", "INTEREST_EXPRESSED", "AWAIT_ANSWER"],
        ["Other Co", "DISCOVERED", "EXPRESS_INTEREST"],
      ]);

      const companyList = await interests.listRelationshipsForCompany({
        actor: founder,
        companyId: companyA,
      });
      expect(
        companyList.map((l) => [
          l.counterpartName,
          l.projection.state,
          l.nextStep,
        ]),
      ).toEqual([["Apex", "INTEREST_EXPRESSED", "ANSWER_INTEREST"]]);
      // Company B's founder sees nothing: the discovery was private.
      await expect(
        interests.listRelationshipsForCompany({
          actor: founder,
          companyId: companyB,
        }),
      ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
      expect(
        await interests.listRelationshipsForCompany({
          actor: otherFounder,
          companyId: companyB,
        }),
      ).toEqual([]);
      // Neither side can list as the other.
      await expect(
        interests.listRelationshipsForInvestor({ actor: founder }),
      ).rejects.toBeInstanceOf(InterestNotPermittedError);
    });
  });

  it("an investor's private discovery is nothing to the company", async () => {
    await withWorld(
      async ({
        network,
        interests,
        founder,
        investorRep,
        companyA,
        investorA,
      }) => {
        await network.ensureRelationship({
          actor: investorRep,
          companyId: companyA,
          investorOrganisationId: investorA,
          source: { type: "DISCOVER" },
          visibilityScope: "investor_private",
          correlationId: CORRELATION(),
        });
        expect(
          await interests.relationshipForCompany({
            actor: founder,
            investorOrganisationId: investorA,
          }),
        ).toBeNull();
        expect(
          await interests.relationshipForInvestor({
            actor: investorRep,
            companyId: companyA,
          }),
        ).toMatchObject({
          projection: { state: "DISCOVERED" },
          nextStep: "EXPRESS_INTEREST",
        });
      },
    );
  });

  it("only the company's own members with the capability may see or answer; everyone else writes nothing", async () => {
    await withWorld(async (world) => {
      const {
        tx,
        interests,
        founder,
        companyViewer,
        otherFounder,
        investorRep,
        companyA,
      } = world;
      const interest = await expressed(world);
      const attempt = (actor: ActorContext) =>
        interests.respondToInterest({
          actor,
          interestId: interest.id,
          decision: "ACCEPTED",
          surface: "INBOX",
          idempotencyKey: `answer:${randomUUID()}`,
          correlationId: CORRELATION(),
        });

      // The investor, and a founder of another company: not-found, not "forbidden".
      await expect(attempt(investorRep)).rejects.toBeInstanceOf(
        InterestNotFoundError,
      );
      await expect(attempt(otherFounder)).rejects.toBeInstanceOf(
        InterestNotFoundError,
      );
      await expect(
        interests.listIncomingInterest({
          actor: otherFounder,
          companyId: companyA,
        }),
      ).rejects.toBeInstanceOf(InterestNotFoundError);
      // A member of the right organisation without the capability.
      await expect(attempt(companyViewer)).rejects.toBeInstanceOf(
        AuthorizationDeniedError,
      );
      // Unknown and malformed interests are the same not-found.
      for (const interestId of [randomUUID(), "not-a-uuid"]) {
        await expect(
          interests.respondToInterest({
            actor: founder,
            interestId,
            decision: "DECLINED",
            surface: "INBOX",
            idempotencyKey: `answer:${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InterestNotFoundError);
      }
      // Q's gate asks the same question.
      expect(
        await interests.mayRespondToInterest({
          actor: founder,
          interestId: interest.id,
        }),
      ).toBe(true);
      for (const actor of [investorRep, otherFounder, companyViewer]) {
        expect(
          await interests.mayRespondToInterest({
            actor,
            interestId: interest.id,
          }),
        ).toBe(false);
      }
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from network.interest_responses where interest_id = ${interest.id}`;
      expect(row?.n).toBe(0);
    });
  });
});
