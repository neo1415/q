import { randomUUID } from "node:crypto";

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
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
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

import { createStructuredCandidateService } from "../../src/candidates/service.js";
import { createEligibilityService } from "../../src/eligibility/service.js";
import { createFeatureRegistry } from "../../src/features/policy.js";
import {
  createFeatureService,
  type FeatureService,
} from "../../src/features/service.js";
import type { HybridCandidate } from "../../src/hybrid/contracts.js";
import { createHybridCandidateService } from "../../src/hybrid/service.js";
import { createDomainCandidatePorts } from "../../src/infrastructure/domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "../../src/infrastructure/domain-port-eligibility-sources.js";
import { createDomainFeaturePorts } from "../../src/infrastructure/domain-port-feature-sources.js";
import { createDomainSemanticPorts } from "../../src/infrastructure/domain-port-semantic-sources.js";
import { createPostgresFeatureSnapshotStore } from "../../src/infrastructure/postgres-feature-snapshot-store.js";
import { createPostgresSemanticRepresentationStore } from "../../src/infrastructure/postgres-semantic-store.js";
import type { SemanticEmbedder } from "../../src/semantic/ports.js";
import { createSemanticCandidateService } from "../../src/semantic/service.js";

/**
 * One synthetic recommendation world over the real owning-context adapters
 * and local PostgreSQL, for integration tests of the recommendation
 * pipeline (REC-002 → REC-005, and REC-006 next): an investor with an
 * ACTIVE mandate and a DRAFT one that must not matter, companies made
 * marketplace-ready through the Companies context's own assessment with
 * the local synthetic verification seam, and every service composed the
 * way a server would. The caller owns the transaction and rolls it back.
 */

export const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const node = (vocabulary: string, code: string) =>
  referenceNode(vocabulary, code).id;

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

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
// A deterministic concept embedder: the runtime's stand-in, 1024 dimensions.
// ---------------------------------------------------------------------------

const CONCEPTS: readonly (readonly string[])[] = [
  [
    "logistics",
    "freight",
    "supply",
    "chain",
    "distributors",
    "fleet",
    "cargo",
    "haulage",
  ],
  ["software", "saas", "platform", "workflow"],
  [
    "africa",
    "african",
    "nigeria",
    "nigerian",
    "ghana",
    "kenya",
    "west",
    "lagos",
  ],
  ["hardware", "devices", "robotics", "sensors"],
  ["europe", "european", "berlin", "germany", "german"],
  ["enterprise", "b2b", "operations"],
  ["pet", "grooming", "bread", "pastry", "bakery"],
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

const CONCEPT_CONFIGURATION: EmbeddingConfiguration =
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

export type CountingEmbedder = SemanticEmbedder & { calls: number };

export function conceptEmbedder(): CountingEmbedder {
  const result = (
    text: string,
    instructionVersion: string,
  ): EmbeddingResult => ({
    vector: conceptVector(text),
    dimension: DIMENSION,
    providerCode: "fake",
    modelCode: CONCEPT_CONFIGURATION.modelCode,
    modelRevision: null,
    configurationVersion: CONCEPT_CONFIGURATION.configurationVersion,
    instructionVersion,
    inputSha256: "0".repeat(64),
    inputCharacters: text.length,
    latencyMs: 0,
  });
  const self: CountingEmbedder = {
    calls: 0,
    describe: () => ({
      providerCode: "fake",
      configuration: CONCEPT_CONFIGURATION,
      endpoint: null,
    }),
    embedDocuments: (inputs) => {
      self.calls += 1;
      return Promise.resolve({
        embeddings: inputs.map((t) =>
          result(t, EMBEDDING_DOCUMENT_INSTRUCTION_VERSION),
        ),
        batchSize: inputs.length,
        latencyMs: 0,
      });
    },
    embedQuery: (query, task) => {
      self.calls += 1;
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

export type CompanyFixture = {
  readonly label: string;
  readonly summary: string;
  readonly stage: string | null;
  readonly country: string | null;
  readonly nodes: readonly (readonly [string, string])[];
  readonly ready: boolean;
};

export type MandateFixture = {
  readonly name: string;
  readonly narrative: string;
  readonly stageCodes: readonly string[];
  readonly countryCodes: readonly string[];
  /** Positive taxonomy preferences, `[vocabulary, code]`. */
  readonly preferences: readonly (readonly [string, string])[];
  /** Declared hard exclusions, `[vocabulary, code]`. */
  readonly exclusions: readonly (readonly [string, string])[];
};

export type SeededCompany = {
  readonly id: string;
  readonly label: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly founder: ActorContext;
};

export type RecommendationWorld = {
  readonly tx: TransactionContext;
  readonly investorActor: ActorContext;
  readonly investorOrgId: string;
  readonly mandateId: string;
  readonly draftId: string;
  readonly companies: Readonly<Record<string, SeededCompany>>;
  readonly features: FeatureService;
  readonly labelOf: (companyId: string) => string;
  /** The REC-002 + REC-003 hybrid pool for the investor's ACTIVE mandate. */
  readonly pool: (topK: number) => Promise<readonly HybridCandidate[]>;
};

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

export async function seedRecommendationWorld(
  tx: TransactionContext,
  input: {
    readonly mandate: MandateFixture;
    readonly companies: readonly CompanyFixture[];
    readonly embedder: SemanticEmbedder;
  },
): Promise<RecommendationWorld> {
  const { sql } = tx;
  const tenantI = await insertTenant(tx, "REC Investor Tenant");
  const orgI = await insertOrganisation(tx, tenantI, "Apex Ventures");
  const investorActor = await insertAdmin(tx, tenantI, orgI);
  const investorOrgId = randomUUID();
  await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (${investorOrgId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;

  const m = input.mandate;
  const mandateId = randomUUID();
  await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, raw_mandate_text)
    values (${mandateId}, ${tenantI}, ${investorOrgId}, ${m.name}, 'ACTIVE', now(), ${investorActor.userId}, ${m.narrative})`;
  if (m.stageCodes.length > 0) {
    await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
      values (${tenantI}, ${mandateId}, 'stage', 'IN', ${sql.json({ kind: "codes", values: [...m.stageCodes] })}, 'MUST', false)`;
  }
  if (m.countryCodes.length > 0) {
    await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
      values (${tenantI}, ${mandateId}, 'geography.country', 'IN', ${sql.json({ kind: "codes", values: [...m.countryCodes] })}, 'STRONG', false)`;
  }
  for (const [vocabulary, code] of m.preferences) {
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
      values (${tenantI}, ${mandateId}, ${node(vocabulary, code)}, 'STRONG', false, 'user_selected')`;
  }
  for (const [vocabulary, code] of m.exclusions) {
    await sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
      values (${tenantI}, ${mandateId}, ${node(vocabulary, code)}, 'HARD_EXCLUSION', true, 'user_selected')`;
  }
  const draftId = randomUUID();
  await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, created_by_user_id)
    values (${draftId}, ${tenantI}, ${investorOrgId}, 'Draft', 'DRAFT', ${investorActor.userId})`;

  const companies: Record<string, SeededCompany> = {};
  for (const fixture of input.companies) {
    const tenantId = await insertTenant(tx, `REC ${fixture.label} tenant`);
    const organisationId = await insertOrganisation(
      tx,
      tenantId,
      `${fixture.label} Ltd`,
    );
    const founder = await insertAdmin(tx, tenantId, organisationId);
    const id = randomUUID();
    await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility)
      values (${id}, ${tenantId}, ${organisationId}, ${fixture.label}, ${`rec-${id.slice(0, 8)}`}, ${fixture.stage}, ${fixture.country}, ${fixture.summary}, 'network_visible')`;
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
    embeddings: input.embedder,
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

  const labelById = new Map(
    Object.values(companies).map((c) => [c.id, c.label] as const),
  );
  return {
    tx,
    investorActor,
    investorOrgId,
    mandateId,
    draftId,
    companies,
    features,
    labelOf: (companyId) => labelById.get(companyId) ?? companyId,
    pool: async (topK) => {
      const pool = await hybrid.generate({ actor: investorActor, topK });
      if (pool.kind !== "GENERATED") throw new Error(pool.kind);
      return pool.candidates;
    },
  };
}
