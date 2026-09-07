import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QRunSummarySchema,
  type CorrelationId,
  type CreateQRunRequest,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createLogger, type Logger } from "@capital-q/observability";
import {
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQAnswer,
  createUnconfiguredQRetrieval,
  neverPause,
  QOrchestrationVersionError,
  QRunAlreadyStartedError,
  QRunAlreadyTerminalError,
  QRunNotFoundError,
  QRunNotResumableError,
  toQRunSummary,
  type ContextFirewallPort,
  type QAnswerPort,
  type QOrchestrator,
  type QPausePolicy,
  type QRetrievalPort,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  Q_GRAPH_STATE_FIELDS,
  Q_ORCHESTRATION_VERSION,
  type QCheckpointStore,
} from "../src/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 *
 * The checkpoint store opens its own connections, so nothing here can run
 * inside one rolled-back transaction: each test commits a small world,
 * exercises the orchestrator against it, and removes everything it made
 * — checkpoints included — in `finally`. Nothing is hidden by cleanup: the
 * assertions on duplicates run before it.
 *
 * "Process restart" is simulated the only way that proves anything: a
 * second orchestrator with a second checkpoint store (second pool, second
 * compiled graph) resumes what the first one paused.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

/** Written as message text and objective; must appear nowhere the engine writes. */
const PRIVATE_MARKER = "PRIVATE-Q-GRAPH-STATE-DO-NOT-EMIT";

type Person = { readonly actor: ActorContext; readonly authUserId: string };

type World = {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly ownerA: Person;
  readonly colleagueA: Person;
  readonly strangerB: Person;
  readonly service: QRuntimeService;
  readonly logLines: string[];
  readonly logger: Logger;
  readonly stores: QCheckpointStore[];
};

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-orchestrator-test", environment: "test" },
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
    message: { text: `Cash position: ${PRIVATE_MARKER}` },
    objective: `Objective ${PRIVATE_MARKER}`,
    modality: "TEXT",
    ...overrides,
  };
}

/** Authorises everything, as a stub: these tests prove orchestration mechanics, not policy. */
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

type Recording = { readonly calls: unknown[] };

function recordingRetrieval(
  onCall?: (request: unknown) => Promise<void>,
): QRetrievalPort & Recording {
  const calls: unknown[] = [];
  return {
    calls,
    retrieve: async (req) => {
      calls.push(req);
      await onCall?.(req);
      return { kind: "NOT_CONFIGURED" };
    },
  };
}

function recordingAnswer(fail?: Error): QAnswerPort & Recording {
  const calls: unknown[] = [];
  return {
    calls,
    answer: (req) => {
      calls.push(req);
      return fail === undefined
        ? Promise.resolve({ kind: "NOT_CONFIGURED" })
        : Promise.reject(fail);
    },
  };
}

describe("@capital-q/q-orchestrator against local PostgreSQL", () => {
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

  async function person(
    tenantId: string,
    organisationId: string,
  ): Promise<Person> {
    return db.transactions.run(async (tx) => {
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
        authUserId,
        actor: ActorContextSchema.parse({
          userId: profile.id,
          tenantId,
          organisationId,
          membershipId,
          actorType: "HUMAN",
        }),
      };
    });
  }

  async function tenant(
    label: string,
  ): Promise<{ tenantId: string; organisationId: string }> {
    return db.transactions.run(async (tx) => {
      const tenantId = randomUUID();
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Q Orchestration ${label}`})`;
      const organisationId = randomUUID();
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', ${`Org ${label}`}, ${`qo-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
      return { tenantId, organisationId };
    });
  }

  async function commitWorld(): Promise<World> {
    const a = await tenant("A");
    const b = await tenant("B");
    const ownerA = await person(a.tenantId, a.organisationId);
    const colleagueA = await person(a.tenantId, a.organisationId);
    const strangerB = await person(b.tenantId, b.organisationId);
    const logLines: string[] = [];
    const logger = capturingLogger(logLines);
    const service = createQRuntimeService({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
      securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
      logger,
    });
    return {
      tenantA: a.tenantId,
      tenantB: b.tenantId,
      ownerA,
      colleagueA,
      strangerB,
      service,
      logLines,
      logger,
      stores: [],
    };
  }

  async function cleanup(world: World): Promise<void> {
    for (const store of world.stores) {
      await store.close();
    }
    await db.transactions.run(async (tx) => {
      for (const tenantId of [world.tenantA, world.tenantB]) {
        const runs = await tx.sql<
          { id: string }[]
        >`select id from q_runtime.runs where tenant_id = ${tenantId}`;
        for (const run of runs) {
          await tx.sql`delete from q_runtime.checkpoint_writes where thread_id = ${run.id}`;
          await tx.sql`delete from q_runtime.checkpoint_blobs where thread_id = ${run.id}`;
          await tx.sql`delete from q_runtime.checkpoints where thread_id = ${run.id}`;
        }
        await tx.sql`delete from q_runtime.message_creation_requests where tenant_id = ${tenantId}`;
        await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = ${tenantId}`;
        await tx.sql`delete from q_runtime.conversation_messages where tenant_id = ${tenantId}`;
        await tx.sql`alter table q_runtime.run_events disable trigger run_events_append_only`;
        await tx.sql`delete from q_runtime.run_events where tenant_id = ${tenantId}`;
        await tx.sql`alter table q_runtime.run_events enable trigger run_events_append_only`;
        await tx.sql`delete from q_runtime.runs where tenant_id = ${tenantId}`;
        await tx.sql`delete from q_runtime.conversations where tenant_id = ${tenantId}`;
        await tx.sql`delete from audit.security_events where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenant_organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenants where id = ${tenantId}`;
      }
      for (const p of [world.ownerA, world.colleagueA, world.strangerB]) {
        await tx.sql`delete from identity.user_profiles where auth_user_id = ${p.authUserId}`;
        await tx.sql`delete from auth.users where id = ${p.authUserId}`;
      }
    });
  }

  /** A fresh orchestrator with its own checkpoint store — a "process". */
  function orchestrator(
    world: World,
    options: {
      readonly pausePolicy?: QPausePolicy;
      readonly retrieval?: QRetrievalPort;
      readonly answer?: QAnswerPort;
    } = {},
  ): QOrchestrator {
    const store = createPostgresQCheckpointStore({
      connectionString: TEST_DATABASE_URL,
    });
    world.stores.push(store);
    return createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        sql: db.sql,
        transactions: db.transactions,
        subjects: createQSubjectResolverRegistry([]),
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories: createPostgresQRuntimeRepositories(),
        logger: world.logger,
      }),
      cancelRun: world.service.cancelRun,
      checkpoints: store,
      firewall: stubFirewall,
      retrieval: options.retrieval ?? createUnconfiguredQRetrieval(),
      answer: options.answer ?? createUnconfiguredQAnswer(),
      pausePolicy: options.pausePolicy ?? neverPause,
      logger: world.logger,
    });
  }

  async function createRun(
    world: World,
    actor: ActorContext = world.ownerA.actor,
  ) {
    const created = await world.service.createRun({
      actor,
      input: request(),
      idempotencyKey: `orch-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return created.run;
  }

  async function events(runId: string) {
    return db.sql<
      {
        sequence: number;
        event_type: string;
        payload: Record<string, unknown>;
      }[]
    >`select sequence, event_type, payload from q_runtime.run_events where run_id = ${runId} order by sequence`;
  }

  async function checkpointRows(runId: string) {
    const [row] = await db.sql<
      { checkpoints: number; blobs: number; text: string }[]
    >`select
        (select count(*)::int from q_runtime.checkpoints where thread_id = ${runId}) as checkpoints,
        (select count(*)::int from q_runtime.checkpoint_blobs where thread_id = ${runId}) as blobs,
        coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_blobs where thread_id = ${runId} and blob is not null), '')
          || ' ' || coalesce((select string_agg(checkpoint::text || metadata::text, ' ') from q_runtime.checkpoints where thread_id = ${runId}), '')
          || ' ' || coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_writes where thread_id = ${runId}), '') as text`;
    if (row === undefined) {
      throw new Error("no checkpoint row");
    }
    return row;
  }

  // -------------------------------------------------------------------------

  it("runs the deterministic path to the honest end: no model, no retrieval, no answer", async () => {
    const world = await commitWorld();
    try {
      const retrieval = recordingRetrieval();
      const answer = recordingAnswer();
      const engine = orchestrator(world, { retrieval, answer });
      const run = await createRun(world);

      const handle = await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });

      expect(handle.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.ownerA.actor,
        runId: run.id,
      });
      expect(final.run.status).toBe("FAILED");
      expect(final.run.failureCode).toBe("MODEL_PROVIDER_UNAVAILABLE");
      expect(final.run.orchestrationVersion).toBe(Q_ORCHESTRATION_VERSION);
      expect(final.run.startedAt).not.toBeNull();
      expect(final.run.completedAt).not.toBeNull();
      expect(final.run.promptBundleVersion).toBeNull();
      expect(final.run.modelPolicyVersion).toBeNull();

      // High-level stages only, in order, each once.
      const stored = await events(run.id);
      expect(
        stored.map((e) => [
          e.event_type,
          e.payload["stage"] ?? e.payload["status"],
        ]),
      ).toEqual([
        ["q.run.started", "RECEIVED"],
        ["q.stage.changed", "UNDERSTANDING_REQUEST"],
        ["q.stage.changed", "PREPARING_ANALYSIS"],
        ["q.run.failed", "FAILED"],
      ]);
      expect(stored[3]?.payload).toMatchObject({
        failure: { code: "Q_UNAVAILABLE", retryable: true },
      });

      // The seams were reached with identifiers only, and nothing was
      // fabricated: no Q message exists.
      expect(retrieval.calls).toHaveLength(1);
      expect(answer.calls).toHaveLength(1);
      expect(JSON.stringify(retrieval.calls)).not.toContain(PRIVATE_MARKER);
      expect(JSON.stringify(answer.calls)).not.toContain(PRIVATE_MARKER);
      const messages = await db.sql<
        { role: string }[]
      >`select role from q_runtime.conversation_messages where run_id = ${run.id}`;
      expect(messages.map((m) => m.role)).toEqual(["USER"]);

      // The public projection carries the plain failure and no engine word.
      const summary = QRunSummarySchema.parse(final.summary);
      expect(summary.failure?.code).toBe("Q_UNAVAILABLE");
      const { messages: _m, ...rest } = summary;
      const text = JSON.stringify(rest);
      expect(text).not.toMatch(
        /preflight|langgraph|checkpoint|thread|interrupt|node/i,
      );
      expect(text).not.toContain(PRIVATE_MARKER);
    } finally {
      await cleanup(world);
    }
  });

  it("checkpoints only the allowlisted working state, never content", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world);
      const run = await createRun(world);
      await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });

      const rows = await checkpointRows(run.id);
      expect(rows.checkpoints).toBeGreaterThan(0);
      expect(rows.blobs).toBeGreaterThan(0);
      expect(rows.text).not.toContain(PRIVATE_MARKER);
      expect(rows.text).toContain(run.id);
      for (const field of Q_GRAPH_STATE_FIELDS) {
        expect(rows.text, field).toContain(field);
      }
      for (const forbidden of [
        "objective",
        "systemPrompt",
        "accessToken",
        "authorization",
        "content",
        "Cash position",
      ]) {
        expect(rows.text, forbidden).not.toContain(forbidden);
      }
      // And the logs carried identifiers only.
      expect(world.logLines.length).toBeGreaterThan(0);
      expect(world.logLines.join("\n")).not.toContain(PRIVATE_MARKER);
    } finally {
      await cleanup(world);
    }
  });

  it("pauses durably and resumes in a different process, exactly once", async () => {
    const world = await commitWorld();
    try {
      const first = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world);

      const paused = await first.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(paused.status).toBe("AWAITING_INPUT");
      expect((await events(run.id)).map((e) => e.event_type)).toEqual([
        "q.run.started",
        "q.stage.changed",
      ]);

      // The first process is gone: its store is closed and its graph
      // instance is never used again.
      const firstStore = world.stores[0];
      if (firstStore === undefined) {
        throw new Error("store missing");
      }
      await firstStore.close();
      world.stores.splice(0, 1);

      // Starting it again is refused: it is already being worked on.
      const second = orchestrator(world, { pausePolicy: alwaysPause });
      await expect(
        second.start({
          actor: world.ownerA.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunAlreadyStartedError);

      const resumed = await second.resume({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(resumed.status).toBe("FAILED");

      const stored = await events(run.id);
      expect(stored.map((e) => e.event_type)).toEqual([
        "q.run.started",
        "q.stage.changed",
        "q.stage.changed",
        "q.run.failed",
      ]);
      expect(
        stored.filter((e) => e.payload["stage"] === "UNDERSTANDING_REQUEST"),
      ).toHaveLength(1);
      expect(
        stored.filter((e) => e.payload["stage"] === "PREPARING_ANALYSIS"),
      ).toHaveLength(1);

      // Resuming a finished run is refused, and nothing is duplicated.
      await expect(
        second.resume({
          actor: world.ownerA.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunAlreadyTerminalError);
      expect((await events(run.id)).length).toBe(4);
      const messages = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.conversation_messages where run_id = ${run.id}`;
      expect(messages[0]?.n).toBe(1);
    } finally {
      await cleanup(world);
    }
  });

  it("lets two concurrent resumes drive the engine exactly once", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world);
      await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });

      const input = () => ({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      const results = await Promise.allSettled([
        engine.resume(input()),
        engine.resume(input()),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
      expect(
        reason instanceof QRunNotResumableError ||
          reason instanceof QRunAlreadyTerminalError,
      ).toBe(true);

      const stored = await events(run.id);
      expect(
        stored.filter((e) => e.event_type === "q.run.failed"),
      ).toHaveLength(1);
      expect(
        stored.filter((e) => e.payload["stage"] === "PREPARING_ANALYSIS"),
      ).toHaveLength(1);
    } finally {
      await cleanup(world);
    }
  });

  it("refuses every operation to a colleague and a stranger without touching the engine", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world);
      await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      const before = await checkpointRows(run.id);

      for (const person of [world.colleagueA, world.strangerB]) {
        const input = {
          actor: person.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        };
        await expect(engine.start(input)).rejects.toBeInstanceOf(
          QRunNotFoundError,
        );
        await expect(engine.resume(input)).rejects.toBeInstanceOf(
          QRunNotFoundError,
        );
        await expect(engine.cancel(input)).rejects.toBeInstanceOf(
          QRunNotFoundError,
        );
      }

      const after = await checkpointRows(run.id);
      expect(after.checkpoints).toBe(before.checkpoints);
      expect(after.blobs).toBe(before.blobs);
      const still = await world.service.getRun({
        actor: world.ownerA.actor,
        runId: run.id,
      });
      expect(still.run.status).toBe("AWAITING_INPUT");

      const refusals = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from audit.security_events where resource_id = ${run.id} and event_type = 'permission_denied'`;
      expect(refusals[0]?.n).toBeGreaterThanOrEqual(6);
    } finally {
      await cleanup(world);
    }
  });

  it("honours cancellation before start, while suspended, and twice", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world, { pausePolicy: alwaysPause });
      const owner = () => ({
        actor: world.ownerA.actor,
        runId: "" as never,
        correlationId: CORRELATION(),
      });

      // Before start.
      const early = await createRun(world);
      const cancelled = await engine.cancel({ ...owner(), runId: early.id });
      expect(cancelled.status).toBe("CANCELLED");
      await expect(
        engine.start({ ...owner(), runId: early.id }),
      ).rejects.toBeInstanceOf(QRunAlreadyTerminalError);
      const earlyRows = await checkpointRows(early.id);
      expect(earlyRows.checkpoints).toBe(0);

      // While suspended.
      const suspended = await createRun(world);
      await engine.start({ ...owner(), runId: suspended.id });
      const once = await engine.cancel({ ...owner(), runId: suspended.id });
      expect(once.status).toBe("CANCELLED");
      const eventsAfterCancel = (await events(suspended.id)).length;
      const twice = await engine.cancel({ ...owner(), runId: suspended.id });
      expect(twice.status).toBe("CANCELLED");
      expect((await events(suspended.id)).length).toBe(eventsAfterCancel);
      await expect(
        engine.resume({ ...owner(), runId: suspended.id }),
      ).rejects.toBeInstanceOf(QRunAlreadyTerminalError);
      const last = (await events(suspended.id)).at(-1);
      expect(last?.event_type).toBe("q.run.failed");
      expect(last?.payload["status"]).toBe("CANCELLED");
    } finally {
      await cleanup(world);
    }
  });

  it("stops at the next boundary when cancelled mid-execution", async () => {
    const world = await commitWorld();
    try {
      let runId = "";
      // The retrieval seam is the moment "someone else" cancels.
      const retrieval = recordingRetrieval(async () => {
        await world.service.cancelRun({
          actor: world.ownerA.actor,
          runId: runId as never,
          correlationId: CORRELATION(),
        });
      });
      const answer = recordingAnswer();
      const engine = orchestrator(world, { retrieval, answer });
      const run = await createRun(world);
      runId = run.id;

      const handle = await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });

      expect(handle.status).toBe("CANCELLED");
      expect(answer.calls).toHaveLength(0);
      const stored = await events(run.id);
      expect(stored.map((e) => e.event_type)).toEqual([
        "q.run.started",
        "q.stage.changed",
        "q.run.failed",
      ]);
      expect(stored[2]?.payload["status"]).toBe("CANCELLED");
      const final = await world.service.getRun({
        actor: world.ownerA.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("RUN_CANCELLED");
    } finally {
      await cleanup(world);
    }
  });

  it("fails closed on an unknown or missing orchestration version at resume", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world);
      await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      const before = await checkpointRows(run.id);

      for (const version of ["q-orchestrator-v0", null]) {
        await db.sql`update q_runtime.runs set orchestration_version = ${version} where id = ${run.id}`;
        await expect(
          engine.resume({
            actor: world.ownerA.actor,
            runId: run.id,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(QOrchestrationVersionError);
        const still = await world.service.getRun({
          actor: world.ownerA.actor,
          runId: run.id,
        });
        expect(still.run.status).toBe("AWAITING_INPUT");
      }
      const after = await checkpointRows(run.id);
      expect(after.checkpoints).toBe(before.checkpoints);

      // Restored to the supported version, it continues.
      await db.sql`update q_runtime.runs set orchestration_version = ${Q_ORCHESTRATION_VERSION} where id = ${run.id}`;
      const resumed = await engine.resume({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(resumed.status).toBe("FAILED");
    } finally {
      await cleanup(world);
    }
  });

  it("turns an engine fault into a coded failure and a plain public sentence", async () => {
    const world = await commitWorld();
    try {
      const fault = new Error(
        `relation "q_runtime.checkpoints" does not exist; ${PRIVATE_MARKER}; conn=postgres://admin:secret@db/capitalq`,
      );
      const engine = orchestrator(world, { answer: recordingAnswer(fault) });
      const run = await createRun(world);

      const handle = await engine.start({
        actor: world.ownerA.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("FAILED");

      const final = await world.service.getRun({
        actor: world.ownerA.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("INTERNAL_ERROR");
      const summary = toQRunSummary(final.run, [], null);
      expect(summary.failure?.code).toBe("Q_FAILED");
      const text = JSON.stringify(summary);
      expect(text).not.toContain(PRIVATE_MARKER);
      expect(text).not.toMatch(/postgres:\/\/|q_runtime|does not exist/);
      const stored = await events(run.id);
      expect(JSON.stringify(stored)).not.toContain(PRIVATE_MARKER);
      expect(JSON.stringify(stored)).not.toMatch(
        /postgres:\/\/|q_runtime\.checkpoints/,
      );
    } finally {
      await cleanup(world);
    }
  });

  it("exposes only the three port operations", async () => {
    const world = await commitWorld();
    try {
      const engine = orchestrator(world);
      expect(Object.keys(engine).sort()).toEqual(["cancel", "resume", "start"]);
    } finally {
      await cleanup(world);
    }
  });
});
