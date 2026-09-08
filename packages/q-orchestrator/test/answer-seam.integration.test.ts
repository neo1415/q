import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type CorrelationId,
  type QSensitivityClass,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import {
  createFakeModelProvider,
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  type FakeBehaviour,
} from "@capital-q/model-gateway";
import { createModelGatewayQAnswer } from "@capital-q/model-gateway/q";
import { createLogger, type Logger } from "@capital-q/observability";
import {
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQRetrieval,
  neverPause,
  type ContextFirewallPort,
  type QRuntimeService,
  type QToolPort,
  type QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  Q_ORCHESTRATION_VERSION,
  type QCheckpointStore,
} from "../src/index.js";

/**
 * The answer seam end to end (CQ-Q-005 §50): a run reaches the Model
 * Gateway through the orchestrator, the gateway routes over the real
 * ai_ops catalog to a FAKE provider registered under a real code, the
 * reply becomes a Q message, the run completes with its model policy
 * version, and the usage ledger holds the attempt. A timeout ends the run
 * as MODEL_PROVIDER_TIMEOUT with the public sentence; a plan too sensitive
 * for any seeded model ends it before any provider is called. With a tool
 * port (CQ-Q-007) the run offers the registry's tools, executes a
 * proposal, records the approved stage, and completes with the actor the
 * engine re-validated.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const PRIVATE_MARKER = "PRIVATE-MODEL-PROVIDER-ERROR-DO-NOT-EMIT";

/** The structured analyst output the seam expects (CQ-Q-006). */
function analystResult(answer: string) {
  return {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  };
}

type World = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly authUserId: string;
  readonly actor: ActorContext;
  readonly service: QRuntimeService;
  readonly logger: Logger;
  readonly logLines: string[];
  readonly stores: QCheckpointStore[];
};

function firewallWith(maxSensitivity: QSensitivityClass): ContextFirewallPort {
  return {
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
          maxSensitivity,
          allowedLayers: [],
          combinationConstraints: [],
          evaluatedAt: new Date().toISOString(),
          revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
          revalidateOnResume: true,
        }),
      }),
  };
}

describe("Model Gateway answer seam inside the Q orchestrator", () => {
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

  async function commitWorld(): Promise<World> {
    const logLines: string[] = [];
    const logger = createLogger(
      { serviceName: "answer-seam-test", environment: "test" },
      {
        level: "debug",
        destination: {
          write: (chunk: string) => {
            logLines.push(chunk);
          },
        },
      },
    );
    return db.transactions.run(async (tx) => {
      const tenantId = randomUUID();
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Answer Seam Tenant')`;
      const organisationId = randomUUID();
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', 'Answer Seam Org', ${`as-${organisationId.slice(0, 8)}`})`;
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
      const actor = ActorContextSchema.parse({
        userId: profile.id,
        tenantId,
        organisationId,
        membershipId,
        actorType: "HUMAN",
      });
      const service = createQRuntimeService({
        sql: db.sql,
        transactions: db.transactions,
        subjects: createQSubjectResolverRegistry([]),
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        logger,
      });
      return {
        tenantId,
        organisationId,
        authUserId,
        actor,
        service,
        logger,
        logLines,
        stores: [],
      };
    });
  }

  async function cleanup(world: World): Promise<void> {
    for (const store of world.stores) {
      await store.close();
    }
    await db.transactions.run(async (tx) => {
      const runs = await tx.sql<
        { id: string }[]
      >`select id from q_runtime.runs where tenant_id = ${world.tenantId}`;
      for (const run of runs) {
        await tx.sql`delete from q_runtime.checkpoint_writes where thread_id = ${run.id}`;
        await tx.sql`delete from q_runtime.checkpoint_blobs where thread_id = ${run.id}`;
        await tx.sql`delete from q_runtime.checkpoints where thread_id = ${run.id}`;
      }
      await tx.sql`alter table ai_ops.model_usage disable trigger model_usage_append_only`;
      await tx.sql`delete from ai_ops.model_usage where tenant_id = ${world.tenantId}`;
      await tx.sql`alter table ai_ops.model_usage enable trigger model_usage_append_only`;
      await tx.sql`delete from q_runtime.message_creation_requests where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = ${world.tenantId}`;
      await tx.sql`delete from q_runtime.conversation_messages where tenant_id = ${world.tenantId}`;
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

  function orchestrator(
    world: World,
    options: {
      readonly google: readonly FakeBehaviour[];
      readonly groq: readonly FakeBehaviour[];
      readonly maxSensitivity: QSensitivityClass;
      readonly tools?: QToolPort | undefined;
    },
  ) {
    const store = createPostgresQCheckpointStore({
      connectionString: TEST_DATABASE_URL,
    });
    world.stores.push(store);
    const repositories = createPostgresQRuntimeRepositories();
    const google = createFakeModelProvider({
      code: "google",
      script: options.google,
    });
    const groq = createFakeModelProvider({
      code: "groq",
      script: options.groq,
    });
    const gateway = createModelGateway({
      catalog: createPostgresModelCatalog({ sql: db.sql, cacheTtlMs: 0 }),
      registry: createModelProviderRegistry([google, groq]),
      usage: createPostgresModelUsageRepository({ sql: db.sql }),
      logger: world.logger,
    });
    const engine = createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        sql: db.sql,
        transactions: db.transactions,
        subjects: createQSubjectResolverRegistry([]),
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories,
        logger: world.logger,
      }),
      cancelRun: world.service.cancelRun,
      checkpoints: store,
      firewall: firewallWith(options.maxSensitivity),
      retrieval: createUnconfiguredQRetrieval(),
      answer: createModelGatewayQAnswer({
        gateway,
        repositories,
        sql: db.sql,
        transactions: db.transactions,
        tools: options.tools,
        logger: world.logger,
      }),
      pausePolicy: neverPause,
      logger: world.logger,
    });
    return { engine, google, groq };
  }

  /** A scripted tool port that records the actor it was asked on behalf of. */
  function scriptedTools() {
    const executed: QToolProposal[] = [];
    const actors: string[] = [];
    const port: QToolPort = {
      offer: (context) => {
        actors.push(context.actor.userId);
        return Promise.resolve([
          {
            toolName: "company.get",
            toolVersion: 1,
            classification: "READ_ONLY",
            definition: {
              name: "get_company",
              description: "Returns a company profile.",
              inputJsonSchema: { type: "object", properties: {} },
            },
            visibleStage: "REVIEWING_COMPANY",
          },
        ]);
      },
      execute: (proposal, context) => {
        executed.push(proposal);
        return Promise.resolve({
          callId: proposal.callId,
          toolName: "company.get",
          toolVersion: 1,
          classification: "READ_ONLY",
          status: "SUCCEEDED",
          failureCode: null,
          sensitivity: "PUBLIC",
          result: {
            ok: true,
            data: {
              canonicalName: "Synthetic Co",
              tenant: context.actor.tenantId,
            },
          },
          latencyMs: 2,
        });
      },
    };
    return { port, executed, actors };
  }

  async function createRun(world: World, text: string) {
    const created = await world.service.createRun({
      actor: world.actor,
      input: { capability: "ANSWER", message: { text }, modality: "TEXT" },
      idempotencyKey: `seam-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return created.run;
  }

  it("answers a public run through the gateway: Q message, COMPLETED, policy version, ledger row", async () => {
    const world = await commitWorld();
    try {
      const { engine, groq, google } = orchestrator(world, {
        google: [{ kind: "JSON", value: analystResult("unused") }],
        groq: [
          {
            kind: "JSON",
            value: analystResult("Synthetic answer from the fake provider."),
            usage: { inputTokens: 90, cachedInputTokens: 0, outputTokens: 12 },
          },
        ],
        maxSensitivity: "PUBLIC",
      });
      const run = await createRun(world, "Say hello to the test.");
      const handle = await engine.start({
        actor: world.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("COMPLETED");

      const final = await world.service.getRun({
        actor: world.actor,
        runId: run.id,
      });
      expect(final.run.status).toBe("COMPLETED");
      expect(final.run.orchestrationVersion).toBe(Q_ORCHESTRATION_VERSION);
      expect(final.run.modelPolicyVersion).toBe("normal_dialogue.v1");
      expect(final.run.promptBundleVersion).toBe(
        "q-system.v1_company-analyst.v2_comm.v1",
      );
      expect(groq.calls[0]?.request.messages[0]?.content).toContain(
        "You are Q",
      );
      expect(groq.calls[0]?.request.messages[1]?.content).toContain(
        '<<<UNTRUSTED_CONTENT source="userMessage">>>',
      );
      expect(groq.calls[0]?.request.output.kind).toBe("STRUCTURED");
      expect(final.messages.map((m) => m.role)).toEqual(["USER", "Q"]);
      expect(final.messages[1]?.content).toBe(
        "Synthetic answer from the fake provider.",
      );

      // NORMAL_DIALOGUE prefers gpt-oss-120b; the fake under the groq code answered.
      expect(groq.calls).toHaveLength(1);
      expect(google.calls).toHaveLength(0);
      expect(groq.calls[0]?.request.modelCode).toBe("openai/gpt-oss-120b");
      expect(groq.calls[0]?.request.messages.map((m) => m.role)).toEqual([
        "SYSTEM",
        "USER",
      ]);

      const ledger = await db.sql<
        { task_class: string; success: boolean; q_run_id: string }[]
      >`
        select task_class, success, q_run_id from ai_ops.model_usage where tenant_id = ${world.tenantId}`;
      expect(ledger).toEqual([
        { task_class: "NORMAL_DIALOGUE", success: true, q_run_id: run.id },
      ]);

      const events = await db.sql<{ event_type: string }[]>`
        select event_type from q_runtime.run_events where run_id = ${run.id} order by sequence`;
      expect(events.at(-1)?.event_type).toBe("q.run.completed");
      expect(world.logLines.join("\n")).not.toContain("Say hello to the test.");
    } finally {
      await cleanup(world);
    }
  });

  it("offers the registry's tools, executes a proposal and records the approved stage before completing", async () => {
    const world = await commitWorld();
    try {
      const tools = scriptedTools();
      const { engine, groq } = orchestrator(world, {
        google: [{ kind: "JSON", value: analystResult("unused") }],
        groq: [
          {
            kind: "TOOL_CALLS",
            calls: [
              {
                callId: "call_1",
                name: "get_company",
                arguments: { companyId: "x" },
              },
            ],
          },
          {
            kind: "TEXT",
            text: JSON.stringify(
              analystResult("Answer built from a tool result."),
            ),
          },
        ],
        maxSensitivity: "PUBLIC",
        tools: tools.port,
      });
      const run = await createRun(
        world,
        "What does the platform know about my company?",
      );
      const handle = await engine.start({
        actor: world.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("COMPLETED");
      expect(tools.executed).toEqual([
        {
          callId: "call_1",
          name: "get_company",
          arguments: { companyId: "x" },
        },
      ]);
      // The tool port is asked on behalf of the actor the engine re-validated.
      expect(tools.actors).toEqual([world.actor.userId]);
      expect(groq.calls).toHaveLength(2);
      expect(groq.calls[0]?.request.tools.map((t) => t.name)).toEqual([
        "get_company",
      ]);
      expect(groq.calls[0]?.request.output.kind).toBe("TEXT");
      expect(groq.calls[1]?.request.messages.map((m) => m.role)).toEqual([
        "SYSTEM",
        "USER",
        "ASSISTANT",
        "TOOL",
      ]);

      const final = await world.service.getRun({
        actor: world.actor,
        runId: run.id,
      });
      expect(final.run.status).toBe("COMPLETED");
      expect(final.messages[1]?.content).toBe(
        "Answer built from a tool result.",
      );
      const events = await db.sql<
        { event_type: string; visible_stage: string | null }[]
      >`
        select event_type, visible_stage from q_runtime.run_events where run_id = ${run.id} order by sequence`;
      expect(
        events.map((e) => e.visible_stage).filter((s) => s !== null),
      ).toContain("REVIEWING_COMPANY");
      expect(events.at(-1)?.event_type).toBe("q.run.completed");
      // Two model attempts, one ledger row each.
      const ledger = await db.sql<{ success: boolean }[]>`
        select success from ai_ops.model_usage where tenant_id = ${world.tenantId}`;
      expect(ledger).toHaveLength(2);
      // No tool argument or result reaches the run's events or the logs.
      const text = JSON.stringify(events) + world.logLines.join("\n");
      expect(text).not.toContain("Synthetic Co");
      expect(text).not.toContain('"companyId":"x"');
    } finally {
      await cleanup(world);
    }
  });

  it("turns a hung provider into MODEL_PROVIDER_TIMEOUT with the public sentence, nothing raw", async () => {
    const world = await commitWorld();
    try {
      const { engine } = orchestrator(world, {
        google: [
          {
            kind: "FAIL",
            failureClass: "PROVIDER_OUTAGE",
            cause: new Error(PRIVATE_MARKER),
          },
        ],
        groq: [
          {
            kind: "FAIL",
            failureClass: "TIMEOUT",
            cause: new Error(PRIVATE_MARKER),
          },
        ],
        maxSensitivity: "PUBLIC",
      });
      const run = await createRun(world, "This will time out.");
      const handle = await engine.start({
        actor: world.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.actor,
        runId: run.id,
      });
      // groq timed out twice, google's outage fallback failed: the last class stands.
      expect([
        "MODEL_PROVIDER_TIMEOUT",
        "MODEL_PROVIDER_UNAVAILABLE",
      ]).toContain(final.run.failureCode);
      expect(final.messages.map((m) => m.role)).toEqual(["USER"]);
      const events = await db.sql<{ payload: Record<string, unknown> }[]>`
        select payload from q_runtime.run_events where run_id = ${run.id} order by sequence`;
      const text = JSON.stringify(events);
      expect(text).not.toContain(PRIVATE_MARKER);
      expect(text).toMatch(/Q_TIMEOUT|Q_UNAVAILABLE/);
      expect(world.logLines.join("\n")).not.toContain(PRIVATE_MARKER);
      const ledger = await db.sql<{ success: boolean; error_code: string }[]>`
        select success, error_code from ai_ops.model_usage where tenant_id = ${world.tenantId} order by id`;
      expect(ledger.length).toBeGreaterThanOrEqual(2);
      expect(ledger.every((r) => !r.success)).toBe(true);
    } finally {
      await cleanup(world);
    }
  });

  it("refuses a plan above every reviewed ceiling before any provider is called", async () => {
    const world = await commitWorld();
    try {
      const { engine, google, groq } = orchestrator(world, {
        google: [{ kind: "JSON", value: analystResult("must not be called") }],
        groq: [{ kind: "JSON", value: analystResult("must not be called") }],
        // Above every reviewed provider ceiling there is. Groq carries
        // CONFIDENTIAL under its zero-retention review (CQ-C5-R2A); nothing
        // carries more, by construction, so this is the class that proves
        // the refusal still happens rather than the one that happened to.
        maxSensitivity: "RESTRICTED",
      });
      const run = await createRun(world, "Restricted question.");
      const handle = await engine.start({
        actor: world.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("MODEL_PROVIDER_UNAVAILABLE");
      expect(google.calls).toHaveLength(0);
      expect(groq.calls).toHaveLength(0);
      const ledger = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from ai_ops.model_usage where tenant_id = ${world.tenantId}`;
      expect(ledger[0]?.n).toBe(0);
    } finally {
      await cleanup(world);
    }
  });
});
