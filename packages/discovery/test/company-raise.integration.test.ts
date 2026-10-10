import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { CompanyRaiseViewSchema } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  composeCompanyRaiseReader,
  type CompanyRaiseReader,
} from "../src/index.js";

/**
 * R2 `raiseFor` against the local database: the canonical objective, its
 * disclosure policies and the disclosure evaluator are real; Media's
 * playback rule and transcript are stubbed per company (Media owns and
 * tests them). The shapes are the hosted ones the founder hit: an ACTIVE
 * objective with no disclosure policy whose pitch says another figure
 * (hosted: Mizan, USD 4,000,000 objective, "raising a $4 million seed").
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Fixture = {
  readonly label: string;
  readonly objective: string | null;
  readonly sharing: "NETWORK" | "PRIVATE" | "REVOKED";
  readonly pitch: string | null;
};

const FIXTURES = [
  { label: "PitchOnly", objective: null, sharing: "PRIVATE", pitch: "4000000" },
  {
    label: "DisclosedOnly",
    objective: "2000000",
    sharing: "NETWORK",
    pitch: null,
  },
  {
    label: "BothDisagree",
    objective: "6000000",
    sharing: "NETWORK",
    pitch: "4000000",
  },
  {
    label: "PrivateDisagree",
    objective: "6000000",
    sharing: "PRIVATE",
    pitch: "4000000",
  },
  { label: "Neither", objective: null, sharing: "PRIVATE", pitch: null },
  {
    label: "PrivateNoPitch",
    objective: "9000000",
    sharing: "PRIVATE",
    pitch: null,
  },
  {
    label: "Revoked",
    objective: "3000000",
    sharing: "REVOKED",
    pitch: "3000000",
  },
] as const satisfies readonly Fixture[];
type Label = (typeof FIXTURES)[number]["label"];

type World = {
  readonly reader: CompanyRaiseReader;
  readonly investor: ActorContext;
  readonly otherFounder: ActorContext;
  readonly companies: Record<
    Label,
    { readonly id: string; readonly founder: ActorContext }
  >;
};

describe("raiseFor against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  async function party(
    tx: TransactionContext,
    type: "company" | "investment_firm",
    name: string,
  ) {
    const { sql } = tx;
    const tenantId = randomUUID();
    const organisationId = randomUUID();
    await sql`insert into identity.tenants (id, name) values (${tenantId}, ${name})`;
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${organisationId}, ${tenantId}, ${type}, ${name}, ${`r2-${organisationId.slice(0, 8)}`})`;
    await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
    const authUserId = randomUUID();
    await sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    const actor = ActorContextSchema.parse({
      userId: profile.id,
      tenantId,
      organisationId,
      membershipId,
      actorType: "HUMAN",
    });
    return { tenantId, organisationId, actor };
  }

  async function seed(tx: TransactionContext): Promise<World> {
    const { sql } = tx;
    const investorParty = await party(tx, "investment_firm", "R2 Fund");
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${randomUUID()}, ${investorParty.tenantId}, ${investorParty.organisationId}, 'VC', 'R2 Fund')`;

    const companies = {} as Record<
      Label,
      { readonly id: string; readonly founder: ActorContext }
    >;
    const pitchById = new Map<string, string>();
    for (const fixture of FIXTURES) {
      const p = await party(tx, "company", `R2 ${fixture.label}`);
      const id = randomUUID();
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, marketplace_visibility)
        values (${id}, ${p.tenantId}, ${p.organisationId}, ${`R2 ${fixture.label}`}, ${`r2-${id.slice(0, 8)}`}, 'network_visible')`;
      if (fixture.objective !== null) {
        const objectiveId = randomUUID();
        await sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id)
          values (${objectiveId}, ${p.tenantId}, ${id}, ${fixture.objective}, 'USD', ${p.actor.userId})`;
        if (fixture.sharing !== "PRIVATE") {
          await sql`insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, owner_user_id, resource_type, resource_id, scope_type, access_level, created_by_user_id, revoked_at)
            values (${p.tenantId}, ${p.organisationId}, ${p.actor.userId}, 'capital_objective', ${objectiveId}, 'network_visible', 'view', ${p.actor.userId},
                    ${fixture.sharing === "REVOKED" ? sql`clock_timestamp()` : null})`;
        }
      }
      if (fixture.pitch !== null) pitchById.set(id, fixture.pitch);
      companies[fixture.label] = { id, founder: p.actor };
    }
    const otherFounder = (await party(tx, "company", "R2 Other founder")).actor;

    const companiesPort = createPostgresCompanyQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const relationshipRepository = createPostgresRelationshipRepository();
    const relationshipEvents = createPostgresRelationshipEventRepository();
    const relationships: RelationshipQueryPort = {
      getById: (id) => relationshipRepository.findById(sql, id),
      findByParties: (c, i) => relationshipRepository.findByParties(sql, c, i),
      listEvents: (id, page = {}) =>
        relationshipEvents.listByRelationship(sql, id, {
          afterSequence: page.afterSequence,
          limit: page.limit ?? 100,
        }),
      getEventById: (id) => relationshipEvents.findById(sql, id),
    };
    const disclosurePorts = {
      companies: companiesPort,
      investors: createPostgresInvestorOrganisationQueryPort({ sql }),
      mandates: createPostgresInvestorMandateQueryPort({ sql }),
      capital,
      relationships,
    };
    const policies = createPostgresDisclosurePolicyRepository();
    const disclosure = createDisclosureAccessService({
      sql,
      policies,
      resolvers: createDisclosureResourceResolverRegistry(
        createDefaultDisclosureResolvers(disclosurePorts),
      ),
      relationshipParties: createRelationshipPartyResolver(disclosurePorts),
      clock: systemDisclosureClock,
    });
    const reader = composeCompanyRaiseReader({
      sql,
      companies: companiesPort,
      capital,
      disclosure,
      policies,
      // The investor-subject resolver's answer for these fixtures.
      isInvestor: (actor) =>
        Promise.resolve(actor.organisationId === investorParty.organisationId),
      pitches: () => ({
        findDiscoverablePitches: (ids) =>
          Promise.resolve(
            new Map(
              ids
                .filter((id) => pitchById.has(id))
                .map((id) => [id, { mediaAssetId: pitchOf(id), more: [] }]),
            ),
          ),
      }),
      // Media's playback rule: a founder plays only their own pitch.
      mayPlay: (actor, companyId) =>
        Promise.resolve(
          actor.organisationId === investorParty.organisationId ||
            Object.values(companies).some(
              (c) =>
                c.id === companyId &&
                c.founder.organisationId === actor.organisationId,
            ),
        ),
      pitchRaise: (_actor, companyId) => {
        const amount = pitchById.get(companyId);
        return Promise.resolve(
          amount === undefined
            ? null
            : { atSeconds: 14, amount, currency: "USD" },
        );
      },
    });
    return { reader, investor: investorParty.actor, otherFounder, companies };
  }

  const pitchOf = (companyId: string) =>
    `${companyId.slice(0, 24)}aaaaaaaaaaaa`;

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(await seed(tx));
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  it("an investor gets one honest raise per company shape", async () => {
    await withWorld(async ({ reader, investor, companies }) => {
      const read = async (label: Label) =>
        CompanyRaiseViewSchema.parse(
          await reader.raiseFor(investor, companies[label].id),
        );

      const pitchOnly = await read("PitchOnly");
      expect(pitchOnly).toMatchObject({
        source: "PITCH_CLAIM",
        money: { amount: "4000000", currency: "USD" },
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        visibility: "network_visible",
        pitch: { atSeconds: 14 },
      });

      const disclosedOnly = await read("DisclosedOnly");
      expect(disclosedOnly.source).toBe("DISCLOSED_OBJECTIVE");
      expect(Number(disclosedOnly.money?.amount)).toBe(2_000_000);
      expect(disclosedOnly.visibility).toBe("network_visible");
      expect(disclosedOnly.evidenceStatus).toBe("SELF_REPORTED");
      expect(disclosedOnly.asOf).not.toBeNull();

      // Both: the declared raise stands; the pitch never replaces it.
      const both = await read("BothDisagree");
      expect(both.source).toBe("DISCLOSED_OBJECTIVE");
      expect(Number(both.money?.amount)).toBe(6_000_000);

      // The hosted shape: founder-private objective, the pitch says
      // another figure. The investor sees the pitch claim, never 6M.
      const privateDisagree = await read("PrivateDisagree");
      expect(privateDisagree.source).toBe("PITCH_CLAIM");
      expect(privateDisagree.money?.amount).toBe("4000000");

      expect((await read("Neither")).source).toBe("NONE");
      expect((await read("Neither")).money).toBeNull();
      // Founder-private with no pitch: NONE, the figure never leaks.
      expect(await read("PrivateNoPitch")).toMatchObject({
        source: "NONE",
        money: null,
      });
      // A share the founder revoked is not re-leaked from the pitch.
      expect((await read("Revoked")).source).toBe("NONE");

      // One read model: the batch says exactly what the single read says.
      const ids = FIXTURES.map((f) => companies[f.label].id);
      const batch = await reader.raisesFor(investor, ids);
      for (const id of ids) {
        expect(batch.get(id)).toEqual(await reader.raiseFor(investor, id));
      }
    });
  });

  it("the owner reads their own objective; another tenant's founder reads nothing", async () => {
    await withWorld(async ({ reader, otherFounder, companies }) => {
      const own = await reader.raiseFor(
        companies.PrivateDisagree.founder,
        companies.PrivateDisagree.id,
      );
      expect(own.source).toBe("DISCLOSED_OBJECTIVE");
      expect(Number(own.money?.amount)).toBe(6_000_000);
      expect(own.visibility).toBe("founder_private");

      // Cross-tenant: a founder of another company sees neither the
      // founder-private objective nor a pitch-derived figure.
      for (const label of [
        "PrivateDisagree",
        "PrivateNoPitch",
        "PitchOnly",
      ] as const) {
        const view = await reader.raiseFor(otherFounder, companies[label].id);
        expect(view).toMatchObject({ source: "NONE", money: null });
      }
      // A founder of one fixture company reading another: same rule.
      const cross = await reader.raiseFor(
        companies.DisclosedOnly.founder,
        companies.PrivateDisagree.id,
      );
      expect(cross.money).toBeNull();
    });
  });
});
