import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { CAPITAL_EVENTS } from "@capital-q/capital/events";
import {
  createPostgresCompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ContractValidationError,
  createEventRegistry,
  CorrelationIdSchema,
  type CorrelationId,
  type OnboardingResponseValue,
  type OnboardingSessionView,
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
  createCompanyOnboardingSubjectResolver,
  createOnboardingService,
  OnboardingSessionIdSchema,
  OnboardingSessionNotFoundError,
  type OnboardingActor,
  type OnboardingService,
} from "@capital-q/onboarding";
import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import {
  AuthorizationDeniedError,
  AuthUserIdSchema,
  OrganisationIdSchema,
  UserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { TAXONOMY_EVENTS } from "@capital-q/taxonomy/events";

import {
  createFounderDomainServices,
  createFounderOnboardingIntegration,
  FOUNDER_STEPS,
  FounderRaiseContextSchema,
  FounderReviewContextSchema,
  FounderSnapshotContextSchema,
  resolveFounderContext,
} from "../src/index.js";

/**
 * The real Founder journey F0 → F8 over the onboarding runtime against the
 * local PostgreSQL, with Founder Definition v1 as published by migration.
 * Every canonical effect is observed through the domains' own tables or
 * public services; nothing is asserted from the session alone. Every test
 * runs in one rolled-back transaction with savepoint-backed units of work.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const FOLLOW_UP_MARKER = "PRIVATE-FOUNDER-FOLLOWUP-DO-NOT-SHARE";
const DESCRIPTION_MARKER = "PRIVATE-FOUNDER-ONBOARDING-DO-NOT-EMIT";

const CORRELATION = (): CorrelationId =>
  CorrelationIdSchema.parse(`cor_${randomUUID()}`);

class Rollback extends Error {}

async function countOf(query: Promise<{ count: number }[]>): Promise<number> {
  return (await query)[0]?.count ?? -1;
}

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

const registry = createEventRegistry([
  ...ORGANISATION_EVENTS,
  ...PERMISSIONS_EVENTS,
  ...COMPANY_EVENTS,
  ...CAPITAL_EVENTS,
  ...TAXONOMY_EVENTS,
  ...ONBOARDING_EVENTS,
]);

type World = {
  readonly tx: TransactionContext;
  readonly service: OnboardingService;
  readonly logs: string[];
  readonly newcomer: OnboardingActor;
  readonly stranger: OnboardingActor;
  readonly memberOfExistingOrg: OnboardingActor;
  readonly existingOrgId: string;
  readonly companies: CompanyService;
};

describe("@capital-q/founder-onboarding against local PostgreSQL", () => {
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
    const actor: OnboardingActor = {
      userId: UserIdSchema.parse(profile.id),
      context: null,
      principal,
    };
    return actor;
  }

  async function insertOrganisationWithMember(
    tx: TransactionContext,
    roleCode: "organisation_admin" | "organisation_member",
  ) {
    const tenantId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Tenant ${tenantId.slice(0, 6)}`})`;
    const organisationId = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${organisationId}, ${tenantId}, 'company', 'Existing Org', ${`org-${organisationId.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
    const person = await insertPerson(tx);
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${person.userId})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${person.userId}, ${membershipId})`;
    const services = createFounderDomainServices(tx, {
      outbox: createOutboxWriter({ registry }),
      audit: createPostgresMaterialActionAuditWriter(),
    });
    const context = await resolveFounderContext(
      services,
      person,
      OrganisationIdSchema.parse(organisationId),
    );
    return { actor: { ...person, context }, organisationId };
  }

  async function seedWorld(tx: TransactionContext): Promise<World> {
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
    const outbox = createOutboxWriter({ registry });
    const audit = createPostgresMaterialActionAuditWriter();
    const founder = createFounderOnboardingIntegration({ outbox, audit });
    const service = createOnboardingService({
      sql: tx.sql,
      transactions: nestedTransactions(tx),
      outbox,
      writeTargets: founder.writeTargets,
      stepContextProviders: founder.stepContextProviders,
      subjectResolvers: [
        createCompanyOnboardingSubjectResolver(
          createPostgresCompanyQueryPort({ sql: tx.sql }),
        ),
      ],
      logger,
    });
    const member = await insertOrganisationWithMember(
      tx,
      "organisation_member",
    );
    return {
      tx,
      service,
      logs,
      newcomer: await insertPerson(tx),
      stranger: await insertPerson(tx),
      memberOfExistingOrg: member.actor,
      existingOrgId: member.organisationId,
      companies: createFounderDomainServices(tx, { outbox, audit }).companies,
    };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
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

  // Journey driver ----------------------------------------------------------

  type Driver = {
    readonly view: () => OnboardingSessionView;
    readonly submit: (
      stepKey: string,
      value: OnboardingResponseValue,
    ) => Promise<OnboardingSessionView>;
    readonly skip: (stepKey: string) => Promise<OnboardingSessionView>;
    readonly back: (targetStepKey?: string) => Promise<OnboardingSessionView>;
    readonly refresh: () => Promise<OnboardingSessionView>;
  };

  async function startFounder(
    world: World,
    actor: OnboardingActor,
  ): Promise<Driver> {
    const { runtime } = world.service;
    let current = (
      await runtime.startSession({
        actor,
        journeyType: "founder",
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      })
    ).view;
    const remember = (next: OnboardingSessionView) => {
      current = next;
      return next;
    };
    return {
      view: () => current,
      submit: async (stepKey, value) =>
        remember(
          await runtime.submitResponse({
            actor,
            sessionId: OnboardingSessionIdSchema.parse(current.session.id),
            stepKey,
            response: { value },
            expectedSessionVersion: current.session.version,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
        ),
      skip: async (stepKey) =>
        remember(
          await runtime.skipStep({
            actor,
            sessionId: OnboardingSessionIdSchema.parse(current.session.id),
            stepKey,
            expectedSessionVersion: current.session.version,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
        ),
      back: async (targetStepKey) =>
        remember(
          await runtime.goBack({
            actor,
            sessionId: OnboardingSessionIdSchema.parse(current.session.id),
            expectedSessionVersion: current.session.version,
            ...(targetStepKey === undefined ? {} : { targetStepKey }),
          }),
        ),
      refresh: async () =>
        remember(
          await runtime.getSession({
            actor,
            sessionId: OnboardingSessionIdSchema.parse(current.session.id),
          }),
        ),
    };
  }

  const single = (optionKey: string): OnboardingResponseValue => ({
    type: "SINGLE_SELECT",
    optionKey,
  });
  const multi = (optionKeys: string[]): OnboardingResponseValue => ({
    type: "MULTI_SELECT",
    optionKeys,
  });
  const text = (value: string): OnboardingResponseValue => ({
    type: "TEXT",
    text: value,
  });
  const range = (value: string): OnboardingResponseValue => ({
    type: "RANGE",
    value,
  });
  const confirm: OnboardingResponseValue = {
    type: "CONFIRMATION",
    confirmed: true,
  };

  const companyIdOf = (view: OnboardingSessionView) => {
    const subject = view.session.subject;
    if (subject === null) {
      throw new Error("session is not bound");
    }
    return subject.id;
  };

  async function companyRow(tx: TransactionContext, companyId: string) {
    const [row] = await tx.sql<
      {
        canonical_name: string;
        website_url: string | null;
        headquarters_country: string | null;
        current_stage_code: string | null;
        primary_description: string | null;
        organisation_id: string;
        tenant_id: string;
        version: number;
      }[]
    >`select canonical_name, website_url, headquarters_country, current_stage_code, primary_description,
             organisation_id, tenant_id, version
        from core.companies where id = ${companyId}`;
    return row;
  }

  async function taxonomyNodes(tx: TransactionContext) {
    const rows = await tx.sql<
      { id: string; vocabulary: string }[]
    >`select n.id, v.code as vocabulary
        from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
       where n.status = 'ACTIVE' and v.code in ('industry', 'business_model')
       order by v.code, n.depth, n.canonical_code`;
    const industry = rows.find((r) => r.vocabulary === "industry");
    const model = rows.find((r) => r.vocabulary === "business_model");
    if (industry === undefined || model === undefined) {
      throw new Error("taxonomy seed missing");
    }
    return { industry, model };
  }

  // -------------------------------------------------------------------------

  it("F0 → F8: a newcomer bootstraps a workspace and one canonical company, and every step lands on canonical truth", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const journey = await startFounder(world, newcomer);
      expect(journey.view().session.subject).toBeNull();
      expect(journey.view().currentStep?.stepKey).toBe(FOUNDER_STEPS.intent);
      expect(journey.view().session.definitionVersion).toBe(1);

      await journey.submit(FOUNDER_STEPS.intent, single("raising_now"));
      expect(journey.view().currentStep?.stepKey).toBe(
        FOUNDER_STEPS.companyName,
      );

      // F1 -- the canonical company exists from the first answer.
      const bound = await journey.submit(
        FOUNDER_STEPS.companyName,
        text("NexaRail Technologies"),
      );
      expect(bound.session.subject?.type).toBe("COMPANY");
      const companyId = companyIdOf(bound);
      const company = await companyRow(tx, companyId);
      expect(company?.canonical_name).toBe("NexaRail Technologies");
      const [membership] = await tx.sql<
        { organisation_id: string; role_codes: string[] }[]
      >`select m.organisation_id, array_agg(r.code order by r.code) as role_codes
          from identity.organisation_memberships m
          join identity.membership_roles mr on mr.membership_id = m.id
          join permissions.roles r on r.id = mr.role_id
         where m.user_id = ${newcomer.userId}
         group by m.organisation_id`;
      expect(membership?.organisation_id).toBe(company?.organisation_id);
      expect(membership?.role_codes).toEqual(["organisation_admin"]);
      const [founderRow] = await tx.sql<
        { is_founder: boolean; relationship_type: string }[]
      >`select is_founder, relationship_type from core.company_members
         where company_id = ${companyId} and user_id = ${newcomer.userId}`;
      expect(founderRow).toEqual({
        is_founder: true,
        relationship_type: "team_member",
      });
      const [sessionRow] = await tx.sql<
        { tenant_id: string; organisation_id: string }[]
      >`select tenant_id, organisation_id from onboarding.sessions where id = ${bound.session.id}`;
      expect(sessionRow).toEqual({
        tenant_id: company?.tenant_id,
        organisation_id: company?.organisation_id,
      });

      await journey.submit(FOUNDER_STEPS.website, text("nexarail.example"));
      await journey.submit(FOUNDER_STEPS.country, single("ng"));
      await journey.submit(FOUNDER_STEPS.stage, single("seed"));
      await journey.submit(
        FOUNDER_STEPS.description,
        text(`Claims automation for insurers. ${DESCRIPTION_MARKER}`),
      );
      const afterBasics = await companyRow(tx, companyId);
      expect(afterBasics).toMatchObject({
        website_url: "https://nexarail.example",
        headquarters_country: "NG",
        current_stage_code: "seed",
      });
      expect(afterBasics?.primary_description).toContain(DESCRIPTION_MARKER);

      // Taxonomy: explicit confirmation of chosen nodes, nothing auto-accepted.
      const nodes = await taxonomyNodes(tx);
      await journey.submit(FOUNDER_STEPS.categories, {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [nodes.industry.id, nodes.model.id],
      });
      const assigned = await tx.sql<
        { node_id: string; assignment_source: string; status: string }[]
      >`select node_id, assignment_source, status from taxonomy.entity_assignments
         where entity_type = 'COMPANY' and entity_id = ${companyId} and status = 'ACTIVE'
         order by node_id`;
      expect(assigned.map((a) => a.node_id).sort()).toEqual(
        [nodes.industry.id, nodes.model.id].sort(),
      );
      expect(new Set(assigned.map((a) => a.assignment_source))).toEqual(
        new Set(["user_selected"]),
      );

      // F2 is a declaration only: no evidence, no upload.
      await journey.submit(
        FOUNDER_STEPS.materials,
        multi(["pitch_deck", "financial_model"]),
      );

      // F3 -- deterministic review of what exists now.
      const review = journey.view();
      expect(review.currentStep?.stepKey).toBe(FOUNDER_STEPS.review);
      const reviewContext = FounderReviewContextSchema.parse(
        review.currentStep?.context,
      );
      expect(reviewContext.company).toMatchObject({
        name: "NexaRail Technologies",
        websiteUrl: "https://nexarail.example",
        country: { key: "ng", label: "Nigeria" },
        stage: { key: "seed", label: "Seed" },
      });
      expect(reviewContext.categories).toHaveLength(2);
      expect(reviewContext.materials?.map((m) => m.key)).toEqual([
        "pitch_deck",
        "financial_model",
      ]);
      expect(reviewContext.intent?.key).toBe("raising_now");
      expect(JSON.stringify(reviewContext)).not.toMatch(
        /readiness|score|verified|Q analysis/i,
      );
      await journey.submit(FOUNDER_STEPS.review, confirm);

      // F4 -- membership title and exact team facts.
      await journey.submit(FOUNDER_STEPS.founderRole, single("ceo"));
      await journey.submit(FOUNDER_STEPS.founderCount, range("2"));
      await journey.submit(FOUNDER_STEPS.fullTime, single("all"));
      await journey.submit(FOUNDER_STEPS.teamSize, range("6"));
      await journey.skip(FOUNDER_STEPS.functions);
      const [title] = await tx.sql<
        { business_title: string | null }[]
      >`select business_title from core.company_members where company_id = ${companyId} and user_id = ${newcomer.userId}`;
      expect(title?.business_title).toBe("CEO");
      const [facts] = await tx.sql<
        {
          founder_count: number | null;
          full_time_founder_count: number | null;
          team_size: number | null;
        }[]
      >`select founder_count, full_time_founder_count, team_size from core.company_team_facts where company_id = ${companyId}`;
      expect(facts).toEqual({
        founder_count: 2,
        full_time_founder_count: 2,
        team_size: 6,
      });

      // F5 -- seed stage takes the pre-revenue branch only.
      const eligible = journey
        .view()
        .progress.eligibleSteps.map((s) => s.stepKey);
      expect(eligible).toContain(FOUNDER_STEPS.signal);
      expect(eligible).not.toContain(FOUNDER_STEPS.revenueStatus);
      expect(eligible).not.toContain(FOUNDER_STEPS.customers);
      await journey.submit(FOUNDER_STEPS.signal, single("pilots"));
      expect(
        journey.view().progress.eligibleSteps.map((s) => s.stepKey),
      ).toContain(FOUNDER_STEPS.pilots);
      await journey.submit(FOUNDER_STEPS.pilots, range("4"));

      // F6 -- the raise becomes the one canonical capital objective.
      await journey.submit(FOUNDER_STEPS.raising, single("active"));
      await journey.submit(FOUNDER_STEPS.currency, single("usd"));
      await journey.submit(FOUNDER_STEPS.targetAmount, range("500000"));
      await journey.submit(FOUNDER_STEPS.instrument, single("safe"));
      await journey.skip(FOUNDER_STEPS.timeframe);
      await journey.submit(FOUNDER_STEPS.useOfFunds, multi(["product", "gtm"]));
      const raiseStep = journey.view();
      expect(raiseStep.currentStep?.stepKey).toBe(FOUNDER_STEPS.raiseConfirm);
      const raiseContext = FounderRaiseContextSchema.parse(
        raiseStep.currentStep?.context,
      );
      expect(raiseContext).toMatchObject({
        mode: "create",
        currency: "USD",
        amount: "500000",
        instrument: { key: "safe" },
        existing: null,
      });
      await journey.submit(FOUNDER_STEPS.raiseConfirm, confirm);
      const companyObjectiveAmount = async () =>
        (
          await tx.sql<
            { target_amount: string }[]
          >`select target_amount::text from core.capital_objectives where company_id = ${companyId}`
        )[0]?.target_amount;
      const objectives = await tx.sql<
        {
          id: string;
          status: string;
          target_amount: string;
          target_currency: string;
          instrument_code: string | null;
          use_of_funds_summary: string | null;
          target_stage: string | null;
          version: number;
        }[]
      >`select id, status, target_amount::text, currency_code, instrument_code, use_of_funds_summary, target_stage, version
          from core.capital_objectives where company_id = ${companyId}`;
      expect(objectives).toHaveLength(1);
      expect(objectives[0]).toMatchObject({
        status: "ACTIVE",
        target_amount: "500000",
        currency_code: "USD",
        instrument_code: "safe",
        use_of_funds_summary: "Product and engineering; Sales and go-to-market",
        target_stage: "seed",
        version: 1,
      });

      // Revising the amount recalibrates the same objective, never a second one.
      await journey.back(FOUNDER_STEPS.targetAmount);
      await journey.submit(FOUNDER_STEPS.targetAmount, range("750000"));
      // A revised earlier answer never silently rewrites the objective: the
      // confirmation step is revisited explicitly and recalibrates.
      await journey.back(FOUNDER_STEPS.raiseConfirm);
      expect(journey.view().currentStep?.stepKey).toBe(
        FOUNDER_STEPS.raiseConfirm,
      );
      expect(await companyObjectiveAmount()).toBe("500000");
      expect(
        FounderRaiseContextSchema.parse(journey.view().currentStep?.context),
      ).toMatchObject({
        mode: "recalibrate",
        amount: "750000",
        existing: { amount: "500000", currency: "USD", version: 1 },
      });
      await journey.submit(FOUNDER_STEPS.raiseConfirm, confirm);
      const recalibrated = await tx.sql<
        { id: string; status: string; target_amount: string; version: number }[]
      >`select id, status, target_amount::text, version from core.capital_objectives where company_id = ${companyId}`;
      expect(recalibrated).toHaveLength(1);
      expect(recalibrated[0]).toMatchObject({
        id: objectives[0]?.id,
        status: "ACTIVE",
        target_amount: "750000",
        version: 2,
      });

      // F7 -- founder-private; F8 -- snapshot reports existence only.
      await journey.submit(
        FOUNDER_STEPS.followUp,
        text(`Board wants a bridge first. ${FOLLOW_UP_MARKER}`),
      );
      const snapshotStep = journey.view();
      expect(snapshotStep.currentStep?.stepKey).toBe(FOUNDER_STEPS.snapshot);
      const snapshot = FounderSnapshotContextSchema.parse(
        snapshotStep.currentStep?.context,
      );
      expect(snapshot.company.name).toBe("NexaRail Technologies");
      expect(snapshot.company.categories).toHaveLength(2);
      expect(snapshot.team).toMatchObject({
        role: { key: "ceo" },
        founderCount: 2,
        fullTimeFounderCount: 2,
        teamSize: 6,
      });
      expect(snapshot.traction).toMatchObject({
        signal: { key: "pilots" },
        pilots: "4",
        revenueStatus: null,
      });
      expect(snapshot.raise).toMatchObject({
        status: "active",
        amount: "750000",
        currency: "USD",
      });
      expect(snapshot.followUpRecorded).toBe(true);
      expect(snapshot.missing).toEqual([]);
      const serialised = JSON.stringify(snapshot);
      expect(serialised).not.toContain(FOLLOW_UP_MARKER);
      expect(serialised).not.toMatch(/readiness|score|verified|discoverab/i);
      expect(snapshotStep.progress.canComplete).toBe(false);
      await journey.submit(FOUNDER_STEPS.snapshot, confirm);
      expect(journey.view().progress.canComplete).toBe(true);

      const completed = await world.service.runtime.completeSession({
        actor: newcomer,
        sessionId: OnboardingSessionIdSchema.parse(journey.view().session.id),
        expectedSessionVersion: journey.view().session.version,
        correlationId: CORRELATION(),
      });
      expect(completed.session.status).toBe("COMPLETED");

      // Privacy: nothing the founder typed reaches logs or event payloads.
      const joined = world.logs.join("\n");
      expect(joined).not.toContain(FOLLOW_UP_MARKER);
      expect(joined).not.toContain(DESCRIPTION_MARKER);
      expect(joined).not.toContain("NexaRail");
      const payloads = await tx.sql<
        { payload: unknown }[]
      >`select payload from events.outbox`;
      const events = JSON.stringify(payloads);
      expect(events).not.toContain(FOLLOW_UP_MARKER);
      expect(events).not.toContain(DESCRIPTION_MARKER);
    });
  });

  it("is retry-safe: a repeated F1 renames the same company and an unbound restart resumes the bound session", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const journey = await startFounder(world, newcomer);
      await journey.submit(FOUNDER_STEPS.intent, single("exploring"));
      const bound = await journey.submit(
        FOUNDER_STEPS.companyName,
        text("First Name Ltd"),
      );
      const companyId = companyIdOf(bound);

      await journey.back();
      await journey.submit(FOUNDER_STEPS.companyName, text("Renamed Ltd"));
      expect(companyIdOf(journey.view())).toBe(companyId);
      expect((await companyRow(tx, companyId))?.canonical_name).toBe(
        "Renamed Ltd",
      );
      const companies = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from core.companies where organisation_id = ${(await companyRow(tx, companyId))?.organisation_id ?? ""}`,
      );
      expect(companies).toBe(1);
      const organisations = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from identity.organisation_memberships where user_id = ${newcomer.userId}`,
      );
      expect(organisations).toBe(1);

      // A fresh unbound start (new key, e.g. after a refresh) resumes, never
      // creates a second session or a second company.
      const again = await world.service.runtime.startSession({
        actor: newcomer,
        journeyType: "founder",
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      expect(again.created).toBe(false);
      expect(again.view.session.id).toBe(journey.view().session.id);
      expect(again.view.session.subject?.id).toBe(companyId);
      const current = await world.service.runtime.getCurrentSession({
        actor: newcomer,
        journeyType: "founder",
      });
      expect(current?.session.id).toBe(journey.view().session.id);
      expect(current?.responses.map((r) => r.stepKey)).toEqual([
        FOUNDER_STEPS.intent,
        FOUNDER_STEPS.companyName,
      ]);
    });
  });

  it("refuses a canonical write the actor may not make and stores nothing for the step", async () => {
    await withWorld(async (world) => {
      const { tx, memberOfExistingOrg, existingOrgId } = world;
      // An organisation_member has no company.create; the company service
      // refuses and the onboarding step rolls back with it.
      const journey = await startFounder(world, memberOfExistingOrg);
      await journey.submit(FOUNDER_STEPS.intent, single("exploring"));
      await expect(
        journey.submit(FOUNDER_STEPS.companyName, text("Not Allowed Ltd")),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const refreshed = await journey.refresh();
      expect(refreshed.session.subject).toBeNull();
      expect(refreshed.currentStep?.stepKey).toBe(FOUNDER_STEPS.companyName);
      expect(refreshed.responses.map((r) => r.stepKey)).toEqual([
        FOUNDER_STEPS.intent,
      ]);
      const count = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from core.companies where organisation_id = ${existingOrgId}`,
      );
      expect(count).toBe(0);
    });
  });

  it("keeps a founder's session and company invisible to anyone else", async () => {
    await withWorld(async (world) => {
      const { newcomer, stranger, memberOfExistingOrg } = world;
      const journey = await startFounder(world, newcomer);
      await journey.submit(FOUNDER_STEPS.intent, single("raising_now"));
      await journey.submit(FOUNDER_STEPS.companyName, text("Mine Ltd"));
      for (const other of [stranger, memberOfExistingOrg]) {
        await expect(
          world.service.runtime.getSession({
            actor: other,
            sessionId: OnboardingSessionIdSchema.parse(
              journey.view().session.id,
            ),
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
        expect(
          await world.service.runtime.getCurrentSession({
            actor: other,
            journeyType: "founder",
          }),
        ).toBeNull();
      }
      // The stranger's own journey is a separate session and a separate company.
      const theirs = await startFounder(world, stranger);
      expect(theirs.view().session.id).not.toBe(journey.view().session.id);
      await theirs.submit(FOUNDER_STEPS.intent, single("exploring"));
      const theirBound = await theirs.submit(
        FOUNDER_STEPS.companyName,
        text("Theirs Ltd"),
      );
      expect(companyIdOf(theirBound)).not.toBe(companyIdOf(journey.view()));
    });
  });

  it("rejects categories outside the company vocabularies or unknown ids without touching assignments", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const journey = await startFounder(world, newcomer);
      await journey.submit(FOUNDER_STEPS.intent, single("raising_now"));
      const bound = await journey.submit(
        FOUNDER_STEPS.companyName,
        text("Taxo Ltd"),
      );
      await journey.skip(FOUNDER_STEPS.website);
      await journey.skip(FOUNDER_STEPS.country);
      await journey.submit(FOUNDER_STEPS.stage, single("series_a"));
      await journey.skip(FOUNDER_STEPS.description);
      const [stage] = await tx.sql<
        { id: string }[]
      >`select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = 'company_stage' and n.canonical_code = 'seed'`;
      await expect(
        journey.submit(FOUNDER_STEPS.categories, {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [stage?.id ?? randomUUID()],
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        journey.submit(FOUNDER_STEPS.categories, {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [randomUUID()],
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      const count = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from taxonomy.entity_assignments where entity_id = ${companyIdOf(bound)}`,
      );
      expect(count).toBe(0);

      // Series A takes the revenue branch, and the review works with skips.
      await journey.skip(FOUNDER_STEPS.categories);
      await journey.skip(FOUNDER_STEPS.materials);
      const review = FounderReviewContextSchema.parse(
        journey.view().currentStep?.context,
      );
      expect(review.company.websiteUrl).toBeNull();
      expect(review.categories).toEqual([]);
      expect(review.materials).toBeNull();
      await journey.submit(FOUNDER_STEPS.review, confirm);
      await journey.submit(FOUNDER_STEPS.founderRole, single("other"));
      await journey.submit(FOUNDER_STEPS.founderCount, range("3"));
      await journey.submit(FOUNDER_STEPS.fullTime, single("some"));
      await journey.submit(FOUNDER_STEPS.teamSize, range("40"));
      await journey.skip(FOUNDER_STEPS.functions);
      const [facts] = await tx.sql<
        {
          founder_count: number | null;
          full_time_founder_count: number | null;
          team_size: number | null;
        }[]
      >`select founder_count, full_time_founder_count, team_size from core.company_team_facts where company_id = ${companyIdOf(bound)}`;
      // "some" is unknown, and unknown stays null.
      expect(facts).toEqual({
        founder_count: 3,
        full_time_founder_count: null,
        team_size: 40,
      });
      const eligible = journey
        .view()
        .progress.eligibleSteps.map((s) => s.stepKey);
      expect(eligible).toContain(FOUNDER_STEPS.revenueStatus);
      expect(eligible).not.toContain(FOUNDER_STEPS.signal);
      await journey.submit(FOUNDER_STEPS.revenueStatus, single("recurring"));
      await journey.submit(FOUNDER_STEPS.customers, range("31"));
      await journey.skip(FOUNDER_STEPS.growth);
      // Not raising: the raise steps are not on the path and nothing is created.
      await journey.submit(FOUNDER_STEPS.raising, single("not_now"));
      expect(
        journey.view().progress.eligibleSteps.map((s) => s.stepKey),
      ).not.toContain(FOUNDER_STEPS.raiseConfirm);
      await journey.skip(FOUNDER_STEPS.followUp);
      const snapshot = FounderSnapshotContextSchema.parse(
        journey.view().currentStep?.context,
      );
      expect(snapshot.raise).toEqual({
        status: "none",
        raising: { key: "not_now", label: "Not right now" },
      });
      expect(snapshot.followUpRecorded).toBe(false);
      expect(snapshot.missing).toEqual(
        expect.arrayContaining([
          "description",
          "categories",
          "materials",
          "capital_objective",
        ]),
      );
      const objectives = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from core.capital_objectives where company_id = ${companyIdOf(bound)}`,
      );
      expect(objectives).toBe(0);
    });
  });
});
