import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  QRunSummarySchema,
  QStreamEventSchema,
  type CorrelationId,
  type CreateQRunRequest,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createLogger, type Logger } from "@capital-q/observability";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  appendRunEvent,
  createCompanyQSubjectResolver,
  createPostgresQRuntimeRepositories,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  QConversationNotFoundError,
  QMessageCreationConflictError,
  QRunCreationConflictError,
  QRunNotAcceptingMessagesError,
  QRunNotFoundError,
  QSubjectNotFoundError,
  QSubjectUnsupportedError,
  toQStreamEvent,
  type QRuntimeService,
} from "../src/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 *
 * Two families of test. The first runs every case in one rolled-back
 * transaction with a savepoint-backed TransactionManager: two tenants, two
 * people in tenant A, one in tenant B, and a cross-tenant or cross-person
 * negative twin for every positive. The second commits a small world so two
 * genuinely concurrent connections can race on it, and cleans up after.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

/**
 * Persisted as legitimate private message content, then looked for on
 * every surface that must not carry it: logs, run events, audit, and any
 * error a non-owner receives.
 */
const PRIVATE_MARKER = "PRIVATE-Q-RUN-CONTENT-DO-NOT-EMIT";

class Rollback extends Error {}

type Person = {
  readonly actor: ActorContext;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: QRuntimeService;
  readonly logLines: string[];
  readonly tenantA: string;
  readonly tenantB: string;
  readonly companyA: string;
  readonly companyB: string;
  readonly adminA: Person;
  readonly memberA: Person;
  readonly adminB: Person;
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

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-runtime-test", environment: "test" },
    {
      level: "debug",
      destination: {
        write: (chunk: string) => {
          lines.push(chunk);
        },
      },
    },
  );
}

function request(
  overrides: Partial<CreateQRunRequest> = {},
): CreateQRunRequest {
  return {
    capability: "INVESTIGATE",
    message: { text: "How much runway does Apex have?" },
    modality: "TEXT",
    ...overrides,
  };
}

describe("@capital-q/q-runtime against local PostgreSQL", () => {
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
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${`qr-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`qr-${id.slice(0, 8)}`})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
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
    return {
      actor: ActorContextSchema.parse({
        userId: profile.id,
        tenantId,
        organisationId,
        membershipId,
        actorType: "HUMAN",
      }),
    };
  }

  function buildService(
    sql: TransactionContext["sql"],
    transactions: TransactionManager,
    logLines: string[],
    options: {
      readonly repositories?: ReturnType<
        typeof createPostgresQRuntimeRepositories
      >;
    } = {},
  ): QRuntimeService {
    return createQRuntimeService({
      sql,
      transactions,
      subjects: createQSubjectResolverRegistry([
        createCompanyQSubjectResolver(createPostgresCompanyQueryPort({ sql })),
      ]),
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      logger: capturingLogger(logLines),
      ...(options.repositories === undefined
        ? {}
        : { repositories: options.repositories }),
    });
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Q Tenant A");
        const tenantB = await insertTenant(tx, "Q Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Org A");
        const orgB = await insertOrganisation(tx, tenantB, "Org B");
        const companyA = await insertCompany(tx, tenantA, orgA, "Apex A");
        const companyB = await insertCompany(tx, tenantB, orgB, "Apex B");
        const adminA = await insertMember(tx, tenantA, orgA);
        const memberA = await insertMember(tx, tenantA, orgA);
        const adminB = await insertMember(tx, tenantB, orgB);
        const logLines: string[] = [];
        const service = buildService(sql, nestedTransactions(tx), logLines);

        await work({
          tx,
          service,
          logLines,
          tenantA,
          tenantB,
          companyA,
          companyB,
          adminA,
          memberA,
          adminB,
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

  // -------------------------------------------------------------------------
  // Creation, persistence, projection
  // -------------------------------------------------------------------------

  it("accepts a run durably: conversation, run, opening message and first event, nothing analysed", async () => {
    await withWorld(async ({ tx, service, adminA, companyA }) => {
      const result = await service.createRun({
        actor: adminA.actor,
        input: request({
          subjects: [{ kind: "COMPANY", companyId: companyA }],
          objective: "Understand runway",
        }),
        idempotencyKey: "create-0001",
        correlationId: CORRELATION(),
      });

      expect(result.created).toBe(true);
      expect(result.run.status).toBe("RECEIVED");
      expect(result.run.startedAt).toBeNull();
      expect(result.run.completedAt).toBeNull();
      expect(result.run.failureCode).toBeNull();
      expect(result.run.orchestrationVersion).toBeNull();
      expect(result.run.promptBundleVersion).toBeNull();
      expect(result.run.modelPolicyVersion).toBeNull();
      expect(result.run.consequenceClass).toBe("MODERATE");
      expect(result.run.actorUserId).toBe(adminA.actor.userId);
      expect(result.run.tenantId).toBe(adminA.actor.tenantId);
      expect(result.run.conversationId).toBe(result.conversation.id);

      expect(result.conversation.userId).toBe(adminA.actor.userId);
      expect(result.conversation.organisationId).toBe(
        adminA.actor.organisationId,
      );
      expect(result.conversation.contextType).toBe("ORGANISATION");
      expect(result.conversation.subjects).toEqual([
        { kind: "COMPANY", companyId: companyA },
      ]);

      expect(result.message.role).toBe("USER");
      expect(result.message.content).toBe("How much runway does Apex have?");
      expect(result.message.runId).toBe(result.run.id);

      const events = await tx.sql<
        { sequence: number; event_type: string; payload: unknown }[]
      >`select sequence, event_type, payload from q_runtime.run_events where run_id = ${result.run.id} order by sequence`;
      expect(events.map((e) => [e.sequence, e.event_type])).toEqual([
        [1, "q.run.started"],
      ]);
      expect(events[0]?.payload).toEqual({
        capability: "INVESTIGATE",
        status: "RECEIVED",
        conversationId: result.conversation.id,
      });

      // No Q message, no answer, no fake analysis.
      const messages = await tx.sql<
        { role: string }[]
      >`select role from q_runtime.conversation_messages where run_id = ${result.run.id}`;
      expect(messages.map((m) => m.role)).toEqual(["USER"]);
    });
  });

  it("reads the run back as its owner through the public projection", async () => {
    await withWorld(async ({ service, adminA }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0002",
        correlationId: CORRELATION(),
      });

      const read = await service.getRun({
        actor: adminA.actor,
        runId: created.run.id,
      });

      expect(QRunSummarySchema.safeParse(read.summary).success).toBe(true);
      expect(read.summary.status).toBe("RECEIVED");
      expect(read.summary.visibleStage).toBeNull();
      expect(read.summary.conversationId).toBe(created.conversation.id);
      expect(read.summary.messages?.map((m) => m.role)).toEqual(["USER"]);
      expect(read.summary.failure).toBeUndefined();
      expect(read.summary.results).toBeUndefined();
      expect(read.summary.startedAt).toBeUndefined();
      // Nothing internal rides the projection.
      const keys = Object.keys(read.summary);
      for (const forbidden of [
        "version",
        "lastEventSequence",
        "failureCode",
        "tenantId",
        "actorUserId",
        "orchestrationVersion",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  it("continues a conversation with a new run and leaves its history untouched", async () => {
    await withWorld(async ({ tx, service, adminA, companyA }) => {
      const first = await service.createRun({
        actor: adminA.actor,
        input: request({
          subjects: [{ kind: "COMPANY", companyId: companyA }],
        }),
        idempotencyKey: "create-0003",
        correlationId: CORRELATION(),
      });

      const second = await service.createRun({
        actor: adminA.actor,
        input: request({
          capability: "COMPARE",
          conversationId: first.conversation.id,
          message: { text: "And compared to last quarter?" },
          // Different subjects for this run: the conversation's own are
          // never rewritten.
          subjects: [],
        }),
        idempotencyKey: "create-0004",
        correlationId: CORRELATION(),
      });

      expect(second.created).toBe(true);
      expect(second.run.id).not.toBe(first.run.id);
      expect(second.conversation.id).toBe(first.conversation.id);
      expect(second.conversation.subjects).toEqual([
        { kind: "COMPANY", companyId: companyA },
      ]);

      const runs = await tx.sql<
        { id: string }[]
      >`select id from q_runtime.runs where conversation_id = ${first.conversation.id} order by created_at`;
      expect(runs.map((r) => r.id)).toEqual([first.run.id, second.run.id]);
    });
  });

  // -------------------------------------------------------------------------
  // Ownership and tenancy
  // -------------------------------------------------------------------------

  it("hides a conversation from another person in the same tenant and from another tenant, and records the refusal", async () => {
    await withWorld(async ({ tx, service, adminA, memberA, adminB }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0005",
        correlationId: CORRELATION(),
      });

      for (const person of [memberA, adminB]) {
        await expect(
          service.createRun({
            actor: person.actor,
            input: request({ conversationId: created.conversation.id }),
            idempotencyKey: `continue-${person.actor.userId}`,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(QConversationNotFoundError);
      }

      const refusals = await tx.sql<
        { user_id: string; resource_type: string }[]
      >`select user_id, resource_type from audit.security_events
         where event_type = 'permission_denied'
           and resource_id = ${created.conversation.id}
         order by occurred_at`;
      expect(refusals.map((r) => r.user_id).sort()).toEqual(
        [memberA.actor.userId, adminB.actor.userId].sort(),
      );
      expect(new Set(refusals.map((r) => r.resource_type))).toEqual(
        new Set(["q_conversation"]),
      );
      // Only one conversation exists: nobody's attempt created one.
      const conversations = await tx.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.conversations where tenant_id in (${adminA.actor.tenantId}, ${adminB.actor.tenantId})`;
      expect(conversations[0]?.n).toBe(1);
    });
  });

  it("hides a run from another person and another tenant on read, append and cancel", async () => {
    await withWorld(async ({ tx, service, adminA, memberA, adminB }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request({ message: { text: PRIVATE_MARKER } }),
        idempotencyKey: "create-0006",
        correlationId: CORRELATION(),
      });

      for (const person of [memberA, adminB]) {
        await expect(
          service.getRun({ actor: person.actor, runId: created.run.id }),
        ).rejects.toBeInstanceOf(QRunNotFoundError);
        await expect(
          service.appendMessage({
            actor: person.actor,
            runId: created.run.id,
            input: { message: { text: "let me in" } },
            idempotencyKey: `append-${person.actor.userId}`,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(QRunNotFoundError);
        await expect(
          service.cancelRun({
            actor: person.actor,
            runId: created.run.id,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(QRunNotFoundError);
      }

      // The refusal error carries none of the run's content.
      try {
        await service.getRun({ actor: adminB.actor, runId: created.run.id });
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(PRIVATE_MARKER);
      }

      const run = await service.getRun({
        actor: adminA.actor,
        runId: created.run.id,
      });
      expect(run.summary.status).toBe("RECEIVED");
      const messages = await tx.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.conversation_messages where run_id = ${created.run.id}`;
      expect(messages[0]?.n).toBe(1);
    });
  });

  it("does not let a personal context continue an organisation conversation", async () => {
    await withWorld(async ({ service, adminA }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0007",
        correlationId: CORRELATION(),
      });
      const personal = ActorContextSchema.parse({
        userId: adminA.actor.userId,
        tenantId: adminA.actor.tenantId,
        actorType: "HUMAN",
      });
      await expect(
        service.createRun({
          actor: personal,
          input: request({ conversationId: created.conversation.id }),
          idempotencyKey: "create-0008",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QConversationNotFoundError);
    });
  });

  it("treats a subject identifier as a selection, not authority", async () => {
    await withWorld(async ({ tx, service, adminA, companyB }) => {
      // A real company in another tenant is indistinguishable from a typo.
      await expect(
        service.createRun({
          actor: adminA.actor,
          input: request({
            subjects: [{ kind: "COMPANY", companyId: companyB }],
          }),
          idempotencyKey: "create-0009",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QSubjectNotFoundError);
      await expect(
        service.createRun({
          actor: adminA.actor,
          input: request({
            subjects: [{ kind: "COMPANY", companyId: randomUUID() }],
          }),
          idempotencyKey: "create-0010",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QSubjectNotFoundError);
      // A kind with no resolver registered fails closed.
      await expect(
        service.createRun({
          actor: adminA.actor,
          input: request({
            subjects: [{ kind: "DOCUMENT", documentId: randomUUID() }],
          }),
          idempotencyKey: "create-0011",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QSubjectUnsupportedError);

      const runs = await tx.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.runs where tenant_id = ${adminA.actor.tenantId}`;
      expect(runs[0]?.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it("answers a retried create from the run it already made, and refuses a different payload under the same key", async () => {
    await withWorld(async ({ tx, service, adminA }) => {
      const input = request();
      const first = await service.createRun({
        actor: adminA.actor,
        input,
        idempotencyKey: "create-retry",
        correlationId: CORRELATION(),
      });
      const retry = await service.createRun({
        actor: adminA.actor,
        input: { ...input },
        idempotencyKey: "create-retry",
        correlationId: CORRELATION(),
      });

      expect(retry.created).toBe(false);
      expect(retry.run.id).toBe(first.run.id);
      expect(retry.conversation.id).toBe(first.conversation.id);
      expect(retry.message.id).toBe(first.message.id);

      await expect(
        service.createRun({
          actor: adminA.actor,
          input: request({ message: { text: "something else" } }),
          idempotencyKey: "create-retry",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunCreationConflictError);

      const counts = await tx.sql<
        { runs: number; messages: number; events: number }[]
      >`select
          (select count(*)::int from q_runtime.runs where actor_user_id = ${adminA.actor.userId}) as runs,
          (select count(*)::int from q_runtime.conversation_messages where tenant_id = ${adminA.actor.tenantId}) as messages,
          (select count(*)::int from q_runtime.run_events where run_id = ${first.run.id}) as events`;
      expect(counts[0]).toEqual({ runs: 1, messages: 1, events: 1 });
    });
  });

  it("stores one message for a retried append, in order, and refuses a different payload under the same key", async () => {
    await withWorld(async ({ service, adminA }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0012",
        correlationId: CORRELATION(),
      });

      const first = await service.appendMessage({
        actor: adminA.actor,
        runId: created.run.id,
        input: { message: { text: "Use the March accounts." } },
        idempotencyKey: "append-retry",
        correlationId: CORRELATION(),
      });
      const retry = await service.appendMessage({
        actor: adminA.actor,
        runId: created.run.id,
        input: { message: { text: "Use the March accounts." } },
        idempotencyKey: "append-retry",
        correlationId: CORRELATION(),
      });
      expect(first.created).toBe(true);
      expect(retry.created).toBe(false);
      expect(retry.message.id).toBe(first.message.id);

      await expect(
        service.appendMessage({
          actor: adminA.actor,
          runId: created.run.id,
          input: { message: { text: "Use the April accounts." } },
          idempotencyKey: "append-retry",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QMessageCreationConflictError);

      const read = await service.getRun({
        actor: adminA.actor,
        runId: created.run.id,
      });
      expect(read.summary.messages?.map((m) => m.role)).toEqual([
        "USER",
        "USER",
      ]);
      // The run's status did not move: persisted is not understood.
      expect(read.summary.status).toBe("RECEIVED");
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  it("cancels an accepted run at once, idempotently, and closes it to new messages", async () => {
    await withWorld(async ({ tx, service, adminA }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0013",
        correlationId: CORRELATION(),
      });

      const cancelled = await service.cancelRun({
        actor: adminA.actor,
        runId: created.run.id,
        correlationId: CORRELATION(),
      });
      expect(cancelled.changed).toBe(true);
      expect(cancelled.run.status).toBe("CANCELLED");
      expect(cancelled.run.completedAt).not.toBeNull();
      expect(cancelled.run.startedAt).toBeNull();
      expect(cancelled.run.failureCode).toBe("RUN_CANCELLED");
      expect(cancelled.run.version).toBe(created.run.version + 1);
      expect(cancelled.summary.status).toBe("CANCELLED");
      expect(cancelled.summary.visibleStage).toBeNull();
      // Cancelled is a status of its own; it is not reported as a failure.
      expect(cancelled.summary.failure).toBeUndefined();

      const again = await service.cancelRun({
        actor: adminA.actor,
        runId: created.run.id,
        correlationId: CORRELATION(),
      });
      expect(again.changed).toBe(false);
      expect(again.run.status).toBe("CANCELLED");
      expect(again.run.version).toBe(cancelled.run.version);

      const events = await tx.sql<
        { sequence: number; event_type: string; payload: unknown }[]
      >`select sequence, event_type, payload from q_runtime.run_events where run_id = ${created.run.id} order by sequence`;
      expect(events.map((e) => e.event_type)).toEqual([
        "q.run.started",
        "q.run.failed",
      ]);
      expect(events[1]?.payload).toMatchObject({
        status: "CANCELLED",
        failure: { code: "CANCELLED", retryable: false },
      });

      await expect(
        service.appendMessage({
          actor: adminA.actor,
          runId: created.run.id,
          input: { message: { text: "one more thing" } },
          idempotencyKey: "append-after-cancel",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunNotAcceptingMessagesError);
    });
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  it("replays stored events as valid stream events, in sequence, from a cursor", async () => {
    await withWorld(async ({ tx, service, adminA }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request(),
        idempotencyKey: "create-0014",
        correlationId: CORRELATION(),
      });
      const repositories = createPostgresQRuntimeRepositories();
      await appendRunEvent(repositories, tx, created.run, {
        type: "q.stage.changed",
        data: { stage: "CHECKING_EVIDENCE" },
      });
      await appendRunEvent(repositories, tx, created.run, {
        type: "q.stage.changed",
        data: { stage: "PREPARING_ANALYSIS" },
      });

      const all = await repositories.runEvents.listForRun(
        tx.sql,
        created.run.tenantId,
        created.run.id,
      );
      expect(all.map((e) => e.sequence)).toEqual([1, 2, 3]);
      for (const stored of all) {
        expect(
          QStreamEventSchema.safeParse(toQStreamEvent(stored)).success,
        ).toBe(true);
      }

      const after = await repositories.runEvents.listForRun(
        tx.sql,
        created.run.tenantId,
        created.run.id,
        { afterSequence: 1 },
      );
      expect(after.map((e) => e.sequence)).toEqual([2, 3]);

      const read = await service.getRun({
        actor: adminA.actor,
        runId: created.run.id,
      });
      expect(read.summary.visibleStage).toBe("PREPARING_ANALYSIS");
    });
  });

  // -------------------------------------------------------------------------
  // Atomicity
  // -------------------------------------------------------------------------

  it("leaves nothing behind when creation fails part-way", async () => {
    await withWorld(async ({ tx, adminA }) => {
      const repositories = createPostgresQRuntimeRepositories();
      const failing = createQRuntimeService({
        sql: tx.sql,
        transactions: nestedTransactions(tx),
        subjects: createQSubjectResolverRegistry([]),
        repositories: {
          ...repositories,
          messages: {
            ...repositories.messages,
            insert: () =>
              Promise.reject(new Error("synthetic message failure")),
          },
        },
      });

      await expect(
        failing.createRun({
          actor: adminA.actor,
          input: request(),
          idempotencyKey: "create-partial",
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow("synthetic message failure");

      const counts = await tx.sql<
        { conversations: number; runs: number; requests: number }[]
      >`select
          (select count(*)::int from q_runtime.conversations where tenant_id = ${adminA.actor.tenantId}) as conversations,
          (select count(*)::int from q_runtime.runs where tenant_id = ${adminA.actor.tenantId}) as runs,
          (select count(*)::int from q_runtime.run_creation_requests where user_id = ${adminA.actor.userId}) as requests`;
      expect(counts[0]).toEqual({ conversations: 0, runs: 0, requests: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Privacy marker
  // -------------------------------------------------------------------------

  it("never copies private message content into logs, run events or audit", async () => {
    await withWorld(async ({ tx, service, logLines, adminA, adminB }) => {
      const created = await service.createRun({
        actor: adminA.actor,
        input: request({
          message: { text: `Cash position: ${PRIVATE_MARKER}` },
          objective: `Objective ${PRIVATE_MARKER}`,
        }),
        idempotencyKey: "create-marker",
        correlationId: CORRELATION(),
      });
      await service.appendMessage({
        actor: adminA.actor,
        runId: created.run.id,
        input: { message: { text: `Payroll ${PRIVATE_MARKER}` } },
        idempotencyKey: "append-marker",
        correlationId: CORRELATION(),
      });
      await expect(
        service.getRun({ actor: adminB.actor, runId: created.run.id }),
      ).rejects.toBeInstanceOf(QRunNotFoundError);
      await service.cancelRun({
        actor: adminA.actor,
        runId: created.run.id,
        correlationId: CORRELATION(),
      });

      // The owner legitimately reads the content back.
      const read = await service.getRun({
        actor: adminA.actor,
        runId: created.run.id,
      });
      expect(JSON.stringify(read.summary.messages)).toContain(PRIVATE_MARKER);

      // Nothing else carries it.
      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join("\n")).not.toContain(PRIVATE_MARKER);

      const events = await tx.sql<
        { payload: string }[]
      >`select payload::text as payload from q_runtime.run_events where run_id = ${created.run.id}`;
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.payload).not.toContain(PRIVATE_MARKER);
      }

      const audit = await tx.sql<
        { row: string }[]
      >`select row_to_json(s)::text as row from audit.security_events s where s.tenant_id in (${adminA.actor.tenantId}, ${adminB.actor.tenantId})
        union all
        select row_to_json(m)::text from audit.material_actions m where m.tenant_id in (${adminA.actor.tenantId}, ${adminB.actor.tenantId})`;
      for (const record of audit) {
        expect(record.row).not.toContain(PRIVATE_MARKER);
      }

      // And the summary without its messages is clean too: the objective
      // is not part of the public run projection.
      const { messages: _messages, ...rest } = read.summary;
      expect(JSON.stringify(rest)).not.toContain(PRIVATE_MARKER);
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrency: committed rows, genuinely parallel connections, cleaned up.
// ---------------------------------------------------------------------------

describe("@capital-q/q-runtime concurrency against local PostgreSQL", () => {
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

  type Committed = {
    readonly actor: ActorContext;
    readonly authUserId: string;
    readonly tenantId: string;
    readonly organisationId: string;
  };

  async function commitWorld(): Promise<Committed> {
    return db.transactions.run(async (tx) => {
      const tenantId = randomUUID();
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Q Concurrency Tenant')`;
      const organisationId = randomUUID();
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', 'Concurrency Org', ${`qc-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
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
      return {
        actor: ActorContextSchema.parse({
          userId: profile.id,
          tenantId,
          organisationId,
          membershipId,
          actorType: "HUMAN",
        }),
        authUserId,
        tenantId,
        organisationId,
      };
    });
  }

  async function cleanup(world: Committed): Promise<void> {
    await db.transactions.run(async (tx) => {
      await tx.sql`delete from q_runtime.message_creation_requests where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from q_runtime.conversation_messages where tenant_id = ${world.tenantId}`;
      // run_events are append-only by trigger; the test rows are removed by
      // the privileged role with the trigger's protection acknowledged.
      await tx.sql`alter table q_runtime.run_events disable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.run_events where tenant_id = ${world.tenantId}`;
      await tx.sql`alter table q_runtime.run_events enable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.runs where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from q_runtime.conversations where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from audit.security_events where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from identity.organisation_memberships where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from identity.tenant_organisations where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from identity.organisations where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from identity.tenants where id = ${world.tenantId}`;
      await tx.sql`delete from identity.user_profiles where auth_user_id = ${world.authUserId}`;
      await tx.sql`delete from auth.users where id = ${world.authUserId}`;
    });
  }

  function service(): QRuntimeService {
    return createQRuntimeService({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
    });
  }

  it("gives two concurrent event appends distinct consecutive sequences", async () => {
    const world = await commitWorld();
    try {
      const created = await service().createRun({
        actor: world.actor,
        input: request(),
        idempotencyKey: `conc-events-${randomUUID()}`,
        correlationId: CORRELATION(),
      });
      const repositories = createPostgresQRuntimeRepositories();
      const stages = [
        "UNDERSTANDING_REQUEST",
        "REVIEWING_COMPANY",
        "CHECKING_EVIDENCE",
        "PREPARING_ANALYSIS",
      ] as const;

      const appended = await Promise.all(
        stages.map((stage) =>
          db.transactions.run((tx) =>
            appendRunEvent(repositories, tx, created.run, {
              type: "q.stage.changed",
              data: { stage },
            }),
          ),
        ),
      );

      const sequences = appended.map((e) => e.sequence).sort((a, b) => a - b);
      expect(sequences).toEqual([2, 3, 4, 5]);
      const stored = await repositories.runEvents.listForRun(
        db.sql,
        world.actor.tenantId,
        created.run.id,
      );
      expect(stored.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await cleanup(world);
    }
  });

  it("resolves two concurrent cancels to one cancellation and one terminal event", async () => {
    const world = await commitWorld();
    try {
      const created = await service().createRun({
        actor: world.actor,
        input: request(),
        idempotencyKey: `conc-cancel-${randomUUID()}`,
        correlationId: CORRELATION(),
      });

      const results = await Promise.all([
        service().cancelRun({
          actor: world.actor,
          runId: created.run.id,
          correlationId: CORRELATION(),
        }),
        service().cancelRun({
          actor: world.actor,
          runId: created.run.id,
          correlationId: CORRELATION(),
        }),
      ]);

      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(results.every((r) => r.run.status === "CANCELLED")).toBe(true);
      const events =
        await createPostgresQRuntimeRepositories().runEvents.listForRun(
          db.sql,
          world.actor.tenantId,
          created.run.id,
        );
      expect(events.map((e) => e.eventType)).toEqual([
        "q.run.started",
        "q.run.failed",
      ]);
    } finally {
      await cleanup(world);
    }
  });

  it("creates one run for two concurrent requests with the same idempotency key", async () => {
    const world = await commitWorld();
    try {
      const key = `conc-create-${randomUUID()}`;
      const input = request();
      const results = await Promise.all([
        service().createRun({
          actor: world.actor,
          input,
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
        service().createRun({
          actor: world.actor,
          input: { ...input },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ]);

      expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const runs = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.runs where tenant_id = ${world.tenantId}`;
      expect(runs[0]?.n).toBe(1);
    } finally {
      await cleanup(world);
    }
  });

  it("stores one message for two concurrent appends with the same idempotency key", async () => {
    const world = await commitWorld();
    try {
      const created = await service().createRun({
        actor: world.actor,
        input: request(),
        idempotencyKey: `conc-append-run-${randomUUID()}`,
        correlationId: CORRELATION(),
      });
      const key = `conc-append-${randomUUID()}`;
      const results = await Promise.all([
        service().appendMessage({
          actor: world.actor,
          runId: created.run.id,
          input: { message: { text: "Use the March accounts." } },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
        service().appendMessage({
          actor: world.actor,
          runId: created.run.id,
          input: { message: { text: "Use the March accounts." } },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ]);
      expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
      const messages = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.conversation_messages where run_id = ${created.run.id}`;
      expect(messages[0]?.n).toBe(2);
    } finally {
      await cleanup(world);
    }
  });
});
