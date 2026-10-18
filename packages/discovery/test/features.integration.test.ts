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
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EmbeddingConfigurationSchema,
  instructionFor,
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
  FEATURE_SCHEMA_VERSION,
  RecommendationFeatureSnapshotSchema,
  type RecommendationFeatureSnapshot,
} from "../src/features/contracts.js";
import {
  createFeatureRegistry,
  FeatureContextNotAllowedError,
} from "../src/features/policy.js";
import {
  createFeatureService,
  type FeatureService,
} from "../src/features/service.js";
import type { HybridCandidate } from "../src/hybrid/contracts.js";
import { createHybridCandidateService } from "../src/hybrid/service.js";
import { createDomainCandidatePorts } from "../src/infrastructure/domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "../src/infrastructure/domain-port-eligibility-sources.js";
import { createDomainFeaturePorts } from "../src/infrastructure/domain-port-feature-sources.js";
import { createDomainSemanticPorts } from "../src/infrastructure/domain-port-semantic-sources.js";
import {
  createPostgresFeatureSnapshotStore,
  readCurrentFeatureSnapshot,
} from "../src/infrastructure/postgres-feature-snapshot-store.js";
import { createPostgresSemanticRepresentationStore } from "../src/infrastructure/postgres-semantic-store.js";
import type { SemanticEmbedder } from "../src/semantic/ports.js";
import { createSemanticCandidateService } from "../src/semantic/service.js";

/**
 * The feature service over the real owning-context adapters, the real
 * `recommendation` store and local PostgreSQL (CQ-REC-004 §80–§81). The
 * candidate pool is the hybrid pool REC-002 and REC-003 produce for the
 * same world (a deterministic concept embedder stands in for the runtime;
 * the feature layer never calls it). Everything rolls back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MARKER = "REC004_FOUNDER_PRIVATE_FEATURE_MUST_NEVER_APPEAR";
const INVESTOR_MARKER = "REC004_INVESTOR_PRIVATE_MANDATE_TEXT_INTERNAL_ONLY";

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

// A deterministic concept embedder so REC-003 produces a semantic-only
// candidate here without a runtime. The feature layer never sees it.
const CONCEPTS: readonly (readonly string[])[] = [
  ["logistics", "freight", "supply", "chain", "distributors", "fleet", "cargo"],
  ["software", "saas", "platform", "workflow"],
  ["africa", "african", "nigeria", "nigerian", "ghana", "kenya", "west"],
  ["hardware", "devices", "robotics", "sensors"],
  ["europe", "european", "berlin", "germany", "german"],
  ["enterprise", "b2b", "operations"],
];
const DIMENSION = 1024;
function conceptVector(text: string): readonly number[] {
  const values = new Array<number>(DIMENSION).fill(0);
  for (const token of text.toLowerCase().match(/[a-z]+/g) ?? []) {
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
const CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-concept-test-v1",
    providerCode: "fake",
    runtime: "IN_PROCESS_FAKE",
    modelCode: "fake/concept-buckets",
    modelFamily: "fake",
    modelRevision: null,
    dimension: DIMENSION,
    maxDimension: DIMENSION,
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    maxInputCharacters: 4_000,
    maxBatchItems: 16,
    maxBatchCharacters: 64_000,
  });
function conceptEmbedder(): SemanticEmbedder & { calls: number } {
  const result = (
    text: string,
    instructionVersion: string,
  ): EmbeddingResult => ({
    vector: conceptVector(text),
    dimension: DIMENSION,
    providerCode: "fake",
    modelCode: CONFIGURATION.modelCode,
    modelRevision: null,
    configurationVersion: CONFIGURATION.configurationVersion,
    instructionVersion,
    inputSha256: "0".repeat(64),
    inputCharacters: text.length,
    latencyMs: 0,
  });
  const self = {
    calls: 0,
    describe: () => ({
      providerCode: "fake" as const,
      configuration: CONFIGURATION,
      endpoint: null,
    }),
    embedDocuments: (inputs: readonly string[]) => {
      self.calls += 1;
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
      self.calls += 1;
      return Promise.resolve(
        result(query, instructionFor(task).instructionVersion),
      );
    },
  };
  return self;
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
  readonly investorOrgId: string;
  readonly mandateId: string;
  readonly draftId: string;
  readonly companies: Record<string, Seeded>;
  readonly embedder: ReturnType<typeof conceptEmbedder>;
  readonly pool: () => Promise<readonly HybridCandidate[]>;
  readonly features: FeatureService;
};

const FIXTURES = [
  // structured + semantic: seed, NG, logistics, logistics summary
  {
    label: "KoboLogistics",
    summary: "Logistics workflow SaaS for African distributors.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "logistics"]],
    ready: true,
  },
  // semantic-only: series_b, KE, enterprise software, freight summary
  {
    label: "Haulr",
    summary:
      "Freight and supply chain operations platform for Nigerian distributors.",
    stage: "series_b",
    country: "KE",
    nodes: [["industry", "enterprise_software"]],
    ready: true,
  },
  // structured-only: seed, NG, unrelated summary, declared but non-overlapping taxonomy
  {
    label: "Bakehouse",
    summary: "Artisan bread and pastry retail.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "ecommerce"]],
    ready: true,
  },
  // unrelated, series_a, DE
  {
    label: "BerlinRobotics",
    summary: "Robotics hardware and sensors for German factories.",
    stage: "series_a",
    country: "DE",
    nodes: [
      ["technology", "hardware"],
      ["industry", "developer_tools"],
    ],
    ready: true,
  },
] as const;

describe("@capital-q/discovery recommendation features against local PostgreSQL", () => {
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
    const tenantI = await insertTenant(tx, "REC4 Investor Tenant");
    const orgI = await insertOrganisation(tx, tenantI, "Apex Ventures");
    const investorActor = await insertAdmin(tx, tenantI, orgI);
    const investorOrgId = randomUUID();
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorOrgId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;
    const mandateId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, raw_mandate_text)
      values (${mandateId}, ${tenantI}, ${investorOrgId}, 'Africa enterprise logistics', 'ACTIVE', now(), ${investorActor.userId},
              ${`${INVESTOR_MARKER}: We back enterprise logistics software companies serving African markets.`})`;
    await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion) values
      (${tenantI}, ${mandateId}, 'stage', 'EQ', ${sql.json({ kind: "codes", values: ["seed"] })}, 'MUST', false),
      (${tenantI}, ${mandateId}, 'geography.country', 'EQ', ${sql.json({ kind: "codes", values: ["NG"] })}, 'STRONG', false)`;
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source) values
      (${tenantI}, ${mandateId}, ${node("industry", "logistics")}, 'STRONG', false, 'user_selected'),
      (${tenantI}, ${mandateId}, ${node("industry", "media_entertainment")}, 'HARD_EXCLUSION', true, 'user_selected')`;
    const draftId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, created_by_user_id)
      values (${draftId}, ${tenantI}, ${investorOrgId}, 'Draft', 'DRAFT', ${investorActor.userId})`;

    const companies: Record<string, Seeded> = {};
    for (const fixture of FIXTURES) {
      const tenantId = await insertTenant(tx, `REC4 ${fixture.label} tenant`);
      const organisationId = await insertOrganisation(
        tx,
        tenantId,
        `${fixture.label} Ltd`,
      );
      const founder = await insertAdmin(tx, tenantId, organisationId);
      const id = randomUUID();
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility)
        values (${id}, ${tenantId}, ${organisationId}, ${fixture.label}, ${`rec4-${id.slice(0, 8)}`}, ${fixture.stage}, ${fixture.country}, ${fixture.summary}, 'network_visible')`;
      for (const [vocabulary, code] of fixture.nodes) {
        await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
          values (${tenantId}, 'COMPANY', ${id}, ${node(vocabulary, code)}, 'user_selected')`;
      }
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
      if (assessment.state !== "marketplace_ready")
        throw new Error(`${fixture.label}: ${assessment.state}`);
      companies[fixture.label] = {
        id,
        label: fixture.label,
        tenantId,
        organisationId,
        founder,
      };
    }

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
    const embedder = conceptEmbedder();
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
    const featurePorts = createDomainFeaturePorts({
      sql,
      companies: marketplace,
      assignments,
      taxonomy,
    });
    const features = createFeatureService({
      registry: createFeatureRegistry(),
      ports: eligibilityPorts,
      companies: featurePorts.companies,
      hierarchy: featurePorts.hierarchy,
      store: createPostgresFeatureSnapshotStore({ sql }),
      clock: () => new Date("2026-09-18T12:00:00.000Z"),
    });

    await semantic.refreshCompanyRepresentations();
    return {
      tx,
      investorActor,
      investorOrgId,
      mandateId,
      draftId,
      companies,
      embedder,
      features,
      pool: async () => {
        const pool = await hybrid.generate({ actor: investorActor, topK: 2 });
        if (pool.kind !== "GENERATED") throw new Error(pool.kind);
        return pool.candidates;
      },
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

  const labelOf = (w: World, companyId: string) =>
    Object.values(w.companies).find((c) => c.id === companyId)?.label ??
    companyId;
  const featureOf = (s: RecommendationFeatureSnapshot, id: string) => {
    const f = s.features.find((x) => x.featureId === id);
    if (f === undefined) throw new Error(id);
    return f;
  };
  const strip = (s: readonly RecommendationFeatureSnapshot[]) =>
    s.map((x) => ({ ...x, computedAt: "" }));

  it("live local acceptance: the hybrid pool gets one governed snapshot per candidate, persisted, batch-read, with no provider call (§81)", async () => {
    await withWorld(async (w) => {
      const pool = await w.pool();
      const embedderCallsBefore = w.embedder.calls;
      const [statements] = await w.tx.sql<
        { n: string }[]
      >`select xact_commit + xact_rollback as n from pg_stat_database where datname = current_database()`;
      void statements;
      const started = performance.now();
      const result = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: pool,
      });
      const wallMs = Math.round(performance.now() - started);
      if (result.kind !== "COMPUTED") throw new Error(result.kind);
      expect(w.embedder.calls).toBe(embedderCallsBefore);

      const byLabel = new Map(
        result.snapshots.map((s) => [labelOf(w, s.companyId), s]),
      );
      const kobo = byLabel.get("KoboLogistics");
      const haulr = byLabel.get("Haulr");
      const bakehouse = byLabel.get("Bakehouse");
      if (
        kobo === undefined ||
        haulr === undefined ||
        bakehouse === undefined
      ) {
        throw new Error(`pool labels: ${[...byLabel.keys()].join(", ")}`);
      }
      // structured + semantic
      expect(kobo.candidateProvenance.structured).not.toBeNull();
      expect(kobo.candidateProvenance.semantic).not.toBeNull();
      expect(featureOf(kobo, "declared_fit.stage")).toMatchObject({
        status: "PRESENT",
        value: "MATCH",
      });
      expect(featureOf(kobo, "declared_fit.geography")).toMatchObject({
        status: "PRESENT",
        value: "COUNTRY_MATCH",
      });
      expect(featureOf(kobo, "declared_fit.taxonomy")).toMatchObject({
        status: "PRESENT",
        value: "EXACT_OVERLAP",
      });
      expect(featureOf(kobo, "declared_fit.cheque")).toMatchObject({
        status: "MISSING",
        missingReason: "CHEQUE_NOT_COMPUTABLE",
      });
      expect(featureOf(kobo, "semantic_fit.mandate_similarity")).toMatchObject({
        status: "PRESENT",
      });
      // semantic-only
      expect(haulr.candidateProvenance.structured).toBeNull();
      expect(featureOf(haulr, "declared_fit.stage")).toMatchObject({
        status: "PRESENT",
        value: "NO_MATCH",
      });
      expect(featureOf(haulr, "declared_fit.taxonomy")).toMatchObject({
        status: "PRESENT",
        value: "NO_OVERLAP",
      });
      expect(featureOf(haulr, "semantic_fit.mandate_similarity")).toMatchObject(
        { status: "PRESENT" },
      );
      // structured-only: no fake semantic zero; a known non-overlap is a value
      expect(bakehouse.candidateProvenance.semantic).toBeNull();
      expect(
        featureOf(bakehouse, "semantic_fit.mandate_similarity"),
      ).toMatchObject({
        status: "MISSING",
        value: null,
        missingReason: "SEMANTIC_NOT_RETRIEVED",
      });
      expect(featureOf(bakehouse, "declared_fit.taxonomy")).toMatchObject({
        status: "PRESENT",
        value: "NO_OVERLAP",
      });

      expect(result.diagnostics).toMatchObject({
        candidates: pool.length,
        withoutProjection: 0,
        scopeViolations: 0,
        inserted: pool.length,
        reused: 0,
      });
      // mandate, taxonomy versions, one company projection batch, one
      // hierarchy expansion, one current-snapshot read, one insert batch:
      // bounded by the run, never by the pool size.
      expect(result.diagnostics.queries).toBe(6);
      const stored = await readCurrentFeatureSnapshot(w.tx.sql, {
        investorOrganisationId: w.investorOrgId,
        mandateId: w.mandateId,
        companyId: kobo.companyId,
        mode: "INVESTOR_DISCOVER",
      });
      expect(stored).toEqual(kobo);
      expect(RecommendationFeatureSnapshotSchema.parse(stored)).toEqual(kobo);

      console.info(
        `[REC-004 local acceptance] schema=${FEATURE_SCHEMA_VERSION} candidates=${String(pool.length)} featureValues=${String(result.diagnostics.featureValues)} present=${String(result.diagnostics.present)} missing=${String(result.diagnostics.missing)} notApplicable=${String(result.diagnostics.notApplicable)} queries=${String(result.diagnostics.queries)} computeMs=${String(result.diagnostics.computeDurationMs)} persistMs=${String(result.diagnostics.persistDurationMs)} wallMs=${String(wallMs)} providerCalls=0`,
      );
      for (const s of result.snapshots) {
        for (const f of s.features) {
          console.info(
            `[REC-004 local acceptance] ${labelOf(w, s.companyId)} ${f.featureId}@${f.featureVersion} ${f.status} value=${f.value === null ? "-" : typeof f.value === "number" ? f.value.toFixed(3) : String(f.value)} sources=${f.sourceClasses.join("+") || "-"} sensitivity=${f.sensitivity} reason=${f.missingReason ?? "-"}`,
          );
        }
      }
    });
  });

  it("L/M/N/O/V: founder-private markers in real private tables change nothing; the investor's private narrative never leaves the server; a repeat reuses (§58–§60)", async () => {
    await withWorld(async (w) => {
      const pool = await w.pool();
      const before = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: pool,
      });
      if (before.kind !== "COMPUTED") throw new Error(before.kind);
      const target = w.companies["KoboLogistics"];
      if (target === undefined) throw new Error("fixture");
      await w.tx.sql`insert into q_knowledge.memory_items
        (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key, content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${target.tenantId}, 'company', ${target.id}, 'COMPANY', ${target.id}, 'fact', 'rec4.churn', ${`${MARKER}: largest customer may churn`}, ${"b".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
      await w.tx
        .sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
        values (${target.tenantId}, ${target.founder.userId}, ${target.organisationId}, 'ORGANISATION', ${`${MARKER}: founder said the largest customer may churn`})`;
      await w.tx
        .sql`insert into evidence.documents (tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${target.tenantId}, ${target.id}, ${target.organisationId}, 'PITCH_DECK', ${`${MARKER}: deck`.slice(0, 200)}, 'founder_private', 'RESTRICTED', ${target.founder.userId})`;
      await w.tx
        .sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
        values (${target.tenantId}, 'PUBLIC_WEB', 'COMPANY', ${target.id}, ${`${MARKER}: article`.slice(0, 200)}, 'https://example.test/rec4', 'founder_private', 'CONFIDENTIAL')`;
      // A Q-proposed classification is not a declared one either.
      await w.tx
        .sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        values (${target.tenantId}, 'COMPANY', ${target.id}, ${node("industry", "media_entertainment")}, 'q_inferred')`;

      const after = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: pool,
      });
      if (after.kind !== "COMPUTED") throw new Error(after.kind);
      expect(strip(after.snapshots)).toEqual(strip(before.snapshots));
      expect(after.diagnostics).toMatchObject({
        reused: pool.length,
        inserted: 0,
        superseded: 0,
      });
      const rows = await w.tx
        .sql`select features, candidate_provenance, fingerprint from recommendation.feature_snapshots`;
      const everything = JSON.stringify({ snapshots: after.snapshots, rows });
      expect(everything).not.toContain(MARKER);
      expect(everything).not.toContain(INVESTOR_MARKER);
      // The store row is unreadable to any browser principal (pgTAP 410);
      // the founder's own actor has no investor organisation at all.
      await expect(
        w.features.computeForCandidates({
          actor: target.founder,
          mode: "INVESTOR_DISCOVER",
          candidates: pool,
        }),
      ).rejects.toThrow(/no canonical investor organisation/);
    });
  });

  it("P/Q: an ACTIVE mandate change supersedes with new values and fingerprints; a DRAFT change does not (§65)", async () => {
    await withWorld(async (w) => {
      const pool = await w.pool();
      const first = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: pool,
      });
      if (first.kind !== "COMPUTED") throw new Error(first.kind);
      await w.tx
        .sql`update core.investor_mandates set raw_mandate_text = 'Draft now wants series B in Kenya' where id = ${w.draftId}`;
      await w.tx
        .sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
        values (${w.investorActor.tenantId}, ${w.draftId}, 'stage', 'EQ', ${w.tx.sql.json({ kind: "codes", values: ["series_b"] })}, 'MUST', false)`;
      const second = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: pool,
      });
      if (second.kind !== "COMPUTED") throw new Error(second.kind);
      expect(second.diagnostics).toMatchObject({
        reused: pool.length,
        superseded: 0,
      });

      await w.tx
        .sql`update core.investor_mandate_constraints set value_jsonb = ${w.tx.sql.json({ kind: "codes", values: ["series_b"] })} where mandate_id = ${w.mandateId} and dimension = 'stage'`;
      await w.tx
        .sql`update core.investor_mandates set version = version + 1 where id = ${w.mandateId}`;
      const refreshed = await w.pool();
      const third = await w.features.computeForCandidates({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
        candidates: refreshed,
      });
      if (third.kind !== "COMPUTED") throw new Error(third.kind);
      expect(third.diagnostics.superseded).toBeGreaterThan(0);
      const kobo = third.snapshots.find(
        (s) => labelOf(w, s.companyId) === "KoboLogistics",
      );
      if (kobo === undefined) throw new Error("fixture");
      expect(featureOf(kobo, "declared_fit.stage")).toMatchObject({
        value: "NO_MATCH",
      });
      expect(kobo.mandateVersion).toBe(2);
      const history = await w.tx.sql<
        { status: string }[]
      >`select status from recommendation.feature_snapshots where company_id = ${kobo.companyId} order by created_at`;
      expect(history.map((h) => h.status)).toEqual(["SUPERSEDED", "CURRENT"]);
    });
  });

  it("R: an unauthorised context is refused before any read, and no snapshot is written", async () => {
    await withWorld(async (w) => {
      const pool = await w.pool();
      await expect(
        w.features.computeForCandidates({
          actor: w.investorActor,
          mode: "FOUNDER_DISCOVER",
          candidates: pool,
        }),
      ).rejects.toBeInstanceOf(FeatureContextNotAllowedError);
      const [count] = await w.tx.sql<
        { n: number }[]
      >`select count(*)::int as n from recommendation.feature_snapshots`;
      expect(count?.n).toBe(0);
    });
  });
});
