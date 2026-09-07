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
  type CreateQRunRequest,
  type PermittedContextPlan,
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
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
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
  type DisclosurePolicyId,
  type PermissionsService,
} from "@capital-q/permissions";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  createCompanyQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQAnswer,
  createUnconfiguredQRetrieval,
  neverPause,
  QRunNotFoundError,
  type ContextFirewallPort,
  type QAnswerPort,
  type QOrchestrator,
  type QPausePolicy,
  type QRetrievalPort,
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
 * The Context Firewall inside the orchestrator, against the real local
 * database (packet §79-81): permissions are re-evaluated on resume, a
 * changed active organisation cannot resume, and a denial ends the run
 * closed — before any retrieval — with one public sentence.
 *
 * As in the orchestrator suite, the checkpoint store opens its own
 * connections, so each test commits a small world and removes it in
 * `finally`. Tenant C holds company Alpha (network-visible) with a founder
 * (organisation_admin) who also belongs to a second organisation in the
 * same tenant; tenant I holds investor Apex with an admin. Private markers
 * live where the firewall resolves but never reads.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const MARKERS = {
  founder: "FOUNDER-PRIVATE-SECRET-DO-NOT-LEAK",
  investor: "INVESTOR-PRIVATE-SECRET-DO-NOT-LEAK",
  organisation: "ORG-A-PRIVATE-SECRET-DO-NOT-LEAK",
  relationship: "RELATIONSHIP-A-ONLY-DO-NOT-LEAK",
  source: "SOURCE-EXISTENCE-SECRET-DO-NOT-HINT",
} as const;

const registry = createEventRegistry([
  ...PERMISSIONS_EVENTS,
  ...NETWORK_EVENTS,
]);

type Person = {
  readonly actor: ActorContext;
  readonly authUserId: string;
  readonly userId: string;
};

type World = {
  readonly tenantC: string;
  readonly tenantI: string;
  readonly orgAlpha: string;
  readonly orgAlphaHoldings: string;
  readonly orgApex: string;
  readonly founder: Person;
  /** The same human, acting for the second organisation. */
  readonly founderElsewhere: ActorContext;
  readonly apexAdmin: Person;
  readonly companyAlpha: CompanyId;
  readonly investorApex: InvestorOrganisationId;
  readonly capitalObjectiveId: string;
  readonly service: QRuntimeService;
  readonly permissions: PermissionsService;
  readonly firewall: ContextFirewallPort;
  readonly subjects: QSubjectResolverRegistry;
  readonly logLines: string[];
  readonly logger: Logger;
  readonly stores: QCheckpointStore[];
};

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-firewall-resume-test", environment: "test" },
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

const alwaysPause: QPausePolicy = { shouldPause: () => true };

type PlanRecording = { readonly plans: PermittedContextPlan[] };

function recordingRetrieval(): QRetrievalPort & PlanRecording {
  const plans: PermittedContextPlan[] = [];
  return {
    plans,
    retrieve: (_request, plan) => {
      plans.push(plan);
      return Promise.resolve({ kind: "NOT_CONFIGURED" });
    },
  };
}

function recordingAnswer(): QAnswerPort & PlanRecording {
  const plans: PermittedContextPlan[] = [];
  return {
    plans,
    answer: (request) => {
      plans.push(request.plan);
      return Promise.resolve({ kind: "NOT_CONFIGURED" });
    },
  };
}

function assertNoMarkers(text: string): void {
  for (const marker of Object.values(MARKERS)) {
    expect(text).not.toContain(marker);
  }
}

describe("Context Firewall inside the Q orchestrator against local PostgreSQL", () => {
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

  async function tenant(label: string): Promise<string> {
    return db.transactions.run(async (tx) => {
      const tenantId = randomUUID();
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Q Firewall ${label}`})`;
      return tenantId;
    });
  }

  async function organisation(
    tenantId: string,
    type: string,
    label: string,
  ): Promise<string> {
    return db.transactions.run(async (tx) => {
      const organisationId = randomUUID();
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, ${type}, ${label}, ${`qf-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
      return organisationId;
    });
  }

  async function membership(
    userId: string,
    tenantId: string,
    organisationId: string,
  ): Promise<ActorContext> {
    return db.transactions.run(async (tx) => {
      const membershipId = randomUUID();
      await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
        values (${membershipId}, ${tenantId}, ${organisationId}, ${userId})`;
      await tx.sql`insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
      return ActorContextSchema.parse({
        userId,
        tenantId,
        organisationId,
        membershipId,
        actorType: "HUMAN",
      });
    });
  }

  async function person(
    tenantId: string,
    organisationId: string,
  ): Promise<Person> {
    const { authUserId, userId } = await db.transactions.run(async (tx) => {
      const authUserId = randomUUID();
      await tx.sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await tx.sql<
        { id: string }[]
      >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) {
        throw new Error("profile trigger did not run");
      }
      return { authUserId, userId: profile.id };
    });
    const actor = await membership(userId, tenantId, organisationId);
    return { actor, authUserId, userId };
  }

  async function commitWorld(): Promise<World> {
    const tenantC = await tenant("C");
    const tenantI = await tenant("I");
    const orgAlpha = await organisation(tenantC, "company", "Alpha");
    const orgAlphaHoldings = await organisation(
      tenantC,
      "company",
      "Alpha Holdings",
    );
    const orgApex = await organisation(tenantI, "investment_firm", "Apex");
    const founder = await person(tenantC, orgAlpha);
    const founderElsewhere = await membership(
      founder.userId,
      tenantC,
      orgAlphaHoldings,
    );
    const apexAdmin = await person(tenantI, orgApex);

    const { companyId, capitalObjectiveId, apexId } = await db.transactions.run(
      async (tx) => {
        const companyId = randomUUID();
        await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description, marketplace_visibility)
          values (${companyId}, ${tenantC}, ${orgAlpha}, 'Alpha Robotics', ${`alpha-${companyId.slice(0, 8)}`}, ${`Alpha builds robots. ${MARKERS.organisation}`}, 'network_visible')`;
        await tx.sql`insert into core.founder_profiles (id, tenant_id, user_id, primary_company_id, professional_summary)
          values (${randomUUID()}, ${tenantC}, ${founder.userId}, ${companyId}, ${`Founder note: ${MARKERS.founder}`})`;
        const capitalObjectiveId = randomUUID();
        await tx.sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id, use_of_funds_summary)
          values (${capitalObjectiveId}, ${tenantC}, ${companyId}, 5000000, 'USD', ${founder.userId}, ${`Use of funds ${MARKERS.source}`})`;
        const apexId = randomUUID();
        await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${apexId}, ${tenantI}, ${orgApex}, 'VC', 'Apex Ventures')`;
        await tx.sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, raw_mandate_text, created_by_user_id)
          values (${randomUUID()}, ${tenantI}, ${apexId}, 'Seed thesis', ${`Ceiling ${MARKERS.investor}`}, ${apexAdmin.userId})`;
        return { companyId, capitalObjectiveId, apexId };
      },
    );
    const companyAlpha = CompanyIdSchema.parse(companyId);
    const investorApex = InvestorOrganisationIdSchema.parse(apexId);

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
    await network.ensureRelationship({
      actor: apexAdmin.actor,
      companyId: companyAlpha,
      investorOrganisationId: investorApex,
      source: { type: "DISCOVER", id: `slate:${MARKERS.relationship}` },
      visibilityScope: "investor_private",
      correlationId: CORRELATION(),
    });
    const service = createQRuntimeService({
      sql,
      transactions: db.transactions,
      subjects,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      logger,
    });
    return {
      tenantC,
      tenantI,
      orgAlpha,
      orgAlphaHoldings,
      orgApex,
      founder,
      founderElsewhere,
      apexAdmin,
      companyAlpha,
      investorApex,
      capitalObjectiveId,
      service,
      permissions,
      firewall,
      subjects,
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
      for (const tenantId of [world.tenantC, world.tenantI]) {
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
        await tx.sql`delete from permissions.disclosure_policies where tenant_id = ${tenantId}`;
        await tx.sql`delete from network.relationship_events where tenant_id = ${tenantId}`;
        await tx.sql`delete from network.relationships where tenant_id = ${tenantId}`;
        await tx.sql`delete from events.outbox where tenant_id = ${tenantId}`;
        await tx.sql`delete from audit.material_actions where tenant_id = ${tenantId}`;
        await tx.sql`delete from audit.security_events where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.capital_objective_events where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.capital_objectives where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.investor_mandates where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.investor_organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.founder_profiles where tenant_id = ${tenantId}`;
        await tx.sql`delete from core.companies where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id = ${tenantId})`;
        await tx.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenant_organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.organisations where tenant_id = ${tenantId}`;
        await tx.sql`delete from identity.tenants where id = ${tenantId}`;
      }
      for (const p of [world.founder, world.apexAdmin]) {
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
        subjects: world.subjects,
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories: createPostgresQRuntimeRepositories(),
        logger: world.logger,
      }),
      cancelRun: world.service.cancelRun,
      checkpoints: store,
      firewall: world.firewall,
      retrieval: options.retrieval ?? createUnconfiguredQRetrieval(),
      answer: options.answer ?? createUnconfiguredQAnswer(),
      pausePolicy: options.pausePolicy ?? neverPause,
      logger: world.logger,
    });
  }

  async function createRun(
    world: World,
    actor: ActorContext,
    overrides: Partial<CreateQRunRequest> = {},
  ) {
    const created = await world.service.createRun({
      actor,
      input: {
        capability: "INVESTIGATE",
        message: { text: `What should I know about Alpha? ${MARKERS.founder}` },
        modality: "TEXT",
        subjects: [{ kind: "COMPANY", companyId: world.companyAlpha }],
        ...overrides,
      },
      idempotencyKey: `fw-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return created.run;
  }

  async function events(runId: string) {
    return db.sql<
      { event_type: string; payload: Record<string, unknown> }[]
    >`select event_type, payload from q_runtime.run_events where run_id = ${runId} order by sequence`;
  }

  async function checkpointText(runId: string): Promise<string> {
    const [row] = await db.sql<{ text: string }[]>`select
        coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_blobs where thread_id = ${runId} and blob is not null), '')
        || ' ' || coalesce((select string_agg(checkpoint::text || metadata::text, ' ') from q_runtime.checkpoints where thread_id = ${runId}), '')
        || ' ' || coalesce((select string_agg(convert_from(blob, 'UTF8'), ' ') from q_runtime.checkpoint_writes where thread_id = ${runId}), '') as text`;
    return row?.text ?? "";
  }

  async function shareObjective(world: World): Promise<DisclosurePolicyId> {
    const granted = await world.permissions.policies.grant({
      actor: world.founder.actor,
      resource: { type: "capital_objective", id: world.capitalObjectiveId },
      scopeType: "specifically_shared",
      recipient: { type: "ORGANISATION", id: world.orgApex },
      accessLevel: "view",
      correlationId: CORRELATION(),
    });
    if (granted.policy === null) {
      throw new Error("share expected");
    }
    return granted.policy.id;
  }

  async function setVisibility(
    world: World,
    visibility: string,
  ): Promise<void> {
    await db.sql`update core.companies set marketplace_visibility = ${visibility} where id = ${world.companyAlpha}`;
  }

  const stagesOf = (stored: { payload: Record<string, unknown> }[]) =>
    stored.map((e) => e.payload["stage"]).filter((s) => s !== undefined);

  // -------------------------------------------------------------------------

  it("GOLDEN revoked access after resume: the plan is re-derived and the retrieval never sees the withdrawn scope", async () => {
    const world = await commitWorld();
    try {
      const policyId = await shareObjective(world);
      const first = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world, world.apexAdmin.actor);

      const paused = await first.start({
        actor: world.apexAdmin.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(paused.status).toBe("AWAITING_INPUT");

      // The checkpoint holds a descriptor of the plan (kinds, fingerprint),
      // never the plan's permission and never content.
      const checkpoint = await checkpointText(run.id);
      expect(checkpoint).toContain("COMPANY_CAPITAL_OBJECTIVE");
      expect(checkpoint).not.toContain("canUseForReasoning");
      expect(checkpoint).not.toContain(world.capitalObjectiveId);
      assertNoMarkers(checkpoint);

      // While paused, the founder withdraws the share.
      await world.permissions.policies.revoke({
        actor: world.founder.actor,
        disclosurePolicyId: policyId,
        correlationId: CORRELATION(),
      });

      const retrieval = recordingRetrieval();
      const answer = recordingAnswer();
      const second = orchestrator(world, {
        pausePolicy: alwaysPause,
        retrieval,
        answer,
      });
      const resumed = await second.resume({
        actor: world.apexAdmin.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(resumed.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.apexAdmin.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("MODEL_PROVIDER_UNAVAILABLE");

      expect(retrieval.plans).toHaveLength(1);
      expect(answer.plans).toHaveLength(1);
      const plan = retrieval.plans[0];
      if (plan === undefined) {
        throw new Error("plan expected");
      }
      const kinds = plan.scopes.map((s) => s.kind);
      expect(kinds).toContain("COMPANY_PROFILE");
      expect(kinds).not.toContain("COMPANY_CAPITAL_OBJECTIVE");
      expect(kinds).not.toContain("COMPANY_PRIVATE_FINANCIALS");
      expect(plan.purpose.taskClass).toBe("COUNTERPARTY_COMPANY_QUESTION");
      expect(answer.plans[0]?.fingerprint).toBe(plan.fingerprint);
      assertNoMarkers(JSON.stringify(plan));
      assertNoMarkers(world.logLines.join("\n"));
      assertNoMarkers(JSON.stringify(await events(run.id)));
    } finally {
      await cleanup(world);
    }
  });

  it("fails closed on resume when the subject has left the actor's reach: no retrieval, one public sentence", async () => {
    const world = await commitWorld();
    try {
      const first = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world, world.apexAdmin.actor);
      const paused = await first.start({
        actor: world.apexAdmin.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(paused.status).toBe("AWAITING_INPUT");

      // The company withdraws from the network while the run is paused.
      await setVisibility(world, "organisation_private");

      const retrieval = recordingRetrieval();
      const answer = recordingAnswer();
      const second = orchestrator(world, {
        pausePolicy: alwaysPause,
        retrieval,
        answer,
      });
      const resumed = await second.resume({
        actor: world.apexAdmin.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(resumed.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.apexAdmin.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("POLICY_DENIED");
      expect(retrieval.plans).toHaveLength(0);
      expect(answer.plans).toHaveLength(0);

      const stored = await events(run.id);
      expect(stored.at(-1)?.event_type).toBe("q.run.failed");
      expect(stored.at(-1)?.payload).toMatchObject({
        failure: { code: "NOT_AVAILABLE_IN_CONTEXT", retryable: false },
      });
      expect(stagesOf(stored)).not.toContain("PREPARING_ANALYSIS");
      const text = JSON.stringify(stored);
      assertNoMarkers(text);
      expect(text).not.toMatch(
        /organisation_private|DISCLOSURE|NO_AUTHORISED_CONTEXT/,
      );
      assertNoMarkers(await checkpointText(run.id));
    } finally {
      await cleanup(world);
    }
  });

  it("denies at start, before the seams, when the subject is not in the actor's reach", async () => {
    const world = await commitWorld();
    try {
      const run = await createRun(world, world.apexAdmin.actor);
      await setVisibility(world, "organisation_private");
      const retrieval = recordingRetrieval();
      const answer = recordingAnswer();
      const engine = orchestrator(world, { retrieval, answer });
      const handle = await engine.start({
        actor: world.apexAdmin.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(handle.status).toBe("FAILED");
      const final = await world.service.getRun({
        actor: world.apexAdmin.actor,
        runId: run.id,
      });
      expect(final.run.failureCode).toBe("POLICY_DENIED");
      expect(retrieval.plans).toHaveLength(0);
      expect(answer.plans).toHaveLength(0);
      const stored = await events(run.id);
      expect(stored.map((e) => e.event_type)).toEqual([
        "q.run.started",
        "q.stage.changed",
        "q.run.failed",
      ]);
      expect(stagesOf(stored)).toEqual(["UNDERSTANDING_REQUEST"]);
      expect(await checkpointText(run.id)).not.toContain('AUTHORISED"');
    } finally {
      await cleanup(world);
    }
  });

  it("GOLDEN active organisation switch: the same person cannot resume under another organisation", async () => {
    const world = await commitWorld();
    try {
      const first = orchestrator(world, { pausePolicy: alwaysPause });
      const run = await createRun(world, world.founder.actor, {
        capability: "ANSWER",
      });
      const paused = await first.start({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(paused.status).toBe("AWAITING_INPUT");

      const retrieval = recordingRetrieval();
      const answer = recordingAnswer();
      const second = orchestrator(world, {
        pausePolicy: alwaysPause,
        retrieval,
        answer,
      });
      await expect(
        second.resume({
          actor: world.founderElsewhere,
          runId: run.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QRunNotFoundError);
      expect(retrieval.plans).toHaveLength(0);
      const still = await world.service.getRun({
        actor: world.founder.actor,
        runId: run.id,
      });
      expect(still.run.status).toBe("AWAITING_INPUT");

      // Back in the organisation the run belongs to, the owner is served
      // the owner's plan: intrinsic labels, quoting allowed, no content.
      const resumed = await second.resume({
        actor: world.founder.actor,
        runId: run.id,
        correlationId: CORRELATION(),
      });
      expect(resumed.status).toBe("FAILED");
      const plan = retrieval.plans[0];
      if (plan === undefined) {
        throw new Error("plan expected");
      }
      expect(plan.purpose.taskClass).toBe("OWN_COMPANY_QUESTION");
      expect(plan.actor.organisationId).toBe(world.orgAlpha);
      const objective = plan.scopes.find(
        (s) => s.kind === "COMPANY_CAPITAL_OBJECTIVE",
      );
      expect(objective?.contextLabel).toBe("founder_private");
      expect(objective?.rights.canQuote).toBe(true);
      expect(answer.plans[0]?.planId).toBe(plan.planId);
      assertNoMarkers(JSON.stringify(plan));
      assertNoMarkers(await checkpointText(run.id));
      assertNoMarkers(world.logLines.join("\n"));
    } finally {
      await cleanup(world);
    }
  });
});
