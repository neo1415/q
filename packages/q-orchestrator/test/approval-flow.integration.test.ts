import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  type CompanyId,
} from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  UtcTimestampSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresDocumentQueryPort } from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import { createNetworkService } from "@capital-q/network";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { createLogger, type Logger } from "@capital-q/observability";
import {
  actorPrincipal,
  createDefaultDisclosureResolvers,
  createDisclosureResourceResolverRegistry,
  createPermissionsService,
  createRelationshipPartyResolver,
} from "@capital-q/permissions";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import {
  createPostgresQActionRepositories,
  createQActionPort,
  createQActionRegistry,
  createQActionService,
  type QActionProposer,
  type QActionService,
} from "@capital-q/q-actions";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import {
  createTestConfirmRequiredAction,
  TEST_CONFIRM_REQUIRED,
  type TestActionExecutorState,
} from "@capital-q/q-actions/testing";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  createCompanyQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQRetrieval,
  neverPause,
  QRunAlreadyTerminalError,
  QRunNotResumableError,
  type ContextFirewallPort,
  type QAnswerPort,
  type QOrchestrator,
  type QRuntimeService,
  type QSubjectResolverRegistry,
} from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";

import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  type QCheckpointStore,
} from "../src/index.js";

/**
 * Prepare → Approve → Execute through the LangGraph orchestrator against
 * the real local database (CQ-Q-008 §55-§58, §114). The graph pauses at
 * the approval gate, the run is durably AWAITING_APPROVAL, the decision is
 * made through the Approval Engine (never through the graph), and the
 * resumed engine executes exactly once through the idempotent gate. The
 * checkpoint is a resumption aid: it never carries an approval and a
 * resumed run without a decision executes nothing.
 *
 * The world is the firewall-resume world reduced to what the seam needs:
 * tenant C, company Alpha (network-visible), a founder who is
 * organisation_admin. The answer seam is a stub that always answers, so
 * no model is called and no provider money is spent.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const PAYLOAD_MARKER = "APPROVAL-PAYLOAD-PRIVATE-DO-NOT-LEAK";

const registry = createEventRegistry([
  ...PERMISSIONS_EVENTS,
  ...NETWORK_EVENTS,
  ...Q_ACTION_EVENTS,
]);

type Person = {
  readonly actor: ActorContext;
  readonly authUserId: string;
  readonly userId: string;
};

type World = {
  readonly tenantC: string;
  readonly orgAlpha: string;
  readonly founder: Person;
  readonly companyAlpha: CompanyId;
  readonly service: QRuntimeService;
  readonly firewall: ContextFirewallPort;
  readonly subjects: QSubjectResolverRegistry;
  readonly actions: QActionService;
  readonly executor: TestActionExecutorState;
  readonly logLines: string[];
  readonly logger: Logger;
  readonly stores: QCheckpointStore[];
};

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-approval-flow-test", environment: "test" },
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

/** A model that always answers, so the run reaches the action seam without a provider. */
const answeringPort: QAnswerPort = {
  answer: () =>
    Promise.resolve({
      kind: "ANSWERED",
      messageId: randomUUID(),
      modelPolicyVersion: "test-policy",
      promptBundleVersion: "test-bundle",
    }),
};

describe("Approval flow through the Q orchestrator against local PostgreSQL", () => {
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
    const tenantC = randomUUID();
    const orgAlpha = randomUUID();
    const { founder, companyId } = await db.transactions.run(async (tx) => {
      await tx.sql`insert into identity.tenants (id, name) values (${tenantC}, 'Q Approval Flow C')`;
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${orgAlpha}, ${tenantC}, 'company', 'Alpha', ${`qa-${orgAlpha.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantC}, ${orgAlpha})`;
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
        values (${membershipId}, ${tenantC}, ${orgAlpha}, ${profile.id})`;
      await tx.sql`insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
      const companyId = randomUUID();
      await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description, marketplace_visibility)
        values (${companyId}, ${tenantC}, ${orgAlpha}, 'Alpha Robotics', ${`alpha-${companyId.slice(0, 8)}`}, 'Alpha builds robots.', 'network_visible')`;
      return {
        founder: {
          authUserId,
          userId: profile.id,
          actor: ActorContextSchema.parse({
            userId: profile.id,
            tenantId: tenantC,
            organisationId: orgAlpha,
            membershipId,
            actorType: "HUMAN",
          }),
        },
        companyId,
      };
    });
    const companyAlpha = CompanyIdSchema.parse(companyId);

    const logLines: string[] = [];
    const logger = capturingLogger(logLines);
    const sql = db.sql;
    const outbox = createOutboxWriter({ registry });
    const audit = createPostgresMaterialActionAuditWriter();
    const authorization = createAuthorizationService(
      createPostgresAuthorizationPolicySource({ sql }),
    );
    const companies = createPostgresCompanyQueryPort({ sql });
    const investors = createPostgresInvestorOrganisationQueryPort({ sql });
    const mandates = createPostgresInvestorMandateQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const network = createNetworkService({
      sql,
      transactions: db.transactions,
      companies,
      investors,
      outbox,
      audit,
    });
    const ports = {
      companies,
      investors,
      mandates,
      capital,
      relationships: network.query,
    };
    const resolvers = createDisclosureResourceResolverRegistry(
      createDefaultDisclosureResolvers(ports),
    );
    const relationshipParties = createRelationshipPartyResolver(ports);
    const clock = {
      now: () => UtcTimestampSchema.parse(new Date().toISOString()),
    };
    const permissions = createPermissionsService({
      sql,
      transactions: db.transactions,
      authorization,
      outbox,
      audit,
      clock,
      resolvers,
      relationshipParties,
    });
    const firewall = createContextFirewall({
      authorization,
      disclosure: permissions.access,
      resolvers,
      relationshipParties,
      documents: createPostgresDocumentQueryPort({ sql }),
      capital,
      clock,
      logger,
    });
    const subjectView = {
      canView: async (
        actor: ActorContext,
        resource: { type: "company" | "investor_organisation"; id: string },
      ) =>
        (
          await permissions.access.canDisclose({
            principal: actorPrincipal(actor),
            resource,
            requestedAccess: "view",
          })
        ).outcome === "ALLOW",
    };
    const subjects = createQSubjectResolverRegistry([
      createCompanyQSubjectResolver(companies, subjectView),
      createInvestorOrganisationQSubjectResolver(investors, subjectView),
    ]);
    const repositories = createPostgresQRuntimeRepositories();
    const service = createQRuntimeService({
      sql,
      transactions: db.transactions,
      subjects,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      repositories,
      logger,
    });
    const test = createTestConfirmRequiredAction();
    const actions = createQActionService({
      sql,
      transactions: db.transactions,
      repositories: createPostgresQActionRepositories(),
      runtime: repositories,
      registry: createQActionRegistry([test.definition]),
      authorization,
      audit,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      outbox,
      logger,
    });
    return {
      tenantC,
      orgAlpha,
      founder,
      companyAlpha,
      service,
      firewall,
      subjects,
      actions,
      executor: test.state,
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
      const tenantId = world.tenantC;
      const runs = await tx.sql<
        { id: string }[]
      >`select id from q_runtime.runs where tenant_id = ${tenantId}`;
      for (const run of runs) {
        await tx.sql`delete from q_runtime.checkpoint_writes where thread_id = ${run.id}`;
        await tx.sql`delete from q_runtime.checkpoint_blobs where thread_id = ${run.id}`;
        await tx.sql`delete from q_runtime.checkpoints where thread_id = ${run.id}`;
      }
      await tx.sql`delete from q_runtime.approvals where tenant_id = ${tenantId}`;
      await tx.sql`delete from q_runtime.actions where tenant_id = ${tenantId}`;
      await tx.sql`delete from q_runtime.message_creation_requests where tenant_id = ${tenantId}`;
      await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = ${tenantId}`;
      await tx.sql`delete from q_runtime.conversation_messages where tenant_id = ${tenantId}`;
      await tx.sql`alter table q_runtime.run_events disable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.run_events where tenant_id = ${tenantId}`;
      await tx.sql`alter table q_runtime.run_events enable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.runs where tenant_id = ${tenantId}`;
      await tx.sql`delete from q_runtime.conversations where tenant_id = ${tenantId}`;
      await tx.sql`delete from events.outbox where tenant_id = ${tenantId}`;
      await tx.sql`delete from audit.material_actions where tenant_id = ${tenantId}`;
      await tx.sql`delete from audit.security_events where tenant_id = ${tenantId}`;
      await tx.sql`delete from core.companies where tenant_id = ${tenantId}`;
      await tx.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id = ${tenantId})`;
      await tx.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}`;
      await tx.sql`delete from identity.tenant_organisations where tenant_id = ${tenantId}`;
      await tx.sql`delete from identity.organisations where tenant_id = ${tenantId}`;
      await tx.sql`delete from identity.tenants where id = ${tenantId}`;
      await tx.sql`delete from identity.user_profiles where auth_user_id = ${world.founder.authUserId}`;
      await tx.sql`delete from auth.users where id = ${world.founder.authUserId}`;
    });
  }

  /** The test proposer: the run has one consequential thing to do. */
  function proposer(world: World): QActionProposer {
    return {
      propose: () =>
        Promise.resolve({
          actionType: TEST_CONFIRM_REQUIRED,
          payload: {
            companyId: world.companyAlpha,
            note: `Record a note about Alpha. ${PAYLOAD_MARKER}`,
          },
        }),
    };
  }

  /** A fresh orchestrator with its own checkpoint store — a "process". */
  function orchestrator(world: World): QOrchestrator {
    const store = createPostgresQCheckpointStore({
      connectionString: TEST_DATABASE_URL,
    });
    world.stores.push(store);
    return createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        sql: db.sql,
        transactions: db.transactions,
        subjects: world.subjects,
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories: createPostgresQRuntimeRepositories(),
        logger: world.logger,
      }),
      cancelRun: world.service.cancelRun,
      checkpoints: store,
      firewall: world.firewall,
      retrieval: createUnconfiguredQRetrieval(),
      answer: answeringPort,
      actions: createQActionPort({
        service: world.actions,
        proposer: proposer(world),
        logger: world.logger,
      }),
      pausePolicy: neverPause,
      logger: world.logger,
    });
  }

  async function createRun(world: World) {
    const created = await world.service.createRun({
      actor: world.founder.actor,
      input: {
        capability: "PREPARE_ACTION",
        message: { text: "Prepare a note about Alpha." },
        modality: "TEXT",
        subjects: [{ kind: "COMPANY", companyId: world.companyAlpha }],
      },
      idempotencyKey: `af-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return created.run;
  }

  async function runRow(runId: string) {
    const [row] = await db.sql<
      { status: string; failure_code: string | null }[]
    >`select status, failure_code from q_runtime.runs where id = ${runId}`;
    return row ?? { status: "missing", failure_code: null };
  }

  async function events(runId: string) {
    return db.sql<
      { event_type: string; payload: Record<string, unknown> }[]
    >`select event_type, payload from q_runtime.run_events where run_id = ${runId} order by sequence`;
  }

  async function actionRow(runId: string) {
    const [row] = await db.sql<
      { id: string; status: string; execution_attempts: number }[]
    >`select id, status, execution_attempts from q_runtime.actions where run_id = ${runId}`;
    return row;
  }

  async function checkpointText(runId: string): Promise<string> {
    const [row] = await db.sql<{ text: string }[]>`select
        coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_blobs where thread_id = ${runId} and blob is not null), '')
        || ' ' || coalesce((select string_agg(checkpoint::text || metadata::text, ' ') from q_runtime.checkpoints where thread_id = ${runId}), '')
        || ' ' || coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_writes where thread_id = ${runId}), '') as text`;
    return row?.text ?? "";
  }

  const stagesOf = (stored: { payload: Record<string, unknown> }[]) =>
    stored.map((e) => e.payload["stage"]).filter((s) => s !== undefined);

  // -------------------------------------------------------------------------

  it("GOLDEN: the graph pauses at the approval gate, the person approves through the engine, and the resumed run executes once", async () => {
    const world = await commitWorld();
    try {
      const run = await createRun(world);
      const first = orchestrator(world);
      const paused = await first.start({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(paused.status).toBe("AWAITING_APPROVAL");
      expect((await runRow(run.id)).status).toBe("AWAITING_APPROVAL");

      const recorded = await events(run.id);
      const types = recorded.map((e) => e.event_type);
      expect(types).toContain("q.action.proposed");
      expect(types).toContain("q.approval.required");
      expect(types).not.toContain("q.run.completed");
      expect(stagesOf(recorded)).toContain("WAITING_FOR_APPROVAL");
      const required = recorded.find(
        (e) => e.event_type === "q.approval.required",
      );
      const approvalId = required?.payload["approvalId"] as string;
      expect(approvalId).toMatch(/^[0-9a-f-]{36}$/);

      const action = await actionRow(run.id);
      expect(action?.status).toBe("AWAITING_APPROVAL");
      expect(world.executor.executions()).toBe(0);

      // The checkpoint carries no approval and no payload; the decision
      // lives in q_runtime.approvals only.
      const checkpoint = await checkpointText(run.id);
      expect(checkpoint).not.toContain(PAYLOAD_MARKER);
      expect(checkpoint).not.toContain("APPROVED");
      expect(checkpoint).not.toContain("sha256:");

      // The person decides through the engine, in another "process".
      const decided = await world.actions.approve({
        actor: world.founder.actor,
        approvalId: approvalId as never,
        correlationId: CORRELATION(),
      });
      expect(decided.decided).toBe(true);
      expect(world.executor.executions()).toBe(0);

      const second = orchestrator(world);
      const finished = await second.resume({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(finished.status).toBe("COMPLETED");
      expect((await runRow(run.id)).status).toBe("COMPLETED");
      expect(world.executor.executions()).toBe(1);
      const executed = await actionRow(run.id);
      expect(executed).toMatchObject({
        status: "EXECUTED",
        execution_attempts: 1,
      });
      const afterStages = stagesOf(await events(run.id));
      expect(afterStages).toContain("COMPLETING_APPROVED_ACTION");
      expect((await events(run.id)).map((e) => e.event_type)).toContain(
        "q.run.completed",
      );

      // A replayed resume cannot execute again: the run has ended.
      await expect(
        second.resume({
          actor: world.founder.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunAlreadyTerminalError);
      expect(world.executor.executions()).toBe(1);

      // Attribution: Q executed under the founder's authority; the payload
      // marker is in no audit row, event or log line.
      const audit = await db.sql<
        { action_type: string; actor_type: string; authority_user_id: string }[]
      >`select action_type, actor_type, authority_user_id from audit.material_actions where tenant_id = ${world.tenantC} and action_type = 'q.action.executed'`;
      expect(audit).toEqual([
        {
          action_type: "q.action.executed",
          actor_type: "q",
          authority_user_id: world.founder.userId,
        },
      ]);
      const outbox = await db.sql<
        { event_type: string; payload: Record<string, unknown> }[]
      >`select event_type, payload from events.outbox where tenant_id = ${world.tenantC} and event_type like 'q.action.%' order by id`;
      expect(outbox.map((e) => e.event_type)).toEqual([
        "q.action.prepared",
        "q.action.approved",
        "q.action.executed",
      ]);
      expect(JSON.stringify(outbox)).not.toContain(PAYLOAD_MARKER);
      expect(world.logLines.join("\n")).not.toContain(PAYLOAD_MARKER);
      expect(await checkpointText(run.id)).not.toContain(PAYLOAD_MARKER);
    } finally {
      await cleanup(world);
    }
  });

  it("a rejection ends the run without a side effect and the engine cannot be resumed into execution", async () => {
    const world = await commitWorld();
    try {
      const run = await createRun(world);
      const engine = orchestrator(world);
      await engine.start({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      const required = (await events(run.id)).find(
        (e) => e.event_type === "q.approval.required",
      );
      const approvalId = required?.payload["approvalId"] as string;

      const rejected = await world.actions.reject({
        actor: world.founder.actor,
        approvalId: approvalId as never,
        correlationId: CORRELATION(),
        reason: "Not this one.",
      });
      expect(rejected.decided).toBe(true);
      expect((await runRow(run.id)).status).toBe("COMPLETED");
      expect((await actionRow(run.id))?.status).toBe("REJECTED");

      await expect(
        engine.resume({
          actor: world.founder.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunAlreadyTerminalError);
      expect(world.executor.executions()).toBe(0);
      expect((await events(run.id)).map((e) => e.event_type)).toContain(
        "q.run.completed",
      );
    } finally {
      await cleanup(world);
    }
  });

  it("the interrupt is not authority: resuming an undecided run executes nothing", async () => {
    const world = await commitWorld();
    try {
      const run = await createRun(world);
      const engine = orchestrator(world);
      await engine.start({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect((await runRow(run.id)).status).toBe("AWAITING_APPROVAL");

      // Someone resumes the engine with no decision recorded (a replayed
      // worker, a forged resume): the gate finds no approval and the
      // action stays unexecuted.
      const resumed = await orchestrator(world).resume({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(world.executor.executions()).toBe(0);
      expect(resumed.status).not.toBe("ACTION_EXECUTION");
      const action = await actionRow(run.id);
      expect(action?.status).not.toBe("EXECUTED");
      expect(action?.execution_attempts).toBe(0);
      expect((await runRow(run.id)).status).not.toBe("AWAITING_APPROVAL");

      // And once the run has left AWAITING_APPROVAL, the stale open request
      // can no longer be approved into an execution.
      const required = (await events(run.id)).find(
        (e) => e.event_type === "q.approval.required",
      );
      const approvalId = required?.payload["approvalId"] as string;
      await expect(
        world.actions.approve({
          actor: world.founder.actor,
          approvalId: approvalId as never,
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow();
      expect(world.executor.executions()).toBe(0);
    } finally {
      await cleanup(world);
    }
  });

  it("two processes resuming the same approved run produce one execution", async () => {
    const world = await commitWorld();
    try {
      const run = await createRun(world);
      await orchestrator(world).start({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      const required = (await events(run.id)).find(
        (e) => e.event_type === "q.approval.required",
      );
      await world.actions.approve({
        actor: world.founder.actor,
        approvalId: required?.payload["approvalId"] as never,
        correlationId: CORRELATION(),
      });

      const resume = (engine: QOrchestrator) =>
        engine.resume({
          actor: world.founder.actor,
          runId: run.id,
          correlationId: CORRELATION(),
        });
      const results = await Promise.allSettled([
        resume(orchestrator(world)),
        resume(orchestrator(world)),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(
        refused[0]?.reason instanceof QRunNotResumableError ||
          refused[0]?.reason instanceof QRunAlreadyTerminalError,
      ).toBe(true);
      expect(world.executor.executions()).toBe(1);
      expect((await runRow(run.id)).status).toBe("COMPLETED");
      expect(await actionRow(run.id)).toMatchObject({
        status: "EXECUTED",
        execution_attempts: 1,
      });
    } finally {
      await cleanup(world);
    }
  });
});
