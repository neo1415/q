import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  type CompanyId,
} from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  type CorrelationId,
  type CreateCapitalObjectiveRequest,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
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

import { CAPITAL_EVENTS } from "../src/events/index.js";
import {
  ActiveCapitalObjectiveExistsError,
  CapitalObjectiveCreationConflictError,
  CapitalObjectiveIdSchema,
  CapitalObjectiveLifecycleError,
  CapitalObjectiveNotFoundError,
  CapitalObjectiveVersionConflictError,
  createCapitalService,
  createPostgresCapitalObjectiveQueryPort,
  type CapitalService,
} from "../src/index.js";

/**
 * Capital Objective behaviour against the real local database, in
 * rolled-back transactions. Covers: one canonical objective per company,
 * exact money, recalibration vs replacement, closure reasons that are never
 * failure, authority (capabilities, not founder/CEO status), revocation, and
 * privacy of the use-of-funds text.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SENTINEL = "PRIVATE-USE-OF-FUNDS-DO-NOT-EMIT";
/** Not representable exactly in binary floating point. */
const EXACT = "4000000.10";

class Rollback extends Error {}

type Person = { principal: AuthenticatedPrincipal; membershipId: string };

type World = {
  readonly tx: TransactionContext;
  readonly service: CapitalService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext>;
  readonly adminA: Person;
  readonly memberA: Person;
  readonly adminB: Person;
  readonly companyA: CompanyId;
  readonly companyB: CompanyId;
  readonly tenantA: string;
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

const registry = createEventRegistry([...CAPITAL_EVENTS]);

describe("@capital-q/capital against local PostgreSQL", () => {
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

  async function withWorld(
    work: (world: World) => Promise<void>,
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
    } = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Capital Tenant A");
        const tenantB = await insertTenant(tx, "Capital Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "NexaRail");
        const orgB = await insertOrganisation(tx, tenantB, "Other Co");
        const companyA = await insertCompany(
          tx,
          tenantA,
          orgA,
          "NexaRail Technologies",
        );
        const companyB = await insertCompany(
          tx,
          tenantB,
          orgB,
          "Other Company",
        );
        const adminA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_admin",
        );
        const memberA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminB = await insertMember(
          tx,
          tenantB,
          orgB,
          "organisation_admin",
        );

        const realOutbox = createOutboxWriter({ registry });
        const service = createCapitalService({
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          companies: createPostgresCompanyQueryPort({ sql }),
          outbox:
            options.outbox === undefined
              ? realOutbox
              : options.outbox(realOutbox),
          audit: createPostgresMaterialActionAuditWriter(),
        });
        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return resolution.context;
        };
        await work({
          tx,
          service,
          resolve,
          adminA,
          memberA,
          adminB,
          companyA,
          companyB,
          tenantA,
        });
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

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${`org-${id.slice(0, 8)}`})`;
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
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`co-${id.slice(0, 8)}`}, 'seed')`;
    return CompanyIdSchema.parse(id);
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<Person> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
    };
  }

  function request(
    overrides: Partial<CreateCapitalObjectiveRequest> = {},
  ): CreateCapitalObjectiveRequest {
    return { target: { amount: "2000000", currency: "USD" }, ...overrides };
  }

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  async function eventsFor(
    tx: TransactionContext,
    correlationId: CorrelationId,
  ) {
    return tx.sql<
      { event_type: string; payload: { data: Record<string, unknown> } }[]
    >`
      select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId} order by event_type`;
  }

  async function auditsFor(
    tx: TransactionContext,
    correlationId: CorrelationId,
  ) {
    return tx.sql<
      {
        action_type: string;
        resource_id: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select action_type, resource_id, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid order by action_type`;
  }

  async function historyFor(tx: TransactionContext, objectiveId: string) {
    return tx.sql<{ event_type: string; payload: Record<string, unknown> }[]>`
      select event_type, payload from core.capital_objective_events where capital_objective_id = ${objectiveId} order by occurred_at, id`;
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  it("an organisation admin creates the ACTIVE objective with exact money, history, audit and event; nothing else changes", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, companyA, tenantA }) => {
        const actor = await resolve(adminA.principal);
        const correlationId = CORRELATION();
        const objective = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request({
            target: { amount: EXACT, currency: "USD" },
            targetStage: "series_a",
            instrumentCode: "safe",
            targetCloseDate: "2026-12-01",
            useOfFundsSummary: SENTINEL,
          }),
          idempotencyKey: "cap-1",
          correlationId,
        });

        expect(objective.id).not.toBe(companyA);
        expect(objective.tenantId).toBe(tenantA);
        expect(objective.companyId).toBe(companyA);
        expect(objective.objectiveType).toBe("RAISE");
        expect(objective.status).toBe("ACTIVE");
        expect(objective.target).toEqual({ amount: EXACT, currency: "USD" });
        expect(objective.targetStage).toBe("series_a");
        expect(objective.instrumentCode).toBe("safe");
        expect(objective.targetCloseDate).toBe("2026-12-01");
        expect(objective.version).toBe(1);
        expect(objective.closedAt).toBeNull();
        expect(objective.createdByUserId).toBe(actor.userId);

        // Exact money round-trips through NUMERIC without loss.
        const [row] = await tx.sql<{ target_amount: string }[]>`
        select target_amount::text as target_amount from core.capital_objectives where id = ${objective.id}`;
        expect(row?.target_amount).toBe(EXACT);
        // The company's own stage is untouched.
        const [company] = await tx.sql<
          { current_stage_code: string; version: number }[]
        >`
        select current_stage_code, version from core.companies where id = ${companyA}`;
        expect(company).toEqual({ current_stage_code: "seed", version: 1 });

        const history = await historyFor(tx, objective.id);
        expect(history.map((h) => h.event_type)).toEqual(["CREATED"]);
        expect(history[0]?.payload["kind"]).toBe("CREATED");
        const audits = await auditsFor(tx, correlationId);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action_type: "capital_objective.created",
          resource_id: objective.id,
          metadata: { companyId: companyA, objectiveType: "RAISE" },
        });
        const events = await eventsFor(tx, correlationId);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("core.capital_objective.created");
        expect(events[0]?.payload.data).toEqual({
          capitalObjectiveId: objective.id,
          companyId: companyA,
          version: 1,
        });
        for (const text of [SENTINEL, EXACT, "2026-12-01"]) {
          expect(JSON.stringify(events)).not.toContain(text);
          expect(JSON.stringify(audits)).not.toContain(text);
        }
        // No relationship, readiness, recommendation or Q table was touched (none exists).
        const tables = await tx.sql<{ n: string }[]>`
        select table_name as n from information_schema.tables
         where table_name in ('readiness_assessments', 'recommendation_slates', 'q_knowledge_objects', 'onboarding_raise')`;
        expect(tables).toEqual([]);
        // The relationship spine exists (CQ-NET-001) but a raise never creates one.
        expect(
          await count(
            tx.sql`select count(*)::int as count from network.relationships where company_id = ${companyA}`,
          ),
        ).toBe(0);

        const port = createPostgresCapitalObjectiveQueryPort({ sql: tx.sql });
        const snapshot = await port.getCurrentForCompany(
          actor.tenantId,
          companyA,
        );
        expect(snapshot?.target).toEqual({ amount: EXACT, currency: "USD" });
        expect(snapshot).not.toHaveProperty("useOfFundsSummary");
        await expect(
          port.getCurrentForCompany(
            actor.tenantId,
            CompanyIdSchema.parse(randomUUID()),
          ),
        ).resolves.toBeNull();
      },
    );
  });

  it("refuses a second ACTIVE objective, is retry-safe, and denies a member, a founder-CEO member and a foreign company", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, companyA, companyB }) => {
        const actor = await resolve(adminA.principal);
        const first = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request(),
          idempotencyKey: "retry",
          correlationId: CORRELATION(),
        });
        const again = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request(),
          idempotencyKey: "retry",
          correlationId: CORRELATION(),
        });
        expect(again.id).toBe(first.id);
        await expect(
          service.createCapitalObjective({
            actor,
            companyId: companyA,
            input: request({ target: { amount: "3000000", currency: "USD" } }),
            idempotencyKey: "retry",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(CapitalObjectiveCreationConflictError);
        await expect(
          service.createCapitalObjective({
            actor,
            companyId: companyA,
            input: request(),
            idempotencyKey: "second",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(ActiveCapitalObjectiveExistsError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.capital_objectives where company_id = ${companyA}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.capital_objective_events where capital_objective_id = ${first.id}`,
          ),
        ).toBe(1);

        // Company B is under another tenant: not found, nothing created.
        await expect(
          service.createCapitalObjective({
            actor,
            companyId: companyB,
            input: request(),
            idempotencyKey: "foreign",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(CapitalObjectiveNotFoundError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.capital_objectives where company_id = ${companyB}`,
          ),
        ).toBe(0);

        // A member who is the founder and CEO still has no create/edit/close authority.
        const member = await resolve(memberA.principal);
        await tx.sql`insert into core.company_members (tenant_id, company_id, user_id, is_founder, business_title)
        values (${member.tenantId}, ${companyA}, ${member.userId}, true, 'CEO')`;
        await expect(
          service.getCapitalObjective({
            actor: member,
            companyId: companyA,
            capitalObjectiveId: first.id,
          }),
        ).resolves.toMatchObject({ id: first.id });
        await expect(
          service.updateCapitalObjective({
            actor: member,
            companyId: companyA,
            capitalObjectiveId: first.id,
            input: {
              expectedVersion: 1,
              target: { amount: "9", currency: "USD" },
            },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        await expect(
          service.closeCapitalObjective({
            actor: member,
            companyId: companyA,
            capitalObjectiveId: first.id,
            input: { reason: "ACHIEVED", expectedVersion: 1 },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      },
    );
  });

  it("rolls back objective, history, audit, event and idempotency record when the event cannot be enqueued", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, companyA }) => {
        const correlationId = CORRELATION();
        await expect(
          service.createCapitalObjective({
            actor: await resolve(adminA.principal),
            companyId: companyA,
            input: request(),
            idempotencyKey: "doomed",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        for (const table of [
          "core.capital_objectives",
          "core.capital_objective_events",
          "core.capital_objective_creation_requests",
        ]) {
          expect(
            await count(
              tx.sql`select count(*)::int as count from ${tx.sql(table)}`,
            ),
            table,
          ).toBe(0);
        }
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
  // Recalibration
  // -------------------------------------------------------------------------

  it("recalibrates the same objective: version + 1, history with previous/next values, audit and event with categories only", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, companyA }) => {
      const actor = await resolve(adminA.principal);
      const objective = await service.createCapitalObjective({
        actor,
        companyId: companyA,
        input: request({ targetCloseDate: "2026-12-01" }),
        idempotencyKey: "recal",
        correlationId: CORRELATION(),
      });
      const correlationId = CORRELATION();
      const updated = await service.updateCapitalObjective({
        actor,
        companyId: companyA,
        capitalObjectiveId: objective.id,
        input: {
          expectedVersion: 1,
          target: { amount: "4000000", currency: "USD" },
          targetCloseDate: "2027-02-01",
          useOfFundsSummary: SENTINEL,
        },
        correlationId,
      });
      expect(updated.id).toBe(objective.id);
      expect(updated.version).toBe(2);
      expect(updated.status).toBe("ACTIVE");
      expect(updated.target.amount).toBe("4000000");
      expect(updated.targetCloseDate).toBe("2027-02-01");
      expect(
        await count(
          tx.sql`select count(*)::int as count from core.capital_objectives where company_id = ${companyA}`,
        ),
      ).toBe(1);

      const history = await historyFor(tx, objective.id);
      expect(history.map((h) => h.event_type)).toEqual([
        "CREATED",
        "RECALIBRATED",
      ]);
      expect(
        [...(history[1]?.payload["changeKinds"] as string[])].sort(),
      ).toEqual(["TARGET_AMOUNT", "TIMELINE", "USE_OF_FUNDS"]);
      expect(history[1]?.payload).toMatchObject({
        kind: "RECALIBRATED",
        previous: {
          target: { amount: "2000000", currency: "USD" },
          targetCloseDate: "2026-12-01",
        },
        next: {
          target: { amount: "4000000", currency: "USD" },
          targetCloseDate: "2027-02-01",
        },
        previousVersion: 1,
        newVersion: 2,
      });
      const events = await eventsFor(tx, correlationId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("core.capital_objective.updated");
      expect(
        [...(events[0]?.payload.data["changeKinds"] as string[])].sort(),
      ).toEqual(["TARGET_AMOUNT", "TIMELINE", "USE_OF_FUNDS"]);
      const audits = await auditsFor(tx, correlationId);
      expect(audits[0]?.action_type).toBe("capital_objective.updated");
      for (const text of [SENTINEL, "4000000", "2000000", "2027-02-01"]) {
        expect(JSON.stringify(events[0]?.payload)).not.toContain(text);
        expect(JSON.stringify(audits[0]?.metadata)).not.toContain(text);
      }
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

      // Stale writer loses nothing silently.
      await expect(
        service.updateCapitalObjective({
          actor,
          companyId: companyA,
          capitalObjectiveId: objective.id,
          input: {
            expectedVersion: 1,
            target: { amount: "1", currency: "USD" },
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CapitalObjectiveVersionConflictError);
      const [row] = await tx.sql<{ target_amount: string; version: number }[]>`
        select target_amount::text as target_amount, version from core.capital_objectives where id = ${objective.id}`;
      expect(row).toEqual({ target_amount: "4000000", version: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // Close and replace
  // -------------------------------------------------------------------------

  it("closes with a stated reason, keeps history, refuses edits afterwards, and allows a new objective", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, companyA }) => {
      const actor = await resolve(adminA.principal);
      for (const reason of [
        "ACHIEVED",
        "CLOSED_BY_FOUNDER",
        "DISCONTINUED",
      ] as const) {
        const objective = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request(),
          idempotencyKey: `close-${reason}`,
          correlationId: CORRELATION(),
        });
        const correlationId = CORRELATION();
        const closed = await service.closeCapitalObjective({
          actor,
          companyId: companyA,
          capitalObjectiveId: objective.id,
          input: { reason, expectedVersion: 1 },
          correlationId,
        });
        expect(closed.status).toBe(reason);
        expect(closed.version).toBe(2);
        expect(closed.closedAt).not.toBeNull();
        const history = await historyFor(tx, objective.id);
        expect(history[1]?.payload).toMatchObject({ kind: "CLOSED", reason });
        const events = await eventsFor(tx, correlationId);
        expect(events[0]?.payload.data["closureReason"]).toBe(reason);
        expect(
          (await auditsFor(tx, correlationId))[0]?.metadata["closureReason"],
        ).toBe(reason);
        for (const attempt of [
          () =>
            service.updateCapitalObjective({
              actor,
              companyId: companyA,
              capitalObjectiveId: objective.id,
              input: {
                expectedVersion: 2,
                target: { amount: "1", currency: "USD" },
              },
              correlationId: CORRELATION(),
            }),
          () =>
            service.closeCapitalObjective({
              actor,
              companyId: companyA,
              capitalObjectiveId: objective.id,
              input: { reason: "ACHIEVED", expectedVersion: 2 },
              correlationId: CORRELATION(),
            }),
        ]) {
          await expect(attempt()).rejects.toBeInstanceOf(
            CapitalObjectiveLifecycleError,
          );
        }
        // History remains readable; the current query is now empty.
        await expect(
          service.getCapitalObjective({
            actor,
            companyId: companyA,
            capitalObjectiveId: objective.id,
          }),
        ).resolves.toMatchObject({ status: reason });
        await expect(
          service.getCurrentCapitalObjective({ actor, companyId: companyA }),
        ).rejects.toBeInstanceOf(CapitalObjectiveNotFoundError);
      }
      // Nothing was deleted and no failure state exists anywhere.
      const [rows] = await tx.sql<{ statuses: string[] }[]>`
        select array_agg(status order by status) as statuses from core.capital_objectives where company_id = ${companyA}`;
      expect(rows?.statuses).toEqual([
        "ACHIEVED",
        "CLOSED_BY_FOUNDER",
        "DISCONTINUED",
      ]);
    });
  });

  it("replaces atomically: old REPLACED with a new id for the new ACTIVE objective; rollback leaves the old ACTIVE", async () => {
    let calls = 0;
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, companyA }) => {
        const actor = await resolve(adminA.principal);
        const old = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request(),
          idempotencyKey: "replace",
          correlationId: CORRELATION(),
        });
        const member = await resolve(memberA.principal);
        await expect(
          service.replaceCapitalObjective({
            actor: member,
            companyId: companyA,
            capitalObjectiveId: old.id,
            input: { expectedVersion: 1, replacement: request() },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);

        const correlationId = CORRELATION();
        const { replaced, replacement } = await service.replaceCapitalObjective(
          {
            actor,
            companyId: companyA,
            capitalObjectiveId: old.id,
            input: {
              expectedVersion: 1,
              replacement: request({
                target: { amount: "6000000", currency: "USD" },
                targetStage: "series_a",
              }),
            },
            correlationId,
          },
        );
        expect(replaced.id).toBe(old.id);
        expect(replaced.status).toBe("REPLACED");
        expect(replaced.closedAt).not.toBeNull();
        expect(replaced.version).toBe(2);
        expect(replacement.id).not.toBe(old.id);
        expect(replacement.status).toBe("ACTIVE");
        expect(replacement.target.amount).toBe("6000000");
        expect(replacement.version).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.capital_objectives where company_id = ${companyA} and status = 'ACTIVE'`,
          ),
        ).toBe(1);

        const oldHistory = await historyFor(tx, old.id);
        expect(oldHistory.map((h) => h.event_type)).toEqual([
          "CREATED",
          "REPLACED",
        ]);
        expect(oldHistory[1]?.payload["replacementCapitalObjectiveId"]).toBe(
          replacement.id,
        );
        const newHistory = await historyFor(tx, replacement.id);
        expect(newHistory[0]?.payload["replacedCapitalObjectiveId"]).toBe(
          old.id,
        );
        const events = await eventsFor(tx, correlationId);
        expect(events.map((e) => e.event_type)).toEqual([
          "core.capital_objective.closed",
          "core.capital_objective.created",
        ]);
        expect(events[0]?.payload.data).toEqual({
          capitalObjectiveId: old.id,
          companyId: companyA,
          version: 2,
          closureReason: "REPLACED",
          replacementCapitalObjectiveId: replacement.id,
        });
        const audits = await auditsFor(tx, correlationId);
        expect(audits.map((a) => a.action_type)).toEqual([
          "capital_objective.created",
          "capital_objective.replaced",
        ]);
        expect(audits[1]?.metadata["replacementCapitalObjectiveId"]).toBe(
          replacement.id,
        );
        expect(JSON.stringify(events)).not.toContain("6000000");
        expect(JSON.stringify(audits)).not.toContain("6000000");

        // Rollback: the replacement's created event fails.
        calls = 1;
        await expect(
          service.replaceCapitalObjective({
            actor,
            companyId: companyA,
            capitalObjectiveId: replacement.id,
            input: { expectedVersion: 1, replacement: request() },
            correlationId: CORRELATION(),
          }),
        ).rejects.toThrow("outbox unavailable");
        const [current] = await tx.sql<{ status: string; version: number }[]>`
          select status, version from core.capital_objectives where id = ${replacement.id}`;
        expect(current).toEqual({ status: "ACTIVE", version: 1 });
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.capital_objectives where company_id = ${companyA}`,
          ),
        ).toBe(2);
        expect(
          (await historyFor(tx, replacement.id)).map((h) => h.event_type),
        ).toEqual(["CREATED"]);
      },
      {
        outbox: (real) => ({
          enqueue: (tx, event) =>
            calls === 0
              ? real.enqueue(tx, event)
              : Promise.reject(new Error("outbox unavailable")),
        }),
      },
    );
  });

  // -------------------------------------------------------------------------
  // Reading and access
  // -------------------------------------------------------------------------

  it("lists latest first with a cursor, hides foreign ids, and loses access on revoked membership despite founder status", async () => {
    await withWorld(
      async ({
        tx,
        service,
        resolve,
        adminA,
        memberA,
        adminB,
        companyA,
        companyB,
      }) => {
        const actor = await resolve(adminA.principal);
        const ids: string[] = [];
        for (const reason of ["DISCONTINUED", "ACHIEVED"] as const) {
          const objective = await service.createCapitalObjective({
            actor,
            companyId: companyA,
            input: request(),
            idempotencyKey: `list-${reason}`,
            correlationId: CORRELATION(),
          });
          // now() is frozen inside this rolled-back test transaction; give each
          // row the distinct creation instant it would have in production.
          await tx.sql`update core.capital_objectives set created_at = clock_timestamp() where id = ${objective.id}`;
          await service.closeCapitalObjective({
            actor,
            companyId: companyA,
            capitalObjectiveId: objective.id,
            input: { reason, expectedVersion: 1 },
            correlationId: CORRELATION(),
          });
          ids.push(objective.id);
        }
        const current = await service.createCapitalObjective({
          actor,
          companyId: companyA,
          input: request(),
          idempotencyKey: "list-current",
          correlationId: CORRELATION(),
        });
        await tx.sql`update core.capital_objectives set created_at = clock_timestamp() where id = ${current.id}`;
        const b = await resolve(adminB.principal);
        const foreign = await service.createCapitalObjective({
          actor: b,
          companyId: companyB,
          input: request(),
          idempotencyKey: "list-b",
          correlationId: CORRELATION(),
        });

        const page1 = await service.listCapitalObjectives({
          actor,
          companyId: companyA,
          limit: 2,
        });
        expect(page1.items.map((o) => o.id)).toEqual([current.id, ids[1]]);
        expect(page1.nextCursor).toBeDefined();
        const page2 = await service.listCapitalObjectives({
          actor,
          companyId: companyA,
          limit: 2,
          cursor: page1.nextCursor,
        });
        expect(page2.items.map((o) => o.id)).toEqual([ids[0]]);
        expect(page2.nextCursor).toBeUndefined();

        await expect(
          service.getCapitalObjective({
            actor,
            companyId: companyA,
            capitalObjectiveId: CapitalObjectiveIdSchema.parse(foreign.id),
          }),
        ).rejects.toBeInstanceOf(CapitalObjectiveNotFoundError);
        await expect(
          service.listCapitalObjectives({ actor, companyId: companyB }),
        ).rejects.toBeInstanceOf(CapitalObjectiveNotFoundError);
        await expect(
          service.getCurrentCapitalObjective({ actor: b, companyId: companyA }),
        ).rejects.toBeInstanceOf(CapitalObjectiveNotFoundError);

        // Founder member, then membership revoked: access disappears.
        const member = await resolve(memberA.principal);
        await tx.sql`insert into core.company_members (tenant_id, company_id, user_id, is_founder)
        values (${member.tenantId}, ${companyA}, ${member.userId}, true)`;
        await expect(
          service.getCurrentCapitalObjective({
            actor: member,
            companyId: companyA,
          }),
        ).resolves.toMatchObject({ id: current.id });
        await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = clock_timestamp() where id = ${memberA.membershipId}`;
        await expect(resolve(memberA.principal)).rejects.toThrow(
          "CONTEXT_REQUIRED",
        );
        await expect(
          service.getCurrentCapitalObjective({
            actor: member,
            companyId: companyA,
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      },
    );
  });
});
