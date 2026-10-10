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
  createInterestService,
  createNetworkService,
  RelationshipIdSchema,
  type BriefThreadMessage,
  type InterestService,
  type NetworkService,
  type RelationshipBriefBatchSources,
  type RelationshipBriefSources,
} from "../src/index.js";

/**
 * The Relationship Brief (R1) against the real local database, reproducing
 * TensorGate's hosted shape (2026-10-09): connected, messages on the thread
 * (message_sent history), a booked call, and no last-message summary
 * anywhere on the relationship row -- the brief must report both from
 * their owning sources. Also: a failing source is UNAVAILABLE, never empty;
 * a cross-tenant investor and a same-tenant non-party get nothing and no
 * source is read for them; a founder-private event never reaches the
 * investor's brief.
 *
 * One rolled-back transaction per test, as the other network suites.
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
  readonly founder: ActorContext;
  readonly otherFounder: ActorContext;
  readonly investorRep: ActorContext;
  readonly strangerInvestor: ActorContext;
  readonly companyA: CompanyId;
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

describe("Relationship Brief against local PostgreSQL", () => {
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
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${id}, ${tenantId}, ${organisationId}, 'VC', ${name})`;
    return InvestorOrganisationIdSchema.parse(id);
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    role: "organisation_admin" | "organisation_member",
  ): Promise<AuthenticatedPrincipal> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${role}`;
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
        const tenantC = await insertTenant(tx, "Brief Company Tenant");
        const tenantI = await insertTenant(tx, "Brief Investor Tenant");
        const tenantX = await insertTenant(tx, "Brief Stranger Tenant");
        const companyOrg = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Tensorgate",
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
          "Zino Aviation",
        );
        const strangerOrg = await insertOrganisation(
          tx,
          tenantX,
          "investment_firm",
          "Stranger Capital",
        );
        const companyA = await insertCompany(
          tx,
          tenantC,
          companyOrg,
          "Tensorgate",
        );
        await insertCompany(tx, tenantC, companyOrgB, "Other Co");
        await insertInvestor(tx, tenantI, investorOrg, "Zino Aviation");
        await insertInvestor(tx, tenantX, strangerOrg, "Stranger Capital");
        const founder = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrg, "organisation_admin"),
        );
        const otherFounder = await resolveActor(
          tx,
          await insertMember(tx, tenantC, companyOrgB, "organisation_admin"),
        );
        const investorRep = await resolveActor(
          tx,
          await insertMember(tx, tenantI, investorOrg, "organisation_member"),
        );
        const strangerInvestor = await resolveActor(
          tx,
          await insertMember(tx, tenantX, strangerOrg, "organisation_member"),
        );
        const base = {
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
        };
        const interests = createInterestService({
          ...base,
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          investorSubject: {
            investorOrganisationFor: async (actor) => {
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
        });
        await work({
          tx,
          interests,
          network: createNetworkService(base),
          founder,
          otherFounder,
          investorRep,
          strangerInvestor,
          companyA,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  /** Connected, three messages, one booked call: TensorGate's shape. */
  async function tensorGate(world: World) {
    const { interests, network, tx, founder, investorRep, companyA } = world;
    const { interest } = await interests.expressInterest({
      actor: investorRep,
      companyId: companyA,
      surface: "RECOMMENDATION_FEED",
      idempotencyKey: `interest:${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    await interests.respondToInterest({
      actor: founder,
      interestId: interest.id,
      decision: "ACCEPTED",
      surface: "INBOX",
      idempotencyKey: `answer:${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    const relationshipId = RelationshipIdSchema.parse(interest.relationshipId);
    const append = (
      eventType: string,
      actor: ActorContext,
      payload: unknown,
      at: string,
    ) =>
      network.events.append(tx, {
        relationshipId,
        eventType,
        occurredAt: at,
        actor: { type: "HUMAN", id: actor.userId },
        source: { type: "MANUAL" },
        visibilityScope: "relationship_shared",
        payload,
        correlationId: CORRELATION(),
      });
    const meetingId = randomUUID();
    await append(
      "message_sent",
      founder,
      { messageId: randomUUID() },
      "2026-10-06T17:28:35.767Z",
    );
    await append(
      "message_sent",
      investorRep,
      { messageId: randomUUID() },
      "2026-10-07T15:43:31.143Z",
    );
    await append(
      "meeting_scheduled",
      investorRep,
      { meetingId },
      "2026-10-08T13:41:22.614Z",
    );
    await append(
      "message_sent",
      investorRep,
      { messageId: randomUUID() },
      "2026-10-09T15:33:39.798Z",
    );
    return { relationshipId, meetingId };
  }

  /** Readers keyed by actor, recording every call (who asked, for what). */
  function sources(
    world: World,
    meetingId: string,
    calls: string[],
  ): RelationshipBriefSources {
    const thread = (actor: ActorContext): BriefThreadMessage[] => {
      const mine = actor.userId === world.investorRep.userId;
      return [
        {
          from: mine ? "OTHER_SIDE" : "YOU",
          senderName: "Ada",
          kind: "TEXT",
          viaQ: false,
          sentAt: "2026-10-06T17:28:35.767Z",
        },
        {
          from: mine ? "YOU" : "OTHER_SIDE",
          senderName: "Marcus",
          kind: "TEXT",
          viaQ: false,
          sentAt: "2026-10-07T15:43:31.143Z",
        },
        {
          from: mine ? "YOU" : "OTHER_SIDE",
          senderName: "Marcus",
          kind: "TEXT",
          viaQ: true,
          sentAt: "2026-10-09T15:33:39.798Z",
        },
      ];
    };
    return {
      thread: (actor, relationshipId) => {
        calls.push(`thread:${actor.userId}:${relationshipId}`);
        return Promise.resolve(thread(actor));
      },
      meetings: (actor, relationshipId) => {
        calls.push(`meetings:${actor.userId}:${relationshipId}`);
        return Promise.resolve([
          {
            id: meetingId,
            status: "SCHEDULED",
            startsAt: "2026-10-12T15:00:00.000Z",
            endsAt: "2026-10-12T15:30:00.000Z",
            organisedByYou: actor.userId === world.investorRep.userId,
          },
        ]);
      },
      diligence: () => Promise.resolve(null),
    };
  }

  const NOW = new Date("2026-10-09T23:30:00.000Z");

  it("reports TensorGate's messages and booked call though the relationship row holds no message summary", async () => {
    await withWorld(async (world) => {
      const { relationshipId, meetingId } = await tensorGate(world);
      const calls: string[] = [];
      const brief = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: sources(world, meetingId, calls),
        now: NOW,
      });
      expect(brief).not.toBeNull();
      if (brief === null) return;
      expect(brief.yourSide).toBe("INVESTOR");
      expect(brief.counterparty).toEqual({
        kind: "COMPANY",
        id: world.companyA,
        name: "Tensorgate",
      });
      expect(brief.state?.state).toBe("CONNECTED");
      expect(brief.messages.count).toBe(3);
      expect(brief.messages.latest).toMatchObject({
        status: "OK",
        message: {
          from: "YOU",
          viaQ: true,
          delivery: "SENT",
          sentAt: "2026-10-09T15:33:39.798Z",
        },
        fromThem: { senderName: "Ada", sentAt: "2026-10-06T17:28:35.767Z" },
      });
      expect(brief.meetings).toMatchObject({
        status: "OK",
        nextScheduled: { id: meetingId, status: "SCHEDULED" },
      });
      // A booked call is not "schedule a meeting".
      expect(brief.pendingDecisions).toEqual({
        items: [
          {
            kind: "ATTEND_MEETING",
            owner: "YOU",
            since: "2026-10-12T15:00:00.000Z",
          },
        ],
        complete: true,
      });
      expect(brief.obligations).toEqual({
        status: "OK",
        openRequests: [],
        answeredCount: 0,
      });
      expect(brief.sourceVersions.brief).toBe("relationship-brief.v1");
      // Sources were read as the asking investor, for this relationship.
      expect(calls.sort()).toEqual(
        [
          `meetings:${world.investorRep.userId}:${relationshipId}`,
          `thread:${world.investorRep.userId}:${relationshipId}`,
        ].sort(),
      );

      // The founder's brief of the same relationship: their own side.
      const founderBrief = await world.interests.relationshipBrief({
        actor: world.founder,
        relationshipId,
        sources: sources(world, meetingId, []),
        now: NOW,
      });
      expect(founderBrief?.yourSide).toBe("COMPANY");
      expect(founderBrief?.messages.count).toBe(3);
      expect(founderBrief?.pendingDecisions.items.map((d) => d.kind)).toEqual([
        "REPLY_TO_MESSAGE",
        "ATTEND_MEETING",
      ]);
    });
  });

  it("a failing source is UNAVAILABLE, never an empty history", async () => {
    await withWorld(async (world) => {
      const { relationshipId } = await tensorGate(world);
      const brief = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: {
          thread: () => Promise.reject(new Error("thread read failed")),
          // meetings and diligence not composed
        },
        now: NOW,
      });
      expect(brief?.messages).toEqual({
        count: 3,
        latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      });
      expect(brief?.meetings).toEqual({
        status: "UNAVAILABLE",
        reason: "NOT_COMPOSED",
      });
      expect(brief?.documents).toEqual({
        status: "UNAVAILABLE",
        reason: "NOT_COMPOSED",
      });
      // CONNECTED's "schedule a meeting" depends on the unknown calls.
      expect(brief?.pendingDecisions).toEqual({ items: [], complete: false });
    });
  });

  it("a cross-tenant investor and a same-tenant non-party get nothing, and no source is read for them", async () => {
    await withWorld(async (world) => {
      const { relationshipId, meetingId } = await tensorGate(world);
      for (const actor of [world.strangerInvestor, world.otherFounder]) {
        const calls: string[] = [];
        expect(
          await world.interests.relationshipBrief({
            actor,
            relationshipId,
            sources: sources(world, meetingId, calls),
            now: NOW,
          }),
        ).toBeNull();
        expect(calls).toEqual([]);
      }
    });
  });

  it("a founder-private event never reaches the investor's brief", async () => {
    await withWorld(async (world) => {
      const { relationshipId, meetingId } = await tensorGate(world);
      const before = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: sources(world, meetingId, []),
        now: NOW,
      });
      await world.network.events.append(world.tx, {
        relationshipId,
        eventType: "discovered",
        occurredAt: "2026-10-09T20:00:00.000Z",
        actor: { type: "HUMAN", id: world.founder.userId },
        source: { type: "MANUAL" },
        visibilityScope: "founder_private",
        payload: {},
        correlationId: CORRELATION(),
      });
      const after = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: sources(world, meetingId, []),
        now: NOW,
      });
      // Byte-identical: the private event moved nothing the investor sees.
      expect(after).toEqual(before);
      const founderAfter = await world.interests.relationshipBrief({
        actor: world.founder,
        relationshipId,
        sources: sources(world, meetingId, []),
        now: NOW,
      });
      expect(founderAfter?.sourceVersions.historySequence).toBeGreaterThan(
        after?.sourceVersions.historySequence ?? 0,
      );
    });
  });

  /** The same facts as `sources`, as batch readers (R1 batching). */
  function batchSources(
    world: World,
    meetingId: string,
    calls: string[],
    single = sources(world, meetingId, []),
  ): RelationshipBriefBatchSources {
    return {
      threads: async (actor, ids) => {
        calls.push(`threads:${actor.userId}:${ids.join(",")}`);
        const out = new Map();
        for (const id of ids) {
          const thread = await single.thread!(actor, id);
          out.set(id, {
            latest: thread.at(-1) ?? null,
            fromThem: thread.findLast((m) => m.from === "OTHER_SIDE") ?? null,
          });
        }
        return out;
      },
      meetings: async (actor, ids) => {
        calls.push(`meetings:${actor.userId}:${ids.join(",")}`);
        return new Map(
          await Promise.all(
            ids.map(
              async (id) => [id, await single.meetings!(actor, id)] as const,
            ),
          ),
        );
      },
    };
  }

  it("batch: the list's briefs equal the single brief, from one read per source", async () => {
    await withWorld(async (world) => {
      const { relationshipId, meetingId } = await tensorGate(world);
      const calls: string[] = [];
      const briefs = await world.interests.relationshipBriefs!({
        actor: world.investorRep,
        sources: batchSources(world, meetingId, calls),
        now: NOW,
      });
      const single = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: sources(world, meetingId, []),
        now: NOW,
      });
      expect(briefs).toHaveLength(1);
      expect(briefs[0]).toEqual(single);
      expect(briefs[0]?.messages.count).toBe(3);
      expect(calls.sort()).toEqual(
        [
          `meetings:${world.investorRep.userId}:${relationshipId}`,
          `threads:${world.investorRep.userId}:${relationshipId}`,
        ].sort(),
      );
      // The founder's side, by their company.
      const founder = await world.interests.relationshipBriefs!({
        actor: world.founder,
        companyId: world.companyA,
        sources: batchSources(world, meetingId, []),
        now: NOW,
      });
      expect(founder.map((b) => b.yourSide)).toEqual(["COMPANY"]);
    });
  });

  it("batch: a failed or unanswered read is UNAVAILABLE, never 'no messages'", async () => {
    await withWorld(async (world) => {
      await tensorGate(world);
      const failed = await world.interests.relationshipBriefs!({
        actor: world.investorRep,
        sources: {
          threads: () => Promise.reject(new Error("chat down")),
          // A reader that answered without this relationship.
          meetings: () => Promise.resolve(new Map()),
        },
        now: NOW,
      });
      expect(failed[0]?.messages).toEqual({
        count: 3,
        latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      });
      expect(failed[0]?.meetings).toEqual({
        status: "UNAVAILABLE",
        reason: "READ_FAILED",
      });
    });
  });

  it("batch: a cross-tenant investor gets nothing and no reader sees the relationship", async () => {
    await withWorld(async (world) => {
      const { relationshipId, meetingId } = await tensorGate(world);
      const calls: string[] = [];
      const briefs = await world.interests.relationshipBriefs!({
        actor: world.strangerInvestor,
        relationshipIds: [relationshipId],
        sources: batchSources(world, meetingId, calls),
        now: NOW,
      });
      expect(briefs).toEqual([]);
      expect(calls.join(" ")).not.toContain(relationshipId);
      // Another founder cannot read a company that is not theirs.
      await expect(
        world.interests.relationshipBriefs!({
          actor: world.otherFounder,
          companyId: world.companyA,
          sources: batchSources(world, meetingId, []),
          now: NOW,
        }),
      ).rejects.toThrow();
    });
  });

  it("a recorded no-show is in the brief, and the call no longer counts as booked", async () => {
    await withWorld(async (world) => {
      const { relationshipId } = await tensorGate(world);
      const pastMeeting = randomUUID();
      await world.network.events.append(world.tx, {
        relationshipId,
        eventType: "meeting_no_show",
        occurredAt: "2026-10-08T16:00:00.000Z",
        actor: { type: "HUMAN", id: world.investorRep.userId },
        source: { type: "MANUAL" },
        visibilityScope: "relationship_shared",
        payload: { meetingId: pastMeeting },
        correlationId: CORRELATION(),
      });
      const brief = await world.interests.relationshipBrief({
        actor: world.investorRep,
        relationshipId,
        sources: {
          thread: () => Promise.resolve([]),
          meetings: () =>
            Promise.resolve([
              {
                id: pastMeeting,
                status: "SCHEDULED",
                startsAt: "2026-10-08T15:00:00.000Z",
                endsAt: "2026-10-08T15:30:00.000Z",
                organisedByYou: true,
              },
            ]),
          diligence: () => Promise.resolve(null),
        },
        now: NOW,
      });
      expect(brief?.noShows).toEqual([
        { meetingId: pastMeeting, at: "2026-10-08T16:00:00.000Z" },
      ]);
      expect(brief?.meetings).toMatchObject({
        status: "OK",
        items: [{ id: pastMeeting, noShow: true, timing: "PAST" }],
        nextScheduled: null,
      });
    });
  });
});
