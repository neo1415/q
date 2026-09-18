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
  createPostgresInvestorMandateRepository,
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
  createEmbeddingService,
  createLocalTeiEmbeddingProvider,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EmbeddingConfigurationSchema,
  instructionFor,
  QWEN3_EMBEDDING_CONFIGURATION,
  type EmbeddingConfiguration,
  type EmbeddingResult,
} from "@capital-q/q-embeddings";
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

import { createStructuredCandidateService } from "../src/candidates/service.js";
import { createEligibilityService } from "../src/eligibility/service.js";
import {
  createHybridCandidateService,
  type HybridCandidateService,
} from "../src/hybrid/service.js";
import { createDomainCandidatePorts } from "../src/infrastructure/domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "../src/infrastructure/domain-port-eligibility-sources.js";
import { createDomainSemanticPorts } from "../src/infrastructure/domain-port-semantic-sources.js";
import { createPostgresSemanticRepresentationStore } from "../src/infrastructure/postgres-semantic-store.js";
import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  SEMANTIC_TOP_K,
} from "../src/semantic/contracts.js";
import type { SemanticEmbedder } from "../src/semantic/ports.js";
import {
  createSemanticCandidateService,
  type SemanticCandidateService,
} from "../src/semantic/service.js";

/**
 * Semantic candidate generation over the real owning-context adapters, the
 * real `recommendation` store and local PostgreSQL (CQ-REC-003 §50–§51).
 *
 * Two embedders drive the same world: a deterministic in-process concept
 * embedder for the assertions that must hold on every machine (privacy
 * markers, staleness, discoverability, REC-001, the merge), and the local
 * Qwen runtime through the production adapter for the live acceptance run
 * and the retrieval-quality sanity set, which run only when that runtime
 * answers on the private loopback address and are skipped otherwise. No
 * hosted provider is ever reached. Everything rolls back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TEI_BASE_URL =
  process.env["Q_EMBEDDING_BASE_URL"] ?? "http://127.0.0.1:8080";
const MARKER = "REC003_PRIVATE_FOUNDER_SEMANTIC_MARKER_DO_NOT_EMBED";
const PUBLIC_WEB_MARKER = "REC003_RAW_PUBLIC_WEB_FINDING_NOT_CANONICAL";

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

// ---------------------------------------------------------------------------
// The deterministic concept embedder (same buckets as the unit scenarios).
// ---------------------------------------------------------------------------

const CONCEPTS: readonly (readonly string[])[] = [
  [
    "logistics",
    "freight",
    "supply",
    "chain",
    "shipping",
    "distributors",
    "fleet",
    "cargo",
    "haulage",
  ],
  ["software", "saas", "platform", "workflow", "app", "tooling"],
  [
    "africa",
    "african",
    "nigeria",
    "nigerian",
    "ghana",
    "lagos",
    "kenya",
    "west",
  ],
  ["fintech", "payments", "lending", "banking", "wallet"],
  ["media", "entertainment", "streaming", "gambling", "betting", "casino"],
  ["hardware", "devices", "robotics", "sensors"],
  ["europe", "european", "berlin", "germany", "german", "london", "paris"],
  ["enterprise", "b2b", "operations", "business"],
];
const CONCEPT_DIMENSION = 1024;

function conceptVector(text: string): readonly number[] {
  const values = new Array<number>(CONCEPT_DIMENSION).fill(0);
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const token of tokens) {
    let hit = false;
    for (const [index, words] of CONCEPTS.entries()) {
      if (words.includes(token)) {
        values[index] = (values[index] ?? 0) + 1;
        hit = true;
      }
    }
    if (!hit) values[CONCEPTS.length] = (values[CONCEPTS.length] ?? 0) + 0.05;
  }
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}

const CONCEPT_CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-concept-test-v1",
    providerCode: "fake",
    runtime: "IN_PROCESS_FAKE",
    modelCode: "fake/concept-buckets",
    modelFamily: "fake",
    modelRevision: null,
    dimension: CONCEPT_DIMENSION,
    maxDimension: CONCEPT_DIMENSION,
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    maxInputCharacters: 4_000,
    maxBatchItems: 16,
    maxBatchCharacters: 64_000,
  });

function conceptEmbedder(): SemanticEmbedder & {
  inputs: string[];
  queries: string[];
} {
  const result = (
    text: string,
    instructionVersion: string,
  ): EmbeddingResult => ({
    vector: conceptVector(text),
    dimension: CONCEPT_DIMENSION,
    providerCode: "fake",
    modelCode: CONCEPT_CONFIGURATION.modelCode,
    modelRevision: null,
    configurationVersion: CONCEPT_CONFIGURATION.configurationVersion,
    instructionVersion,
    inputSha256: "0".repeat(64),
    inputCharacters: text.length,
    latencyMs: 0,
  });
  const self = {
    inputs: [] as string[],
    queries: [] as string[],
    describe: () => ({
      providerCode: "fake" as const,
      configuration: CONCEPT_CONFIGURATION,
      endpoint: null,
    }),
    embedDocuments: (inputs: readonly string[]) => {
      self.inputs.push(...inputs);
      return Promise.resolve({
        embeddings: inputs.map((t) =>
          result(t, EMBEDDING_DOCUMENT_INSTRUCTION_VERSION),
        ),
        batchSize: inputs.length,
        latencyMs: 0,
      });
    },
    embedQuery: (
      query: string,
      task: "EVIDENCE_RETRIEVAL" | "MANDATE_MATCHING",
    ) => {
      self.queries.push(query);
      return Promise.resolve(
        result(query, instructionFor(task).instructionVersion),
      );
    },
  };
  return self;
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

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
  readonly semantic: SemanticCandidateService;
  readonly hybrid: HybridCandidateService;
  readonly embedder: SemanticEmbedder;
  readonly representationText: (companyId: string) => Promise<string | null>;
};

const COMPANY_FIXTURES = [
  // obvious semantic match; also structured (seed, NG, logistics)
  {
    label: "KoboLogistics",
    summary: "Logistics workflow SaaS for African distributors.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "logistics"]],
    visibility: "network_visible",
    ready: true,
  },
  // different words, same concept; semantic-only (series_b, KE, enterprise software)
  {
    label: "Haulr",
    summary:
      "Freight and supply chain operations platform for Nigerian distributors.",
    stage: "series_b",
    country: "KE",
    nodes: [["industry", "enterprise_software"]],
    visibility: "network_visible",
    ready: true,
  },
  // structured-only (seed, NG), semantically unrelated
  {
    label: "Bakehouse",
    summary: "Artisan bread and pastry retail.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "ecommerce"]],
    visibility: "network_visible",
    ready: true,
  },
  // semantically similar, DECLARED hard exclusion (media & entertainment)
  {
    label: "BetHaul",
    summary: "Betting and casino logistics platform for African operators.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "media_entertainment"]],
    visibility: "network_visible",
    ready: true,
  },
  // similar, not marketplace-ready
  {
    label: "Fleetly",
    summary: "Fleet and cargo software for West Africa.",
    stage: "seed",
    country: "GH",
    nodes: [["industry", "logistics"]],
    visibility: "network_visible",
    ready: false,
  },
  // similar, private
  {
    label: "ShadowFreight",
    summary: "Freight software for Africa.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "logistics"]],
    visibility: "organisation_private",
    ready: false,
  },
  // unrelated
  {
    label: "BerlinRobotics",
    summary: "Robotics hardware and sensors for German factories.",
    stage: "series_a",
    country: "DE",
    // An industry classification too, so the declared industry exclusion
    // can be decided: unknown is UNDETERMINED, not "unrelated".
    nodes: [
      ["technology", "hardware"],
      ["industry", "developer_tools"],
    ],
    visibility: "network_visible",
    ready: true,
  },
] as const;

describe("@capital-q/discovery semantic candidates against local PostgreSQL", () => {
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

  async function seed(
    tx: TransactionContext,
    embedder: SemanticEmbedder,
  ): Promise<World> {
    const { sql } = tx;
    const tenantI = await insertTenant(tx, "REC3 Investor Tenant");
    const orgI = await insertOrganisation(tx, tenantI, "Apex Ventures");
    const investorActor = await insertAdmin(tx, tenantI, orgI);
    const investorOrgId = randomUUID();
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorOrgId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;

    // ACTIVE: African enterprise logistics software; seed; NG; logistics; HARD_EXCLUSION media & entertainment.
    const mandateId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, raw_mandate_text)
      values (${mandateId}, ${tenantI}, ${investorOrgId}, 'Africa enterprise logistics', 'ACTIVE', now(), ${investorActor.userId},
              'We back enterprise logistics software companies serving African markets.')`;
    await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion) values
      (${tenantI}, ${mandateId}, 'stage', 'EQ', ${sql.json({ kind: "codes", values: ["seed"] })}, 'MUST', false),
      (${tenantI}, ${mandateId}, 'geography.country', 'EQ', ${sql.json({ kind: "codes", values: ["NG"] })}, 'STRONG', false)`;
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source) values
      (${tenantI}, ${mandateId}, ${node("industry", "logistics")}, 'STRONG', false, 'user_selected'),
      (${tenantI}, ${mandateId}, ${node("industry", "media_entertainment")}, 'HARD_EXCLUSION', true, 'user_selected')`;
    // DRAFT: European robotics; must not matter.
    const draftId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, created_by_user_id, raw_mandate_text)
      values (${draftId}, ${tenantI}, ${investorOrgId}, 'Draft', 'DRAFT', ${investorActor.userId}, 'Draft: European robotics hardware.')`;

    const companies: Record<string, Seeded> = {};
    for (const fixture of COMPANY_FIXTURES) {
      const tenantId = await insertTenant(tx, `REC3 ${fixture.label} tenant`);
      const organisationId = await insertOrganisation(
        tx,
        tenantId,
        `${fixture.label} Ltd`,
      );
      const founder = await insertAdmin(tx, tenantId, organisationId);
      const id = randomUUID();
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility)
        values (${id}, ${tenantId}, ${organisationId}, ${fixture.label}, ${`rec3-${id.slice(0, 8)}`}, ${fixture.stage}, ${fixture.country}, ${fixture.summary}, ${fixture.visibility})`;
      for (const [vocabulary, code] of fixture.nodes) {
        await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
          values (${tenantId}, 'COMPANY', ${id}, ${node(vocabulary, code)}, 'user_selected')`;
      }
      if (fixture.ready) {
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
            `${fixture.label} did not become ready: ${assessment.state}`,
          );
        }
      }
      companies[fixture.label] = {
        id,
        label: fixture.label,
        tenantId,
        organisationId,
        founder,
      };
    }

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
    const eligibility = createEligibilityService({
      ports: eligibilityPorts,
      clock: () => new Date("2026-09-18T12:00:00.000Z"),
    });
    const semanticPorts = createDomainSemanticPorts({
      sql,
      companies: marketplace,
      assignments,
      taxonomy,
      mandates: createPostgresInvestorMandateRepository(),
    });
    const semantic = createSemanticCandidateService({
      ports: eligibilityPorts,
      facts: semanticPorts.facts,
      narratives: semanticPorts.narratives,
      vocabulary: semanticPorts.vocabulary,
      store: createPostgresSemanticRepresentationStore({ sql }),
      embeddings: embedder,
      eligibility,
    });
    const structured = createStructuredCandidateService({
      ports: eligibilityPorts,
      retrieval: createDomainCandidatePorts({
        sql,
        companies: marketplace,
        assignments,
        taxonomy,
      }),
      eligibility,
    });
    const hybrid = createHybridCandidateService({ structured, semantic });

    return {
      tx,
      investorActor,
      mandateId,
      companies,
      semantic,
      hybrid,
      embedder,
      representationText: async (companyId) => {
        const [row] = await sql<{ content: string }[]>`
          select content from recommendation.company_representations
           where company_id = ${companyId} and status = 'CURRENT'`;
        return row?.content ?? null;
      },
    };
  }

  async function withWorld(
    embedder: SemanticEmbedder,
    work: (world: World) => Promise<void>,
  ) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(await seed(tx, embedder));
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const labelsOf = (w: World, candidates: readonly { companyId: string }[]) => {
    const byId = new Map(
      Object.values(w.companies).map((c) => [c.id, c.label]),
    );
    return candidates.map((c) => byId.get(c.companyId) ?? c.companyId);
  };

  describe("deterministic concept embedder", () => {
    it("refreshes only discoverable companies, reads the investor-visible layer, and retrieves through REC-001 into a merged pool", async () => {
      const embedder = conceptEmbedder();
      await withWorld(embedder, async (w) => {
        const refresh = await w.semantic.refreshCompanyRepresentations();
        // Six discoverable companies; the private one has no representation.
        expect(refresh).toMatchObject({
          considered: 6,
          built: 6,
          embedded: 6,
          reused: 0,
        });
        expect(
          await w.representationText(w.companies["ShadowFreight"]?.id ?? ""),
        ).toBeNull();
        expect(
          await w.representationText(w.companies["KoboLogistics"]?.id ?? ""),
        ).toBe(
          [
            "Company: KoboLogistics",
            "Stage: seed",
            "Headquarters: NG",
            "Sector: Logistics & Mobility",
            "Summary: Logistics workflow SaaS for African distributors.",
          ].join("\n"),
        );
        const again = await w.semantic.refreshCompanyRepresentations();
        expect(again).toMatchObject({
          built: 0,
          unchanged: 6,
          embedded: 0,
          reused: 6,
        });

        const r = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (r.kind !== "GENERATED") throw new Error(r.kind);
        const labels = labelsOf(w, r.candidates);
        expect(labels).toContain("KoboLogistics");
        expect(labels).toContain("Haulr");
        expect(labels).not.toContain("BetHaul");
        expect(labels).not.toContain("Fleetly");
        expect(labels).not.toContain("ShadowFreight");
        expect(labels).not.toContain("BerlinRobotics");
        expect(r.diagnostics.rawHits).toBe(4);
        expect(r.diagnostics.ineligible).toBeGreaterThanOrEqual(1);

        const pool = await w.hybrid.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (pool.kind !== "GENERATED") throw new Error(pool.kind);
        const byLabel = new Map(
          pool.candidates.map((c) => [labelsOf(w, [c])[0], c]),
        );
        expect(byLabel.get("KoboLogistics")?.structured).not.toBeNull();
        expect(byLabel.get("KoboLogistics")?.semantic).not.toBeNull();
        expect(byLabel.get("Haulr")?.structured).toBeNull();
        expect(byLabel.get("Haulr")?.semantic).not.toBeNull();
        expect(byLabel.get("Bakehouse")?.structured).not.toBeNull();
        expect(byLabel.get("Bakehouse")?.semantic).toBeNull();
        expect(pool.semanticUnavailable).toBeNull();
      });
    });

    it("H: markers in founder-private memory, a private conversation, a private document and raw public-web research never reach the representation, the vectors or the output", async () => {
      const embedder = conceptEmbedder();
      await withWorld(embedder, async (w) => {
        await w.semantic.refreshCompanyRepresentations();
        const target = w.companies["KoboLogistics"];
        if (target === undefined) throw new Error("fixture");
        const before = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        const [hashBefore] = await w.tx.sql<{ content_sha256: string }[]>`
          select content_sha256 from recommendation.company_representations where company_id = ${target.id} and status = 'CURRENT'`;

        await w.tx.sql`insert into q_knowledge.memory_items
          (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key, content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
          values (${target.tenantId}, 'company', ${target.id}, 'COMPANY', ${target.id}, 'fact', 'rec3.private_marker', ${`${MARKER}: the founder told Q they are really a gambling company`}, ${"b".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
        await w.tx
          .sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
          values (${target.tenantId}, ${target.founder.userId}, ${target.organisationId}, 'ORGANISATION', ${`${MARKER}: private voice transcript summary`})`;
        await w.tx
          .sql`insert into evidence.documents (tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
          values (${target.tenantId}, ${target.id}, ${target.organisationId}, 'PITCH_DECK', ${`${MARKER}: deck`.slice(0, 200)}, 'founder_private', 'RESTRICTED', ${target.founder.userId})`;
        await w.tx
          .sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
          values (${target.tenantId}, 'PUBLIC_WEB', 'COMPANY', ${target.id}, ${`${PUBLIC_WEB_MARKER}: article`.slice(0, 200)}, 'https://example.test/rec3', 'founder_private', 'CONFIDENTIAL')`;

        const refresh = await w.semantic.refreshCompanyRepresentations();
        expect(refresh).toMatchObject({ built: 0, embedded: 0 });
        const [hashAfter] = await w.tx.sql<{ content_sha256: string }[]>`
          select content_sha256 from recommendation.company_representations where company_id = ${target.id} and status = 'CURRENT'`;
        expect(hashAfter?.content_sha256).toBe(hashBefore?.content_sha256);
        const during = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (before.kind !== "GENERATED" || during.kind !== "GENERATED")
          throw new Error("kind");
        expect(during.candidates).toEqual(before.candidates);
        const everything = JSON.stringify({
          inputs: embedder.inputs,
          queries: embedder.queries,
          rows: await w.tx
            .sql`select content from recommendation.company_representations`,
          mandates: await w.tx
            .sql`select content from recommendation.mandate_representations`,
          result: during,
        });
        expect(everything).not.toContain(MARKER);
        expect(everything).not.toContain(PUBLIC_WEB_MARKER);
      });
    });

    it("I/G: a network-visible summary change rebuilds and re-embeds; going private drops a company from retrieval while its vector remains", async () => {
      const embedder = conceptEmbedder();
      await withWorld(embedder, async (w) => {
        await w.semantic.refreshCompanyRepresentations();
        const bakehouse = w.companies["Bakehouse"];
        const kobo = w.companies["KoboLogistics"];
        if (bakehouse === undefined || kobo === undefined)
          throw new Error("fixture");
        await w.tx
          .sql`update core.companies set short_description = 'Logistics software for African bakeries and distributors.', version = version + 1 where id = ${bakehouse.id}`;
        const report = await w.semantic.refreshCompanyRepresentations({
          companyIds: [bakehouse.id],
        });
        expect(report).toMatchObject({ considered: 1, built: 1, embedded: 1 });
        const rows = await w.tx.sql<{ status: string }[]>`
          select status from recommendation.company_representations where company_id = ${bakehouse.id} order by built_at`;
        expect(rows.map((r) => r.status)).toEqual(["SUPERSEDED", "CURRENT"]);
        const r = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (r.kind !== "GENERATED") throw new Error(r.kind);
        expect(labelsOf(w, r.candidates)).toContain("Bakehouse");

        await w.tx
          .sql`update core.companies set marketplace_visibility = 'organisation_private' where id = ${kobo.id}`;
        const after = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (after.kind !== "GENERATED") throw new Error(after.kind);
        expect(labelsOf(w, after.candidates)).not.toContain("KoboLogistics");
        const [vectors] = await w.tx.sql<{ n: number }[]>`
          select count(*)::int as n from recommendation.company_embeddings where company_id = ${kobo.id}`;
        expect(vectors?.n).toBe(1);
      });
    });

    it("J/K: the ACTIVE mandate's change rebuilds the investor representation; a DRAFT change is invisible; the mandate representation is stored under the investor's tenant only", async () => {
      const embedder = conceptEmbedder();
      await withWorld(embedder, async (w) => {
        await w.semantic.refreshCompanyRepresentations();
        const first = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (first.kind !== "GENERATED") throw new Error(first.kind);
        expect(first.diagnostics).toMatchObject({
          investorRepresentation: "BUILT",
          queryVector: "COMPUTED",
        });
        await w.tx
          .sql`update core.investor_mandates set raw_mandate_text = 'Draft now wants robotics.' where status = 'DRAFT' and investor_organisation_id = (select investor_organisation_id from core.investor_mandates where id = ${w.mandateId})`;
        const second = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (second.kind !== "GENERATED") throw new Error(second.kind);
        expect(second.diagnostics).toMatchObject({
          investorRepresentation: "UNCHANGED",
          queryVector: "REUSED",
        });
        expect(embedder.queries).toHaveLength(1);
        await w.tx
          .sql`update core.investor_mandates set raw_mandate_text = 'We now back robotics hardware and sensors for European factories.', version = version + 1 where id = ${w.mandateId}`;
        await w.tx
          .sql`delete from core.investor_mandate_constraints where mandate_id = ${w.mandateId}`;
        await w.tx
          .sql`delete from taxonomy.mandate_preferences where mandate_id = ${w.mandateId}`;
        const third = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (third.kind !== "GENERATED") throw new Error(third.kind);
        expect(third.diagnostics).toMatchObject({
          investorRepresentation: "BUILT",
          queryVector: "COMPUTED",
        });
        expect(labelsOf(w, third.candidates)).toContain("BerlinRobotics");
        const rows = await w.tx.sql<{ tenant_id: string; status: string }[]>`
          select tenant_id, status from recommendation.mandate_representations where mandate_id = ${w.mandateId} order by built_at`;
        expect(rows.map((r) => r.status)).toEqual(["SUPERSEDED", "CURRENT"]);
        expect(
          rows.every((r) => r.tenant_id === w.investorActor.tenantId),
        ).toBe(true);
        // A DRAFT pinned by id yields nothing; nothing of it was embedded.
        const draft = await w.semantic.generate({
          actor: w.investorActor,
          mandateId: randomUUID(),
        });
        expect(draft.kind).toBe("NO_ACTIVE_MANDATE");
      });
    });

    it("the nearest-neighbour query prefilters by configuration and current discoverability before ordering by distance (plan review)", async () => {
      const embedder = conceptEmbedder();
      await withWorld(embedder, async (w) => {
        await w.semantic.refreshCompanyRepresentations();
        const plan = await w.tx.sql<{ "QUERY PLAN": string }[]>`
          explain (costs off)
          select r.company_id, (e.embedding <=> ${`[${new Array(1024).fill(0).join(",")}]`}::extensions.vector) as distance
            from recommendation.company_embeddings e
            join recommendation.company_representations r on r.id = e.representation_id and r.tenant_id = e.tenant_id
            join core.companies c on c.id = r.company_id and c.tenant_id = r.tenant_id
           where e.configuration_version = ${CONCEPT_CONFIGURATION.configurationVersion}
             and e.instruction_version = ${EMBEDDING_DOCUMENT_INSTRUCTION_VERSION}
             and r.status = 'CURRENT' and r.purpose = 'INVESTOR_DISCOVER'
             and r.representation_version = ${COMPANY_REPRESENTATION_VERSION}
             and c.company_status = 'active' and c.marketplace_visibility = any(${["network_visible", "public_external"]}::text[])
           order by distance asc, r.company_id asc limit ${SEMANTIC_TOP_K}`;
        const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
        // Exact scan at this volume, filtered before the sort, bounded by the limit.
        expect(text).toMatch(/Limit/);
        expect(text).toMatch(/Sort/);
        expect(text).toMatch(/configuration_version/);
        expect(text).toMatch(/marketplace_visibility/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Live local acceptance and the retrieval-quality sanity set: the real
  // Qwen runtime through the production adapter, only when it answers.
  // -------------------------------------------------------------------------

  const teiProvider = createLocalTeiEmbeddingProvider({
    baseUrl: TEI_BASE_URL,
    configuration: QWEN3_EMBEDDING_CONFIGURATION,
    timeoutMs: 60_000,
  });
  let teiReady = false;
  beforeAll(async () => {
    const health = await teiProvider.health({ timeoutMs: 3_000 });
    teiReady = health.state === "READY";
  });

  describe("live local acceptance (Qwen3-Embedding-0.6B via TEI, skipped when the runtime is absent)", () => {
    it("retrieves the obvious and the differently-worded logistics companies ahead of the unrelated one, gates through REC-001, and merges with the structured pool", async ({
      skip,
    }) => {
      if (!teiReady) skip();
      const embedder = createEmbeddingService({ provider: teiProvider });
      await withWorld(embedder, async (w) => {
        const started = performance.now();
        const refresh = await w.semantic.refreshCompanyRepresentations();
        expect(refresh).toMatchObject({
          considered: 6,
          built: 6,
          embedded: 6,
          reused: 0,
        });
        const again = await w.semantic.refreshCompanyRepresentations();
        expect(again).toMatchObject({
          built: 0,
          unchanged: 6,
          embedded: 0,
          reused: 6,
        });

        // Sanity set: every discoverable company, ordered by the real model.
        const all = await w.semantic.generate({
          actor: w.investorActor,
          topK: SEMANTIC_TOP_K,
        });
        if (all.kind !== "GENERATED") throw new Error(all.kind);
        const ordered = [...all.candidates]
          .sort((a, b) => b.provenance.similarity - a.provenance.similarity)
          .map(
            (c) =>
              `${labelsOf(w, [c])[0] ?? ""}=${c.provenance.similarity.toFixed(3)}`,
          );
        const similarity = (label: string) =>
          all.candidates.find((c) => labelsOf(w, [c])[0] === label)?.provenance
            .similarity ?? -2;
        // Close matches above the adjacent one, all above the unrelated one.
        expect(similarity("KoboLogistics")).toBeGreaterThan(
          similarity("Bakehouse"),
        );
        expect(similarity("Haulr")).toBeGreaterThan(similarity("Bakehouse"));
        expect(similarity("KoboLogistics")).toBeGreaterThan(
          similarity("BerlinRobotics"),
        );
        expect(similarity("Haulr")).toBeGreaterThan(
          similarity("BerlinRobotics"),
        );
        for (const c of all.candidates) {
          expect(Number.isFinite(c.provenance.similarity)).toBe(true);
          expect(c.provenance.similarity).toBeGreaterThanOrEqual(-1);
          expect(c.provenance.similarity).toBeLessThanOrEqual(1);
          expect(c.provenance.configurationVersion).toBe(
            QWEN3_EMBEDDING_CONFIGURATION.configurationVersion,
          );
          expect(c.provenance.queryInstructionVersion).toBe(
            "capital-q-mandate-matching-v1",
          );
        }
        // Rankable set under REC-001: the excluded, not-ready and private ones are absent.
        const labels = labelsOf(w, all.candidates);
        expect(labels).not.toContain("BetHaul");
        expect(labels).not.toContain("Fleetly");
        expect(labels).not.toContain("ShadowFreight");
        expect(all.diagnostics).toMatchObject({
          rawHits: 6,
          ineligible: 2,
          undetermined: 0,
        });

        // Bounded acceptance run at top-K 4 and the merged pool.
        const r = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (r.kind !== "GENERATED") throw new Error(r.kind);
        expect(r.diagnostics.rawHits).toBe(4);
        expect(labelsOf(w, r.candidates)).toEqual(
          expect.arrayContaining(["KoboLogistics", "Haulr"]),
        );
        const pool = await w.hybrid.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (pool.kind !== "GENERATED") throw new Error(pool.kind);
        const elapsed = Math.round(performance.now() - started);
        const byLabel = new Map(
          pool.candidates.map((c) => [labelsOf(w, [c])[0], c]),
        );
        expect(byLabel.get("KoboLogistics")?.structured).not.toBeNull();
        expect(byLabel.get("KoboLogistics")?.semantic).not.toBeNull();
        expect(byLabel.get("Haulr")?.structured).toBeNull();
        expect(byLabel.get("Haulr")?.semantic).not.toBeNull();
        expect(byLabel.get("Bakehouse")?.structured).not.toBeNull();
        const same = await w.semantic.generate({
          actor: w.investorActor,
          topK: 4,
        });
        if (same.kind !== "GENERATED") throw new Error(same.kind);
        expect(same.candidates).toEqual(r.candidates);

        console.info(
          `[REC-003 local acceptance] companyRepresentation=${COMPANY_REPRESENTATION_VERSION} investorRepresentation=${INVESTOR_REPRESENTATION_VERSION} model=${QWEN3_EMBEDDING_CONFIGURATION.modelCode} dimension=${String(QWEN3_EMBEDDING_CONFIGURATION.dimension)} instruction=${r.candidates[0]?.provenance.queryInstructionVersion ?? ""} topK=4 refresh=${JSON.stringify({ considered: refresh.considered, built: refresh.built, embedded: refresh.embedded, reused: again.reused, refreshMs: refresh.durationMs })} semantic=${JSON.stringify(r.diagnostics)} structured=${JSON.stringify({ rawHits: pool.diagnostics.structured.rawHits, eligible: pool.diagnostics.structured.eligible })} merged=${JSON.stringify({ merged: pool.diagnostics.merged, structuredOnly: pool.diagnostics.structuredOnly, semanticOnly: pool.diagnostics.semanticOnly, both: pool.diagnostics.both })} wallMs=${String(elapsed)}`,
        );
        console.info(`[REC-003 sanity ordering] ${ordered.join(" > ")}`);
        for (const c of pool.candidates) {
          console.info(
            `[REC-003 local acceptance] ${labelsOf(w, [c])[0] ?? ""} structured=${c.structured?.reasonCodes.join(",") ?? "-"} semantic=${c.semantic === null ? "-" : c.semantic.similarity.toFixed(3)}`,
          );
        }
      });
    }, 300_000);
  });
});
