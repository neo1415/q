import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createLogger } from "@capital-q/observability";
import {
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQRetrieval,
  neverPause,
  type ContextFirewallPort,
  type QAnswerPort,
  type QOrchestrator,
  type QPausePolicy,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  type QCheckpointStore,
} from "../src/index.js";

/**
 * The transaction-pooler proof for the run engine
 * (scripts/db/pooler-proof/run.sh): the request client and the checkpoint
 * store both on Supavisor's transaction port, as q-api builds them with
 * DATABASE_CONNECTION_MODE=transaction_pooler, against a pool of a few
 * server connections. Concurrent runs, half of them paused and resumed in
 * a second "process", must all reach a terminal state; a run whose answer
 * step hits a slow statement must fail cleanly at the statement limit.
 * Never part of `pnpm test` or `pnpm test:integration`.
 */

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run scripts/db/pooler-proof/run.sh`);
  }
  return value;
}

const POOLER_URL = env("POOLER_PROOF_POOLER_URL");
const LISTEN_URL = env("POOLER_PROOF_LISTEN_URL");
const DIRECT_URL = env("POOLER_PROOF_DIRECT_URL");
const STATEMENT_TIMEOUT_MS = 3_000;
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const stubFirewall: ContextFirewallPort = {
  plan: (request) =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: PermittedContextPlanSchema.parse({
        contractVersion: 1,
        policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
        planId: randomUUID(),
        fingerprint: "0".repeat(64),
        runId: request.runId,
        tenantId: request.actor.tenantId,
        actor: {
          userId: request.actor.userId,
          ...(request.actor.organisationId === undefined
            ? {}
            : { organisationId: request.actor.organisationId }),
        },
        purpose: {
          capability: request.capability,
          taskClass: "GENERAL_QUESTION",
        },
        subjects: request.subjects,
        scopes: [],
        denied: [],
        maxSensitivity: "PUBLIC",
        allowedLayers: [],
        combinationConstraints: [],
        evaluatedAt: new Date().toISOString(),
        revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
        revalidateOnResume: true,
      }),
    }),
};

const alwaysPause: QPausePolicy = { shouldPause: () => true };

describe("transaction pooler: the run engine through Supavisor (transaction mode)", () => {
  let db: RequestDatabase;
  let direct: pg.Pool;
  let service: QRuntimeService;
  const stores: QCheckpointStore[] = [];
  let tenantId = "";
  let organisationId = "";
  let authUserId = "";
  let actor: ActorContext;
  const logger = createLogger(
    { serviceName: "pooler-proof", environment: "test" },
    { level: "warn" },
  );

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: POOLER_URL,
        DATABASE_LISTEN_URL: LISTEN_URL,
        DATABASE_CONNECTION_MODE: "transaction_pooler",
        DATABASE_POOL_MAX: "10",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
        DATABASE_WARM_INTERVAL_SECONDS: "0",
        DATABASE_STATEMENT_TIMEOUT_MS: String(STATEMENT_TIMEOUT_MS),
      }),
    );
    direct = new pg.Pool({ connectionString: DIRECT_URL, max: 1 });
    service = createQRuntimeService({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
      securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
      logger,
    });
    tenantId = randomUUID();
    organisationId = randomUUID();
    authUserId = randomUUID();
    const membershipId = randomUUID();
    const profileId = await db.transactions.run(async (tx) => {
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Pooler proof')`;
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', 'Pooler proof', ${`pp-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
      await tx.sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await tx.sql<
        { id: string }[]
      >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) throw new Error("profile trigger did not run");
      await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
        values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
      return profile.id;
    });
    actor = ActorContextSchema.parse({
      userId: profileId,
      tenantId,
      organisationId,
      membershipId,
      actorType: "HUMAN",
    });
  });

  afterAll(async () => {
    for (const store of stores) await store.close();
    // Fixtures go direct: cleanup is not what is being proven.
    const client = await direct.connect();
    try {
      await client.query("begin");
      const runs = await client.query<{ id: string }>(
        "select id from q_runtime.runs where tenant_id = $1",
        [tenantId],
      );
      const runIds = runs.rows.map((row) => row.id);
      for (const table of [
        "checkpoint_writes",
        "checkpoint_blobs",
        "checkpoints",
      ]) {
        await client.query(
          `delete from q_runtime.${table} where thread_id = any($1::text[])`,
          [runIds],
        );
      }
      for (const table of [
        "message_creation_requests",
        "run_creation_requests",
        "conversation_messages",
      ]) {
        await client.query(
          `delete from q_runtime.${table} where tenant_id = $1`,
          [tenantId],
        );
      }
      await client.query(
        "alter table q_runtime.run_events disable trigger run_events_append_only",
      );
      await client.query(
        "delete from q_runtime.run_events where tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "alter table q_runtime.run_events enable trigger run_events_append_only",
      );
      for (const table of [
        "q_runtime.runs",
        "q_runtime.conversation_summary_revisions",
        "q_runtime.conversation_states",
        "q_runtime.conversations",
        "audit.security_events",
        "identity.organisation_memberships",
        "identity.tenant_organisations",
        "identity.organisations",
      ]) {
        await client.query(`delete from ${table} where tenant_id = $1`, [
          tenantId,
        ]);
      }
      await client.query("delete from identity.tenants where id = $1", [
        tenantId,
      ]);
      await client.query(
        "delete from identity.user_profiles where auth_user_id = $1",
        [authUserId],
      );
      await client.query("delete from auth.users where id = $1", [authUserId]);
      await client.query("commit");
    } finally {
      client.release();
    }
    await db.close();
    await direct.end();
  });

  /** A "process": its own checkpoint store, on the transaction pooler. */
  function orchestrator(
    answer: QAnswerPort,
    pausePolicy: QPausePolicy = neverPause,
  ): QOrchestrator {
    const store = createPostgresQCheckpointStore({
      connectionString: POOLER_URL,
      poolMax: 5,
      connectTimeoutSeconds: 5,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    });
    stores.push(store);
    return createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        sql: db.sql,
        transactions: db.transactions,
        subjects: createQSubjectResolverRegistry([]),
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories: createPostgresQRuntimeRepositories(),
        logger,
      }),
      cancelRun: service.cancelRun,
      checkpoints: store,
      firewall: stubFirewall,
      retrieval: createUnconfiguredQRetrieval(),
      answer,
      pausePolicy,
      logger,
    });
  }

  /** An answer step that reads the run's history through the pooler, as the turn reader does. */
  const readingAnswer: QAnswerPort = {
    answer: async (request) => {
      await db.sql`select count(*)::int from q_runtime.run_events where run_id = ${request.runId}`;
      await db.transactions.run(async (tx) => {
        await tx.sql`select count(*)::int from q_runtime.conversation_messages where run_id = ${request.runId}`;
      });
      return { kind: "NOT_CONFIGURED" };
    },
  };

  async function createRun() {
    const created = await service.createRun({
      actor,
      input: {
        capability: "INVESTIGATE",
        message: { text: "Pooler proof turn" },
        objective: "Pooler proof",
        modality: "TEXT",
      },
      idempotencyKey: `pooler-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return created.run.id;
  }

  async function eventTypes(runId: string): Promise<string[]> {
    const result = await direct.query<{ event_type: string }>(
      "select event_type from q_runtime.run_events where run_id = $1 order by sequence",
      [runId],
    );
    return result.rows.map((row) => row.event_type);
  }

  it("(b) twelve concurrent runs, half paused and resumed by a second process, all reach a terminal state", async () => {
    const straight = orchestrator(readingAnswer);
    const pausing = orchestrator(readingAnswer, alwaysPause);
    const resuming = orchestrator(readingAnswer);
    const started = performance.now();
    const runs = await Promise.all(Array.from({ length: 12 }, createRun));
    const outcomes = await Promise.all(
      runs.map(async (runId, index) => {
        if (index % 2 === 0) {
          const handle = await straight.start({
            actor,
            runId,
            correlationId: CORRELATION(),
          });
          return handle.status;
        }
        const paused = await pausing.start({
          actor,
          runId,
          correlationId: CORRELATION(),
        });
        expect(paused.status).toBe("AWAITING_INPUT");
        const resumed = await resuming.resume({
          actor,
          runId,
          correlationId: CORRELATION(),
        });
        return resumed.status;
      }),
    );
    const elapsed = performance.now() - started;
    // NOT_CONFIGURED answers end at the honest failure: terminal, coded.
    expect(outcomes).toEqual(Array.from({ length: 12 }, () => "FAILED"));
    for (const runId of runs) {
      const final = await service.getRun({ actor, runId });
      expect(final.run.failureCode).toBe("MODEL_PROVIDER_UNAVAILABLE");
      expect(await eventTypes(runId)).toEqual([
        "q.run.started",
        "q.stage.changed",
        "q.stage.changed",
        "q.run.failed",
      ]);
    }
    console.info(
      `pooler-proof (b): 12 runs (6 paused and resumed) in ${elapsed.toFixed(0)} ms`,
    );
  });

  it("(c) a run whose answer step hits a slow statement fails cleanly at the limit", async () => {
    const slow: QAnswerPort = {
      answer: async () => {
        await db.transactions.run(async (tx) => {
          await tx.sql`select pg_sleep(30)`;
        });
        return { kind: "NOT_CONFIGURED" };
      },
    };
    const engine = orchestrator(slow);
    const runId = await createRun();
    const started = performance.now();
    const handle = await engine.start({
      actor,
      runId,
      correlationId: CORRELATION(),
    });
    const elapsed = performance.now() - started;
    expect(handle.status).toBe("FAILED");
    expect(elapsed).toBeLessThan(STATEMENT_TIMEOUT_MS + 4_000);
    const final = await service.getRun({ actor, runId });
    expect(final.run.status).toBe("FAILED");
    expect(final.run.completedAt).not.toBeNull();
    expect((await eventTypes(runId)).at(-1)).toBe("q.run.failed");
    // Nothing is left sleeping on a server connection.
    const active = await direct.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where state = 'active' and query like '%pg_sleep(30)%'
         and pid <> pg_backend_pid()`,
    );
    expect(active.rows[0]?.n).toBe(0);
    console.info(
      `pooler-proof (c): slow run failed as ${String(final.run.failureCode)} in ${elapsed.toFixed(0)} ms`,
    );
  });
});
