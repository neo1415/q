import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  approveQApproval,
  cancelQRun,
  createQRun,
  createQStreamState,
  getQRun,
  reduceQStream,
  streamQRunEvents,
  type ApiSession,
  type QStreamEventMeta,
  type QStreamState,
} from "@capital-q/api-client";
import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  createEventRegistry,
  UtcTimestampSchema,
  type QStreamEvent,
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
} from "@capital-q/q-actions";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import {
  createTestConfirmRequiredAction,
  TEST_CONFIRM_REQUIRED,
} from "@capital-q/q-actions/testing";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  type QCheckpointStore,
} from "@capital-q/q-orchestrator";
import {
  appendRunEvent,
  createCompanyQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createPostgresQRunEventNotifier,
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQRunStreamService,
  createQSubjectResolverRegistry,
  createUnconfiguredQRetrieval,
  neverPause,
  type QRunEventNotifier,
  type QRuntimeRepositories,
  type QRuntimeService,
  type QSubjectResolverRegistry,
} from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { createApp } from "../src/app.js";
import {
  createSyntheticStreamAnswer,
  type SyntheticStreamAnswer,
} from "../src/dev/synthetic-answer.js";

/**
 * The resumable stream through the real q-api composition against the
 * local database (CQ-Q-009 §90-§100, §109): real runtime, real LangGraph
 * orchestrator with checkpoints, real Context Firewall, real Approval
 * Engine with the test action, the Postgres NOTIFY wake-up, and the
 * fetch-based client from @capital-q/api-client. The model is the
 * synthetic streaming answer: no provider, no key, deltas on the delta
 * bus, one persisted message.
 *
 * World: tenant C holds company Alpha (network-visible) with a founder
 * (admin) and a colleague (member); tenant I holds investor Apex with an
 * admin. Private rows carry the SSE-* markers; nothing an unauthorised
 * stream, a log line or an error returns may carry them.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MARKERS = {
  message: "SSE-PRIVATE-MESSAGE-DO-NOT-LEAK",
  founder: "SSE-FOUNDER-PRIVATE-DO-NOT-LEAK",
  investor: "SSE-INVESTOR-PRIVATE-DO-NOT-LEAK",
  reasoning: "SSE-INTERNAL-REASONING-DO-NOT-LEAK",
  internalError: "SSE-INTERNAL-ERROR-DO-NOT-LEAK",
  approvalPayload: "SSE-APPROVAL-PAYLOAD-DO-NOT-LEAK",
} as const;

const registry = createEventRegistry([
  ...PERMISSIONS_EVENTS,
  ...NETWORK_EVENTS,
  ...Q_ACTION_EVENTS,
]);

type Person = {
  readonly token: string;
  readonly actor: ActorContext;
  readonly authUserId: string;
  readonly userId: string;
};

type Instance = {
  readonly app: FastifyInstance;
  readonly baseUrl: string;
  readonly notifier: QRunEventNotifier;
  readonly streams: () => number;
  readonly close: () => Promise<void>;
};

type World = {
  readonly tenantC: string;
  readonly tenantI: string;
  readonly founder: Person;
  readonly colleague: Person;
  readonly investor: Person;
  readonly companyAlpha: string;
  readonly service: QRuntimeService;
  readonly repositories: QRuntimeRepositories;
  readonly subjects: QSubjectResolverRegistry;
  readonly answer: SyntheticStreamAnswer;
  readonly executions: () => number;
  readonly logLines: string[];
  readonly instances: Instance[];
  readonly stores: QCheckpointStore[];
  /** A fresh q-api process: its own notifier and its own port. */
  readonly instance: () => Promise<Instance>;
};

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-events-test", environment: "test" },
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

describe("GET /v1/q/runs/:runId/events through the real Q API composition", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "8",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function commitWorld(): Promise<World> {
    const tenantC = randomUUID();
    const tenantI = randomUUID();
    const orgAlpha = randomUUID();
    const orgApex = randomUUID();
    const companyAlpha = randomUUID();
    const tokens = new Map<string, AuthenticatedPrincipal>();

    const people = await db.transactions.run(async (tx) => {
      const tenants: readonly (readonly [string, string])[] = [
        [tenantC, "Q Stream C"],
        [tenantI, "Q Stream I"],
      ];
      for (const [id, name] of tenants) {
        await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
      }
      const organisations: readonly (readonly [
        string,
        string,
        string,
        string,
      ])[] = [
        [orgAlpha, tenantC, "company", "Alpha"],
        [orgApex, tenantI, "investment_firm", "Apex"],
      ];
      for (const [id, tenantId, type, name] of organisations) {
        await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${id}, ${tenantId}, ${type}, ${name}, ${`qe-${id.slice(0, 8)}`})`;
        await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
      }
      const person = async (
        token: string,
        tenantId: string,
        organisationId: string,
        role: "organisation_admin" | "organisation_member",
      ): Promise<Person> => {
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
          select ${membershipId}, r.id from permissions.roles r where r.code = ${role}`;
        await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
        tokens.set(token, {
          authUserId: authUserId as AuthenticatedPrincipal["authUserId"],
        });
        return {
          token,
          authUserId,
          userId: profile.id,
          actor: ActorContextSchema.parse({
            userId: profile.id,
            tenantId,
            organisationId,
            membershipId,
            actorType: "HUMAN",
          }),
        };
      };
      const founder = await person(
        "founder",
        tenantC,
        orgAlpha,
        "organisation_admin",
      );
      const colleague = await person(
        "colleague",
        tenantC,
        orgAlpha,
        "organisation_member",
      );
      const investor = await person(
        "investor",
        tenantI,
        orgApex,
        "organisation_admin",
      );
      await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description, marketplace_visibility)
        values (${companyAlpha}, ${tenantC}, ${orgAlpha}, 'Alpha Robotics', ${`alpha-${companyAlpha.slice(0, 8)}`}, ${`Alpha builds robots. ${MARKERS.founder}`}, 'network_visible')`;
      const apexId = randomUUID();
      await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${apexId}, ${tenantI}, ${orgApex}, 'VC', 'Apex Ventures')`;
      await tx.sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, raw_mandate_text, created_by_user_id)
        values (${randomUUID()}, ${tenantI}, ${apexId}, 'Seed thesis', ${`Ceiling ${MARKERS.investor}`}, ${investor.userId})`;
      return { founder, colleague, investor };
    });

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
    const runtimeDependencies = {
      sql,
      transactions: db.transactions,
      subjects,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      repositories,
      logger,
    };
    const service = createQRuntimeService(runtimeDependencies);
    const testAction = createTestConfirmRequiredAction();
    const actionService = createQActionService({
      sql,
      transactions: db.transactions,
      repositories: createPostgresQActionRepositories(),
      runtime: repositories,
      registry: createQActionRegistry([testAction.definition]),
      authorization,
      audit,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      outbox,
      logger,
    });
    const stores: QCheckpointStore[] = [];
    const instances: Instance[] = [];

    // One delta bus per instance would be the honest multi-instance
    // picture; here every instance shares the process, so one bus serves.
    const { createInProcessQLiveDeltaBus } =
      await import("@capital-q/q-runtime");
    const deltas = createInProcessQLiveDeltaBus();
    const answer = createSyntheticStreamAnswer({
      sql,
      transactions: db.transactions,
      repositories,
      deltas,
      deltaDelayMs: 150,
      chunks: 6,
      internalNote: MARKERS.reasoning,
    });

    const instance = async (): Promise<Instance> => {
      const store = createPostgresQCheckpointStore({
        connectionString: TEST_DATABASE_URL,
      });
      stores.push(store);
      const orchestrator = createLangGraphQOrchestrator({
        runtime: createQOrchestrationRuntime(runtimeDependencies),
        cancelRun: service.cancelRun,
        checkpoints: store,
        firewall,
        retrieval: createUnconfiguredQRetrieval(),
        answer,
        actions: createQActionPort({
          service: actionService,
          proposer: {
            propose: (context) =>
              Promise.resolve(
                context.capability === "PREPARE_ACTION"
                  ? {
                      actionType: TEST_CONFIRM_REQUIRED,
                      payload: {
                        companyId: companyAlpha,
                        note: `Record this. ${MARKERS.approvalPayload}`,
                      },
                    }
                  : null,
              ),
          },
          logger,
        }),
        pausePolicy: neverPause,
        logger,
      });
      const notifier = createPostgresQRunEventNotifier({
        listen: db.listen,
        logger,
      });
      const qStream = createQRunStreamService({
        ...runtimeDependencies,
        notifier,
        deltas,
        options: { safetyPollMs: 2_000 },
      });
      const { app, streams } = createApp(
        parseQApiConfig({ NODE_ENV: "test" }),
        {
          authenticator: {
            authenticate: (request: FastifyRequest) => {
              const header = request.headers.authorization;
              const token =
                typeof header === "string" && header.startsWith("Bearer ")
                  ? header.slice(7)
                  : "";
              return Promise.resolve(tokens.get(token) ?? null);
            },
          },
          resolver: createPostgresActorContextResolver({ sql }),
        },
        {
          qRuntime: service,
          orchestration: { orchestrator, autostart: true },
          qActions: actionService,
          qStream: {
            service: qStream,
            options: { heartbeatIntervalMs: 1_000, retryHintMs: 100 },
          },
        },
        { shutdownGraceMs: 300 },
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("no address");
      }
      const created: Instance = {
        app,
        baseUrl: `http://127.0.0.1:${address.port}`,
        notifier,
        streams: () => streams?.activeStreams() ?? -1,
        close: async () => {
          await app.close();
          await notifier.close();
        },
      };
      instances.push(created);
      return created;
    };

    return {
      tenantC,
      tenantI,
      ...people,
      companyAlpha,
      service,
      repositories,
      subjects,
      answer,
      executions: () => testAction.state.executions(),
      logLines,
      instances,
      stores,
      instance,
    };
  }

  async function cleanup(world: World): Promise<void> {
    for (const instance of world.instances) {
      await instance.close().catch(() => undefined);
    }
    for (const store of world.stores) {
      await store.close();
    }
    await db.transactions.run(async (tx) => {
      for (const tenantId of [world.tenantC, world.tenantI]) {
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
        await tx.sql`delete from core.investor_mandates where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.investor_organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.companies where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.user_active_contexts where membership_id in (select id from identity.organisation_memberships where tenant_id = ${tenantId})`;
        await tx.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id = ${tenantId})`;
        await tx.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenant_organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenants where id = ${tenantId}`;
      }
      for (const p of [world.founder, world.colleague, world.investor]) {
        await tx.sql`delete from identity.user_profiles where auth_user_id = ${p.authUserId}`;
        await tx.sql`delete from auth.users where id = ${p.authUserId}`;
      }
    });
  }

  const session = (instance: Instance, person: Person): ApiSession => ({
    baseUrl: instance.baseUrl,
    accessToken: person.token,
  });

  type Seen = { event: QStreamEvent; meta: QStreamEventMeta };

  /** Streams until terminal, abort, or `stopWhen` says so; returns everything seen. */
  async function collect(
    s: ApiSession,
    runId: string,
    options: {
      lastEventId?: number;
      stopWhen?: (seen: Seen[]) => boolean;
      onEvent?: (seen: Seen) => void;
    } = {},
  ) {
    const controller = new AbortController();
    const seen: Seen[] = [];
    let state: QStreamState = createQStreamState();
    const result = await streamQRunEvents(s, runId, {
      signal: controller.signal,
      lastEventId: options.lastEventId,
      backoff: { initialMs: 50, maxMs: 200, jitter: () => 0 },
      onEvent: (event, meta) => {
        seen.push({ event, meta });
        state = reduceQStream(state, event);
        options.onEvent?.({ event, meta });
        if (options.stopWhen?.(seen) === true) {
          controller.abort();
        }
      },
    });
    return { seen, state, result };
  }

  const durableIds = (seen: Seen[]) =>
    seen.filter((s) => s.meta.durable).map((s) => s.event.sequence);
  const types = (seen: Seen[]) => seen.map((s) => s.event.type);

  const alphaRequest = (text: string, companyId: string) => ({
    capability: "INVESTIGATE" as const,
    message: { text },
    modality: "TEXT" as const,
    subjects: [{ kind: "COMPANY" as const, companyId }],
  });

  it("RECONNECT DEMO: streams the run, survives a forced disconnect, replays from Last-Event-ID and converges on the persisted message", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const handle = await createQRun(
        s,
        alphaRequest(
          `What should I know about Alpha? ${MARKERS.message}`,
          world.companyAlpha,
        ),
        `demo-${randomUUID()}`,
      );
      expect(handle.status).toBe("RECEIVED");

      // 1-5. Connect immediately after creation: the first durable event
      // (q.run.started, id 1) is replayed, then live events follow, then
      // live text; disconnect once a delta has been seen.
      const first = await collect(s, handle.runId, {
        stopWhen: (seen) =>
          seen.some((x) => x.event.type === "q.message.delta") &&
          durableIds(seen).length >= 3,
      });
      expect(first.result.reason).toBe("ABORTED");
      const firstIds = durableIds(first.seen);
      expect(firstIds[0]).toBe(1);
      expect(firstIds).toEqual([...firstIds].sort((x, y) => x - y));
      expect(types(first.seen)).toContain("q.message.delta");
      expect(first.state.partial?.text.length).toBeGreaterThan(0);
      const cursor = first.result.lastEventId;
      expect(cursor).toBe(firstIds.at(-1));

      // 6. The run continues without us.
      await sleep(400);
      expect(a.streams()).toBe(0);

      // 7-12. Reconnect with the cursor; missed durable events replay, the
      // stream continues live, the persisted message arrives, terminal.
      const second = await collect(s, handle.runId, { lastEventId: cursor });
      expect(second.result.reason).toBe("TERMINAL");
      const secondIds = durableIds(second.seen);
      expect(secondIds[0]).toBe(cursor + 1);
      const all = [...firstIds, ...secondIds];
      expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
      expect(types(second.seen)).toContain("q.message.completed");
      expect(types(second.seen).at(-1)).toBe("q.run.completed");

      // Convergence: the recovered message is the persisted one, whatever
      // the deltas we missed.
      const final = await getQRun(s, handle.runId);
      expect(final.status).toBe("COMPLETED");
      const persisted = final.messages?.find((m) => m.role === "Q");
      const recovered = second.state.messages.find((m) => m.role === "Q");
      expect(recovered?.text).toBe(persisted?.text);
      expect(recovered?.messageId).toBe(persisted?.messageId);
      expect(second.state.partial).toBeNull();
      expect(second.state.terminal).toBe(true);
      expect(world.answer.calls()).toBe(1);

      // Nothing internal rode the stream or the logs.
      const wire = JSON.stringify([...first.seen, ...second.seen]);
      expect(wire).not.toContain(MARKERS.reasoning);
      expect(wire).not.toContain(MARKERS.founder);
      expect(world.logLines.join("\n")).not.toContain(MARKERS.reasoning);
      expect(world.logLines.join("\n")).not.toContain(MARKERS.message);
      // The owner's own user message never appears in the stream either:
      // the stream carries Q's events, not the transcript.
      expect(wire).not.toContain(MARKERS.message);
    } finally {
      await cleanup(world);
    }
  });

  it("PROCESS RECREATION: a second q-api instance replays a run it never saw and receives live events from a run another instance is executing", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const sa = session(a, world.founder);
      const done = await createQRun(
        sa,
        alphaRequest("Run to completion on A.", world.companyAlpha),
        `a-${randomUUID()}`,
      );
      const onA = await collect(sa, done.runId);
      expect(onA.result.reason).toBe("TERMINAL");
      const total = durableIds(onA.seen).at(-1) ?? 0;

      // A is gone; B has nothing in memory about the run.
      await a.close();
      const b = await world.instance();
      const sb = session(b, world.founder);
      const fromB = await collect(sb, done.runId, { lastEventId: 2 });
      expect(fromB.result.reason).toBe("TERMINAL");
      expect(durableIds(fromB.seen)).toEqual(
        Array.from({ length: total - 2 }, (_, i) => i + 3),
      );

      // A run executed by instance C is observed live from instance B
      // through NOTIFY: no in-memory hand-off exists between them.
      const c = await world.instance();
      const live = await createQRun(
        session(c, world.founder),
        alphaRequest("Executed on C, watched on B.", world.companyAlpha),
        `c-${randomUUID()}`,
      );
      const watched = await collect(sb, live.runId);
      expect(watched.result.reason).toBe("TERMINAL");
      expect(types(watched.seen)).toContain("q.message.completed");
      expect(durableIds(watched.seen)[0]).toBe(1);
    } finally {
      await cleanup(world);
    }
  });

  it("REPLAY/LIVE RACE: events appended while clients connect and reconnect are never lost and never out of order", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      // A run that no orchestrator drives: the test appends its events.
      const created = await world.service.createRun({
        actor: world.founder.actor,
        input: {
          capability: "INVESTIGATE",
          message: { text: "race" },
          modality: "TEXT",
        },
        idempotencyKey: `race-${randomUUID()}`,
        correlationId: `cor_${randomUUID()}`,
      });
      const run = { id: created.run.id, tenantId: created.run.tenantId };
      const append = (stage: string) =>
        db.transactions.run((tx) =>
          appendRunEvent(world.repositories, tx, run, {
            type: "q.stage.changed",
            data: { stage: stage as never },
          }),
        );
      const stages = ["REVIEWING_COMPANY", "CHECKING_EVIDENCE"];
      const TOTAL = 120;
      let appended = 0;
      const writer = (async () => {
        for (let i = 0; i < TOTAL; i += 1) {
          await append(stages[i % 2] as string);
          appended += 1;
        }
        await db.transactions.run((tx) =>
          appendRunEvent(world.repositories, tx, run, {
            type: "q.run.completed",
            data: {
              status: "COMPLETED",
              completedAt: new Date().toISOString(),
            },
          }),
        );
      })();

      // Connect and reconnect repeatedly mid-write, each time from the cursor.
      const perConnection: number[][] = [];
      let cursor = 0;
      let reason = "";
      while (reason !== "TERMINAL") {
        const target = Math.min(cursor + 15, TOTAL + 2);
        const piece = await collect(s, run.id, {
          lastEventId: cursor,
          stopWhen: (seen) => (durableIds(seen).at(-1) ?? 0) >= target,
        });
        const ids = durableIds(piece.seen);
        perConnection.push(ids);
        for (let i = 1; i < ids.length; i += 1) {
          expect(ids[i]).toBe((ids[i - 1] ?? 0) + 1);
        }
        cursor = piece.result.lastEventId;
        reason = piece.result.reason;
      }
      await writer;
      const union = perConnection.flat();
      expect(union).toEqual(Array.from({ length: TOTAL + 2 }, (_, i) => i + 1));
      expect(appended).toBe(TOTAL);
      expect(perConnection.length).toBeGreaterThan(3);
    } finally {
      await cleanup(world);
    }
  });

  it("MULTIPLE CONNECTIONS: several authorised subscribers see one run, one model execution, one action proposal at most", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const handle = await createQRun(
        s,
        alphaRequest("Two tabs.", world.companyAlpha),
        `tabs-${randomUUID()}`,
      );
      const [one, two, three] = await Promise.all([
        collect(s, handle.runId),
        collect(s, handle.runId),
        collect(s, handle.runId),
      ]);
      for (const c of [one, two, three]) {
        expect(c.result.reason).toBe("TERMINAL");
        expect(durableIds(c.seen)).toEqual(durableIds(one.seen));
        expect(c.state.messages).toHaveLength(1);
      }
      expect(world.answer.calls()).toBe(1);
      const [count] = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.actions where run_id = ${handle.runId}`;
      expect(count?.n).toBe(0);
      await sleep(50);
      expect(a.streams()).toBe(0);
    } finally {
      await cleanup(world);
    }
  });

  it("AUTHORIZATION: a colleague in the same tenant, another tenant and an unauthenticated caller get no stream and no fact about the run", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const handle = await createQRun(
        s,
        alphaRequest(`Private. ${MARKERS.message}`, world.companyAlpha),
        `auth-${randomUUID()}`,
      );
      await collect(s, handle.runId); // let it finish
      for (const person of [world.colleague, world.investor]) {
        const response = await fetch(
          `${a.baseUrl}/v1/q/runs/${handle.runId}/events`,
          {
            headers: { authorization: `Bearer ${person.token}` },
          },
        );
        expect(response.status, person.token).toBe(404);
        const body = await response.text();
        expect(body).not.toContain(MARKERS.message);
        expect(body).not.toContain("COMPLETED");
        expect(body).not.toContain("sequence");
      }
      const anonymous = await fetch(
        `${a.baseUrl}/v1/q/runs/${handle.runId}/events`,
      );
      expect(anonymous.status).toBe(401);
      const forged = await fetch(
        `${a.baseUrl}/v1/q/runs/${handle.runId}/events?tenantId=${world.tenantC}&userId=${world.founder.userId}`,
        {
          headers: { authorization: `Bearer ${world.investor.token}` },
        },
      );
      expect(forged.status).toBe(404);
      // The refusals were recorded, without content.
      const security = await db.sql<
        { metadata: Record<string, unknown> }[]
      >`select metadata from audit.security_events where tenant_id in (${world.tenantC}, ${world.tenantI})`;
      expect(security.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(security)).not.toContain(MARKERS.message);
    } finally {
      await cleanup(world);
    }
  });

  it("CANCELLATION: the cancel command ends the run; the stream shows the cancelled state, closes, and a reconnect shows the same", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const handle = await createQRun(
        s,
        alphaRequest("Cancel me.", world.companyAlpha),
        `cancel-${randomUUID()}`,
      );
      let cancelled = false;
      const stream = await collect(s, handle.runId, {
        onEvent: ({ event }) => {
          if (event.type === "q.message.delta" && !cancelled) {
            cancelled = true;
            void cancelQRun(s, handle.runId);
          }
        },
      });
      expect(stream.result.reason).toBe("TERMINAL");
      const last = stream.seen.at(-1)?.event;
      expect(last?.type).toBe("q.run.failed");
      expect(last?.type === "q.run.failed" ? last.data.status : "").toBe(
        "CANCELLED",
      );
      expect(stream.state.partial).toBeNull();
      expect(stream.state.runStatus).toBe("CANCELLED");
      const again = await collect(s, handle.runId, { lastEventId: 0 });
      expect(again.result.reason).toBe("TERMINAL");
      expect(again.state.runStatus).toBe("CANCELLED");
      // Cancellation is cooperative (CQ-Q-002/003): the engine finishes
      // its current boundary, then the run ends CANCELLED and stays so.
      const final = await getQRun(s, handle.runId);
      expect(final.status).toBe("CANCELLED");
      expect(world.answer.calls()).toBe(1);
    } finally {
      await cleanup(world);
    }
  });

  it("APPROVAL FLOW: the stream announces the approval, survives a disconnect, the decision goes over HTTP, and the run resumes with one execution", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const handle = await createQRun(
        s,
        {
          capability: "PREPARE_ACTION",
          message: { text: "Prepare a note about Alpha." },
          modality: "TEXT",
          subjects: [{ kind: "COMPANY", companyId: world.companyAlpha }],
        },
        `approval-${randomUUID()}`,
      );
      const untilApproval = await collect(s, handle.runId, {
        stopWhen: (seen) =>
          seen.some((x) => x.event.type === "q.approval.required"),
      });
      expect(untilApproval.result.reason).toBe("ABORTED");
      expect(types(untilApproval.seen)).toContain("q.action.proposed");
      expect(untilApproval.state.approval).not.toBeNull();
      expect(untilApproval.state.stage).toBe("WAITING_FOR_APPROVAL");
      // The owner is the approver: the proposal's public preview is theirs
      // to read (§64). What never rides the stream is the binding hash.
      const wire = JSON.stringify(untilApproval.seen);
      expect(wire).not.toContain("sha256:");
      expect(wire).not.toContain("payloadHash");
      const required = untilApproval.seen.find(
        (x) => x.event.type === "q.approval.required",
      );
      expect(JSON.stringify(required)).not.toContain(MARKERS.approvalPayload);
      const approvalId = untilApproval.state.approval?.approvalId ?? "";
      const cursor = untilApproval.result.lastEventId;

      // Disconnected while waiting; the approval is still there on reconnect.
      await sleep(200);
      const reconnected = await collect(s, handle.runId, {
        lastEventId: 0,
        stopWhen: (seen) =>
          seen.some((x) => x.event.type === "q.approval.required"),
      });
      expect(reconnected.state.approval?.approvalId).toBe(approvalId);
      expect(world.executions()).toBe(0);

      // The decision is an HTTP command, never a stream message.
      const decided = await approveQApproval(s, approvalId);
      expect(decided.status).toBe("APPROVED");
      const rest = await collect(s, handle.runId, { lastEventId: cursor });
      expect(rest.result.reason).toBe("TERMINAL");
      expect(types(rest.seen)).toContain("q.stage.changed");
      expect(
        rest.state.stage === null ||
          rest.state.stage === "COMPLETING_APPROVED_ACTION",
      ).toBe(true);
      expect(types(rest.seen).at(-1)).toBe("q.run.completed");
      expect(rest.state.approval).toBeNull();
      expect(world.executions()).toBe(1);
      const final = await getQRun(s, handle.runId);
      expect(final.status).toBe("COMPLETED");
    } finally {
      await cleanup(world);
    }
  });

  it("PRIVACY: founder-private and investor-private markers never cross into the other party's stream, logs or errors", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const founderSession = session(a, world.founder);
      const investorSession = session(a, world.investor);
      const founderRun = await createQRun(
        founderSession,
        alphaRequest("Founder view.", world.companyAlpha),
        `f-${randomUUID()}`,
      );
      const investorRun = await createQRun(
        investorSession,
        {
          capability: "INVESTIGATE",
          message: { text: "Investor view of Alpha." },
          modality: "TEXT",
          subjects: [{ kind: "COMPANY", companyId: world.companyAlpha }],
        },
        `i-${randomUUID()}`,
      );
      const founderStream = await collect(founderSession, founderRun.runId);
      const investorStream = await collect(investorSession, investorRun.runId);
      const founderWire = JSON.stringify(founderStream.seen);
      const investorWire = JSON.stringify(investorStream.seen);
      expect(investorWire).not.toContain(MARKERS.founder);
      expect(founderWire).not.toContain(MARKERS.investor);
      for (const wire of [founderWire, investorWire]) {
        expect(wire).not.toContain(MARKERS.reasoning);
        expect(wire).not.toContain(MARKERS.internalError);
        expect(wire).not.toContain(MARKERS.approvalPayload);
        expect(wire).not.toMatch(
          /q\.(chain_of_thought|reasoning|internal_reasoning|scratchpad|prompt)/,
        );
      }
      const logs = world.logLines.join("\n");
      for (const marker of Object.values(MARKERS)) {
        expect(logs).not.toContain(marker);
      }
      // Cross-stream attempts are refused with nothing.
      const crossed = await fetch(
        `${a.baseUrl}/v1/q/runs/${founderRun.runId}/events`,
        {
          headers: { authorization: `Bearer ${world.investor.token}` },
        },
      );
      expect(crossed.status).toBe(404);
      expect(await crossed.text()).not.toContain(MARKERS.founder);
    } finally {
      await cleanup(world);
    }
  });

  it("CONCURRENCY BASELINE: bounded local load, recorded", async () => {
    const world = await commitWorld();
    try {
      const a = await world.instance();
      const s = session(a, world.founder);
      const RUNS = 5;
      const CLIENTS_PER_RUN = 4;
      const before = process.memoryUsage().heapUsed;
      const t0 = Date.now();
      const handles = await Promise.all(
        Array.from({ length: RUNS }, (_, i) =>
          createQRun(
            s,
            alphaRequest(`Baseline ${i}.`, world.companyAlpha),
            `base-${randomUUID()}`,
          ),
        ),
      );
      const firstEvent: number[] = [];
      const results = await Promise.all(
        handles.flatMap((h) =>
          Array.from({ length: CLIENTS_PER_RUN }, () => {
            const opened = Date.now();
            let first: number | undefined;
            return collect(s, h.runId, {
              onEvent: () => {
                if (first === undefined) {
                  first = Date.now() - opened;
                  firstEvent.push(first);
                }
              },
            });
          }),
        ),
      );
      const completedAt = Date.now() - t0;
      expect(results.every((r) => r.result.reason === "TERMINAL")).toBe(true);
      expect(results.every((r) => r.state.messages.length === 1)).toBe(true);
      expect(world.answer.calls()).toBe(RUNS);
      await sleep(100);
      expect(a.streams()).toBe(0);
      const after = process.memoryUsage().heapUsed;
      const sorted = [...firstEvent].sort((x, y) => x - y);
      const baseline = {
        concurrentClients: RUNS * CLIENTS_PER_RUN,
        runs: RUNS,
        timeToFirstEventMs: {
          p50: sorted[Math.floor(sorted.length / 2)],
          max: sorted.at(-1),
        },
        allRunsCompletedMs: completedAt,
        heapDeltaMb: Math.round(((after - before) / 1024 / 1024) * 10) / 10,
        streamsAfter: a.streams(),
      };
      // Recorded for the postflight; not a threshold.
      console.info(`[baseline] ${JSON.stringify(baseline)}`);
    } finally {
      await cleanup(world);
    }
  }, 60_000);
});
