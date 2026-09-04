import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
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
import {
  createPostgresInvestorOrganisationQueryPort,
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  InvestorVersionConflictError,
} from "@capital-q/investors";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { createLogger } from "@capital-q/observability";
import {
  createInvestorOrganisationOnboardingSubjectResolver,
  createOnboardingService,
  OnboardingSessionIdSchema,
  OnboardingSessionNotFoundError,
  OnboardingSessionVersionConflictError,
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
  createInvestorDomainServices,
  createInvestorOnboardingIntegration,
  INVESTOR_STEPS,
  InvestorHandoffContextSchema,
  InvestorMandatesContextSchema,
  InvestorReviewContextSchema,
  resolveInvestorContext,
} from "../src/index.js";

/**
 * The real Investor journey I0 → I12 over the onboarding runtime against
 * local PostgreSQL, with Investor Definition v1 as published by migration.
 * Every canonical effect is observed in the Organisation, Investor,
 * Taxonomy and portfolio tables; nothing is asserted from the session
 * alone. Every test runs in one rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PRIVATE_MARKER = "PRIVATE-INVESTOR-ONBOARDING-DO-NOT-EMIT";
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
  ...INVESTOR_EVENTS,
  ...TAXONOMY_EVENTS,
  ...ONBOARDING_EVENTS,
]);

type World = {
  readonly tx: TransactionContext;
  readonly service: OnboardingService;
  readonly logs: string[];
  readonly newcomer: OnboardingActor;
  readonly stranger: OnboardingActor;
  readonly existingAdmin: OnboardingActor;
  readonly existingMember: OnboardingActor;
  readonly existingOrgId: string;
  readonly existingOrgName: string;
};

describe("@capital-q/investor-onboarding against local PostgreSQL", () => {
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

  async function insertPerson(
    tx: TransactionContext,
  ): Promise<OnboardingActor> {
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
    return { userId: UserIdSchema.parse(profile.id), context: null, principal };
  }

  async function insertOrganisation(tx: TransactionContext, name: string) {
    const tenantId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${name})`;
    const organisationId = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${organisationId}, ${tenantId}, 'investment_firm', ${name}, ${`org-${organisationId.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
    return { tenantId, organisationId };
  }

  async function insertMember(
    tx: TransactionContext,
    org: { tenantId: string; organisationId: string },
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<OnboardingActor> {
    const person = await insertPerson(tx);
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${org.tenantId}, ${org.organisationId}, ${person.userId})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${person.userId}, ${membershipId})`;
    const services = createInvestorDomainServices(tx, {
      outbox: createOutboxWriter({ registry }),
      audit: createPostgresMaterialActionAuditWriter(),
    });
    const context = await resolveInvestorContext(
      services,
      person,
      OrganisationIdSchema.parse(org.organisationId),
    );
    return { ...person, context };
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
    const investor = createInvestorOnboardingIntegration({ outbox, audit });
    const service = createOnboardingService({
      sql: tx.sql,
      transactions: nestedTransactions(tx),
      outbox,
      writeTargets: investor.writeTargets,
      stepContextProviders: investor.stepContextProviders,
      subjectResolvers: [
        createInvestorOrganisationOnboardingSubjectResolver(
          createPostgresInvestorOrganisationQueryPort({ sql: tx.sql }),
        ),
      ],
      logger,
    });
    const existingOrgName = "Apex Ventures";
    const existing = await insertOrganisation(tx, existingOrgName);
    return {
      tx,
      service,
      logs,
      newcomer: await insertPerson(tx),
      stranger: await insertPerson(tx),
      existingAdmin: await insertMember(tx, existing, "organisation_admin"),
      existingMember: await insertMember(tx, existing, "organisation_member"),
      existingOrgId: existing.organisationId,
      existingOrgName,
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

  // Journey driver ----------------------------------------------------------------

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

  async function startInvestor(
    world: World,
    actor: OnboardingActor,
  ): Promise<Driver> {
    const { runtime } = world.service;
    let current = (
      await runtime.startSession({
        actor,
        journeyType: "investor",
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      })
    ).view;
    const remember = (next: OnboardingSessionView) => {
      current = next;
      return next;
    };
    const id = () => OnboardingSessionIdSchema.parse(current.session.id);
    return {
      view: () => current,
      submit: async (stepKey, value) =>
        remember(
          await runtime.submitResponse({
            actor,
            sessionId: id(),
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
            sessionId: id(),
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
            sessionId: id(),
            expectedSessionVersion: current.session.version,
            ...(targetStepKey === undefined ? {} : { targetStepKey }),
          }),
        ),
      refresh: async () =>
        remember(await runtime.getSession({ actor, sessionId: id() })),
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
  const nodes = (ids: string[]): OnboardingResponseValue => ({
    type: "RESOURCE_REFERENCE",
    resourceType: "TAXONOMY_NODE",
    resourceIds: ids,
  });
  const mandateRef = (id: string): OnboardingResponseValue => ({
    type: "RESOURCE_REFERENCE",
    resourceType: "INVESTOR_MANDATE",
    resourceIds: [id],
  });
  const confirm: OnboardingResponseValue = {
    type: "CONFIRMATION",
    confirmed: true,
  };

  const investorIdOf = (view: OnboardingSessionView) => {
    const subject = view.session.subject;
    if (subject === null) {
      throw new Error("session is not bound");
    }
    return subject.id;
  };

  async function node(
    tx: TransactionContext,
    vocabulary: string,
    code: string,
  ) {
    const [row] = await tx.sql<{ id: string }[]>`
      select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
       where v.code = ${vocabulary} and n.canonical_code = ${code}`;
    if (row === undefined) {
      throw new Error(`taxonomy node ${vocabulary}/${code} missing`);
    }
    return row.id;
  }

  async function mandateRow(tx: TransactionContext, mandateId: string) {
    const [row] = await tx.sql<
      {
        status: string;
        version: number;
        discovery_mode: string | null;
        min_cheque: string | null;
        max_cheque: string | null;
        currency_code: string | null;
        min_stage_code: string | null;
        max_stage_code: string | null;
        raw_mandate_text: string | null;
        effective_from: string | null;
      }[]
    >`select status, version, discovery_mode, min_cheque::text, max_cheque::text, currency_code,
             min_stage_code, max_stage_code, raw_mandate_text, effective_from::text
        from core.investor_mandates where id = ${mandateId}`;
    return row;
  }

  async function constraints(tx: TransactionContext, mandateId: string) {
    return tx.sql<
      {
        dimension: string;
        importance: string;
        is_hard_exclusion: boolean;
        value_jsonb: unknown;
      }[]
    >`select dimension, importance, is_hard_exclusion, value_jsonb
        from core.investor_mandate_constraints where mandate_id = ${mandateId}
       order by dimension, importance`;
  }

  /** Runs I0 and I1 for `actor`, returning the driver and the selected mandate id. */
  async function throughMandateContext(
    world: World,
    actor: OnboardingActor,
    input: {
      readonly type: string;
      readonly name: string;
      readonly title?: string;
    },
  ) {
    const journey = await startInvestor(world, actor);
    await journey.submit(INVESTOR_STEPS.investorType, single(input.type));
    await journey.submit(INVESTOR_STEPS.organisationName, text(input.name));
    if (input.title === undefined) {
      await journey.skip(INVESTOR_STEPS.businessTitle);
    } else {
      await journey.submit(INVESTOR_STEPS.businessTitle, text(input.title));
    }
    await journey.submit(
      INVESTOR_STEPS.deploymentStatus,
      single("actively_investing"),
    );
    const mandates = InvestorMandatesContextSchema.parse(
      journey.view().currentStep?.context,
    );
    const mandateId = mandates.suggestedMandateId;
    if (mandateId === null) {
      throw new Error("expected a suggested draft mandate");
    }
    await journey.submit(INVESTOR_STEPS.mandateContext, mandateRef(mandateId));
    return { journey, mandateId };
  }

  // -----------------------------------------------------------------------------------

  it("I0 → I12: a newcomer establishes one organisation, one investor organisation, one draft mandate, defines it and activates it", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const { journey, mandateId } = await throughMandateContext(
        world,
        newcomer,
        {
          type: "vc",
          name: "Northbank Capital",
          title: "Partner",
        },
      );

      // I0: canonical rows, one of each; the person is not the investor.
      const investorId = investorIdOf(journey.view());
      const [investor] = await tx.sql<
        {
          investor_type: string;
          display_name: string;
          deployment_state: string | null;
          organisation_id: string;
        }[]
      >`select investor_type, display_name, deployment_state, organisation_id
          from core.investor_organisations where id = ${investorId}`;
      expect(investor).toMatchObject({
        investor_type: "VC",
        display_name: "Northbank Capital",
        deployment_state: "ACTIVELY_INVESTING",
      });
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from identity.organisation_memberships where user_id = ${newcomer.userId}`,
        ),
      ).toBe(1);
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from core.investor_organisations where organisation_id = ${investor?.organisation_id ?? ""}`,
        ),
      ).toBe(1);
      const [representative] = await tx.sql<
        { business_title: string | null }[]
      >`select business_title from core.investor_representatives where investor_organisation_id = ${investorId} and user_id = ${newcomer.userId}`;
      expect(representative?.business_title).toBe("Partner");

      // I1: deployment state is investor state; the mandate stays DRAFT.
      expect((await mandateRow(tx, mandateId))?.status).toBe("DRAFT");
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from core.investor_mandates where investor_organisation_id = ${investorId}`,
        ),
      ).toBe(1);

      // I2: exact money, stage envelope, roles.
      await journey.submit(INVESTOR_STEPS.stages, multi(["series_a", "seed"]));
      await journey.submit(INVESTOR_STEPS.currency, single("usd"));
      await journey.submit(INVESTOR_STEPS.chequeMin, range("0.10"));
      await journey.submit(
        INVESTOR_STEPS.chequeTypical,
        range("123456789012.34"),
      );
      await journey.submit(INVESTOR_STEPS.chequeMax, range("999999999999.99"));
      await journey.submit(INVESTOR_STEPS.investmentRole, multi(["lead"]));
      const afterCheque = await mandateRow(tx, mandateId);
      expect(afterCheque).toMatchObject({
        min_cheque: "0.10",
        max_cheque: "999999999999.99",
        currency_code: "USD",
        min_stage_code: "seed",
        max_stage_code: "series_a",
      });
      const typical = (await constraints(tx, mandateId)).find(
        (c) => c.dimension === "cheque.typical",
      );
      expect(typical?.value_jsonb).toEqual({
        kind: "amount",
        amount: "123456789012.34",
        currency: "USD",
      });

      // I3: canonical taxonomy nodes, explicit strengths, AVOID stays soft.
      const nigeria = await node(tx, "geography", "nigeria");
      const africa = await node(tx, "geography", "africa");
      const [industryNode] = await tx.sql<
        { id: string; canonical_code: string }[]
      >`
        select n.id, n.canonical_code from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = 'industry' and n.status = 'ACTIVE' order by n.depth, n.canonical_code limit 2`;
      const industries = await tx.sql<{ id: string }[]>`
        select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = 'industry' and n.status = 'ACTIVE' order by n.depth, n.canonical_code limit 3`;
      const [sectorA, sectorB, sectorC] = industries.map((r) => r.id);
      if (
        industryNode === undefined ||
        sectorA === undefined ||
        sectorB === undefined ||
        sectorC === undefined
      ) {
        throw new Error("industry seed missing");
      }
      await journey.submit(INVESTOR_STEPS.geography, nodes([nigeria, africa]));
      await journey.submit(INVESTOR_STEPS.geographyStrength, single("must"));
      await journey.submit(INVESTOR_STEPS.sectors, nodes([sectorA]));
      await journey.skip(INVESTOR_STEPS.sectorStrength);
      await journey.submit(INVESTOR_STEPS.sectorsAvoid, nodes([sectorB]));
      const preferences = await tx.sql<
        {
          node_id: string;
          preference_strength: string;
          is_exclusion: boolean;
        }[]
      >`select node_id, preference_strength, is_exclusion from taxonomy.mandate_preferences where mandate_id = ${mandateId}`;
      const byNode = new Map(preferences.map((p) => [p.node_id, p]));
      expect(byNode.get(nigeria)).toMatchObject({
        preference_strength: "MUST",
        is_exclusion: false,
      });
      expect(byNode.get(sectorA)).toMatchObject({
        preference_strength: "STRONG",
        is_exclusion: false,
      });
      expect(byNode.get(sectorB)).toMatchObject({
        preference_strength: "AVOID",
        is_exclusion: false,
      });

      // I4: separate dimensions.
      const businessModel = await node(
        tx,
        "business_model",
        (
          await tx.sql<{ canonical_code: string }[]>`
          select n.canonical_code from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = 'business_model' and n.status = 'ACTIVE' order by n.canonical_code limit 1`
        )[0]?.canonical_code ?? "",
      );
      await journey.submit(
        INVESTOR_STEPS.businessModels,
        nodes([businessModel]),
      );
      await journey.skip(INVESTOR_STEPS.customerTypes);
      await journey.submit(
        INVESTOR_STEPS.capitalIntensity,
        single("avoid_hardware"),
      );
      await journey.submit(
        INVESTOR_STEPS.regulatoryAppetite,
        single("prefer_regulated"),
      );
      await journey.submit(
        INVESTOR_STEPS.revenueState,
        single("revenue_preferred"),
      );
      const attributes = (await constraints(tx, mandateId)).filter(
        (c) => c.dimension === "business.attribute",
      );
      expect(attributes.map((c) => [c.importance, c.value_jsonb])).toEqual([
        ["AVOID", { kind: "codes", values: ["hardware"] }],
        ["STRONG", { kind: "codes", values: ["regulated"] }],
      ]);

      // I5, I6, I7.
      await journey.submit(
        INVESTOR_STEPS.founderPreferences,
        multi(["deep_domain_expertise"]),
      );
      await journey.submit(INVESTOR_STEPS.founderStrength, single("nice"));
      await journey.submit(
        INVESTOR_STEPS.greenFlags,
        multi(["capital_efficiency", "high_retention"]),
      );
      await journey.skip(INVESTOR_STEPS.greenFlagStrength);
      await journey.submit(
        INVESTOR_STEPS.customCriteria,
        text(`Founders who ship weekly ${PRIVATE_MARKER}`),
      );
      await journey.submit(INVESTOR_STEPS.avoid, multi(["hardware_heavy"]));
      await journey.submit(INVESTOR_STEPS.hardExclusions, multi(["gambling"]));
      await journey.submit(INVESTOR_STEPS.sectorExclusions, nodes([sectorC]));
      const all = await constraints(tx, mandateId);
      const red = all.filter((c) => c.dimension === "red_flag");
      expect(red).toEqual([
        {
          dimension: "red_flag",
          importance: "AVOID",
          is_hard_exclusion: false,
          value_jsonb: { kind: "codes", values: ["hardware_heavy"] },
        },
        {
          dimension: "red_flag",
          importance: "HARD_EXCLUSION",
          is_hard_exclusion: true,
          value_jsonb: { kind: "codes", values: ["gambling"] },
        },
      ]);
      expect(all.find((c) => c.dimension === "green_flag")).toMatchObject({
        importance: "STRONG",
        value_jsonb: {
          kind: "codes",
          values: ["capital_efficiency", "high_retention"],
        },
      });
      expect(
        all.find((c) => c.dimension === "founder.business_attribute"),
      ).toMatchObject({
        importance: "NICE",
      });
      expect(all.find((c) => c.dimension === "custom.text")).toMatchObject({
        importance: "NICE",
      });
      const [sectorRow] = await tx.sql<{ is_exclusion: boolean }[]>`
        select is_exclusion from taxonomy.mandate_preferences where mandate_id = ${mandateId} and node_id = ${sectorC}`;
      expect(sectorRow?.is_exclusion).toBe(true);

      // I8: portfolio references, never companies.
      await journey.submit(
        INVESTOR_STEPS.portfolio,
        text("Stripe\nPaystack\nFlutterwave"),
      );
      const references = await tx.sql<{ company_name: string }[]>`
        select company_name from core.investor_portfolio_references
         where investor_organisation_id = ${investorId} and removed_at is null order by company_name`;
      expect(references.map((r) => r.company_name)).toEqual([
        "Flutterwave",
        "Paystack",
        "Stripe",
      ]);
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from core.companies where canonical_name in ('Stripe', 'Paystack', 'Flutterwave')`,
        ),
      ).toBe(0);

      // I9 + I10: exploratory keeps the hard exclusions; inbound is journey state.
      await journey.submit(INVESTOR_STEPS.discoveryMode, single("exploratory"));
      await journey.submit(
        INVESTOR_STEPS.inboundPreference,
        single("qualified"),
      );
      expect((await mandateRow(tx, mandateId))?.discovery_mode).toBe(
        "EXPLORATORY",
      );
      expect(
        (await constraints(tx, mandateId)).filter((c) => c.is_hard_exclusion),
      ).toHaveLength(1);

      // I11: deterministic review, then activation through the Investor domain.
      await journey.submit(
        INVESTOR_STEPS.additionalContext,
        text(`Bridge rounds welcome ${PRIVATE_MARKER}`),
      );
      const before = await mandateRow(tx, mandateId);
      expect(before?.raw_mandate_text).toContain(PRIVATE_MARKER);
      const reviewStep = journey.view();
      expect(reviewStep.currentStep?.stepKey).toBe(INVESTOR_STEPS.review);
      const review = InvestorReviewContextSchema.parse(
        reviewStep.currentStep?.context,
      );
      expect(review.investor).toMatchObject({
        displayName: "Northbank Capital",
        investorType: "VC",
        representativeTitle: "Partner",
      });
      expect(review.mandate).toMatchObject({
        status: "DRAFT",
        cheque: {
          currency: "USD",
          min: "0.10",
          typical: "123456789012.34",
          max: "999999999999.99",
        },
        discoveryMode: { key: "exploratory" },
        rawTextRecorded: true,
      });
      expect(review.mandate.geographies.map((g) => g.strength)).toEqual([
        "MUST",
        "MUST",
      ]);
      expect(review.mandate.avoid.map((a) => a.code)).toEqual([
        "hardware_heavy",
      ]);
      expect(review.mandate.hardExclusions).toHaveLength(2);
      expect(review.portfolio).toHaveLength(3);
      expect(review.onboardingOnly.inboundPreference?.key).toBe("qualified");
      const reviewText = JSON.stringify(review);
      expect(reviewText).not.toMatch(
        /Q understood|Q analysed|recommend|matches found/i,
      );
      await journey.submit(INVESTOR_STEPS.review, confirm);
      const active = await mandateRow(tx, mandateId);
      expect(active?.status).toBe("ACTIVE");
      expect(active?.effective_from).not.toBeNull();
      expect(active?.version).toBeGreaterThan(before?.version ?? 0);

      // I12 handoff: honest about recommendation; completion is journey completion only.
      const handoff = InvestorHandoffContextSchema.parse(
        journey.view().currentStep?.context,
      );
      expect(handoff.mandate.status).toBe("ACTIVE");
      expect(handoff.recommendation).toBe("NOT_AVAILABLE");
      await journey.submit(INVESTOR_STEPS.handoff, confirm);
      const completed = await world.service.runtime.completeSession({
        actor: newcomer,
        sessionId: OnboardingSessionIdSchema.parse(journey.view().session.id),
        expectedSessionVersion: journey.view().session.version,
        correlationId: CORRELATION(),
      });
      expect(completed.session.status).toBe("COMPLETED");

      // Events: canonical facts come from the Investor domain, not from onboarding.
      const events = await tx.sql<{ event_type: string; payload: unknown }[]>`
        select event_type, payload from events.outbox`;
      const types = new Set(events.map((e) => e.event_type));
      expect(types.has("core.investor_organisation.created")).toBe(true);
      expect(types.has("core.investor_mandate.created")).toBe(true);
      expect(types.has("core.investor_mandate.activated")).toBe(true);
      expect(types.has("core.investor_portfolio_reference.added")).toBe(true);
      expect(
        [...types].filter((t) => t.startsWith("onboarding.")),
      ).not.toContain("onboarding.mandate.activated");
      const serialisedEvents = JSON.stringify(events);
      expect(serialisedEvents).not.toContain(PRIVATE_MARKER);
      expect(serialisedEvents).not.toContain("Stripe");
      const audit = await tx.sql<
        { metadata: unknown }[]
      >`select metadata from audit.material_actions`;
      expect(JSON.stringify(audit)).not.toContain(PRIVATE_MARKER);
      expect(world.logs.join("\n")).not.toContain(PRIVATE_MARKER);
      expect(world.logs.join("\n")).not.toContain("Northbank");
    });
  });

  it("is retry-safe: a repeated I0 renames the same investor organisation, and restarts resume the same session and mandate", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const { journey, mandateId } = await throughMandateContext(
        world,
        newcomer,
        {
          type: "angel",
          name: "Personal Investing",
        },
      );
      const investorId = investorIdOf(journey.view());
      await journey.back(INVESTOR_STEPS.organisationName);
      await journey.submit(
        INVESTOR_STEPS.organisationName,
        text("Jane Doe Angel"),
      );
      expect(investorIdOf(journey.view())).toBe(investorId);
      const [investor] = await tx.sql<
        { display_name: string; investor_type: string }[]
      >`
        select display_name, investor_type from core.investor_organisations where id = ${investorId}`;
      expect(investor).toEqual({
        display_name: "Jane Doe Angel",
        investor_type: "ANGEL",
      });
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from identity.organisation_memberships where user_id = ${newcomer.userId}`,
        ),
      ).toBe(1);
      // The solo angel is a person in a workspace, never the investor row itself.
      const personRows = await countOf(
        tx.sql<{ count: number }[]>`
        select count(*)::int as count from core.investor_organisations i
          join identity.organisation_memberships m on m.organisation_id = i.organisation_id
         where m.user_id = ${newcomer.userId}`,
      );
      expect(personRows).toBe(1);

      // A second deployment answer does not create a second mandate.
      await journey.back(INVESTOR_STEPS.deploymentStatus);
      await journey.submit(
        INVESTOR_STEPS.deploymentStatus,
        single("selective"),
      );
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from core.investor_mandates where investor_organisation_id = ${investorId}`,
        ),
      ).toBe(1);
      const again = await world.service.runtime.startSession({
        actor: newcomer,
        journeyType: "investor",
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
      });
      expect(again.created).toBe(false);
      expect(again.view.session.id).toBe(journey.view().session.id);
      const current = await world.service.runtime.getCurrentSession({
        actor: newcomer,
        journeyType: "investor",
      });
      const stored = current?.responses.find(
        (r) => r.stepKey === INVESTOR_STEPS.mandateContext,
      );
      expect(stored?.value).toEqual({
        type: "RESOURCE_REFERENCE",
        resourceType: "INVESTOR_MANDATE",
        resourceIds: [mandateId],
      });
    });
  });

  it("an existing member uses their explicit organisation context; typing another firm's name never joins it", async () => {
    await withWorld(async (world) => {
      const { tx, existingAdmin, existingOrgId, existingOrgName, newcomer } =
        world;
      const membersBefore = await countOf(
        tx.sql<
          { count: number }[]
        >`select count(*)::int as count from identity.organisation_memberships where organisation_id = ${existingOrgId}`,
      );
      const admin = await throughMandateContext(world, existingAdmin, {
        type: "vc",
        name: existingOrgName,
      });
      const [investor] = await tx.sql<{ organisation_id: string }[]>`
        select organisation_id from core.investor_organisations where id = ${investorIdOf(admin.journey.view())}`;
      expect(investor?.organisation_id).toBe(existingOrgId);
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from identity.organisations where display_name = ${existingOrgName}`,
        ),
      ).toBe(1);

      // A newcomer typing "Apex Ventures" gets their own workspace, not Apex.
      const spoof = await throughMandateContext(world, newcomer, {
        type: "vc",
        name: existingOrgName,
      });
      const [spoofInvestor] = await tx.sql<{ organisation_id: string }[]>`
        select organisation_id from core.investor_organisations where id = ${investorIdOf(spoof.journey.view())}`;
      expect(spoofInvestor?.organisation_id).not.toBe(existingOrgId);
      expect(
        await countOf(
          tx.sql<
            { count: number }[]
          >`select count(*)::int as count from identity.organisation_memberships where organisation_id = ${existingOrgId}`,
        ),
      ).toBe(membersBefore);
    });
  });

  it("a business title grants nothing: a member without mandate capabilities is denied and the step stores nothing", async () => {
    await withWorld(async (world) => {
      const { tx, existingAdmin, existingMember } = world;
      // The admin establishes the investor organisation for the firm.
      await throughMandateContext(world, existingAdmin, {
        type: "vc",
        name: "Apex Ventures",
      });
      const journey = await startInvestor(world, existingMember);
      await journey.submit(INVESTOR_STEPS.investorType, single("vc"));
      await journey.submit(
        INVESTOR_STEPS.organisationName,
        text("Apex Ventures"),
      );
      await journey.submit(
        INVESTOR_STEPS.businessTitle,
        text("Managing Partner"),
      );
      const investorId = investorIdOf(journey.view());
      const [before] = await tx.sql<
        { deployment_state: string | null; version: number }[]
      >`
        select deployment_state, version from core.investor_organisations where id = ${investorId}`;
      await expect(
        journey.submit(INVESTOR_STEPS.deploymentStatus, single("paused")),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const [after] = await tx.sql<
        { deployment_state: string | null; version: number }[]
      >`
        select deployment_state, version from core.investor_organisations where id = ${investorId}`;
      expect(after).toEqual(before);
      const refreshed = await journey.refresh();
      expect(refreshed.responses.map((r) => r.stepKey)).not.toContain(
        INVESTOR_STEPS.deploymentStatus,
      );
    });
  });

  it("with several open mandates nothing is picked implicitly; a closed or foreign mandate is refused", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer, existingAdmin } = world;
      const other = await throughMandateContext(world, existingAdmin, {
        type: "vc",
        name: "Apex Ventures",
      });
      const journey = await startInvestor(world, newcomer);
      await journey.submit(
        INVESTOR_STEPS.investorType,
        single("family_office"),
      );
      await journey.submit(
        INVESTOR_STEPS.organisationName,
        text("Doe Family Office"),
      );
      await journey.skip(INVESTOR_STEPS.businessTitle);
      await journey.submit(
        INVESTOR_STEPS.deploymentStatus,
        single("selective"),
      );
      const investorId = investorIdOf(journey.view());
      const first = InvestorMandatesContextSchema.parse(
        journey.view().currentStep?.context,
      );
      expect(first.candidates).toHaveLength(1);
      // A second draft appears (created outside onboarding): ambiguity, no default.
      await tx.sql`insert into core.investor_mandates (tenant_id, investor_organisation_id, name, created_by_user_id)
        select tenant_id, id, 'Opportunity fund', ${newcomer.userId} from core.investor_organisations where id = ${investorId}`;
      const ambiguous = InvestorMandatesContextSchema.parse(
        (await journey.refresh()).currentStep?.context,
      );
      expect(ambiguous.candidates).toHaveLength(2);
      expect(ambiguous.suggestedMandateId).toBeNull();
      // Another investor's mandate is unknown here; nothing is recorded.
      await expect(
        journey.submit(
          INVESTOR_STEPS.mandateContext,
          mandateRef(other.mandateId),
        ),
      ).rejects.toBeInstanceOf(ContractValidationError);
      const chosen = ambiguous.candidates.find(
        (c) => c.name === "Opportunity fund",
      );
      if (chosen === undefined) throw new Error("candidate missing");
      await journey.submit(
        INVESTOR_STEPS.mandateContext,
        mandateRef(chosen.mandateId),
      );
      await journey.submit(INVESTOR_STEPS.stages, multi(["seed"]));
      expect((await mandateRow(tx, chosen.mandateId))?.min_stage_code).toBe(
        "seed",
      );
      expect(
        (await mandateRow(tx, other.mandateId))?.min_stage_code,
      ).toBeNull();
    });
  });

  it("refuses an inverted cheque range and a protected attribute, leaving the mandate untouched", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer } = world;
      const { journey, mandateId } = await throughMandateContext(
        world,
        newcomer,
        {
          type: "vc",
          name: "Range Capital",
        },
      );
      await journey.submit(INVESTOR_STEPS.stages, multi(["seed"]));
      await journey.submit(INVESTOR_STEPS.currency, single("eur"));
      await journey.submit(INVESTOR_STEPS.chequeMin, range("500000"));
      const versionBefore = (await mandateRow(tx, mandateId))?.version;
      await expect(
        journey.submit(INVESTOR_STEPS.chequeTypical, range("250000")),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        journey.submit(INVESTOR_STEPS.chequeMax, range("100000")),
      ).rejects.toBeInstanceOf(ContractValidationError);
      expect((await mandateRow(tx, mandateId))?.version).toBe(versionBefore);
      await journey.skip(INVESTOR_STEPS.chequeTypical);
      await journey.skip(INVESTOR_STEPS.chequeMax);
      await journey.skip(INVESTOR_STEPS.investmentRole);
      for (const key of [
        INVESTOR_STEPS.geography,
        INVESTOR_STEPS.sectors,
        INVESTOR_STEPS.sectorsAvoid,
        INVESTOR_STEPS.businessModels,
        INVESTOR_STEPS.customerTypes,
        INVESTOR_STEPS.capitalIntensity,
        INVESTOR_STEPS.regulatoryAppetite,
        INVESTOR_STEPS.revenueState,
      ]) {
        await journey.skip(key);
      }
      // A protected trait smuggled into the founder step is refused by the
      // runtime's option validation; the mandate is never touched.
      await expect(
        journey.submit(
          INVESTOR_STEPS.founderPreferences,
          multi(["founder_ethnicity"]),
        ),
      ).rejects.toBeInstanceOf(ContractValidationError);
      expect((await mandateRow(tx, mandateId))?.version).toBe(versionBefore);
      expect(
        (await constraints(tx, mandateId)).some(
          (c) => c.dimension === "founder.business_attribute",
        ),
      ).toBe(false);
    });
  });

  it("keeps sessions and mandates invisible across users and tenants, and refuses stale writes", async () => {
    await withWorld(async (world) => {
      const { tx, newcomer, stranger, existingAdmin } = world;
      const { journey, mandateId } = await throughMandateContext(
        world,
        newcomer,
        {
          type: "vc",
          name: "Private Capital",
        },
      );
      for (const other of [stranger, existingAdmin]) {
        await expect(
          world.service.runtime.getSession({
            actor: other,
            sessionId: OnboardingSessionIdSchema.parse(
              journey.view().session.id,
            ),
          }),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      }
      // A stale session version never overwrites the declared mandate.
      const stale = journey.view().session.version;
      await journey.submit(INVESTOR_STEPS.stages, multi(["seed"]));
      await expect(
        world.service.runtime.submitResponse({
          actor: newcomer,
          sessionId: OnboardingSessionIdSchema.parse(journey.view().session.id),
          stepKey: INVESTOR_STEPS.stages,
          response: { value: multi(["series_b"]) },
          expectedSessionVersion: stale,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OnboardingSessionVersionConflictError);
      expect((await mandateRow(tx, mandateId))?.min_stage_code).toBe("seed");
      // The mandate keeps its own version domain: a concurrent domain change
      // outside onboarding bumps it, and the next step still reads it fresh.
      const services = createInvestorDomainServices(tx, {
        outbox: createOutboxWriter({ registry }),
        audit: createPostgresMaterialActionAuditWriter(),
      });
      const [sessionRow] = await tx.sql<{ organisation_id: string }[]>`
        select organisation_id from onboarding.sessions where id = ${journey.view().session.id}`;
      const bound = await resolveInvestorContext(
        services,
        newcomer,
        OrganisationIdSchema.parse(sessionRow?.organisation_id),
      );
      const mandate = await services.investors.getInvestorMandate({
        actor: bound,
        investorOrganisationId: InvestorOrganisationIdSchema.parse(
          investorIdOf(journey.view()),
        ),
        mandateId: InvestorMandateIdSchema.parse(mandateId),
      });
      await expect(
        services.investors.updateInvestorMandate({
          actor: bound,
          investorOrganisationId: mandate.investorOrganisationId,
          mandateId: mandate.id,
          input: { expectedVersion: mandate.version - 1, name: "Stale name" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(InvestorVersionConflictError);
      await journey.submit(INVESTOR_STEPS.currency, single("gbp"));
      expect((await mandateRow(tx, mandateId))?.currency_code).toBe("GBP");
    });
  });
});
