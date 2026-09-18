import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyMarketplaceQueryPort,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { createSyntheticVerificationClaimsPort } from "@capital-q/companies/dev";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorOrganisationRepository,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";
import {
  createPostgresTaxonomyAssignmentRepository,
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyQueryPort,
  normalizeTaxonomyAlias,
  referenceNode,
} from "@capital-q/taxonomy";

import type { StructuredCandidateResult } from "../src/candidates/contracts.js";
import { createStructuredCandidateService } from "../src/candidates/service.js";
import { createEligibilityService } from "../src/eligibility/service.js";
import { createDomainCandidatePorts } from "../src/infrastructure/domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "../src/infrastructure/domain-port-eligibility-sources.js";

/**
 * Structured candidate generation over the real owning-context adapters
 * and local PostgreSQL (CQ-REC-002), which is also the live local
 * acceptance run: synthetic tenants, one investor with an ACTIVE mandate
 * (and a DRAFT one that must not matter), and companies that cover each
 * dimension, the not-ready and the private cases. Readiness is produced
 * by the Companies context's own assessment with the local synthetic
 * verification seam; nothing here writes the readiness column directly.
 * Everything rolls back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MARKER = "REC002_PRIVATE_FOUNDER_CONTEXT_MUST_NOT_AFFECT_CANDIDATES";

class Rollback extends Error {}
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const node = (vocabulary: string, code: string) =>
  referenceNode(vocabulary, code).id;

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

type Seeded = {
  readonly id: string;
  readonly label: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly founder: ActorContext;
};

type World = {
  readonly tx: TransactionContext;
  readonly investorActor: ActorContext;
  readonly mandateId: string;
  readonly companies: Record<string, Seeded>;
  readonly generate: (query?: {
    mandateId?: string | null;
    limit?: number;
  }) => Promise<StructuredCandidateResult>;
};

describe("@capital-q/discovery structured candidates against local PostgreSQL", () => {
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

  async function insertAdmin(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<ActorContext> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return ActorContextSchema.parse({
      userId: profile.id,
      tenantId,
      organisationId,
      membershipId,
      actorType: "HUMAN",
    });
  }

  async function seed(tx: TransactionContext): Promise<World> {
    const { sql } = tx;
    const tenantI = await insertTenant(tx, "REC2 Investor Tenant");
    const orgI = await insertOrganisation(tx, tenantI, "Apex Ventures");
    const investorActor = await insertAdmin(tx, tenantI, orgI);
    const investorOrgId = randomUUID();
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorOrgId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;

    // ACTIVE: seed, Nigeria, fintech (industry), West Africa (geography); AVOID hardware (technology); HARD_EXCLUSION media & entertainment.
    const mandateId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, min_cheque, max_cheque, currency_code)
      values (${mandateId}, ${tenantI}, ${investorOrgId}, 'Seed Africa', 'ACTIVE', now(), ${investorActor.userId}, 250000, 1000000, 'USD')`;
    await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion) values
      (${tenantI}, ${mandateId}, 'stage', 'EQ', ${sql.json({ kind: "codes", values: ["seed"] })}, 'MUST', false),
      (${tenantI}, ${mandateId}, 'geography.country', 'EQ', ${sql.json({ kind: "codes", values: ["NG"] })}, 'STRONG', false)`;
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source) values
      (${tenantI}, ${mandateId}, ${node("industry", "fintech")}, 'STRONG', false, 'user_selected'),
      (${tenantI}, ${mandateId}, ${node("geography", "west_africa")}, 'NICE', false, 'user_selected'),
      (${tenantI}, ${mandateId}, ${node("technology", "hardware")}, 'AVOID', false, 'user_selected'),
      (${tenantI}, ${mandateId}, ${node("industry", "media_entertainment")}, 'HARD_EXCLUSION', true, 'user_selected')`;
    // DRAFT: would ask for Series C and hardware; must not matter.
    const draftId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, created_by_user_id)
      values (${draftId}, ${tenantI}, ${investorOrgId}, 'Draft', 'DRAFT', ${investorActor.userId})`;
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source) values
      (${tenantI}, ${draftId}, ${node("technology", "hardware")}, 'MUST', false, 'user_selected')`;

    // Companies, each in its own organisation and tenant.
    const companies: Record<string, Seeded> = {};
    const seedCompany = async (input: {
      label: string;
      stage: string | null;
      country: string | null;
      nodes: readonly [string, string][];
      visibility: "network_visible" | "organisation_private";
      ready: boolean;
    }) => {
      const tenantId = await insertTenant(tx, `REC2 ${input.label} tenant`);
      const organisationId = await insertOrganisation(
        tx,
        tenantId,
        `${input.label} Ltd`,
      );
      const founder = await insertAdmin(tx, tenantId, organisationId);
      const id = randomUUID();
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility)
        values (${id}, ${tenantId}, ${organisationId}, ${input.label}, ${`rec2-${id.slice(0, 8)}`}, ${input.stage}, ${input.country}, 'A short description.', ${input.visibility})`;
      for (const [vocabulary, code] of input.nodes) {
        await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
          values (${tenantId}, 'COMPANY', ${id}, ${node(vocabulary, code)}, 'user_selected')`;
      }
      if (input.ready) {
        // Through the Companies context, with the local synthetic verification seam.
        const assessment = await createCompanyService({
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          organisations: createPostgresOrganisationQueryPort({ sql }),
          outbox: createOutboxWriter({
            registry: createEventRegistry([...COMPANY_EVENTS]),
          }),
          audit: createPostgresMaterialActionAuditWriter(),
          verification: createSyntheticVerificationClaimsPort({
            environment: "test",
            databaseUrl: TEST_DATABASE_URL,
            verifiedCompanyIds: [id],
          }),
        }).assessMarketplaceReadiness({
          actor: founder,
          companyId: CompanyIdSchema.parse(id),
          correlationId: CORRELATION(),
        });
        if (assessment.state !== "marketplace_ready") {
          throw new Error(
            `${input.label} did not become ready: ${assessment.state}`,
          );
        }
      }
      companies[input.label] = {
        id,
        label: input.label,
        tenantId,
        organisationId,
        founder,
      };
    };

    await seedCompany({
      label: "AllThree",
      stage: "seed",
      country: "NG",
      nodes: [["industry", "payments"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "GeographyOnly",
      stage: "series_b",
      country: "NG",
      nodes: [["industry", "enterprise_software"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "TaxonomyOnly",
      stage: "series_a",
      country: "DE",
      nodes: [["industry", "fintech"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "StageOnly",
      stage: "seed",
      country: "GB",
      nodes: [["industry", "developer_tools"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "RegionOnly",
      stage: "series_a",
      country: "GH",
      nodes: [
        ["industry", "logistics"],
        ["geography", "west_africa"],
      ],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "AvoidOnly",
      stage: "series_c_plus",
      country: "FR",
      nodes: [["technology", "hardware"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "Excluded",
      stage: "seed",
      country: "NG",
      nodes: [["industry", "media_entertainment"]],
      visibility: "network_visible",
      ready: true,
    });
    await seedCompany({
      label: "NotReady",
      stage: "seed",
      country: "NG",
      nodes: [["industry", "payments"]],
      visibility: "network_visible",
      ready: false,
    });
    await seedCompany({
      label: "Private",
      stage: "seed",
      country: "NG",
      nodes: [["industry", "payments"]],
      visibility: "organisation_private",
      ready: false,
    });
    await seedCompany({
      label: "UnknownStage",
      stage: null,
      country: "NG",
      nodes: [["industry", "enterprise_software"]],
      visibility: "network_visible",
      ready: false,
    });

    // Real adapters over the owning contexts.
    const companiesPort = createPostgresCompanyQueryPort({ sql });
    const marketplace = createPostgresCompanyMarketplaceQueryPort({ sql });
    const investors = createPostgresInvestorOrganisationQueryPort({ sql });
    const mandates = createPostgresInvestorMandateQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const relationshipRepository = createPostgresRelationshipRepository();
    const relationshipEventRepository =
      createPostgresRelationshipEventRepository();
    const relationships: RelationshipQueryPort = {
      getById: (id) => relationshipRepository.findById(sql, id),
      findByParties: (c, i) => relationshipRepository.findByParties(sql, c, i),
      listEvents: (id, page = {}) =>
        relationshipEventRepository.listByRelationship(sql, id, {
          afterSequence: page.afterSequence,
          limit: page.limit ?? 100,
        }),
      getEventById: (id) => relationshipEventRepository.findById(sql, id),
    };
    const disclosurePorts = {
      companies: companiesPort,
      investors,
      mandates,
      capital,
      relationships,
    };
    const disclosure = createDisclosureAccessService({
      sql,
      policies: createPostgresDisclosurePolicyRepository(),
      resolvers: createDisclosureResourceResolverRegistry(
        createDefaultDisclosureResolvers(disclosurePorts),
      ),
      relationshipParties: createRelationshipPartyResolver(disclosurePorts),
      clock: systemDisclosureClock,
    });
    const assignments = createPostgresTaxonomyAssignmentRepository();
    const taxonomy = createTaxonomyQueryPort({
      sql,
      reference: createPostgresTaxonomyReferenceRepository(),
      normalizeAlias: normalizeTaxonomyAlias,
    });
    const eligibilityPorts = createDomainEligibilityPorts({
      sql,
      companies: marketplace,
      assignments,
      mandates,
      investorOrganisations: createPostgresInvestorOrganisationRepository(),
      relationships,
      disclosure,
      taxonomy,
    });
    const service = createStructuredCandidateService({
      ports: eligibilityPorts,
      retrieval: createDomainCandidatePorts({
        sql,
        companies: marketplace,
        assignments,
        taxonomy,
      }),
      eligibility: createEligibilityService({
        ports: eligibilityPorts,
        clock: () => new Date("2026-09-18T12:00:00.000Z"),
      }),
    });

    return {
      tx,
      investorActor,
      mandateId,
      companies,
      generate: (query = {}) =>
        service.generate({ actor: investorActor, ...query }),
    };
  }

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

  const generatedOf = (r: StructuredCandidateResult) => {
    if (r.kind !== "GENERATED") throw new Error(r.kind);
    return r;
  };
  const labelsOf = (w: World, r: StructuredCandidateResult) => {
    const byId = new Map(
      Object.values(w.companies).map((c) => [c.id, c.label]),
    );
    return generatedOf(r).candidates.map(
      (c) => byId.get(c.companyId) ?? c.companyId,
    );
  };

  it("live local acceptance: dimensions union, dedupe, REC-001 gate, provenance, stable order", async () => {
    await withWorld(async (w) => {
      const started = performance.now();
      const r = generatedOf(await w.generate());
      const elapsed = Math.round(performance.now() - started);
      const labels = labelsOf(w, r);

      // Found and eligible: every declared dimension contributes on its own.
      expect(new Set(labels)).toEqual(
        new Set([
          "AllThree",
          "GeographyOnly",
          "TaxonomyOnly",
          "StageOnly",
          "RegionOnly",
        ]),
      );
      // Ordered by canonical id, not by desirability.
      expect(r.candidates.map((c) => c.companyId)).toEqual(
        [...r.candidates.map((c) => c.companyId)].sort(),
      );
      // Never: AVOID-only, hard-excluded, not ready, private.
      // UnknownStage is found by geography but can never be marketplace-ready
      // (the readiness policy needs a stage), so REC-001 stops it.
      for (const absent of [
        "AvoidOnly",
        "Excluded",
        "NotReady",
        "Private",
        "UnknownStage",
      ]) {
        expect(labels).not.toContain(absent);
        expect(JSON.stringify(r)).not.toContain(
          w.companies[absent]?.id ?? "never",
        );
      }

      const provenance = (label: string) =>
        r.candidates.find((c) => c.companyId === w.companies[label]?.id)
          ?.provenance;
      expect(provenance("AllThree")?.reasonCodes).toEqual([
        "GEOGRAPHY_OVERLAP",
        "STAGE_OVERLAP",
        "TAXONOMY_DESCENDANT_OVERLAP",
      ]);
      expect(provenance("AllThree")?.matchedNodes).toEqual([
        {
          preferredNodeId: node("industry", "fintech"),
          matchedNodeId: node("industry", "payments"),
          vocabularyCode: "industry",
          exact: false,
        },
      ]);
      expect(provenance("GeographyOnly")?.reasonCodes).toEqual([
        "GEOGRAPHY_OVERLAP",
      ]);
      expect(provenance("TaxonomyOnly")?.reasonCodes).toEqual([
        "TAXONOMY_OVERLAP",
      ]);
      expect(provenance("StageOnly")?.reasonCodes).toEqual(["STAGE_OVERLAP"]);
      expect(provenance("RegionOnly")?.reasonCodes).toEqual([
        "GEOGRAPHY_REGION_OVERLAP",
      ]);
      for (const c of r.candidates) {
        expect(c.provenance.generatorVersion).toBe("structured-mandate.v1");
        expect(c.provenance.taxonomyVersion).not.toBeNull();
        expect(c.eligibility.decision).toBe("ELIGIBLE");
      }

      // Diagnostics: raw = stage(AllThree, StageOnly, Excluded, NotReady) 4
      //   + country NG (AllThree, GeographyOnly, Excluded, NotReady, UnknownStage) 5
      //   + region (RegionOnly) 1 + taxonomy (AllThree, TaxonomyOnly, NotReady) 3 = 13;
      //   Private carries payments too but is not on the discoverable projection.
      expect(r.diagnostics).toMatchObject({
        rawHitsByDimension: { STAGE: 4, GEOGRAPHY: 6, TAXONOMY: 3, CHEQUE: 0 },
        rawHits: 13,
        deduped: 8,
        eligible: 5,
        ineligible: 3,
        undetermined: 0,
        truncated: false,
        chequeSignal: "NOT_COMPUTABLE",
      });
      console.info(
        `[REC-002 local acceptance] raw=${JSON.stringify(r.diagnostics.rawHitsByDimension)} rawHits=${String(r.diagnostics.rawHits)} deduped=${String(r.diagnostics.deduped)} eligible=${String(r.diagnostics.eligible)} ineligible=${String(r.diagnostics.ineligible)} undetermined=${String(r.diagnostics.undetermined)} durationMs=${String(r.diagnostics.durationMs)} wallMs=${String(elapsed)}`,
      );
      for (const c of r.candidates) {
        console.info(
          `[REC-002 local acceptance] ${labelsOf(w, { ...r, candidates: [c] })[0] ?? ""} ${c.companyId} ${c.provenance.reasonCodes.join(",")}`,
        );
      }
    });
  });

  it("N, O, S. founder-private memory, a private conversation and a public-web source change nothing; repeated runs are identical", async () => {
    await withWorld(async (w) => {
      const strip = (r: StructuredCandidateResult) =>
        r.kind === "GENERATED"
          ? { ...r, diagnostics: { ...r.diagnostics, durationMs: 0 } }
          : r;
      const before = strip(await w.generate());
      const target = w.companies["AllThree"];
      if (target === undefined) throw new Error("fixture");
      const content = `${MARKER}: the founder told Q they are really a media hardware company in Berlin`;
      await w.tx.sql`insert into q_knowledge.memory_items
        (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key, content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${target.tenantId}, 'company', ${target.id}, 'COMPANY', ${target.id}, 'fact', 'rec2.private_marker', ${content}, ${"b".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
      await w.tx
        .sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
        values (${target.tenantId}, ${target.founder.userId}, ${target.organisationId}, 'ORGANISATION', ${`${MARKER}: private summary`})`;
      await w.tx
        .sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
        values (${target.tenantId}, 'PUBLIC_WEB', 'COMPANY', ${target.id}, ${`${MARKER}: article`.slice(0, 200)}, 'https://example.test/rec2', 'founder_private', 'CONFIDENTIAL')`;
      const during = strip(await w.generate());
      expect(during).toEqual(before);
      expect(JSON.stringify(during)).not.toContain(MARKER);
      for (let i = 0; i < 3; i += 1) {
        expect(strip(await w.generate())).toEqual(before);
      }
    });
  });

  it("L, M, T. the DRAFT mandate has no effect; an ACTIVE change moves the set; the pool is bounded", async () => {
    await withWorld(async (w) => {
      const draft = await w.tx.sql<
        { id: string }[]
      >`select id from core.investor_mandates where status = 'DRAFT' and name = 'Draft'`;
      const pinnedDraft = await w.generate({ mandateId: draft[0]?.id ?? null });
      expect(pinnedDraft.kind).toBe("NO_ACTIVE_MANDATE");
      expect(labelsOf(w, await w.generate())).not.toContain("AvoidOnly");

      // Withdraw the geography constraint: the geography-only companies leave.
      await w.tx
        .sql`delete from core.investor_mandate_constraints where mandate_id = ${w.mandateId} and dimension = 'geography.country'`;
      const after = labelsOf(w, await w.generate());
      expect(after).not.toContain("GeographyOnly");
      expect(after).not.toContain("UnknownStage");
      expect(after).toContain("AllThree");

      const limited = generatedOf(await w.generate({ limit: 2 }));
      expect(limited.candidates.length).toBeLessThanOrEqual(2);
      expect(limited.diagnostics.truncated).toBe(true);
    });
  });
});
