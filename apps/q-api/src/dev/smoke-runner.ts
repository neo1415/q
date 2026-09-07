import { randomUUID } from "node:crypto";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import {
  loadDatabaseConfig,
  resolveDatabaseUrl,
} from "@capital-q/config/database";
import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  Q_COMMUNICATION_PROFILES,
  type QCapability,
  type QCommunicationPreset,
  type QSubjectRef,
  type TenantModelPolicy,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type DatabaseExecutor,
  type DatabaseNotificationListener,
  type RequestDatabase,
  type TransactionManager,
} from "@capital-q/database";
import { createPostgresDocumentQueryPort } from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { createLogger, type Logger } from "@capital-q/observability";
import {
  actorPrincipal,
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import {
  createModelGatewayQAnswer,
  type QAnswerObservation,
  type QAuthorisedContextPort,
} from "@capital-q/model-gateway/q";
import {
  Q_CONVERSATION_SCENARIOS,
  type AuthorisedFact,
  type QConversationScenario,
} from "@capital-q/q-core";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
  type QCheckpointStore,
} from "@capital-q/q-orchestrator";
import {
  createCompanyQSubjectResolver,
  createInProcessQLiveDeltaBus,
  createInvestorOrganisationQSubjectResolver,
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQRetrieval,
  createUnconfiguredQTools,
  neverPause,
  type QActionPort,
  type QAnswerPort,
  type QLiveDeltaBus,
  type QOrchestrator,
  type QRuntimeRepositories,
  type QRuntimeService,
  type QSubjectResolverRegistry,
} from "@capital-q/q-runtime";
import { createQTools } from "@capital-q/q-tools";
import {
  createPostgresQActionRepositories,
  createQActionPort,
  createQActionRegistry,
  createQActionService,
  type QActionService,
} from "@capital-q/q-actions";
import {
  createTestConfirmRequiredAction,
  TEST_CONFIRM_REQUIRED,
} from "@capital-q/q-actions/testing";
import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";

import { createSyntheticStreamAnswer } from "./synthetic-answer.js";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";

import {
  TOOL_SMOKE_MARKERS,
  type QToolScenario,
  type ToolSmokeActor,
} from "./tool-scenarios.js";

/**
 * Developer Q smoke runner (CQ-Q-006 §66-§67; CQ-Q-007 §70-§75). DEV/TEST ONLY.
 *
 * Builds the SAME Q composition as main.ts — real Context Firewall over
 * the real database, real Tool Registry over the real query ports, real
 * Prompt Registry, real Model Gateway with the real provider adapters —
 * for a synthetic world it creates and then removes:
 *
 *   tenant F  Northwind Sensor Systems (founder = organisation_admin),
 *             with an ACTIVE capital objective; private rows carry markers
 *   tenant I  Apex Ventures (investor admin) with an ACTIVE mandate whose
 *             raw narrative carries a marker
 *   tenant N  Beacon Analytics (network_visible) and Beacon Hidden Ltd
 *             (organisation_private, marker)
 *
 * Two things differ from production, and both are composition-level
 * declarations only a developer can make:
 *
 *   1. the answer seam is told the inputs are SYNTHETIC and PUBLIC (they
 *      are: every fact and every row is invented here), so the unreviewed
 *      providers are eligible;
 *   2. the authorised-context port serves fixture facts, filtered by the
 *      knowledge-scope kinds the real firewall plan permits.
 *
 * Nothing here reaches the public API, and nothing here prints a key,
 * a prompt body, a fact, a tool argument, a tool result, or anything but
 * Q's user-visible answer and safe operational metadata.
 */

export type SmokeProviderFilter = "google" | "groq" | undefined;

export type SmokeRunResult = {
  readonly scenarioId: string;
  readonly status: string;
  readonly failureCode: string | null;
  readonly answer: string | null;
  readonly observation: QAnswerObservation | undefined;
  readonly promptBundleVersion: string | null;
  readonly modelPolicyVersion: string | null;
  /** Visible stages recorded on the run, in order. */
  readonly visibleStages: readonly string[];
};

export type SmokeRunInput = {
  readonly scenarioId: string;
  readonly capability: QCapability;
  readonly message: string;
  readonly facts: readonly AuthorisedFact[];
  readonly preset: QCommunicationPreset;
  /** Which synthetic person asks; the founder by default. */
  readonly actor?: ToolSmokeActor | undefined;
};

export type SmokeWorld = {
  readonly run: (input: SmokeRunInput) => Promise<SmokeRunResult>;
  readonly runScenario: (
    scenario: QConversationScenario,
  ) => Promise<SmokeRunResult>;
  readonly runToolScenario: (
    scenario: QToolScenario,
  ) => Promise<SmokeRunResult>;
  readonly configuredProviders: readonly string[];
  /** Registered tools, by version id. */
  readonly tools: readonly string[];
  readonly ids: {
    readonly company: string;
    readonly investorOrganisation: string;
    readonly networkCompany: string;
  };
  readonly runtime: SmokeRuntime;
};

export type SmokeOptions = {
  readonly provider?: SmokeProviderFilter;
  /** Offer the Tool Registry to the model (CQ-Q-007). Default: true. */
  readonly tools?: boolean | undefined;
  /**
   * Replace the model with the synthetic streaming answer (CQ-Q-009): no
   * provider, no key, a labelled synthetic message produced as live
   * deltas. For watching the stream, never for judging Q.
   */
  readonly synthetic?: boolean | undefined;
  /**
   * Compose the Approval Engine with the TEST-ONLY confirm-required action
   * and a proposer for PREPARE_ACTION runs (CQ-Q-008 test seam), so the
   * stream smoke can show the approval flow. Never a real action.
   */
  readonly approval?: boolean | undefined;
  readonly logger?: Logger | undefined;
};

export type SmokePerson = {
  readonly actor: ActorContext;
  readonly authUserId: string;
};

/** The composed runtime, for harnesses that drive it over HTTP (the stream smoke). */
export type SmokeRuntime = {
  readonly service: QRuntimeService;
  readonly orchestrator: QOrchestrator;
  readonly repositories: QRuntimeRepositories;
  readonly subjects: QSubjectResolverRegistry;
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly listen: DatabaseNotificationListener;
  readonly deltas: QLiveDeltaBus;
  readonly logger: Logger;
  readonly people: {
    readonly founder: SmokePerson;
    readonly investor: SmokePerson;
  };
  /** Present when `approval` was requested. */
  readonly actions:
    | { readonly service: QActionService; readonly executions: () => number }
    | undefined;
};

/** Facts the plan permits: filtered by the knowledge-scope kinds the real firewall allowed. */
function fixtureContext(
  current: () => readonly AuthorisedFact[],
  subject: () => string,
): QAuthorisedContextPort {
  return {
    assemble: (request) => {
      const kinds = new Set(request.plan.scopes.map((s) => s.kind as string));
      const facts = current().filter((f) => kinds.has(f.scope));
      return Promise.resolve({ facts, subjectDescription: subject() });
    },
  };
}

type Person = SmokePerson;

export async function withSmokeWorld(
  options: SmokeOptions,
  work: (world: SmokeWorld) => Promise<void>,
): Promise<void> {
  const config = parseQApiConfig(process.env);
  const databaseConfig = loadDatabaseConfig();
  const database: RequestDatabase = createRequestDatabaseClient(databaseConfig);
  const logger =
    options.logger ??
    createLogger(
      { serviceName: "q-smoke", environment: "local" },
      { level: "warn" },
    );
  const stores: QCheckpointStore[] = [];
  const ids = {
    tenantF: randomUUID(),
    tenantI: randomUUID(),
    tenantN: randomUUID(),
    organisation: randomUUID(),
    investorOrg: randomUUID(),
    beaconOrg: randomUUID(),
    hiddenOrg: randomUUID(),
    company: randomUUID(),
    capitalObjective: randomUUID(),
    investorOrganisation: randomUUID(),
    mandate: randomUUID(),
    networkCompany: randomUUID(),
    hiddenCompany: randomUUID(),
  };
  const authUsers: string[] = [];
  let currentFacts: readonly AuthorisedFact[] = [];
  let currentSubject = "";

  try {
    // --- synthetic world ------------------------------------------------------
    const people = await database.transactions.run(async (tx) => {
      const tenant = async (id: string, name: string) => {
        await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
      };
      const organisation = async (
        id: string,
        tenantId: string,
        type: string,
        name: string,
      ) => {
        await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${id}, ${tenantId}, ${type}, ${name}, ${`qs-${id.slice(0, 8)}`})`;
        await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
      };
      const admin = async (
        tenantId: string,
        organisationId: string,
      ): Promise<Person> => {
        const authUserId = randomUUID();
        authUsers.push(authUserId);
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
          select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
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
      };

      await tenant(ids.tenantF, "Q Smoke Founder (synthetic)");
      await tenant(ids.tenantI, "Q Smoke Investor (synthetic)");
      await tenant(ids.tenantN, "Q Smoke Network (synthetic)");
      await organisation(
        ids.organisation,
        ids.tenantF,
        "company",
        "Northwind Sensor Systems (synthetic)",
      );
      await organisation(
        ids.investorOrg,
        ids.tenantI,
        "investment_firm",
        "Apex Ventures (synthetic)",
      );
      await organisation(
        ids.beaconOrg,
        ids.tenantN,
        "company",
        "Beacon Analytics (synthetic)",
      );
      await organisation(
        ids.hiddenOrg,
        ids.tenantN,
        "company",
        "Beacon Hidden (synthetic)",
      );

      const founder = await admin(ids.tenantF, ids.organisation);
      const investor = await admin(ids.tenantI, ids.investorOrg);

      await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description, short_description, current_stage_code, headquarters_country, headquarters_city, founded_date)
        values (${ids.company}, ${ids.tenantF}, ${ids.organisation}, 'Northwind Sensor Systems Ltd', ${`northwind-${ids.company.slice(0, 8)}`},
                ${`Synthetic test company: vibration sensors and monitoring software for mid-sized manufacturing plants. Internal note: ${TOOL_SMOKE_MARKERS.founderPrivate}`},
                'Vibration sensors for manufacturing plants (synthetic).', 'seed', 'GB', 'Manchester', '2024-03-01'::date)`;
      await tx.sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id, use_of_funds_summary, target_stage, instrument_code)
        values (${ids.capitalObjective}, ${ids.tenantF}, ${ids.company}, 2000000, 'GBP', ${founder.actor.userId}, 'Synthetic: sales hires and expansion.', 'seed', 'safe')`;

      await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investorOrganisation}, ${ids.tenantI}, ${ids.investorOrg}, 'VC', 'Apex Ventures')`;
      await tx.sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, raw_mandate_text, created_by_user_id, min_cheque, max_cheque, currency_code, min_stage_code, max_stage_code, discovery_mode)
        values (${ids.mandate}, ${ids.tenantI}, ${ids.investorOrganisation}, 'Seed thesis (synthetic)', 'ACTIVE', now(),
                ${`We back seed-stage industrial software. Private note: ${TOOL_SMOKE_MARKERS.investorPrivate}`},
                ${investor.actor.userId}, 250000, 2000000, 'USD', 'pre_seed', 'seed', 'BALANCED')`;
      await tx.sql`insert into core.investor_mandate_constraints (id, tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
        values (${randomUUID()}, ${ids.tenantI}, ${ids.mandate}, 'geography.country', 'IN', ${tx.sql.json({ kind: "codes", values: ["GB", "DE"] })}, 'MUST', false)`;

      await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description, marketplace_visibility, current_stage_code, headquarters_country, headquarters_city)
        values (${ids.networkCompany}, ${ids.tenantN}, ${ids.beaconOrg}, 'Beacon Analytics', ${`beacon-${ids.networkCompany.slice(0, 8)}`},
                'Synthetic: predictive maintenance analytics for factories.', 'network_visible', 'series_a', 'DE', 'Berlin')`;
      await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description)
        values (${ids.hiddenCompany}, ${ids.tenantN}, ${ids.hiddenOrg}, 'Beacon Hidden Ltd', ${`hidden-${ids.hiddenCompany.slice(0, 8)}`},
                ${`Synthetic private company. ${TOOL_SMOKE_MARKERS.crossTenant}`})`;

      return { founder, investor };
    });

    // --- composition (mirrors apps/q-api/src/main.ts) -------------------------
    const sql = database.sql;
    const companies = createPostgresCompanyQueryPort({ sql });
    const investors = createPostgresInvestorOrganisationQueryPort({ sql });
    const mandates = createPostgresInvestorMandateQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const documents = createPostgresDocumentQueryPort({ sql });
    const relationshipRepository = createPostgresRelationshipRepository();
    const relationshipEventRepository =
      createPostgresRelationshipEventRepository();
    const relationships: RelationshipQueryPort = {
      getById: (id) => relationshipRepository.findById(sql, id),
      findByParties: (companyId, investorOrganisationId) =>
        relationshipRepository.findByParties(
          sql,
          companyId,
          investorOrganisationId,
        ),
      listEvents: (relationshipId, page = {}) =>
        relationshipEventRepository.listByRelationship(sql, relationshipId, {
          afterSequence: page.afterSequence,
          limit: page.limit ?? 100,
        }),
      getEventById: (id) => relationshipEventRepository.findById(sql, id),
    };
    const authorization = createAuthorizationService(
      createPostgresAuthorizationPolicySource({ sql }),
    );
    const disclosurePorts = {
      companies,
      investors,
      mandates,
      capital,
      relationships,
    };
    const disclosureResolvers = createDisclosureResourceResolverRegistry(
      createDefaultDisclosureResolvers(disclosurePorts),
    );
    const relationshipParties =
      createRelationshipPartyResolver(disclosurePorts);
    const disclosure = createDisclosureAccessService({
      sql,
      policies: createPostgresDisclosurePolicyRepository(),
      resolvers: disclosureResolvers,
      relationshipParties,
      clock: systemDisclosureClock,
    });
    const subjectView = {
      canView: async (
        a: ActorContext,
        resource: { type: "company" | "investor_organisation"; id: string },
      ) =>
        (
          await disclosure.canDisclose({
            principal: actorPrincipal(a),
            resource,
            requestedAccess: "view",
          })
        ).outcome === "ALLOW",
    };
    const subjects = createQSubjectResolverRegistry([
      createCompanyQSubjectResolver(companies, subjectView),
      createInvestorOrganisationQSubjectResolver(investors, subjectView),
    ]);
    const firewall = createContextFirewall({
      authorization,
      disclosure,
      resolvers: disclosureResolvers,
      relationshipParties,
      documents,
      capital,
      clock: systemDisclosureClock,
      logger,
    });
    const qTools = createQTools({
      ports: {
        companies,
        capital,
        mandates,
        investors,
        authorization,
        disclosure,
      },
      logger,
    });

    const secrets = config.secrets.modelProviders;
    const providers: ModelProvider[] = [];
    if (secrets.google !== undefined && options.provider !== "groq") {
      providers.push(
        createGoogleModelProvider({ apiKey: secrets.google.reveal() }),
      );
    }
    if (secrets.groq !== undefined && options.provider !== "google") {
      providers.push(
        createGroqModelProvider({ apiKey: secrets.groq.reveal() }),
      );
    }
    const tenantPolicy: TenantModelPolicy | undefined =
      options.provider === undefined
        ? undefined
        : { deniedProviderCodes: [], allowedProviderCodes: [options.provider] };
    const gateway = createModelGateway({
      catalog: createPostgresModelCatalog({ sql }),
      registry: createModelProviderRegistry(providers),
      usage: createPostgresModelUsageRepository({ sql }),
      health: createProcessLocalProviderHealth(),
      logger,
    });

    const repositories = createPostgresQRuntimeRepositories();
    const runtimeDependencies = {
      sql,
      transactions: database.transactions,
      subjects,
      securityEvents: createPostgresSecurityEventWriter({ sql }),
      logger,
    };
    const service: QRuntimeService = createQRuntimeService({
      ...runtimeDependencies,
      repositories,
    });
    const checkpoints = createPostgresQCheckpointStore({
      connectionString: resolveDatabaseUrl(databaseConfig, "REQUEST"),
    });
    stores.push(checkpoints);

    let currentPreset: QCommunicationPreset = "BALANCED";
    const answer = createModelGatewayQAnswer({
      gateway,
      repositories,
      sql,
      transactions: database.transactions,
      context: fixtureContext(
        () => currentFacts,
        () => currentSubject,
      ),
      tools: options.tools === false ? createUnconfiguredQTools() : qTools.port,
      // Dev-only declaration: every input is synthetic fixture data.
      sensitivity: { kind: "DECLARED_SYNTHETIC", sensitivity: "PUBLIC" },
      communication: {
        profileFor: () =>
          Promise.resolve(Q_COMMUNICATION_PROFILES[currentPreset]),
      },
      tenantPolicy,
      logger,
    });
    const deltas = createInProcessQLiveDeltaBus();
    const answerPort: QAnswerPort =
      options.synthetic === true
        ? createSyntheticStreamAnswer({
            sql,
            transactions: database.transactions,
            repositories,
            deltas,
          })
        : answer;
    let actions:
      | { readonly service: QActionService; readonly executions: () => number }
      | undefined;
    let actionPort: QActionPort | undefined;
    if (options.approval === true) {
      const testAction = createTestConfirmRequiredAction();
      const actionService = createQActionService({
        sql,
        transactions: database.transactions,
        repositories: createPostgresQActionRepositories(),
        runtime: repositories,
        registry: createQActionRegistry([testAction.definition]),
        authorization,
        audit: createPostgresMaterialActionAuditWriter(),
        logger,
      });
      actions = {
        service: actionService,
        executions: () => testAction.state.executions(),
      };
      actionPort = createQActionPort({
        service: actionService,
        proposer: {
          propose: (context) =>
            Promise.resolve(
              context.capability === "PREPARE_ACTION"
                ? {
                    actionType: TEST_CONFIRM_REQUIRED,
                    payload: {
                      companyId: ids.company,
                      note: "Synthetic note for the stream smoke.",
                    },
                  }
                : null,
            ),
        },
        logger,
      });
    }
    const orchestrator = createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        ...runtimeDependencies,
        repositories,
      }),
      cancelRun: service.cancelRun,
      checkpoints,
      firewall,
      retrieval: createUnconfiguredQRetrieval(),
      answer: answerPort,
      ...(actionPort === undefined ? {} : { actions: actionPort }),
      pausePolicy: neverPause,
      logger,
    });

    const subjectsFor = (actor: ToolSmokeActor): readonly QSubjectRef[] =>
      actor === "INVESTOR"
        ? [
            {
              kind: "INVESTOR_ORGANISATION",
              investorOrganisationId: ids.investorOrganisation,
            },
          ]
        : [{ kind: "COMPANY", companyId: ids.company }];

    const run: SmokeWorld["run"] = async (input) => {
      const who = input.actor ?? "FOUNDER";
      const person = who === "INVESTOR" ? people.investor : people.founder;
      currentFacts = input.facts;
      currentPreset = input.preset;
      currentSubject =
        who === "INVESTOR"
          ? "the person's own investor organisation (Apex Ventures, a synthetic test investor)"
          : "the person's own company (Northwind Sensor Systems Ltd, a synthetic test company)";
      const correlationId = `cor_${randomUUID()}`;
      const created = await service.createRun({
        actor: person.actor,
        input: {
          capability: input.capability,
          message: { text: input.message },
          modality: "TEXT",
          subjects: [...subjectsFor(who)],
        },
        idempotencyKey: `smoke-${randomUUID()}`,
        correlationId,
      });
      await orchestrator.start({
        actor: person.actor,
        runId: created.run.id,
        correlationId,
      });
      const final = await service.getRun({
        actor: person.actor,
        runId: created.run.id,
      });
      const reply = final.messages.find((m) => m.role === "Q");
      const events = await repositories.runEvents.listForRun(
        sql,
        person.actor.tenantId,
        created.run.id,
        { limit: 200 },
      );
      return {
        scenarioId: input.scenarioId,
        status: final.run.status,
        failureCode: final.run.failureCode,
        answer: reply?.content ?? null,
        observation: answer.lastObservation(),
        promptBundleVersion: final.run.promptBundleVersion,
        modelPolicyVersion: final.run.modelPolicyVersion,
        visibleStages: events
          .map((e) => e.visibleStage)
          .filter((s): s is NonNullable<typeof s> => s !== null),
      };
    };

    const fill = (message: string): string =>
      message
        .replaceAll("{{companyId}}", ids.company)
        .replaceAll("{{investorOrganisationId}}", ids.investorOrganisation)
        .replaceAll("{{unknownId}}", "00000000-0000-4000-8000-00000000dead");

    await work({
      run,
      runScenario: (scenario) =>
        run({
          scenarioId: scenario.id,
          capability: scenario.capability,
          message: scenario.message,
          facts: scenario.facts,
          preset: scenario.preset,
        }),
      runToolScenario: (scenario) =>
        run({
          scenarioId: scenario.id,
          capability: scenario.capability,
          message: fill(scenario.message),
          facts: [],
          preset: scenario.preset,
          actor: scenario.actor,
        }),
      configuredProviders: providers.map((p) => p.code),
      tools: qTools.registry.list().map((r) => r.versionId),
      ids: {
        company: ids.company,
        investorOrganisation: ids.investorOrganisation,
        networkCompany: ids.networkCompany,
      },
      runtime: {
        service,
        orchestrator,
        repositories,
        subjects,
        sql,
        transactions: database.transactions,
        listen: database.listen,
        deltas,
        logger,
        people,
        actions,
      },
    });
  } finally {
    for (const store of stores) {
      await store.close();
    }
    await cleanup(database, {
      tenants: [ids.tenantF, ids.tenantI, ids.tenantN],
      authUsers,
    }).catch((error: unknown) => {
      logger.error({ err: error }, "q smoke cleanup failed");
    });
    await database.close();
  }
}

async function cleanup(
  database: RequestDatabase,
  ids: {
    readonly tenants: readonly string[];
    readonly authUsers: readonly string[];
  },
): Promise<void> {
  await database.transactions.run(async (tx) => {
    const tenants = [...ids.tenants];
    const runs = await tx.sql<
      { id: string }[]
    >`select id from q_runtime.runs where tenant_id = any(${tenants}::uuid[])`;
    for (const run of runs) {
      await tx.sql`delete from q_runtime.checkpoint_writes where thread_id = ${run.id}`;
      await tx.sql`delete from q_runtime.checkpoint_blobs where thread_id = ${run.id}`;
      await tx.sql`delete from q_runtime.checkpoints where thread_id = ${run.id}`;
    }
    await tx.sql`alter table ai_ops.model_usage disable trigger model_usage_append_only`;
    await tx.sql`delete from ai_ops.model_usage where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`alter table ai_ops.model_usage enable trigger model_usage_append_only`;
    await tx.sql`delete from q_runtime.approvals where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from q_runtime.actions where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from audit.material_actions where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from q_runtime.message_creation_requests where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from q_runtime.conversation_messages where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`alter table q_runtime.run_events disable trigger run_events_append_only`;
    await tx.sql`delete from q_runtime.run_events where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`alter table q_runtime.run_events enable trigger run_events_append_only`;
    await tx.sql`delete from q_runtime.runs where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from q_runtime.conversations where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from audit.security_events where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.investor_mandate_constraints where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.investor_mandates where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.investor_organisations where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.capital_objective_events where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.capital_objectives where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from core.companies where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id = any(${tenants}::uuid[]))`;
    await tx.sql`delete from identity.organisation_memberships where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from identity.tenant_organisations where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from identity.organisations where tenant_id = any(${tenants}::uuid[])`;
    await tx.sql`delete from identity.tenants where id = any(${tenants}::uuid[])`;
    for (const authUserId of ids.authUsers) {
      await tx.sql`delete from identity.user_profiles where auth_user_id = ${authUserId}`;
      await tx.sql`delete from auth.users where id = ${authUserId}`;
    }
  });
}

export type Check = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string | undefined;
};

/** Deterministic checks a fixture declares; prose quality is reviewed by a person. */
export function checkExpectations(
  scenario: QConversationScenario,
  result: SmokeRunResult,
): Check[] {
  const checks: Check[] = [];
  const answer = (result.answer ?? "").toLowerCase();
  const analyst = result.observation?.result;
  checks.push({
    name: "completed",
    ok: result.status === "COMPLETED",
    detail: result.failureCode ?? undefined,
  });
  for (const phrase of scenario.expected.requiredPhrases ?? []) {
    checks.push({
      name: `mentions "${phrase}"`,
      ok: answer.includes(phrase.toLowerCase()),
    });
  }
  for (const phrase of scenario.expected.prohibitedPhrases ?? []) {
    checks.push({
      name: `avoids "${phrase}"`,
      ok: !answer.includes(phrase.toLowerCase()),
    });
  }
  if (scenario.expected.responseShape !== undefined) {
    checks.push({
      name: `shape ${scenario.expected.responseShape}`,
      ok: analyst?.responseShape === scenario.expected.responseShape,
      detail: analyst?.responseShape,
    });
  }
  if (scenario.expected.insufficientEvidence !== undefined) {
    checks.push({
      name: `insufficientEvidence=${scenario.expected.insufficientEvidence}`,
      ok:
        analyst?.insufficientEvidence ===
        scenario.expected.insufficientEvidence,
    });
  }
  if (scenario.expected.expectContradiction === true) {
    checks.push({
      name: "contradiction identified",
      ok: (analyst?.contradictions.length ?? 0) > 0,
    });
  }
  if (scenario.expected.expectRecommendation === true) {
    checks.push({
      name: "recommendation given",
      ok:
        analyst?.recommendation !== null &&
        analyst?.recommendation !== undefined,
    });
  }
  if (scenario.expected.maxAnswerCharacters !== undefined) {
    checks.push({
      name: `answer ≤ ${scenario.expected.maxAnswerCharacters} chars`,
      ok: (result.answer?.length ?? 0) <= scenario.expected.maxAnswerCharacters,
      detail: String(result.answer?.length ?? 0),
    });
  }
  return checks;
}

/** Deterministic checks for a tool scenario: which tools ran, how, and what the answer must (not) say. */
export function checkToolExpectations(
  scenario: QToolScenario,
  result: SmokeRunResult,
): Check[] {
  const checks: Check[] = [];
  const answer = (result.answer ?? "").toLowerCase();
  const calls = result.observation?.toolCalls ?? [];
  checks.push({
    name: "completed",
    ok: result.status === "COMPLETED",
    detail: result.failureCode ?? undefined,
  });
  for (const expected of scenario.expected.toolCalls ?? []) {
    checks.push({
      name: `${expected.providerName} ${expected.status}`,
      ok: calls.some(
        (c) =>
          c.providerName === expected.providerName &&
          c.status === expected.status,
      ),
      detail:
        calls.map((c) => `${c.providerName}:${c.status}`).join(",") ||
        "no tool calls",
    });
  }
  for (const forbidden of scenario.expected.forbiddenTools ?? []) {
    checks.push({
      name: `never calls ${forbidden}`,
      ok: !calls.some((c) => c.providerName === forbidden),
    });
  }
  for (const phrase of scenario.expected.requiredPhrases ?? []) {
    checks.push({
      name: `mentions "${phrase}"`,
      ok: answer.includes(phrase.toLowerCase()),
    });
  }
  for (const phrase of scenario.expected.prohibitedPhrases ?? []) {
    checks.push({
      name: `avoids "${phrase}"`,
      ok: !answer.includes(phrase.toLowerCase()),
    });
  }
  return checks;
}

export const SMOKE_SCENARIOS = Q_CONVERSATION_SCENARIOS;
