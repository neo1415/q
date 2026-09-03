import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CapitalObjectiveIdSchema,
  createPostgresCapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  FounderProfileIdSchema,
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
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import { createNetworkService, type NetworkService } from "@capital-q/network";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import {
  AuthorizationDeniedError,
  AuthorizationRequirementError,
  AuthUserIdSchema,
  capability,
  createAuthorizationService,
  OrganisationIdSchema,
  resolveHumanActorContext,
  TenantIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
  type AuthorizationService,
  type OrganisationId,
  type TenantId,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import {
  actorPrincipal,
  ANONYMOUS_PRINCIPAL,
  createDefaultDisclosureResolvers,
  createDisclosureResourceResolverRegistry,
  createPermissionsService,
  createRelationshipPartyResolver,
  DisclosureDeniedError,
  DisclosurePolicyConflictError,
  DisclosurePolicyIdSchema,
  DisclosurePolicyInvalidError,
  DisclosureResourceNotFoundError,
  type DisclosureAccessLevel,
  type DisclosurePrincipal,
  type DisclosureResourceRef,
  type PermissionsService,
} from "../src/index.js";
import { PERMISSIONS_EVENTS } from "../src/events/index.js";

/**
 * The disclosure layer against the real local database. Every test runs in
 * one rolled-back transaction with a savepoint-backed TransactionManager.
 *
 * Fixtures (synthetic): tenant C holds Company Alpha with Founder Alpha
 * (organisation_admin) and a colleague (organisation_member, founder,
 * "CEO"); tenant I holds investor Apex with an admin and a "Partner"
 * representative (organisation_member); tenant H holds investor Horizon
 * with an admin. Relationships Alpha↔Apex and Alpha↔Horizon exist through
 * the Network service. Private markers live in the founder profile, the
 * Apex mandate and the company description.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const FOUNDER_MARKER = "OUR-LARGEST-CUSTOMER-MAY-LEAVE";
const INVESTOR_MARKER = "MAX-VALUATION-25M";
const CONTENT_MARKER = "PRIVATE-DISCLOSURE-CONTENT-DO-NOT-EMIT";
const COMPANY_VIEW = capability("company.view");

class Rollback extends Error {}

const registry = createEventRegistry([
  ...PERMISSIONS_EVENTS,
  ...NETWORK_EVENTS,
]);

type Member = {
  readonly principal: AuthenticatedPrincipal;
  readonly membershipId: string;
  readonly userId: string;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: PermissionsService;
  readonly network: NetworkService;
  readonly authorization: AuthorizationService;
  readonly clock: { now: () => string; set: (iso: string) => void };
  readonly tenantC: TenantId;
  readonly tenantI: TenantId;
  readonly tenantH: TenantId;
  readonly orgAlpha: OrganisationId;
  readonly orgApex: OrganisationId;
  readonly orgHorizon: OrganisationId;
  readonly founderAlpha: ActorContext;
  readonly alphaColleague: ActorContext;
  readonly apexAdmin: ActorContext;
  readonly apexPartner: ActorContext;
  readonly horizonAdmin: ActorContext;
  readonly apexPartnerMember: Member;
  readonly companyAlpha: CompanyId;
  readonly founderProfileId: string;
  readonly investorApex: InvestorOrganisationId;
  readonly investorHorizon: InvestorOrganisationId;
  readonly apexMandateId: string;
  readonly capitalObjectiveId: string;
  readonly relationshipApex: string;
  readonly relationshipHorizon: string;
  readonly discoveredEventId: string;
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

describe("@capital-q/permissions against local PostgreSQL", () => {
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

  // Fixture builders -----------------------------------------------------------------

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    type: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, ${type}, ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<Member> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
      userId: profile.id,
    };
  }

  async function resolveActor(
    tx: TransactionContext,
    principal: AuthenticatedPrincipal,
  ): Promise<ActorContext> {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  function buildService(
    tx: TransactionContext,
    authorization: AuthorizationService,
    outbox: OutboxWriter,
    clock: { now: () => string },
    audit = createPostgresMaterialActionAuditWriter(),
  ): { service: PermissionsService; network: NetworkService } {
    const sql = tx.sql;
    const companies = createPostgresCompanyQueryPort({ sql });
    const investors = createPostgresInvestorOrganisationQueryPort({ sql });
    const mandates = createPostgresInvestorMandateQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const network = createNetworkService({
      sql,
      transactions: nestedTransactions(tx),
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
    const service = createPermissionsService({
      sql,
      transactions: nestedTransactions(tx),
      authorization,
      outbox,
      audit,
      clock: { now: () => UtcTimestampSchema.parse(clock.now()) },
      resolvers: createDisclosureResourceResolverRegistry(
        createDefaultDisclosureResolvers(ports),
      ),
      relationshipParties: createRelationshipPartyResolver(ports),
    });
    return { service, network };
  }

  async function seedWorld(
    tx: TransactionContext,
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
      readonly authorization?:
        ((real: AuthorizationService) => AuthorizationService) | undefined;
      readonly auditFailure?: boolean | undefined;
    },
  ): Promise<World> {
    const tenantC = await insertTenant(tx, "Disclosure Company Tenant");
    const tenantI = await insertTenant(tx, "Disclosure Investor Tenant");
    const tenantH = await insertTenant(tx, "Disclosure Horizon Tenant");
    const orgAlpha = await insertOrganisation(tx, tenantC, "company", "Alpha");
    const orgApex = await insertOrganisation(
      tx,
      tenantI,
      "investment_firm",
      "Apex",
    );
    const orgHorizon = await insertOrganisation(
      tx,
      tenantH,
      "investment_firm",
      "Horizon",
    );

    const founder = await insertMember(
      tx,
      tenantC,
      orgAlpha,
      "organisation_admin",
    );
    const colleague = await insertMember(
      tx,
      tenantC,
      orgAlpha,
      "organisation_member",
    );
    const apexAdminMember = await insertMember(
      tx,
      tenantI,
      orgApex,
      "organisation_admin",
    );
    const apexPartnerMember = await insertMember(
      tx,
      tenantI,
      orgApex,
      "organisation_member",
    );
    const horizonAdminMember = await insertMember(
      tx,
      tenantH,
      orgHorizon,
      "organisation_admin",
    );

    const companyId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description)
      values (${companyId}, ${tenantC}, ${orgAlpha}, 'Alpha Robotics', ${`alpha-${companyId.slice(0, 8)}`}, ${`Alpha builds robots. ${CONTENT_MARKER}`})`;
    const companyAlpha = CompanyIdSchema.parse(companyId);
    // The colleague is a founder with a CEO title -- neither grants disclosure authority.
    await tx.sql`insert into core.company_members (tenant_id, company_id, user_id, business_title, is_founder)
      values (${tenantC}, ${companyId}, ${colleague.userId}, 'CEO', true)`;
    const founderProfileId = randomUUID();
    await tx.sql`insert into core.founder_profiles (id, tenant_id, user_id, primary_company_id, professional_summary)
      values (${founderProfileId}, ${tenantC}, ${founder.userId}, ${companyId}, ${`Founder note: ${FOUNDER_MARKER}`})`;
    const capitalObjectiveId = randomUUID();
    await tx.sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id, use_of_funds_summary)
      values (${capitalObjectiveId}, ${tenantC}, ${companyId}, 5000000, 'USD', ${founder.userId}, ${`Use of funds ${CONTENT_MARKER}`})`;

    const apexId = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${apexId}, ${tenantI}, ${orgApex}, 'VC', 'Apex Ventures')`;
    const horizonId = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${horizonId}, ${tenantH}, ${orgHorizon}, 'VC', 'Horizon Capital')`;
    const apexMandateId = randomUUID();
    await tx.sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, raw_mandate_text, created_by_user_id)
      values (${apexMandateId}, ${tenantI}, ${apexId}, 'Seed thesis', ${`Negotiation ceiling ${INVESTOR_MARKER}`}, ${apexAdminMember.userId})`;
    await tx.sql`insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title)
      values (${tenantI}, ${apexId}, ${orgApex}, ${apexPartnerMember.userId}, ${apexPartnerMember.membershipId}, 'Partner')`;

    const founderAlpha = await resolveActor(tx, founder.principal);
    const alphaColleague = await resolveActor(tx, colleague.principal);
    const apexAdmin = await resolveActor(tx, apexAdminMember.principal);
    const apexPartner = await resolveActor(tx, apexPartnerMember.principal);
    const horizonAdmin = await resolveActor(tx, horizonAdminMember.principal);

    // Live time unless a test pins it; a pinned instant must never precede
    // rows the database stamps with clock_timestamp().
    let pinned: string | null = null;
    const clock = {
      now: () => pinned ?? new Date().toISOString(),
      set: (iso: string) => {
        pinned = iso;
      },
    };
    const realOutbox = createOutboxWriter({ registry });
    const realAuthorization = createAuthorizationService(
      createPostgresAuthorizationPolicySource({ sql: tx.sql }),
    );
    const audit = createPostgresMaterialActionAuditWriter();
    const { service, network } = buildService(
      tx,
      options.authorization === undefined
        ? realAuthorization
        : options.authorization(realAuthorization),
      options.outbox === undefined ? realOutbox : options.outbox(realOutbox),
      clock,
      options.auditFailure === true
        ? {
            record: (tx, input) =>
              input.actionType === "disclosure.revoked"
                ? Promise.reject(new Error("audit unavailable"))
                : audit.record(tx, input),
          }
        : audit,
    );

    const investorApex = InvestorOrganisationIdSchema.parse(apexId);
    const investorHorizon = InvestorOrganisationIdSchema.parse(horizonId);
    const apexRelationship = await network.ensureRelationship({
      actor: apexAdmin,
      companyId: companyAlpha,
      investorOrganisationId: investorApex,
      source: { type: "DISCOVER", id: `slate:${CONTENT_MARKER}` },
      visibilityScope: "investor_private",
      correlationId: CORRELATION(),
    });
    const horizonRelationship = await network.ensureRelationship({
      actor: horizonAdmin,
      companyId: companyAlpha,
      investorOrganisationId: investorHorizon,
      source: { type: "DISCOVER" },
      visibilityScope: "investor_private",
      correlationId: CORRELATION(),
    });
    const [discovered] = await network.query.listEvents(
      apexRelationship.relationship.id,
    );
    if (discovered === undefined) {
      throw new Error("discovered event missing");
    }

    return {
      tx,
      service,
      network,
      authorization: realAuthorization,
      clock,
      tenantC: TenantIdSchema.parse(tenantC),
      tenantI: TenantIdSchema.parse(tenantI),
      tenantH: TenantIdSchema.parse(tenantH),
      orgAlpha: OrganisationIdSchema.parse(orgAlpha),
      orgApex: OrganisationIdSchema.parse(orgApex),
      orgHorizon: OrganisationIdSchema.parse(orgHorizon),
      founderAlpha,
      alphaColleague,
      apexAdmin,
      apexPartner,
      horizonAdmin,
      apexPartnerMember,
      companyAlpha,
      founderProfileId,
      investorApex,
      investorHorizon,
      apexMandateId,
      capitalObjectiveId,
      relationshipApex: apexRelationship.relationship.id,
      relationshipHorizon: horizonRelationship.relationship.id,
      discoveredEventId: discovered.id,
    };
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
    options: Parameters<typeof seedWorld>[1] = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const world = await seedWorld(tx, options);
        await work(world);
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

  function ref(
    type: DisclosureResourceRef["type"],
    id: string,
  ): DisclosureResourceRef {
    return { type, id };
  }

  async function decide(
    world: World,
    principal: DisclosurePrincipal,
    resource: DisclosureResourceRef,
    requestedAccess: DisclosureAccessLevel = "view",
  ) {
    return world.service.access.canDisclose({
      principal,
      resource,
      requestedAccess,
    });
  }

  async function outcomes(
    world: World,
    resource: DisclosureResourceRef,
    requestedAccess: DisclosureAccessLevel = "view",
  ) {
    const principals = [
      actorPrincipal(world.founderAlpha),
      actorPrincipal(world.apexAdmin),
      actorPrincipal(world.horizonAdmin),
      ANONYMOUS_PRINCIPAL,
    ];
    const decisions = await world.service.access.evaluateMany(
      principals.map((principal) => ({ principal, resource, requestedAccess })),
    );
    return decisions.map((decision) => decision.outcome);
  }

  // -------------------------------------------------------------------------
  // Cross-party matrix (§186-189)
  // -------------------------------------------------------------------------

  it("cross-party matrix: founder-private, investor-private, relationship-shared, specific, network and public", async () => {
    await withWorld(async (world) => {
      const { tx, service, founderAlpha, apexAdmin, companyAlpha } = world;
      const profile = ref("founder_profile", world.founderProfileId);
      const mandate = ref("investor_mandate", world.apexMandateId);
      const company = ref("company", companyAlpha);
      const relationship = ref("relationship", world.relationshipApex);

      // founder_private: Apex has a real relationship with Alpha and still gets nothing.
      expect(await outcomes(world, profile)).toEqual([
        "ALLOW",
        "DENY",
        "DENY",
        "DENY",
      ]);
      expect(
        await decide(world, actorPrincipal(apexAdmin), profile),
      ).toMatchObject({
        outcome: "DENY",
        reasonCode: "NO_MATCHING_SCOPE",
      });
      // investor_private (Apex): the founder with a relationship gets nothing.
      expect(await outcomes(world, mandate)).toEqual([
        "DENY",
        "ALLOW",
        "DENY",
        "DENY",
      ]);
      // capital objective and investor organisation follow their sides.
      expect(
        await outcomes(
          world,
          ref("capital_objective", world.capitalObjectiveId),
        ),
      ).toEqual(["ALLOW", "DENY", "DENY", "DENY"]);
      expect(
        await outcomes(world, ref("investor_organisation", world.investorApex)),
      ).toEqual(["DENY", "ALLOW", "DENY", "DENY"]);

      // relationship_shared A-Apex: granted by the founder side on the relationship itself.
      const shared = await service.policies.grant({
        actor: founderAlpha,
        resource: relationship,
        scopeType: "relationship_shared",
        recipient: { type: "RELATIONSHIP", id: world.relationshipApex },
        accessLevel: "view",
        correlationId: CORRELATION(),
      });
      expect(shared.outcome).toBe("CREATED");
      expect(await outcomes(world, relationship)).toEqual([
        "ALLOW",
        "ALLOW",
        "DENY",
        "DENY",
      ]);
      // ... and the Alpha-Horizon relationship gained nothing from it.
      expect(
        await outcomes(world, ref("relationship", world.relationshipHorizon)),
      ).toEqual(["DENY", "DENY", "DENY", "DENY"]);

      // specifically_shared to Apex on the founder-private profile.
      await service.policies.grant({
        actor: founderAlpha,
        resource: profile,
        scopeType: "specifically_shared",
        recipient: { type: "ORGANISATION", id: world.orgApex },
        accessLevel: "view",
        correlationId: CORRELATION(),
      });
      expect(await outcomes(world, profile)).toEqual([
        "ALLOW",
        "ALLOW",
        "DENY",
        "DENY",
      ]);
      expect(await outcomes(world, profile, "view_download")).toEqual([
        "ALLOW",
        "DENY",
        "DENY",
        "DENY",
      ]);

      // network_visible / public_external through the company's own classification.
      expect(await outcomes(world, company)).toEqual([
        "ALLOW",
        "DENY",
        "DENY",
        "DENY",
      ]);
      await tx.sql`update core.companies set marketplace_visibility = 'network_visible' where id = ${companyAlpha}`;
      expect(await outcomes(world, company)).toEqual([
        "ALLOW",
        "ALLOW",
        "ALLOW",
        "DENY",
      ]);
      expect(await decide(world, ANONYMOUS_PRINCIPAL, company)).toMatchObject({
        outcome: "DENY",
        reasonCode: "AUTHENTICATION_REQUIRED",
      });
      await tx.sql`update core.companies set marketplace_visibility = 'public_external' where id = ${companyAlpha}`;
      expect(await outcomes(world, company)).toEqual([
        "ALLOW",
        "ALLOW",
        "ALLOW",
        "ALLOW",
      ]);
      // Public disclosure does not open the raw table to anyone: the ACL and
      // the company row are still server-only / RLS-guarded (pgTAP covers roles).
      expect(
        await count(
          tx.sql`select count(*)::int as count from permissions.disclosure_policies where resource_id = ${companyAlpha}`,
        ),
      ).toBe(0);
    });
  });

  it("relationship sharing respects the exact parties across tenants (ADR 0003) and refuses non-parties (§139-140)", async () => {
    await withWorld(async (world) => {
      const {
        service,
        founderAlpha,
        apexAdmin,
        horizonAdmin,
        tenantC,
        tenantI,
      } = world;
      const relationship = ref("relationship", world.relationshipApex);
      // No policy yet: existence is not disclosure.
      expect(
        await decide(world, actorPrincipal(founderAlpha), relationship),
      ).toMatchObject({
        outcome: "DENY",
        reasonCode: "UNKNOWN_RESOURCE_SCOPE",
      });
      // The investor party may share into the relationship from its own tenant.
      const byApex = await service.policies.grant({
        actor: apexAdmin,
        resource: relationship,
        scopeType: "relationship_shared",
        recipient: { type: "RELATIONSHIP", id: world.relationshipApex },
        accessLevel: "view_download",
        correlationId: CORRELATION(),
      });
      expect(byApex.outcome).toBe("CREATED");
      expect(byApex.policy?.tenantId).toBe(tenantC);
      expect(tenantI).not.toBe(tenantC);
      expect(
        await decide(
          world,
          actorPrincipal(founderAlpha),
          relationship,
          "view_download",
        ),
      ).toMatchObject({
        outcome: "ALLOW",
        reasonCode: "RELATIONSHIP_PARTY",
      });
      expect(
        await decide(
          world,
          actorPrincipal(apexAdmin),
          relationship,
          "view_download",
        ),
      ).toMatchObject({
        outcome: "ALLOW",
        reasonCode: "RELATIONSHIP_PARTY",
      });
      expect(
        (await decide(world, actorPrincipal(horizonAdmin), relationship))
          .outcome,
      ).toBe("DENY");
      // Horizon, a non-party, cannot share into the Alpha-Apex relationship.
      await expect(
        service.policies.grant({
          actor: horizonAdmin,
          resource: relationship,
          scopeType: "relationship_shared",
          recipient: { type: "RELATIONSHIP", id: world.relationshipApex },
          accessLevel: "view",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // A share of the founder profile into the Alpha-Horizon relationship never reaches Apex.
      await service.policies.grant({
        actor: founderAlpha,
        resource: ref("founder_profile", world.founderProfileId),
        scopeType: "specifically_shared",
        recipient: { type: "RELATIONSHIP", id: world.relationshipHorizon },
        accessLevel: "view",
        correlationId: CORRELATION(),
      });
      expect(
        await outcomes(world, ref("founder_profile", world.founderProfileId)),
      ).toEqual(["ALLOW", "DENY", "ALLOW", "DENY"]);
      // A relationship event may only be shared inside its own relationship.
      await expect(
        service.policies.grant({
          actor: apexAdmin,
          resource: ref("relationship_event", world.discoveredEventId),
          scopeType: "relationship_shared",
          recipient: { type: "RELATIONSHIP", id: world.relationshipHorizon },
          accessLevel: "view",
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "RELATIONSHIP_MISMATCH" });
    });
  });

  it("relationship events keep their recorded scope: investor_private discovery is invisible to the founder (§141)", async () => {
    await withWorld(async (world) => {
      const event = ref("relationship_event", world.discoveredEventId);
      expect(await outcomes(world, event)).toEqual([
        "DENY",
        "ALLOW",
        "DENY",
        "DENY",
      ]);
      const [row] = await world.tx.sql<{ visibility_scope: string }[]>`
        select visibility_scope from network.relationship_events where id = ${world.discoveredEventId}`;
      expect(row?.visibility_scope).toBe("investor_private");
    });
  });

  // -------------------------------------------------------------------------
  // Scopes and recipients
  // -------------------------------------------------------------------------

  it("personal_private admits only the Person; organisation_private admits the organisation (§122-123)", async () => {
    await withWorld(async (world) => {
      const { tx, founderAlpha, alphaColleague, apexAdmin } = world;
      await tx.sql`update core.founder_profiles set visibility_scope = 'personal_private' where id = ${world.founderProfileId}`;
      const profile = ref("founder_profile", world.founderProfileId);
      expect(
        (await decide(world, actorPrincipal(founderAlpha), profile)).reasonCode,
      ).toBe("OWNER");
      expect(
        (await decide(world, actorPrincipal(alphaColleague), profile)).outcome,
      ).toBe("DENY");
      const company = ref("company", world.companyAlpha);
      expect(
        (await decide(world, actorPrincipal(founderAlpha), company)).outcome,
      ).toBe("ALLOW");
      expect(
        (await decide(world, actorPrincipal(alphaColleague), company)).outcome,
      ).toBe("ALLOW");
      expect(
        (await decide(world, actorPrincipal(apexAdmin), company)).outcome,
      ).toBe("DENY");
    });
  });

  it("specific USER, MEMBERSHIP and ORGANISATION recipients; a revoked membership loses its share by losing its context (§127-129)", async () => {
    await withWorld(async (world) => {
      const {
        tx,
        service,
        founderAlpha,
        apexAdmin,
        apexPartner,
        horizonAdmin,
      } = world;
      const profile = ref("founder_profile", world.founderProfileId);
      const grant = (recipient: {
        type: "USER" | "MEMBERSHIP" | "ORGANISATION";
        id: string;
      }) =>
        service.policies.grant({
          actor: founderAlpha,
          resource: profile,
          scopeType: "specifically_shared",
          recipient,
          accessLevel: "view",
          correlationId: CORRELATION(),
        });
      await grant({ type: "USER", id: apexPartner.userId });
      expect(
        (await decide(world, actorPrincipal(apexPartner), profile)).reasonCode,
      ).toBe("EXPLICIT_RECIPIENT");
      expect(
        (await decide(world, actorPrincipal(apexAdmin), profile)).outcome,
      ).toBe("DENY");

      await grant({ type: "ORGANISATION", id: world.orgHorizon });
      expect(
        (await decide(world, actorPrincipal(horizonAdmin), profile)).outcome,
      ).toBe("ALLOW");
      expect(
        (await decide(world, actorPrincipal(apexAdmin), profile)).outcome,
      ).toBe("DENY");

      await grant({
        type: "MEMBERSHIP",
        id: world.apexPartnerMember.membershipId,
      });
      expect(
        (await decide(world, actorPrincipal(apexPartner), profile)).outcome,
      ).toBe("ALLOW");
      await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = now() where id = ${world.apexPartnerMember.membershipId}`;
      const resolution = await resolveHumanActorContext(
        createPostgresActorContextResolver({ sql: tx.sql }),
        { principal: world.apexPartnerMember.principal },
      );
      expect(resolution.status).not.toBe("RESOLVED");
    });
  });

  it("expiry uses the injected clock, revocation keeps history, view never satisfies download (§131-133)", async () => {
    await withWorld(async (world) => {
      const { tx, service, founderAlpha, apexAdmin, clock } = world;
      const profile = ref("founder_profile", world.founderProfileId);
      const t2 = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { policy } = await service.policies.grant({
        actor: founderAlpha,
        resource: profile,
        scopeType: "specifically_shared",
        recipient: { type: "ORGANISATION", id: world.orgApex },
        accessLevel: "view",
        expiresAt: UtcTimestampSchema.parse(t2),
        correlationId: CORRELATION(),
      });
      expect(policy).not.toBeNull();
      const apex = actorPrincipal(apexAdmin);
      expect((await decide(world, apex, profile, "view")).outcome).toBe(
        "ALLOW",
      );
      expect(await decide(world, apex, profile, "view_download")).toMatchObject(
        {
          outcome: "DENY",
          reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
        },
      );
      clock.set(new Date(Date.parse(t2) + 1000).toISOString());
      expect(await decide(world, apex, profile)).toMatchObject({
        outcome: "DENY",
        reasonCode: "POLICY_EXPIRED",
      });
      clock.set(new Date(Date.now() + 1000).toISOString());
      expect((await decide(world, apex, profile)).outcome).toBe("ALLOW");

      const download = await service.policies.grant({
        actor: founderAlpha,
        resource: profile,
        scopeType: "specifically_shared",
        recipient: { type: "ORGANISATION", id: world.orgApex },
        accessLevel: "view_download",
        correlationId: CORRELATION(),
      });
      expect(download.outcome).toBe("CREATED");
      expect(
        (await decide(world, apex, profile, "view_download")).outcome,
      ).toBe("ALLOW");

      if (policy === null || download.policy === null) {
        throw new Error("policies expected");
      }
      const revoked = await service.policies.revoke({
        actor: founderAlpha,
        disclosurePolicyId: download.policy.id,
        correlationId: CORRELATION(),
      });
      expect(revoked.outcome).toBe("REVOKED");
      expect(revoked.policy.revokedAt).not.toBeNull();
      // Another active path (the view share) still holds: no false "no access".
      expect((await decide(world, apex, profile, "view")).outcome).toBe(
        "ALLOW",
      );
      expect(
        (await decide(world, apex, profile, "view_download")).outcome,
      ).toBe("DENY");
      const again = await service.policies.revoke({
        actor: founderAlpha,
        disclosurePolicyId: download.policy.id,
        correlationId: CORRELATION(),
      });
      expect(again.outcome).toBe("ALREADY_REVOKED");
      expect(
        await count(
          tx.sql`select count(*)::int as count from permissions.disclosure_policies where resource_id = ${world.founderProfileId}`,
        ),
      ).toBe(2);
      const inspection = await service.inspectResourceDisclosure({
        actor: founderAlpha,
        resource: profile,
      });
      expect(inspection.intrinsicScope).toBe("founder_private");
      expect(inspection.policies.map((p) => p.status).sort()).toEqual([
        "ACTIVE",
        "REVOKED",
      ]);
      // A recipient does not get the recipient list.
      await expect(
        service.inspectResourceDisclosure({
          actor: apexAdmin,
          resource: profile,
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    });
  });

  // -------------------------------------------------------------------------
  // Authority
  // -------------------------------------------------------------------------

  it("sharing needs disclosure.manage over the owning organisation: fake owner, recipient re-share, founder title and Partner title all fail (§144-147)", async () => {
    await withWorld(async (world) => {
      const {
        service,
        founderAlpha,
        alphaColleague,
        apexAdmin,
        apexPartner,
        horizonAdmin,
      } = world;
      const profile = ref("founder_profile", world.founderProfileId);
      const share = (
        actor: ActorContext,
        resource: DisclosureResourceRef,
        recipientOrg: string,
      ) =>
        service.policies.grant({
          actor,
          resource,
          scopeType: "specifically_shared",
          recipient: { type: "ORGANISATION", id: recipientOrg },
          accessLevel: "view",
          correlationId: CORRELATION(),
        });
      // Apex admin (admin of its own org) cannot share Alpha's resource: the server resolves the owner.
      await expect(
        share(apexAdmin, profile, world.orgApex),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // Recipient cannot re-share what it received.
      await share(founderAlpha, profile, world.orgApex);
      expect(
        (await decide(world, actorPrincipal(apexAdmin), profile)).outcome,
      ).toBe("ALLOW");
      await expect(
        share(apexAdmin, profile, world.orgHorizon),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      expect(
        (await decide(world, actorPrincipal(horizonAdmin), profile)).outcome,
      ).toBe("DENY");
      // Founder + CEO title without the capability.
      await expect(
        share(
          alphaColleague,
          ref("company", world.companyAlpha),
          world.orgApex,
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // Partner title without the capability.
      await expect(
        share(
          apexPartner,
          ref("investor_mandate", world.apexMandateId),
          world.orgAlpha,
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // A recipient cannot revoke someone else's access.
      const inspection = await service.inspectResourceDisclosure({
        actor: founderAlpha,
        resource: profile,
      });
      const [existing] = inspection.policies;
      if (existing === undefined) {
        throw new Error("policy expected");
      }
      await expect(
        service.policies.revoke({
          actor: apexAdmin,
          disclosurePolicyId: existing.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // Unknown resources are indistinguishable from forbidden ones.
      await expect(
        share(founderAlpha, ref("company", randomUUID()), world.orgApex),
      ).rejects.toBeInstanceOf(DisclosureResourceNotFoundError);
      expect(
        await decide(
          world,
          actorPrincipal(founderAlpha),
          ref("company", randomUUID()),
        ),
      ).toMatchObject({
        outcome: "DENY",
        reasonCode: "UNKNOWN_RESOURCE",
      });
    });
  });

  it("combined guard: capability DENY + disclosure ALLOW = DENY; ALLOW + DENY = DENY; REQUIRES_STEP_UP is preserved (§134-136)", async () => {
    await withWorld(async (world) => {
      const {
        service,
        founderAlpha,
        apexAdmin,
        tenantC,
        tenantI,
        orgAlpha,
        orgApex,
      } = world;
      const company = ref("company", world.companyAlpha);
      await world.tx
        .sql`update core.companies set marketplace_visibility = 'network_visible' where id = ${world.companyAlpha}`;
      // Apex: disclosure ALLOW (network) but company.view over Alpha's company: DENY.
      const apexCheck = await service.guard.check({
        actor: apexAdmin,
        capability: COMPANY_VIEW,
        resourceScope: {
          kind: "RESOURCE",
          tenantId: tenantC,
          organisationId: orgAlpha,
          resourceType: "company",
          resourceId: world.companyAlpha,
        },
        disclosure: { resource: company, requestedAccess: "view" },
      });
      expect(apexCheck.outcome).toBe("DENY");
      expect(apexCheck.disclosure).toBeNull();
      // Founder: capability ALLOW on the Apex mandate scope is impossible (org mismatch) --
      // so prove the reverse with a resource the founder holds the capability for but
      // cannot be disclosed: a colleague's personal_private profile.
      await world.tx
        .sql`update core.founder_profiles set visibility_scope = 'personal_private', user_id = ${world.alphaColleague.userId} where id = ${world.founderProfileId}`;
      const founderCheck = await service.guard.check({
        actor: founderAlpha,
        capability: COMPANY_VIEW,
        resourceScope: {
          kind: "RESOURCE",
          tenantId: tenantC,
          organisationId: orgAlpha,
          resourceType: "company",
          resourceId: world.companyAlpha,
        },
        disclosure: {
          resource: ref("founder_profile", world.founderProfileId),
          requestedAccess: "view",
        },
      });
      expect(founderCheck.authorization.outcome).toBe("ALLOW");
      expect(founderCheck.disclosure?.outcome).toBe("DENY");
      expect(founderCheck.outcome).toBe("DENY");
      await expect(
        service.guard.require({
          actor: founderAlpha,
          capability: COMPANY_VIEW,
          resourceScope: {
            kind: "RESOURCE",
            tenantId: tenantC,
            organisationId: orgAlpha,
            resourceType: "company",
            resourceId: world.companyAlpha,
          },
          disclosure: {
            resource: ref("founder_profile", world.founderProfileId),
            requestedAccess: "view",
          },
        }),
      ).rejects.toBeInstanceOf(DisclosureDeniedError);
      // Both ALLOW.
      const ok = await service.guard.check({
        actor: founderAlpha,
        capability: COMPANY_VIEW,
        resourceScope: {
          kind: "RESOURCE",
          tenantId: tenantC,
          organisationId: orgAlpha,
          resourceType: "company",
          resourceId: world.companyAlpha,
        },
        disclosure: { resource: company, requestedAccess: "view" },
      });
      expect(ok.outcome).toBe("ALLOW");
      expect(tenantI).not.toBe(tenantC);
      expect(orgApex).not.toBe(orgAlpha);
    });
  });

  it("REQUIRES_STEP_UP from authorization is never flattened by a disclosure ALLOW", async () => {
    await withWorld(
      async (world) => {
        const company = ref("company", world.companyAlpha);
        const decision = await world.service.guard.check({
          actor: world.founderAlpha,
          capability: COMPANY_VIEW,
          resourceScope: {
            kind: "RESOURCE",
            tenantId: world.tenantC,
            organisationId: world.orgAlpha,
            resourceType: "company",
            resourceId: world.companyAlpha,
          },
          disclosure: { resource: company, requestedAccess: "view" },
        });
        expect(decision.disclosure?.outcome).toBe("ALLOW");
        expect(decision.outcome).toBe("REQUIRES_STEP_UP");
        await expect(
          world.service.guard.require({
            actor: world.founderAlpha,
            capability: COMPANY_VIEW,
            resourceScope: {
              kind: "RESOURCE",
              tenantId: world.tenantC,
              organisationId: world.orgAlpha,
              resourceType: "company",
              resourceId: world.companyAlpha,
            },
            disclosure: { resource: company, requestedAccess: "view" },
          }),
        ).rejects.toBeInstanceOf(AuthorizationRequirementError);
      },
      {
        authorization: (real) => ({
          authorize: async (request) => {
            const decision = await real.authorize(request);
            return decision.outcome === "ALLOW"
              ? {
                  outcome: "REQUIRES_STEP_UP",
                  capability: decision.capability,
                  resource: decision.resource,
                  reasonCode: "STEP_UP_REQUIRED",
                  requirements: ["STEP_UP"],
                }
              : decision;
          },
          requireCapability: real.requireCapability,
        }),
      },
    );
  });

  it("Q has zero ambient disclosure authority and database privilege is not permission (§137-138)", async () => {
    await withWorld(async (world) => {
      const qActor: ActorContext = { ...world.founderAlpha, actorType: "Q" };
      await world.tx
        .sql`update core.companies set marketplace_visibility = 'public_external' where id = ${world.companyAlpha}`;
      expect(
        await decide(
          world,
          actorPrincipal(qActor),
          ref("company", world.companyAlpha),
        ),
      ).toMatchObject({
        outcome: "DENY",
        reasonCode: "NON_HUMAN_PRINCIPAL",
      });
      // This test itself runs on the privileged connection that can read every
      // row; the evaluator still denies the non-party.
      expect(
        await count(
          world.tx
            .sql`select count(*)::int as count from core.investor_mandates where id = ${world.apexMandateId}`,
        ),
      ).toBe(1);
      expect(
        (
          await decide(
            world,
            actorPrincipal(world.founderAlpha),
            ref("investor_mandate", world.apexMandateId),
          )
        ).outcome,
      ).toBe("DENY");
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency, duplicates, atomicity
  // -------------------------------------------------------------------------

  it("same id retry is idempotent, same id with a different policy conflicts, duplicates collapse, re-share after revoke works, self-share is a no-op (§148-151, §195)", async () => {
    await withWorld(async (world) => {
      const { tx, service, founderAlpha } = world;
      const profile = ref("founder_profile", world.founderProfileId);
      const id = DisclosurePolicyIdSchema.parse(randomUUID());
      const base = {
        actor: founderAlpha,
        disclosurePolicyId: id,
        resource: profile,
        scopeType: "specifically_shared" as const,
        recipient: { type: "ORGANISATION" as const, id: world.orgApex },
        accessLevel: "view" as const,
        correlationId: CORRELATION(),
      };
      const first = await service.policies.grant(base);
      const second = await service.policies.grant({
        ...base,
        correlationId: CORRELATION(),
      });
      expect(first.outcome).toBe("CREATED");
      expect(second.outcome).toBe("EXISTING");
      expect(second.policy?.id).toBe(id);
      await expect(
        service.policies.grant({
          ...base,
          accessLevel: "view_download",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DisclosurePolicyConflictError);
      // Same policy, new id: one canonical active grant.
      const duplicate = await service.policies.grant({
        ...base,
        disclosurePolicyId: undefined,
        correlationId: CORRELATION(),
      });
      expect(duplicate.outcome).toBe("EXISTING");
      expect(duplicate.policy?.id).toBe(id);
      expect(
        await count(
          tx.sql`select count(*)::int as count from permissions.disclosure_policies where resource_id = ${world.founderProfileId}`,
        ),
      ).toBe(1);
      // Revoke, then a deliberate new share: P1 stays revoked, P2 active.
      await service.policies.revoke({
        actor: founderAlpha,
        disclosurePolicyId: id,
        correlationId: CORRELATION(),
      });
      const p2 = await service.policies.grant({
        ...base,
        disclosurePolicyId: undefined,
        correlationId: CORRELATION(),
      });
      expect(p2.outcome).toBe("CREATED");
      expect(p2.policy?.id).not.toBe(id);
      const rows = await tx.sql<{ id: string; revoked: boolean }[]>`
        select id, revoked_at is not null as revoked from permissions.disclosure_policies where resource_id = ${world.founderProfileId} order by created_at`;
      expect(rows.map((row) => row.revoked)).toEqual([true, false]);
      // Grant to self / own organisation is redundant, not a row.
      const self = await service.policies.grant({
        ...base,
        disclosurePolicyId: undefined,
        recipient: { type: "ORGANISATION", id: world.orgAlpha },
        correlationId: CORRELATION(),
      });
      expect(self).toEqual({
        outcome: "REDUNDANT",
        policy: null,
        reason: "RECIPIENT_IS_OWNER",
      });
      // Malformed statements are refused before any write.
      await expect(
        service.policies.grant({
          ...base,
          disclosurePolicyId: undefined,
          scopeType: "network_visible",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DisclosurePolicyInvalidError);
      await expect(
        service.policies.grant({
          ...base,
          disclosurePolicyId: undefined,
          expiresAt: UtcTimestampSchema.parse("2020-01-01T00:00:00.000Z"),
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "EXPIRY_IN_PAST" });
      // No network -> public escalation: public_external needs its own deliberate grant.
      await tx.sql`update core.founder_profiles set visibility_scope = 'network_visible' where id = ${world.founderProfileId}`;
      expect((await decide(world, ANONYMOUS_PRINCIPAL, profile)).outcome).toBe(
        "DENY",
      );
    });
  });

  it("a failed outbox write rolls back the grant, its audit and the policy; a failed audit rolls back a revoke (§152-153)", async () => {
    await withWorld(
      async (world) => {
        const { tx, service, founderAlpha } = world;
        const correlationId = CORRELATION();
        await expect(
          service.policies.grant({
            actor: founderAlpha,
            resource: ref("founder_profile", world.founderProfileId),
            scopeType: "specifically_shared",
            recipient: { type: "ORGANISATION", id: world.orgApex },
            accessLevel: "view",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        expect(
          await count(
            tx.sql`select count(*)::int as count from permissions.disclosure_policies where resource_id = ${world.founderProfileId}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where payload ->> 'correlationId' = ${correlationId}`,
          ),
        ).toBe(0);
        expect(
          (
            await decide(
              world,
              actorPrincipal(world.apexAdmin),
              ref("founder_profile", world.founderProfileId),
            )
          ).outcome,
        ).toBe("DENY");
      },
      {
        outbox: (real) => ({
          enqueue: (tx, event, options) =>
            event.type === "permissions.disclosure.granted"
              ? Promise.reject(new Error("outbox unavailable"))
              : real.enqueue(tx, event, options),
        }),
      },
    );
    await withWorld(
      async (world) => {
        const { tx, service, founderAlpha } = world;
        // Seed an active policy directly (audit is broken in this world).
        const policyId = randomUUID();
        await tx.sql`insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, owner_user_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
          values (${policyId}, ${world.tenantC}, ${world.orgAlpha}, ${founderAlpha.userId}, 'founder_profile', ${world.founderProfileId}, 'specifically_shared', 'ORGANISATION', ${world.orgApex}, 'view', ${founderAlpha.userId})`;
        await expect(
          service.policies.revoke({
            actor: founderAlpha,
            disclosurePolicyId: DisclosurePolicyIdSchema.parse(policyId),
            correlationId: CORRELATION(),
          }),
        ).rejects.toThrow("audit unavailable");
        const [row] = await tx.sql<
          { revoked_at: Date | null }[]
        >`select revoked_at from permissions.disclosure_policies where id = ${policyId}`;
        expect(row?.revoked_at).toBeNull();
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where event_type = 'permissions.disclosure.revoked'`,
          ),
        ).toBe(0);
        expect(
          (
            await decide(
              world,
              actorPrincipal(world.apexAdmin),
              ref("founder_profile", world.founderProfileId),
            )
          ).outcome,
        ).toBe("ALLOW");
      },
      { auditFailure: true },
    );
  });

  it("audit and outbox carry references only: no private marker leaves the domain tables (§155-156, §188-189)", async () => {
    await withWorld(async (world) => {
      const { tx, service, founderAlpha, apexAdmin } = world;
      const correlationId = CORRELATION();
      const grant = await service.policies.grant({
        actor: founderAlpha,
        resource: ref("founder_profile", world.founderProfileId),
        scopeType: "specifically_shared",
        recipient: { type: "ORGANISATION", id: world.orgApex },
        accessLevel: "view",
        correlationId,
      });
      const mandateShare = await service.policies.grant({
        actor: apexAdmin,
        resource: ref("investor_mandate", world.apexMandateId),
        scopeType: "specifically_shared",
        recipient: { type: "USER", id: founderAlpha.userId },
        accessLevel: "view",
        correlationId,
      });
      await service.policies.grant({
        actor: founderAlpha,
        resource: ref("company", world.companyAlpha),
        scopeType: "network_visible",
        accessLevel: "view",
        correlationId,
      });
      if (grant.policy === null || mandateShare.policy === null) {
        throw new Error("policies expected");
      }
      await service.policies.revoke({
        actor: apexAdmin,
        disclosurePolicyId: mandateShare.policy.id,
        correlationId,
      });

      const audits = await tx.sql<
        {
          action_type: string;
          resource_type: string;
          metadata: Record<string, unknown>;
        }[]
      >`
        select action_type, resource_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid order by occurred_at`;
      expect(audits.map((a) => a.action_type)).toEqual([
        "disclosure.granted",
        "disclosure.granted",
        "disclosure.granted",
        "disclosure.revoked",
      ]);
      expect(audits[0]?.metadata).toEqual({
        disclosurePolicyId: grant.policy.id,
        resourceType: "founder_profile",
        resourceId: world.founderProfileId,
        scopeType: "specifically_shared",
        accessLevel: "view",
        recipientType: "ORGANISATION",
        recipientId: world.orgApex,
      });
      const outbox = await tx.sql<
        { event_type: string; payload: { data: unknown } }[]
      >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId} order by id`;
      expect(outbox.map((o) => o.event_type)).toEqual([
        "permissions.disclosure.granted",
        "permissions.disclosure.granted",
        "permissions.disclosure.granted",
        "permissions.disclosure.revoked",
      ]);
      expect(outbox[0]?.payload.data).toEqual({
        disclosurePolicyId: grant.policy.id,
        resourceType: "founder_profile",
        resourceId: world.founderProfileId,
        scopeType: "specifically_shared",
        accessLevel: "view",
      });
      for (const marker of [FOUNDER_MARKER, INVESTOR_MARKER, CONTENT_MARKER]) {
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${marker}%`}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${marker}%`}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from permissions.disclosure_policies dp where row_to_json(dp)::text like ${`%${marker}%`}`,
          ),
        ).toBe(0);
      }
      // The markers still exist where they belong.
      expect(
        await count(
          tx.sql`select count(*)::int as count from core.founder_profiles where professional_summary like ${`%${FOUNDER_MARKER}%`}`,
        ),
      ).toBe(1);
      expect(
        await count(
          tx.sql`select count(*)::int as count from core.investor_mandates where raw_mandate_text like ${`%${INVESTOR_MARKER}%`}`,
        ),
      ).toBe(1);
      // And the disclosure decisions never contain them either.
      const decision = await decide(
        world,
        actorPrincipal(apexAdmin),
        ref("founder_profile", world.founderProfileId),
      );
      expect(JSON.stringify(decision)).not.toContain(FOUNDER_MARKER);
      // Founder cannot read the Apex ceiling after the share was revoked; Apex cannot read the founder marker resource's download.
      expect(
        (
          await decide(
            world,
            actorPrincipal(founderAlpha),
            ref("investor_mandate", world.apexMandateId),
          )
        ).outcome,
      ).toBe("DENY");
    });
  });

  it("batch evaluation resolves each resource once and answers item-wise", async () => {
    await withWorld(async (world) => {
      const { service, founderAlpha, apexAdmin } = world;
      const decisions = await service.access.evaluateMany([
        {
          principal: actorPrincipal(founderAlpha),
          resource: ref("founder_profile", world.founderProfileId),
          requestedAccess: "view",
        },
        {
          principal: actorPrincipal(apexAdmin),
          resource: ref("founder_profile", world.founderProfileId),
          requestedAccess: "view",
        },
        {
          principal: actorPrincipal(apexAdmin),
          resource: ref("investor_mandate", world.apexMandateId),
          requestedAccess: "view_download",
        },
        {
          principal: actorPrincipal(apexAdmin),
          resource: ref("relationship", world.relationshipApex),
          requestedAccess: "view",
        },
        {
          principal: actorPrincipal(apexAdmin),
          resource: ref("capital_objective", randomUUID()),
          requestedAccess: "view",
        },
      ]);
      expect(decisions.map((d) => d.outcome)).toEqual([
        "ALLOW",
        "DENY",
        "ALLOW",
        "DENY",
        "DENY",
      ]);
      expect(decisions[4]?.reasonCode).toBe("UNKNOWN_RESOURCE");
      // Ids parsed through their branded schemas remain distinct kinds.
      expect(
        FounderProfileIdSchema.safeParse(world.founderProfileId).success,
      ).toBe(true);
      expect(
        InvestorMandateIdSchema.safeParse(world.apexMandateId).success,
      ).toBe(true);
      expect(
        CapitalObjectiveIdSchema.safeParse(world.capitalObjectiveId).success,
      ).toBe(true);
    });
  });
});
