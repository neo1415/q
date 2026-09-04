import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ContractValidationError,
  createEventRegistry,
  type CorrelationId,
  type OnboardingResponseInput,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createLogger } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  UserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import { ONBOARDING_EVENTS } from "../src/events/index.js";
import {
  createCompanyOnboardingSubjectResolver,
  createOnboardingService,
  OnboardingDefinitionConflictError,
  OnboardingDefinitionInvalidError,
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  OnboardingSessionVersionConflictError,
  OnboardingSubjectNotFoundError,
  type OnboardingActor,
  type OnboardingService,
  type OnboardingSessionId,
  type OnboardingWriteTargetHandler,
} from "../src/index.js";
import {
  SYNTHETIC_FOUNDER_MANIFEST,
  SYNTHETIC_FOUNDER_MANIFEST_V2,
  TEST_WRITE_TARGET,
} from "./synthetic-manifest.js";

/**
 * The onboarding runtime against the real local database: publication and
 * immutability, version pinning, start / resume / idempotency, one-way
 * context binding, validation, branching, skip, back, revision history,
 * optimistic concurrency, write-target atomicity, completion, suggestions,
 * ownership boundaries and privacy of raw answers. Every test runs in one
 * rolled-back transaction with a savepoint-backed TransactionManager.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const RESPONSE_MARKER = "PRIVATE-ONBOARDING-RESPONSE-DO-NOT-EMIT";
const SUGGESTION_MARKER = "PRIVATE-ONBOARDING-SUGGESTION-DO-NOT-EMIT";

class Rollback extends Error {}

const registry = createEventRegistry([...ONBOARDING_EVENTS]);

const select = (optionKey: string): OnboardingResponseInput => ({
  value: { type: "SINGLE_SELECT", optionKey },
});
const multi = (...optionKeys: string[]): OnboardingResponseInput => ({
  value: { type: "MULTI_SELECT", optionKeys },
});
const text = (value: string): OnboardingResponseInput => ({
  value: { type: "TEXT", text: value },
});
const range = (value: string): OnboardingResponseInput => ({
  value: { type: "RANGE", value },
});
const confirm = (): OnboardingResponseInput => ({
  value: { type: "CONFIRMATION", confirmed: true },
});

type World = {
  readonly tx: TransactionContext;
  readonly service: OnboardingService;
  readonly logs: string[];
  readonly echo: string[];
  readonly tenantA: string;
  readonly adminA: OnboardingActor;
  readonly memberA: OnboardingActor;
  readonly adminC: OnboardingActor;
  readonly newcomer: OnboardingActor;
  readonly companyA: string;
  readonly companyA2: string;
  readonly companyC: string;
  readonly build: (options?: {
    readonly writeTargets?: readonly OnboardingWriteTargetHandler[];
  }) => OnboardingService;
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

describe("@capital-q/onboarding against local PostgreSQL", () => {
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
      values (${id}, ${tenantId}, 'company', ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertPerson(tx: TransactionContext) {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const principal: AuthenticatedPrincipal = {
      authUserId: AuthUserIdSchema.parse(authUserId),
    };
    return {
      principal,
      userId: profile.id,
    };
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<OnboardingActor> {
    const person = await insertPerson(tx);
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${person.userId})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${person.userId}, ${membershipId})`;
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      {
        principal: person.principal,
      },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return { userId: resolution.context.userId, context: resolution.context };
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`c-${id.slice(0, 8)}`})`;
    return id;
  }

  async function seedWorld(tx: TransactionContext): Promise<World> {
    const tenantA = await insertTenant(tx, "Onboarding Tenant A");
    const tenantC = await insertTenant(tx, "Onboarding Tenant C");
    const orgA = await insertOrganisation(tx, tenantA, "Alpha");
    const orgC = await insertOrganisation(tx, tenantC, "Gamma");
    const adminA = await insertMember(tx, tenantA, orgA, "organisation_admin");
    const memberA = await insertMember(
      tx,
      tenantA,
      orgA,
      "organisation_member",
    );
    const adminC = await insertMember(tx, tenantC, orgC, "organisation_admin");
    const newcomerPerson = await insertPerson(tx);
    const newcomer: OnboardingActor = {
      userId: UserIdSchema.parse(newcomerPerson.userId),
      context: null,
    };
    const companyA = await insertCompany(tx, tenantA, orgA, "Alpha Rails");
    const companyA2 = await insertCompany(tx, tenantA, orgA, "Alpha Two");
    const companyC = await insertCompany(tx, tenantC, orgC, "Gamma Co");
    await tx.sql`create temporary table if not exists onboarding_test_echo (session_id uuid, step_key text, payload text) on commit drop`;
    await tx.sql`delete from onboarding_test_echo`;

    const logs: string[] = [];
    const logger = createLogger(
      { serviceName: "test", environment: "test" },
      {
        level: "debug",
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logs.push(chunk.toString("utf8"));
            callback();
          },
        }),
      },
    );
    const echo: string[] = [];
    const echoHandler: OnboardingWriteTargetHandler = {
      targetKey: TEST_WRITE_TARGET,
      apply: async (context, response) => {
        echo.push(response.stepKey);
        await context.tx
          .sql`insert into onboarding_test_echo (session_id, step_key, payload)
          values (${context.session.id}, ${response.stepKey}, ${response.rawText ?? "-"})`;
      },
    };
    const build = (
      options: {
        readonly writeTargets?: readonly OnboardingWriteTargetHandler[];
      } = {},
    ) =>
      createOnboardingService({
        sql: tx.sql,
        transactions: nestedTransactions(tx),
        outbox: createOutboxWriter({ registry }),
        subjectResolvers: [
          createCompanyOnboardingSubjectResolver(
            createPostgresCompanyQueryPort({ sql: tx.sql }),
          ),
        ],
        writeTargets: options.writeTargets ?? [echoHandler],
        logger,
      });
    const service = build();
    await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST);
    return {
      tx,
      service,
      logs,
      echo,
      tenantA,
      adminA,
      memberA,
      adminC,
      newcomer,
      companyA,
      companyA2,
      companyC,
      build,
    };
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(await seedWorld(tx));
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

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  async function start(
    world: World,
    actor: OnboardingActor,
    subject?: { subjectType: "COMPANY"; subjectId: string },
  ) {
    const result = await world.service.runtime.startSession({
      actor,
      journeyType: "founder",
      subject,
      idempotencyKey: randomUUID(),
      correlationId: CORRELATION(),
    });
    return result;
  }

  async function submit(
    world: World,
    actor: OnboardingActor,
    sessionId: string,
    stepKey: string,
    response: OnboardingResponseInput,
    version: number,
    key = randomUUID(),
  ) {
    return world.service.runtime.submitResponse({
      actor,
      sessionId: sessionId as OnboardingSessionId,
      stepKey,
      response,
      expectedSessionVersion: version,
      idempotencyKey: key,
      correlationId: CORRELATION(),
    });
  }

  // -------------------------------------------------------------------------
  // Publication and versioning
  // -------------------------------------------------------------------------

  it("publishes a validated manifest idempotently, conflicts on a different manifest and freezes the version (§163-164, §204)", async () => {
    await withWorld(async ({ tx, service }) => {
      const first = await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST);
      const again = await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST);
      expect(again.version.id).toBe(first.version.id);
      expect(first.version.publishedAt).not.toBeNull();
      expect(first.steps.map((s) => s.stepKey)).toEqual([
        "intent",
        "sectors",
        "name",
        "raise_amount",
        "notes",
        "docs",
        "confirm",
      ]);
      await expect(
        service.publisher.publish({
          ...SYNTHETIC_FOUNDER_MANIFEST,
          name: "Renamed but same version",
        }),
      ).rejects.toBeInstanceOf(OnboardingDefinitionConflictError);
      await expect(
        service.publisher.publish({ ...SYNTHETIC_FOUNDER_MANIFEST, steps: [] }),
      ).rejects.toBeInstanceOf(OnboardingDefinitionInvalidError);
      await expect(
        tx.sql.savepoint(
          (s) =>
            s`update onboarding.steps set required = false where definition_version_id = ${first.version.id}`,
        ),
      ).rejects.toThrow(/immutable/);
      const v2 = await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST_V2);
      expect(v2.version.version).toBe(2);
      const [v1Again] = await tx.sql<
        { published_at: Date }[]
      >`select published_at from onboarding.definition_versions where id = ${first.version.id}`;
      expect(v1Again?.published_at).toBeInstanceOf(Date);
    });
  });

  it("pins sessions to their definition version: A → v1, publish v2, A → v1, B → v2 (§23-24, §205)", async () => {
    await withWorld(async (world) => {
      const { service, adminA, memberA } = world;
      const a = await start(world, adminA);
      expect(a.created).toBe(true);
      expect(a.view.session.definitionVersion).toBe(1);
      await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST_V2);
      const aAgain = await service.runtime.getSession({
        actor: adminA,
        sessionId: a.view.session.id as OnboardingSessionId,
      });
      expect(aAgain.session.definitionVersion).toBe(1);
      expect(aAgain.session.definitionVersionId).toBe(
        a.view.session.definitionVersionId,
      );
      expect(aAgain.progress.eligibleSteps.map((s) => s.stepKey)).not.toContain(
        "website",
      );
      const b = await start(world, memberA);
      expect(b.view.session.definitionVersion).toBe(2);
      expect(b.view.progress.eligibleSteps.map((s) => s.stepKey)).toContain(
        "website",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Start / resume / bootstrap / binding
  // -------------------------------------------------------------------------

  it("a newcomer without any organisation starts a bootstrap session and resumes it (§60-61, §74, §125-126, §206)", async () => {
    await withWorld(async (world) => {
      const { tx, service, newcomer } = world;
      const key = randomUUID();
      const first = await service.runtime.startSession({
        actor: newcomer,
        journeyType: "founder",
        idempotencyKey: key,
        correlationId: CORRELATION(),
      });
      expect(first.created).toBe(true);
      expect(first.view.session).toMatchObject({
        status: "ACTIVE",
        subject: null,
        currentStepKey: "intent",
        version: 1,
      });
      expect(first.view.currentStep?.stepKey).toBe("intent");
      const [row] = await tx.sql<
        { tenant_id: string | null; organisation_id: string | null }[]
      >`
        select tenant_id, organisation_id from onboarding.sessions where id = ${first.view.session.id}`;
      expect(row).toEqual({ tenant_id: null, organisation_id: null });

      const replay = await service.runtime.startSession({
        actor: newcomer,
        journeyType: "founder",
        idempotencyKey: key,
        correlationId: CORRELATION(),
      });
      expect(replay).toMatchObject({ created: false });
      expect(replay.view.session.id).toBe(first.view.session.id);
      const resumed = await start(world, newcomer);
      expect(resumed.created).toBe(false);
      expect(resumed.view.session.id).toBe(first.view.session.id);
      await expect(
        service.runtime.startSession({
          actor: newcomer,
          journeyType: "founder",
          subject: { subjectType: "COMPANY", subjectId: randomUUID() },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OnboardingMutationConflictError);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.sessions where user_id = ${newcomer.userId}`,
        ),
      ).toBe(1);
      const [event] = await tx.sql<
        { payload: { data: unknown; tenantId?: string } }[]
      >`
        select payload from events.outbox where event_type = 'onboarding.session.started' and payload -> 'data' ->> 'sessionId' = ${first.view.session.id}`;
      expect(event?.payload.data).toEqual({
        sessionId: first.view.session.id,
        journeyType: "founder",
        definitionVersionId: first.view.session.definitionVersionId,
      });
      expect(event?.payload.tenantId).toBeUndefined();
    });
  });

  it("binds context one way: unbound → Company A, idempotent, never Company A2 or a foreign company (§62-65, §208)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA, companyA, companyA2, companyC, tenantA } =
        world;
      const { view } = await start(world, adminA);
      const sessionId = view.session.id as OnboardingSessionId;
      const bound = await service.internal.bindSessionContext({
        actor: adminA,
        sessionId,
        subject: { subjectType: "COMPANY", subjectId: companyA },
      });
      expect(bound).toMatchObject({
        tenantId: tenantA,
        organisationId: adminA.context?.organisationId,
        subject: { subjectType: "COMPANY", subjectId: companyA },
        version: 2,
      });
      const again = await service.internal.bindSessionContext({
        actor: adminA,
        sessionId,
        subject: { subjectType: "COMPANY", subjectId: companyA },
      });
      expect(again.version).toBe(2);
      await expect(
        service.internal.bindSessionContext({
          actor: adminA,
          sessionId,
          subject: { subjectType: "COMPANY", subjectId: companyA2 },
        }),
      ).rejects.toMatchObject({ reason: "SUBJECT_ALREADY_BOUND" });
      await expect(
        service.internal.bindSessionContext({
          actor: adminA,
          sessionId,
          subject: { subjectType: "COMPANY", subjectId: companyC },
        }),
      ).rejects.toBeInstanceOf(OnboardingSubjectNotFoundError);
      // Even a raw rebind is refused by the database.
      await expect(
        tx.sql.savepoint(
          (s) =>
            s`update onboarding.sessions set subject_id = ${companyA2} where id = ${sessionId}`,
        ),
      ).rejects.toThrow(/cannot change subject/);
      // A bound start for the same company resumes the bound session; a foreign company is not found.
      const resumed = await start(world, adminA, {
        subjectType: "COMPANY",
        subjectId: companyA,
      });
      expect(resumed.created).toBe(false);
      expect(resumed.view.session.id).toBe(sessionId);
      await expect(
        start(world, adminA, { subjectType: "COMPANY", subjectId: companyC }),
      ).rejects.toBeInstanceOf(OnboardingSubjectNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // Responses, branching, skip, back, revision, concurrency, idempotency
  // -------------------------------------------------------------------------

  it("validates against the pinned step and refuses out-of-path or unknown steps (§132-133, §210)", async () => {
    await withWorld(async (world) => {
      const { adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      await expect(
        submit(world, adminA, id, "intent", select("maybe"), 1),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        submit(world, adminA, id, "intent", text("raising"), 1),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        submit(world, adminA, id, "raise_amount", range("5"), 1),
      ).rejects.toMatchObject({ reason: "STEP_NOT_ELIGIBLE" });
      await expect(
        submit(world, adminA, id, "ghost", select("x"), 1),
      ).rejects.toMatchObject({ reason: "STEP_NOT_ELIGIBLE" });
      await expect(
        submit(world, adminA, id, "intent", select("raising_now"), 2),
      ).rejects.toBeInstanceOf(OnboardingSessionVersionConflictError);
    });
  });

  it("branching changes the active path, revisions keep history, and the delta names what changed (§83-88, §213-216)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      let v = await submit(
        world,
        adminA,
        id,
        "intent",
        select("raising_now"),
        1,
      );
      expect(v.progress.eligibleSteps.map((s) => s.stepKey)).toContain(
        "raise_amount",
      );
      expect(v.session.currentStepKey).toBe("sectors");
      expect(v.pathChanges).toEqual({
        becameEligibleStepKeys: ["raise_amount"],
        becameIneligibleStepKeys: [],
      });
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("fintech"),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "name",
        text(`Alpha Rails ${RESPONSE_MARKER}`),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "raise_amount",
        range("5000000"),
        v.session.version,
      );
      expect(v.session.currentStepKey).toBe("notes");
      expect(v.progress.completedEligibleStepCount).toBe(4);

      // Back to intent, revise: raise_amount falls off the path; its response is history.
      v = await service.runtime.goBack({
        actor: adminA,
        sessionId: id as OnboardingSessionId,
        expectedSessionVersion: v.session.version,
        targetStepKey: "intent",
      });
      expect(v.session.currentStepKey).toBe("intent");
      expect(v.currentStep?.currentResponse?.value).toEqual({
        type: "SINGLE_SELECT",
        optionKey: "raising_now",
      });
      const before = await tx.sql<
        { id: string }[]
      >`select id from onboarding.responses where session_id = ${id} and step_key = 'intent'`;
      v = await submit(
        world,
        adminA,
        id,
        "intent",
        select("exploring"),
        v.session.version,
      );
      expect(v.pathChanges).toEqual({
        becameEligibleStepKeys: [],
        becameIneligibleStepKeys: ["raise_amount"],
      });
      expect(v.progress.eligibleSteps.map((s) => s.stepKey)).not.toContain(
        "raise_amount",
      );
      expect(v.session.currentStepKey).toBe("notes");
      const history = await tx.sql<
        {
          id: string;
          response_jsonb: { optionKey: string };
          superseded_by_response_id: string | null;
        }[]
      >`
        select id, response_jsonb, superseded_by_response_id from onboarding.responses where session_id = ${id} and step_key = 'intent' order by created_at`;
      expect(history).toHaveLength(2);
      expect(history[0]?.id).toBe(before[0]?.id);
      expect(history[0]?.response_jsonb.optionKey).toBe("raising_now");
      expect(history[0]?.superseded_by_response_id).toBe(history[1]?.id);
      expect(history[1]?.superseded_by_response_id).toBeNull();
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id} and step_key = 'raise_amount'`,
        ),
      ).toBe(1);
      // The old raise answer still exists but is invisible to progress.
      expect(v.progress.eligibleStepCount).toBe(6);
    });
  });

  it("optional steps can be skipped without a fake answer; required steps cannot (§80-82, §211-212)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      await expect(
        service.runtime.skipStep({
          actor: adminA,
          sessionId: id as OnboardingSessionId,
          stepKey: "intent",
          expectedSessionVersion: 1,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "STEP_REQUIRED" });
      let v = await submit(world, adminA, id, "intent", select("exploring"), 1);
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("health", "energy"),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "name",
        text("Alpha"),
        v.session.version,
      );
      expect(v.session.currentStepKey).toBe("notes");
      expect(v.progress.canSkipCurrentStep).toBe(true);
      v = await service.runtime.skipStep({
        actor: adminA,
        sessionId: id as OnboardingSessionId,
        stepKey: "notes",
        expectedSessionVersion: v.session.version,
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      expect(v.session.currentStepKey).toBe("docs");
      expect(
        v.progress.eligibleSteps.find((s) => s.stepKey === "notes")?.status,
      ).toBe("SKIPPED");
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id} and step_key = 'notes'`,
        ),
      ).toBe(0);
      const [skipped] = await tx.sql<
        { status: string; skipped_at: Date | null }[]
      >`select status, skipped_at from onboarding.step_states where session_id = ${id} and step_key = 'notes'`;
      expect(skipped?.status).toBe("SKIPPED");
      expect(skipped?.skipped_at).toBeInstanceOf(Date);
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where event_type = 'onboarding.step.skipped' and payload -> 'data' ->> 'stepKey' = 'notes'`,
        ),
      ).toBe(1);
    });
  });

  it("back navigates to visited eligible steps only and deletes nothing (§83-85, §140-141, §214)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id as OnboardingSessionId;
      let v = await submit(world, adminA, id, "intent", select("exploring"), 1);
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("fintech"),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "name",
        text("Alpha"),
        v.session.version,
      );
      expect(v.session.currentStepKey).toBe("notes");
      const responsesBefore = await count(
        tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id}`,
      );
      v = await service.runtime.goBack({
        actor: adminA,
        sessionId: id,
        expectedSessionVersion: v.session.version,
      });
      expect(v.session.currentStepKey).toBe("name");
      expect(v.currentStep?.currentResponse?.value).toEqual({
        type: "TEXT",
        text: "Alpha",
      });
      v = await service.runtime.goBack({
        actor: adminA,
        sessionId: id,
        expectedSessionVersion: v.session.version,
      });
      expect(v.session.currentStepKey).toBe("sectors");
      await expect(
        service.runtime.goBack({
          actor: adminA,
          sessionId: id,
          expectedSessionVersion: v.session.version,
          targetStepKey: "confirm",
        }),
      ).rejects.toMatchObject({ reason: "STEP_NOT_VISITED" });
      v = await service.runtime.goBack({
        actor: adminA,
        sessionId: id,
        expectedSessionVersion: v.session.version,
      });
      await expect(
        service.runtime.goBack({
          actor: adminA,
          sessionId: id,
          expectedSessionVersion: v.session.version,
        }),
      ).rejects.toMatchObject({ reason: "NO_PREVIOUS_STEP" });
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id}`,
        ),
      ).toBe(responsesBefore);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.sessions where user_id = ${adminA.userId}`,
        ),
      ).toBe(1);
      expect(v.progress.completedEligibleStepCount).toBe(3);
    });
  });

  it("two tabs at the same version: the first wins, the second gets VERSION_CONFLICT; identical replays are idempotent (§70-71, §217-218)", async () => {
    await withWorld(async (world) => {
      const { tx, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      const key = randomUUID();
      const first = await submit(
        world,
        adminA,
        id,
        "intent",
        select("raising_now"),
        1,
        key,
      );
      expect(first.session.version).toBe(2);
      await expect(
        submit(world, adminA, id, "intent", select("exploring"), 1),
      ).rejects.toBeInstanceOf(OnboardingSessionVersionConflictError);
      const replay = await submit(
        world,
        adminA,
        id,
        "intent",
        select("raising_now"),
        1,
        key,
      );
      expect(replay.session.version).toBe(2);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id}`,
        ),
      ).toBe(1);
      await expect(
        submit(world, adminA, id, "intent", select("exploring"), 2, key),
      ).rejects.toBeInstanceOf(OnboardingMutationConflictError);
      const [current] = await tx.sql<
        { response_jsonb: { optionKey: string } }[]
      >`select response_jsonb from onboarding.responses where session_id = ${id} and superseded_by_response_id is null`;
      expect(current?.response_jsonb.optionKey).toBe("raising_now");
    });
  });

  // -------------------------------------------------------------------------
  // Write targets
  // -------------------------------------------------------------------------

  it("a registered write target commits with the response, a failing one rolls everything back, a missing one fails safely (§53-56, §219-221)", async () => {
    await withWorld(async (world) => {
      const { tx, adminA, echo, build } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      let v = await submit(world, adminA, id, "intent", select("exploring"), 1);
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("fintech"),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "name",
        text("Alpha Rails"),
        v.session.version,
      );
      expect(echo).toEqual(["name"]);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding_test_echo where session_id = ${id}`,
        ),
      ).toBe(1);

      // Failing handler: nothing about the revision persists.
      const failing = build({
        writeTargets: [
          {
            targetKey: TEST_WRITE_TARGET,
            apply: async (context) => {
              await context.tx
                .sql`insert into onboarding_test_echo (session_id, step_key, payload) values (${context.session.id}, 'poison', 'x')`;
              throw new Error("canonical write refused");
            },
          },
        ],
      });
      v = await failing.runtime.goBack({
        actor: adminA,
        sessionId: id as OnboardingSessionId,
        expectedSessionVersion: v.session.version,
        targetStepKey: "name",
      });
      const versionBefore = v.session.version;
      const eventsBefore = await count(
        tx.sql`select count(*)::int as count from events.outbox where payload -> 'data' ->> 'sessionId' = ${id}`,
      );
      await expect(
        failing.runtime.submitResponse({
          actor: adminA,
          sessionId: id as OnboardingSessionId,
          stepKey: "name",
          response: text("Renamed"),
          expectedSessionVersion: versionBefore,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow(/canonical write refused/);
      const [session] = await tx.sql<
        { version: number }[]
      >`select version from onboarding.sessions where id = ${id}`;
      expect(session?.version).toBe(versionBefore);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id} and step_key = 'name'`,
        ),
      ).toBe(1);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding_test_echo where step_key = 'poison'`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where payload -> 'data' ->> 'sessionId' = ${id}`,
        ),
      ).toBe(eventsBefore);

      // Missing handler: a published step with an unregistered target never stores a response.
      const bare = build({ writeTargets: [] });
      await expect(
        bare.runtime.submitResponse({
          actor: adminA,
          sessionId: id as OnboardingSessionId,
          stepKey: "name",
          response: text("Renamed"),
          expectedSessionVersion: versionBefore,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OnboardingRuntimeConfigurationError);
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id} and step_key = 'name'`,
        ),
      ).toBe(1);
      const [after] = await tx.sql<
        { version: number }[]
      >`select version from onboarding.sessions where id = ${id}`;
      expect(after?.version).toBe(versionBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  it("completes only when every eligible required step is answered, then refuses further mutation (§143-146, §222-224)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id as OnboardingSessionId;
      let v = await submit(world, adminA, id, "intent", select("exploring"), 1);
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("fintech"),
        v.session.version,
      );
      await expect(
        service.runtime.completeSession({
          actor: adminA,
          sessionId: id,
          expectedSessionVersion: v.session.version,
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "REQUIRED_STEPS_INCOMPLETE" });
      v = await submit(
        world,
        adminA,
        id,
        "name",
        text("Alpha"),
        v.session.version,
      );
      v = await submit(
        world,
        adminA,
        id,
        "confirm",
        confirm(),
        v.session.version,
      );
      expect(v.progress.canComplete).toBe(true);
      v = await service.runtime.completeSession({
        actor: adminA,
        sessionId: id,
        expectedSessionVersion: v.session.version,
        correlationId: CORRELATION(),
      });
      expect(v.session).toMatchObject({
        status: "COMPLETED",
        currentStepKey: null,
      });
      expect(v.session.completedAt).not.toBeNull();
      expect(v.currentStep).toBeNull();
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where event_type = 'onboarding.session.completed' and payload -> 'data' ->> 'sessionId' = ${id}`,
        ),
      ).toBe(1);
      const version = v.session.version;
      await expect(
        submit(world, adminA, id, "notes", text("late"), version),
      ).rejects.toMatchObject({ reason: "SESSION_NOT_ACTIVE" });
      await expect(
        service.runtime.skipStep({
          actor: adminA,
          sessionId: id,
          stepKey: "docs",
          expectedSessionVersion: version,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "SESSION_NOT_ACTIVE" });
      await expect(
        service.runtime.goBack({
          actor: adminA,
          sessionId: id,
          expectedSessionVersion: version,
        }),
      ).rejects.toMatchObject({ reason: "SESSION_NOT_ACTIVE" });
      // A completed session frees the slot: starting again creates a new one.
      const next = await start(world, adminA);
      expect(next.created).toBe(true);
      expect(next.view.session.id).not.toBe(id);
    });
  });

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  it("suggestions are proposals: accept, edit, reject, expire, never twice (§117-121, §225-228, §236)", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id as OnboardingSessionId;
      await submit(world, adminA, id, "intent", select("exploring"), 1);
      const accepted = await service.internal.createSuggestion({
        sessionId: id,
        stepKey: "sectors",
        targetField: "sectors",
        suggestedValue: { type: "MULTI_SELECT", optionKeys: ["fintech"] },
        confidence: "0.8",
        sourceRefs: [
          { sourceType: "EVIDENCE_DOCUMENT", sourceId: randomUUID() },
        ],
      });
      const edited = await service.internal.createSuggestion({
        sessionId: id,
        stepKey: "name",
        targetField: "name",
        suggestedValue: { type: "TEXT", text: `Alpha ${SUGGESTION_MARKER}` },
      });
      const rejected = await service.internal.createSuggestion({
        sessionId: id,
        stepKey: "notes",
        targetField: "notes",
        suggestedValue: { type: "TEXT", text: SUGGESTION_MARKER },
      });
      const expired = await service.internal.createSuggestion({
        sessionId: id,
        stepKey: "notes",
        targetField: "notes",
        suggestedValue: { type: "TEXT", text: "later" },
      });
      await expect(
        service.internal.createSuggestion({
          sessionId: id,
          stepKey: "sectors",
          targetField: "sectors",
          suggestedValue: { type: "MULTI_SELECT", optionKeys: ["space"] },
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      let v = await service.runtime.getSession({
        actor: adminA,
        sessionId: id,
      });
      expect(v.pendingSuggestions.map((s) => s.id).sort()).toEqual(
        [accepted.id, edited.id, rejected.id, expired.id].sort(),
      );

      v = await service.runtime.resolveSuggestion({
        actor: adminA,
        sessionId: id,
        suggestionId: accepted.id,
        resolution: "ACCEPT",
        expectedSessionVersion: v.session.version,
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      expect(v.session.currentStepKey).toBe("name");
      const [acceptedResponse] = await tx.sql<
        { source_modality: string; response_jsonb: unknown }[]
      >`select source_modality, response_jsonb from onboarding.responses where session_id = ${id} and step_key = 'sectors'`;
      expect(acceptedResponse).toEqual({
        source_modality: "SUGGESTION_ACCEPT",
        response_jsonb: { type: "MULTI_SELECT", optionKeys: ["fintech"] },
      });

      v = await service.runtime.resolveSuggestion({
        actor: adminA,
        sessionId: id,
        suggestionId: edited.id,
        resolution: "EDIT",
        response: text("Alpha Rails"),
        expectedSessionVersion: v.session.version,
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      const [editedRow] = await tx.sql<
        { status: string; suggested_value: { text: string } }[]
      >`select status, suggested_value from onboarding.suggestions where id = ${edited.id}`;
      expect(editedRow?.status).toBe("EDITED");
      expect(editedRow?.suggested_value.text).toContain(SUGGESTION_MARKER);
      const [editedResponse] = await tx.sql<
        { source_modality: string; raw_text: string }[]
      >`select source_modality, raw_text from onboarding.responses where session_id = ${id} and step_key = 'name' and superseded_by_response_id is null`;
      expect(editedResponse).toEqual({
        source_modality: "SUGGESTION_EDIT",
        raw_text: "Alpha Rails",
      });

      v = await service.runtime.resolveSuggestion({
        actor: adminA,
        sessionId: id,
        suggestionId: rejected.id,
        resolution: "REJECT",
        expectedSessionVersion: v.session.version,
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      expect(
        await count(
          tx.sql`select count(*)::int as count from onboarding.responses where session_id = ${id} and step_key = 'notes'`,
        ),
      ).toBe(0);
      await expect(
        service.runtime.resolveSuggestion({
          actor: adminA,
          sessionId: id,
          suggestionId: rejected.id,
          resolution: "ACCEPT",
          expectedSessionVersion: v.session.version,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "SUGGESTION_ALREADY_RESOLVED" });
      const gone = await service.internal.expireSuggestion({
        sessionId: id,
        suggestionId: expired.id,
        correlationId: CORRELATION(),
      });
      expect(gone.status).toBe("EXPIRED");
      expect(gone.resolvedAt).not.toBeNull();

      const events = await tx.sql<
        { payload: { data: Record<string, unknown> } }[]
      >`select payload from events.outbox where event_type = 'onboarding.suggestion.resolved' and payload -> 'data' ->> 'sessionId' = ${id} order by created_at`;
      expect(events.map((e) => e.payload.data["resolution"])).toEqual([
        "ACCEPTED",
        "EDITED",
        "REJECTED",
        "EXPIRED",
      ]);
      for (const event of events) {
        expect(Object.keys(event.payload.data).sort()).toEqual([
          "resolution",
          "sessionId",
          "stepKey",
          "suggestionId",
        ]);
      }
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${SUGGESTION_MARKER}%`}`,
        ),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Security and privacy
  // -------------------------------------------------------------------------

  it("a session is private to its owner: admins, colleagues, other tenants and guessed ids get nothing (§177-181, §229-232)", async () => {
    await withWorld(async (world) => {
      const { service, adminA, memberA, adminC, newcomer, companyA } = world;
      const owned = await start(world, memberA);
      const id = owned.view.session.id as OnboardingSessionId;
      const bootstrap = await start(world, newcomer);
      const bootstrapId = bootstrap.view.session.id as OnboardingSessionId;
      for (const intruder of [adminA, adminC]) {
        await expect(
          service.runtime.getSession({ actor: intruder, sessionId: id }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        await expect(
          submit(world, intruder, id, "intent", select("exploring"), 1),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        await expect(
          service.runtime.skipStep({
            actor: intruder,
            sessionId: id,
            stepKey: "notes",
            expectedSessionVersion: 1,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        await expect(
          service.runtime.goBack({
            actor: intruder,
            sessionId: id,
            expectedSessionVersion: 1,
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        await expect(
          service.runtime.completeSession({
            actor: intruder,
            sessionId: id,
            expectedSessionVersion: 1,
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        await expect(
          service.runtime.getSession({
            actor: intruder,
            sessionId: bootstrapId,
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      }
      await expect(
        service.runtime.getSession({ actor: memberA, sessionId: bootstrapId }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      await expect(
        service.runtime.getSession({ actor: newcomer, sessionId: id }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      await expect(
        service.runtime.getSession({
          actor: adminA,
          sessionId: randomUUID() as OnboardingSessionId,
        }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      await expect(
        service.internal.bindSessionContext({
          actor: adminA,
          sessionId: id,
          subject: { subjectType: "COMPANY", subjectId: companyA },
        }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);

      // A bound session keeps its context when the owner acts without (or with another) context.
      const bound = await start(world, adminA, {
        subjectType: "COMPANY",
        subjectId: companyA,
      });
      const contextless: OnboardingActor = {
        userId: adminA.userId,
        context: null,
      };
      const seen = await service.runtime.getSession({
        actor: contextless,
        sessionId: bound.view.session.id as OnboardingSessionId,
      });
      expect(seen.session.subject).toEqual({ type: "COMPANY", id: companyA });
      const stillBound = await submit(
        world,
        contextless,
        bound.view.session.id,
        "intent",
        select("exploring"),
        1,
      );
      expect(stillBound.session.subject).toEqual({
        type: "COMPANY",
        id: companyA,
      });
    });
  });

  it("raw answers never reach the outbox, audit or logs (§149, §235, §237)", async () => {
    await withWorld(async (world) => {
      const { tx, logs, adminA } = world;
      const { view } = await start(world, adminA);
      const id = view.session.id;
      let v = await submit(world, adminA, id, "intent", select("exploring"), 1);
      v = await submit(
        world,
        adminA,
        id,
        "sectors",
        multi("fintech"),
        v.session.version,
      );
      await submit(
        world,
        adminA,
        id,
        "name",
        text(`Alpha ${RESPONSE_MARKER}`),
        v.session.version,
      );
      const stored = await count(
        tx.sql`select count(*)::int as count from onboarding.responses where raw_text like ${`%${RESPONSE_MARKER}%`}`,
      );
      expect(stored).toBe(1);
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${RESPONSE_MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${RESPONSE_MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from audit.material_actions where resource_type = 'onboarding_session'`,
        ),
      ).toBe(0);
      const joined = logs.join("\n");
      expect(logs.length).toBeGreaterThan(0);
      expect(joined).not.toContain(RESPONSE_MARKER);
      expect(joined).toContain('"operation":"response.committed"');
      expect(joined).toContain('"stepKey":"name"');
      const [event] = await tx.sql<
        { payload: { data: Record<string, unknown> } }[]
      >`select payload from events.outbox where event_type = 'onboarding.response.committed' and payload -> 'data' ->> 'stepKey' = 'name'`;
      expect(Object.keys(event?.payload.data ?? {}).sort()).toEqual([
        "responseId",
        "sessionId",
        "sessionVersion",
        "stepKey",
      ]);
    });
  });
});

describe("concurrent session start over separate connections (§207)", () => {
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

  it("two simultaneous starts for the same newcomer produce exactly one session", async () => {
    // Committed on purpose (two real connections); uses a journey no other
    // suite publishes so the leftover definition never collides.
    const service = createOnboardingService({
      sql: db.sql,
      transactions: db.transactions,
      outbox: createOutboxWriter({ registry }),
    });
    await service.publisher.publish({
      ...SYNTHETIC_FOUNDER_MANIFEST,
      journeyType: "external_investor_conversion",
      name: "Synthetic concurrency journey",
    });
    const authUserId = randomUUID();
    await db.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await db.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const actor: OnboardingActor = {
      userId: UserIdSchema.parse(profile.id),
      context: null,
    };
    try {
      const results = await Promise.all([
        service.runtime.startSession({
          actor,
          journeyType: "external_investor_conversion",
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
        service.runtime.startSession({
          actor,
          journeyType: "external_investor_conversion",
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ]);
      expect(new Set(results.map((r) => r.view.session.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const [row] = await db.sql<
        { count: number }[]
      >`select count(*)::int as count from onboarding.sessions where user_id = ${profile.id}`;
      expect(row?.count).toBe(1);
    } finally {
      await db.sql`delete from onboarding.session_creation_requests where user_id = ${profile.id}`;
      await db.sql`delete from onboarding.step_states where session_id in (select id from onboarding.sessions where user_id = ${profile.id})`;
      await db.sql`delete from events.outbox where payload -> 'data' ->> 'sessionId' in (select id::text from onboarding.sessions where user_id = ${profile.id})`;
      await db.sql`delete from onboarding.sessions where user_id = ${profile.id}`;
      await db.sql`delete from identity.user_profiles where id = ${profile.id}`;
      await db.sql`delete from auth.users where id = ${authUserId}`;
    }
  });
});
