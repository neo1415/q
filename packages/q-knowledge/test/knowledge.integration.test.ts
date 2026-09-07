import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createPostgresEvidenceRepositories } from "@capital-q/evidence";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import {
  createKnowledgeQueryService,
  createKnowledgeWriteGate,
  createPostgresContradictionRepository,
  createPostgresKnowledgeRepository,
  type KnowledgeCandidateInput,
  type KnowledgeQueryScope,
} from "../src/index.js";
import type { RetrievalScopeConstraint } from "../src/retrieval/contracts.js";

/**
 * The Knowledge Write Gate against local PostgreSQL (CQ-KNW-002 §45-§47).
 *
 * The §47 eval cases (KNWW-001..008) are implemented HERE rather than inside
 * the q-evals release gate, and named so they are traceable. Every one of
 * them is a deterministic security or correctness property, which §47 itself
 * says must not be judged by a model; putting them in the harness that runs
 * scripted Q conversations would add a model-shaped wrapper around an
 * assertion that needs none, and would put the release gate at risk for no
 * gain in coverage.
 *
 * Each security case makes the forbidden thing the EASY thing: a candidate
 * that simply names another tenant's evidence, or asserts a value with
 * nothing behind it. If any succeeded, a model could decide what Capital Q
 * believes.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const MARKERS = {
  founderPrivate: "KNW-FOUNDER-PRIVATE-DO-NOT-LEAK",
  investorPrivate: "KNW-INVESTOR-PRIVATE-DO-NOT-LEAK",
  crossTenant: "KNW-CROSS-TENANT-DO-NOT-LEAK",
} as const;

class Rollback extends Error {}

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

type Tenant = {
  readonly tenantId: string;
  readonly orgId: string;
  readonly companyId: string;
  readonly actor: ActorContext;
};

type World = {
  readonly tx: TransactionContext;
  readonly a: Tenant;
  readonly b: Tenant;
  readonly gate: ReturnType<typeof createKnowledgeWriteGate>;
  readonly query: ReturnType<typeof createKnowledgeQueryService>;
  readonly contradictions: ReturnType<
    typeof createPostgresContradictionRepository
  >;
  readonly seedEvidence: (input: {
    readonly tenant: Tenant;
    readonly visibility?: string;
    readonly sensitivity?: string;
    readonly evidenceStatus?: string;
    readonly companyId?: string;
  }) => Promise<{ readonly sourceId: string; readonly evidenceItemId: string }>;
};

describe("the Knowledge Write Gate against local PostgreSQL", () => {
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

  async function seedTenant(
    tx: TransactionContext,
    label: string,
  ): Promise<Tenant> {
    const tenantId = randomUUID();
    const orgId = randomUUID();
    const companyId = randomUUID();
    const authUserId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`KNW ${label}`})`;
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${orgId}, ${tenantId}, 'company', ${`Org ${label}`}, ${`knw2-org-${orgId.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyId}, ${tenantId}, ${orgId}, ${`Company ${label}`}, ${`knw2-co-${companyId.slice(0, 8)}`})`;
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${orgId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return { tenantId, orgId, companyId, actor: resolution.context };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await seedTenant(tx, "Tenant A");
        const b = await seedTenant(tx, "Tenant B");
        const knowledge = createPostgresKnowledgeRepository();
        const contradictions = createPostgresContradictionRepository();
        const evidence = createPostgresEvidenceRepositories();

        const seedEvidence: World["seedEvidence"] = async (input) => {
          const sourceId = randomUUID();
          const evidenceItemId = randomUUID();
          const subjectId = input.companyId ?? input.tenant.companyId;
          const visibility = input.visibility ?? "founder_private";
          const sensitivity = input.sensitivity ?? "CONFIDENTIAL";
          await tx.sql`insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, created_by_user_id, visibility_scope, sensitivity_class)
            values (${sourceId}, ${input.tenant.tenantId}, 'DOCUMENT', 'COMPANY', ${subjectId}, 'Deck', ${input.tenant.actor.userId}, ${visibility}, ${sensitivity})`;
          await tx.sql`insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id)
            values (${evidenceItemId}, ${input.tenant.tenantId}, ${sourceId}, 'COMPANY', ${subjectId}, 'financial.extracted', 'ARR: $2.4m', ${tx.sql.json({ kind: "MONEY", amount: 2400000, currency: "USD" })}::jsonb, ${tx.sql.json({ kind: "statement" })}::jsonb, ${input.evidenceStatus ?? "DOCUMENT_SUPPORTED"}, 'UNKNOWN', ${visibility}, ${sensitivity}, ${input.tenant.actor.userId})`;
          return { sourceId, evidenceItemId };
        };

        await work({
          tx,
          a,
          b,
          seedEvidence,
          gate: createKnowledgeWriteGate({
            sql: tx.sql,
            transactions: nestedTransactions(tx),
            knowledge,
            contradictions,
            evidence,
          }),
          query: createKnowledgeQueryService({ sql: tx.sql, knowledge }),
          contradictions,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const candidate = (
    tenant: Tenant,
    evidenceItemId: string,
    overrides: Partial<KnowledgeCandidateInput> = {},
  ): KnowledgeCandidateInput => ({
    subject: { subjectType: "COMPANY", subjectId: tenant.companyId },
    knowledgeType: "fact",
    knowledgeKey: "financial.arr",
    statement: "Annual recurring revenue is approximately USD 2.4m.",
    structuredValue: { kind: "MONEY", amount: 2_400_000, currency: "USD" },
    truthClassProposal: "USER_CLAIM",
    supportingClaimIds: [],
    supportingEvidenceItemIds: [evidenceItemId],
    supportingSourceIds: [],
    validFrom: null,
    validTo: null,
    lineage: [],
    reason: "EXTRACTED_FROM_DOCUMENT",
    ...overrides,
  });

  const ownerScope = (tenant: Tenant): KnowledgeQueryScope => ({
    tenantId: tenant.tenantId,
    constraints: [
      {
        scopeKind: "EVIDENCE_DOCUMENTS",
        layer: "KNOWLEDGE_OBJECTS",
        subjectIds: [tenant.companyId],
        visibilityScopes: ["founder_private", "organisation_private"],
        sensitivityCeiling: "HIGHLY_CONFIDENTIAL",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: false,
      } satisfies RetrievalScopeConstraint,
    ],
  });

  const counterpartyScope = (tenant: Tenant): KnowledgeQueryScope => ({
    tenantId: tenant.tenantId,
    constraints: [
      {
        scopeKind: "NETWORK_VISIBLE_DATA",
        layer: "KNOWLEDGE_OBJECTS",
        subjectIds: null,
        visibilityScopes: ["network_visible"],
        sensitivityCeiling: "NETWORK_VISIBLE",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: true,
      } satisfies RetrievalScopeConstraint,
    ],
  });

  // -------------------------------------------------------------------------
  // KNWW-001 — a valid document-supported candidate
  // -------------------------------------------------------------------------

  it("KNWW-001: records a document-supported understanding with its provenance", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId, sourceId } = await world.seedEvidence({
        tenant: world.a,
      });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          supportingSourceIds: [sourceId],
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      expect(result.outcome).toBe("ACCEPTED");
      expect(result.status).toBe("ACTIVE");
      // A deck is the company describing itself. Document support is not
      // verification, and confidence says so.
      expect(result.truthClass).toBe("USER_CLAIM");
      expect(result.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
      expect(result.confidenceClass).toBe("MODERATE");
      expect(result.visibilityScope).toBe("founder_private");

      const read = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(read?.object.id).toBe(result.objectId);
      expect(read?.evidence).toEqual([
        { evidenceItemId, relationship: "SUPPORTS" },
      ]);
      expect(read?.sourceIds).toEqual([sourceId]);
    });
  });

  it("holds a candidate that no one has confirmed", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        // Not an automatic write: a person decides.
        automatic: false,
      });
      expect(result.outcome).toBe("HELD");
      expect(result.status).toBe("CANDIDATE");
      // A held candidate is not Capital Q's position, so a read finds none.
      const read = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(read).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-002 — an unsupported model inference
  // -------------------------------------------------------------------------

  it("KNWW-002: refuses an assertion with nothing behind it, and holds an inference", async () => {
    await withWorld(async (world) => {
      // No evidence at all: general model knowledge is not entity evidence.
      const unsupported = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, "", {
          supportingEvidenceItemIds: [],
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(unsupported.outcome).toBe("REJECTED");
      expect(unsupported.reason).toBe("NO_SUPPORTING_EVIDENCE");
      expect(unsupported.objectId).toBeNull();

      // Evidenced, but Q's own conclusion: kept as a candidate for a person.
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const inferred = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          knowledgeKey: "traction.churn_rate",
          knowledgeType: "inference",
          truthClassProposal: "Q_INFERENCE",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(inferred.outcome).toBe("HELD");
      expect(inferred.reason).toBe("INFERENCE_NEEDS_CONFIRMATION");
      expect(inferred.truthClass).toBe("Q_INFERENCE");
      expect(inferred.confidenceClass).toBe("LOW");
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-003 — private-scope contamination
  // -------------------------------------------------------------------------

  it("KNWW-003 BLOCKER: founder-private evidence cannot produce wider knowledge", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({
        tenant: world.a,
        visibility: "founder_private",
        sensitivity: "RESTRICTED",
      });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          statement: `Annual recurring revenue is USD 2.4m. ${MARKERS.founderPrivate}`,
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(result.visibilityScope).toBe("founder_private");
      // RESTRICTED in, RESTRICTED out. The candidate has no field with
      // which to ask for anything else.
      expect(result.sensitivityClass).toBe("RESTRICTED");

      // And a counterparty-scoped read cannot reach it.
      const asCounterparty = await world.query.currentForKey(
        counterpartyScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(asCounterparty).toBeNull();
      expect(JSON.stringify(asCounterparty)).not.toContain(
        MARKERS.founderPrivate,
      );
    });
  });

  it("KNWW-003 BLOCKER: investor-private evidence keeps its scope", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({
        tenant: world.a,
        visibility: "investor_private",
        sensitivity: "HIGHLY_CONFIDENTIAL",
      });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          statement: `Cheque size is USD 2.4m. ${MARKERS.investorPrivate}`,
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(result.visibilityScope).toBe("investor_private");
      expect(result.sensitivityClass).toBe("HIGHLY_CONFIDENTIAL");
      // A founder-scoped read does not reach investor-private knowledge.
      const asFounder = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(asFounder).toBeNull();
    });
  });

  it("KNWW-003 BLOCKER: mixed inputs take the narrowest scope and strongest class", async () => {
    await withWorld(async (world) => {
      const shared = await world.seedEvidence({
        tenant: world.a,
        visibility: "network_visible",
        sensitivity: "NETWORK_VISIBLE",
      });
      const private_ = await world.seedEvidence({
        tenant: world.a,
        visibility: "founder_private",
        sensitivity: "RESTRICTED",
      });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, shared.evidenceItemId, {
          supportingEvidenceItemIds: [
            shared.evidenceItemId,
            private_.evidenceItemId,
          ],
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      // It could not have been reached without the private half, so it
      // carries the private half's scope and the stronger class.
      expect(result.visibilityScope).toBe("founder_private");
      expect(result.sensitivityClass).toBe("RESTRICTED");
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-004 — cross-tenant injection
  // -------------------------------------------------------------------------

  it("KNWW-004 BLOCKER: a candidate naming another tenant's evidence writes nothing", async () => {
    await withWorld(async (world) => {
      const foreign = await world.seedEvidence({ tenant: world.b });
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, foreign.evidenceItemId, {
          statement: `ARR is USD 2.4m. ${MARKERS.crossTenant}`,
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(result.outcome).toBe("REJECTED");
      expect(result.reason).toBe("PROVENANCE_NOT_FOUND");
      const [count] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${world.a.tenantId}`;
      expect(count?.n).toBe(0);
      expect(JSON.stringify(result)).not.toContain(MARKERS.crossTenant);
    });
  });

  it("KNWW-004 BLOCKER: a candidate about another subject writes nothing", async () => {
    await withWorld(async (world) => {
      const other = randomUUID();
      await world.tx
        .sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${other}, ${world.a.tenantId}, ${world.a.orgId}, 'Other', ${`knw2-oc-${other.slice(0, 8)}`})`;
      const { evidenceItemId } = await world.seedEvidence({
        tenant: world.a,
        companyId: other,
      });
      const result = await world.gate.submit({
        actor: world.a.actor,
        // Evidence about the other company, claimed for this one.
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(result.outcome).toBe("REJECTED");
      expect(result.reason).toBe("PROVENANCE_NOT_FOUND");
    });
  });

  it("KNWW-004 BLOCKER: a fabricated evidence id writes nothing", async () => {
    await withWorld(async (world) => {
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, randomUUID()),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(result.outcome).toBe("REJECTED");
      expect(result.reason).toBe("PROVENANCE_NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-005 / KNWW-006 — VERIFIED and a manufactured percentage
  // -------------------------------------------------------------------------

  it("KNWW-005 + KNWW-006 BLOCKER: no candidate can assert VERIFIED, ACTIVE or a confidence", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({
        tenant: world.a,
        evidenceStatus: "PLATFORM_VERIFIED",
      });
      const hostile = {
        ...candidate(world.a, evidenceItemId),
        truthClassProposal: "VERIFIED",
        status: "ACTIVE",
        confidenceClass: "HIGH",
        confidence: 0.92,
        visibilityScope: "network_visible",
        sensitivityClass: "PUBLIC",
      };
      const result = await world.gate.submit({
        actor: world.a.actor,
        candidate: hostile as never,
        correlationId: CORRELATION(),
        automatic: true,
      });
      // The candidate is refused at the schema: none of those fields exists.
      expect(result.outcome).toBe("REJECTED");
      expect(result.reason).toBe("CANDIDATE_INVALID");
      const [count] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${world.a.tenantId}`;
      expect(count?.n).toBe(0);

      // And even a well-formed candidate over platform-verified evidence
      // does not become VERIFIED: the gate does not upgrade truth class.
      const honest = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(honest.truthClass).toBe("USER_CLAIM");
      expect(honest.truthClass).not.toBe("VERIFIED");
      // Confidence is a category with no numeric form anywhere in the path.
      expect(typeof honest.confidenceClass).toBe("string");
      expect(JSON.stringify(honest)).not.toMatch(/0\.9|92/);
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-007 — revoked evidence
  // -------------------------------------------------------------------------

  it("KNWW-007: withdrawn evidence lowers confidence on the knowledge that rested on it", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const created = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(created.confidenceClass).toBe("MODERATE");

      const reassessed = await world.gate.reassessForWithdrawnEvidence({
        actor: world.a.actor,
        evidenceItemIds: [evidenceItemId],
        reason: "EVIDENCE_WITHDRAWN",
      });

      expect(reassessed).toHaveLength(1);
      // Nothing is deleted and the statement is unchanged; what changes is
      // that Capital Q stops claiming to be supported.
      expect(reassessed[0]?.confidenceClass).toBe("INSUFFICIENT_EVIDENCE");
      expect(reassessed[0]?.evidenceStatus).toBe("NO_EVIDENCE");
      expect(reassessed[0]?.revisionNumber).toBe(2);

      const [row] = await world.tx.sql<
        {
          statement: string;
          confidence_class: string;
          reassessment_reason: string | null;
          reassessment_required_at: Date | null;
        }[]
      >`select statement, confidence_class, reassessment_reason, reassessment_required_at
          from q_knowledge.objects where id = ${created.objectId ?? ""}`;
      expect(row?.statement).toContain("2.4m");
      expect(row?.confidence_class).toBe("INSUFFICIENT_EVIDENCE");
      expect(row?.reassessment_reason).toBe("EVIDENCE_WITHDRAWN");
      expect(row?.reassessment_required_at).not.toBeNull();

      // The earlier, better-supported understanding is still reconstructable.
      const revisions = await world.tx.sql<
        { revision_number: number; confidence_class: string }[]
      >`select revision_number, confidence_class from q_knowledge.revisions
          where knowledge_object_id = ${created.objectId ?? ""} order by revision_number`;
      expect(revisions.map((r) => r.confidence_class)).toEqual([
        "MODERATE",
        "INSUFFICIENT_EVIDENCE",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // KNWW-008 — a conflicting current candidate
  // -------------------------------------------------------------------------

  it("KNWW-008: a conflicting candidate is held, and neither value is chosen", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      const active = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(active.outcome).toBe("ACCEPTED");

      const conflicting = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "Annual recurring revenue is approximately USD 1.9m.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_900_000,
            currency: "USD",
          },
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      expect(conflicting.outcome).toBe("HELD");
      expect(conflicting.reason).toBe("CONFLICTS_WITH_ACTIVE");
      expect(conflicting.status).toBe("CANDIDATE");
      // CQ-KNW-003: the disagreement now has somewhere to live.
      expect(conflicting.contradictionSetId).not.toBeNull();

      // The existing understanding keeps its value and its history. Nothing
      // preferred the larger number, and nothing preferred the newer one.
      const [row] = await world.tx.sql<
        {
          structured_value: Record<string, unknown>;
          confidence_class: string;
          status: string;
        }[]
      >`select structured_value, confidence_class, status from q_knowledge.objects
          where id = ${active.objectId ?? ""}`;
      expect(row?.structured_value).toMatchObject({ amount: 2_400_000 });
      // Contested, not withdrawn and not chosen against.
      expect(row?.status).toBe("DISPUTED");
      // And Capital Q stops claiming confidence it no longer has.
      expect(row?.confidence_class).toBe("CONFLICTING_EVIDENCE");

      // Both readings exist, and the lineage records that one reassesses
      // the other — the input CQ-KNW-003 needs.
      const [objects] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${world.a.tenantId}`;
      expect(objects?.n).toBe(2);
      const lineage = await world.tx.sql<{ relationship: string }[]>`
        select relationship from q_knowledge.lineage
         where parent_object_id = ${active.objectId ?? ""}`;
      expect(lineage.map((l) => l.relationship)).toEqual(["reassesses"]);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency, corroboration and history
  // -------------------------------------------------------------------------

  it("is idempotent when the same candidate arrives twice", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const command = {
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      };
      const first = await world.gate.submit(command);
      const second = await world.gate.submit({
        ...command,
        correlationId: CORRELATION(),
      });
      expect(first.outcome).toBe("ACCEPTED");
      expect(second.outcome).toBe("DUPLICATE");
      expect(second.objectId).toBe(first.objectId);
      const [count] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${world.a.tenantId}`;
      expect(count?.n).toBe(1);
    });
  });

  it("records a second independent source as better support, with history", async () => {
    await withWorld(async (world) => {
      const deck = await world.seedEvidence({ tenant: world.a });
      const accounts = await world.seedEvidence({ tenant: world.a });
      const first = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, deck.evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const second = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, accounts.evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });

      expect(second.outcome).toBe("REVISED");
      expect(second.objectId).toBe(first.objectId);
      // Two genuinely distinct sources, so multi-source support is honest.
      expect(second.evidenceStatus).toBe("MULTI_SOURCE_SUPPORTED");
      expect(second.supportingSourceCount).toBe(2);
      // Better evidence does not make it verified.
      expect(second.truthClass).toBe("USER_CLAIM");
      expect(second.confidenceClass).not.toBe("HIGH");

      const read = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(read?.evidence).toHaveLength(2);
      expect(read?.sourceIds).toHaveLength(2);

      // Revision 1 is still what it was.
      const revisions = await world.tx.sql<
        { revision_number: number; evidence_status: string }[]
      >`select revision_number, evidence_status from q_knowledge.revisions
          where knowledge_object_id = ${first.objectId ?? ""} order by revision_number`;
      expect(revisions.map((r) => r.evidence_status)).toEqual([
        "DOCUMENT_SUPPORTED",
        "MULTI_SOURCE_SUPPORTED",
      ]);
    });
  });

  it("refuses to rewrite history or identity in the database", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const created = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      await expect(
        world.tx.sql.savepoint(
          async (sql) =>
            sql`update q_knowledge.revisions set statement = 'rewritten'
                 where knowledge_object_id = ${created.objectId ?? ""}`,
        ),
      ).rejects.toThrow();
      await expect(
        world.tx.sql.savepoint(
          async (sql) =>
            sql`update q_knowledge.objects set knowledge_key = 'financial.mrr'
                 where id = ${created.objectId ?? ""}`,
        ),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Reads are authorisation, not existence
  // -------------------------------------------------------------------------

  it("an empty envelope reads nothing, and looks exactly like nothing being there", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const denied = await world.query.currentForKey(
        { tenantId: world.a.tenantId, constraints: [] },
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      const missing = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "team.employee_count",
      );
      expect(denied).toBeNull();
      expect(missing).toBeNull();
    });
  });

  it("BLOCKER: another tenant's envelope reads nothing", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          statement: `ARR is USD 2.4m. ${MARKERS.crossTenant}`,
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      // Tenant B's envelope naming tenant A's company: the id is a
      // selection, never authority, and the tenant predicate is the server's.
      const asB = await world.query.currentForSubject(
        {
          tenantId: world.b.tenantId,
          constraints: ownerScope(world.a).constraints,
        },
        { subjectType: "COMPANY", subjectId: world.a.companyId },
      );
      expect(asB).toEqual([]);
      expect(JSON.stringify(asB)).not.toContain(MARKERS.crossTenant);
    });
  });

  // -------------------------------------------------------------------------
  // CQ-KNW-003 — time, difference and disagreement
  // -------------------------------------------------------------------------

  const period = (from: string, to: string | null) => ({
    validFrom: from as never,
    validTo: to as never,
  });

  it("KNW3-001: a metric has a history, and growth is not a conflict", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      const january = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId, {
          statement: "ARR was USD 1.8m in January.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_800_000,
            currency: "USD",
          },
          ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const august = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "ARR was USD 2.4m in August.",
          structuredValue: {
            kind: "MONEY",
            amount: 2_400_000,
            currency: "USD",
          },
          ...period("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      // Both stand. Neither is a discrepancy, and nothing was superseded.
      expect(january.outcome).toBe("ACCEPTED");
      expect(august.outcome).toBe("ACCEPTED_DIFFERENCE");
      expect(august.reason).toBe("DIFFERENT_PERIOD");
      expect(august.contradictionSetId).toBeNull();

      const subject = {
        subjectType: "COMPANY" as const,
        subjectId: world.a.companyId,
      };
      const history = await world.query.historyForKey(
        ownerScope(world.a),
        subject,
        "financial.arr",
      );
      expect(history).toHaveLength(2);
      expect(history[0]?.object.id).toBe(august.objectId);

      // "What was ARR in June" is answered from valid time.
      const inJune = await world.query.asOfForKey(
        ownerScope(world.a),
        subject,
        "financial.arr",
        new Date("2026-06-15T00:00:00.000Z"),
      );
      expect(inJune).toBeNull();
      const inJanuary = await world.query.asOfForKey(
        ownerScope(world.a),
        subject,
        "financial.arr",
        new Date("2026-01-15T00:00:00.000Z"),
      );
      expect(inJanuary?.object.id).toBe(january.objectId);

      // And "what is it now" is the latest effective reading, once.
      const current = await world.query.currentForSubject(
        ownerScope(world.a),
        subject,
      );
      expect(current).toHaveLength(1);
      expect(current[0]?.object.id).toBe(august.objectId);
    });
  });

  it("KNW3-002: a definition and a basis coexist rather than compete", async () => {
    await withWorld(async (world) => {
      const seeds = [
        await world.seedEvidence({ tenant: world.a }),
        await world.seedEvidence({ tenant: world.a }),
        await world.seedEvidence({ tenant: world.a }),
      ];
      const gross = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, seeds[0]?.evidenceItemId ?? "", {
          definitionQualifier: "gross",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const net = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, seeds[1]?.evidenceItemId ?? "", {
          statement: "ARR net of churn is approximately USD 2.1m.",
          structuredValue: {
            kind: "MONEY",
            amount: 2_100_000,
            currency: "USD",
          },
          definitionQualifier: "net_of_churn",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const forecast = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, seeds[2]?.evidenceItemId ?? "", {
          statement: "ARR is forecast at USD 4m.",
          structuredValue: {
            kind: "MONEY",
            amount: 4_000_000,
            currency: "USD",
          },
          definitionQualifier: "gross",
          measurementBasis: "FORECAST",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      expect(gross.outcome).toBe("ACCEPTED");
      expect(net.outcome).toBe("ACCEPTED_DIFFERENCE");
      expect(net.reason).toBe("DIFFERENT_DEFINITION");
      expect(forecast.outcome).toBe("ACCEPTED_DIFFERENCE");
      // Three readings, no disagreement, nothing superseded.
      for (const result of [gross, net, forecast]) {
        expect(result.status).toBe("ACTIVE");
        expect(result.contradictionSetId).toBeNull();
      }
      const [open] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.contradiction_sets
         where tenant_id = ${world.a.tenantId}`;
      expect(open?.n).toBe(0);
    });
  });

  it("KNW3-003: a correction supersedes the period it restates, and keeps it", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      const original = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId, {
          statement: "ARR was USD 1.8m in June.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_800_000,
            currency: "USD",
          },
          ...period("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const corrected = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "ARR was USD 1.75m in June.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_750_000,
            currency: "USD",
          },
          ...period("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
          correctsEarlier: true,
          reason: "CORRECTION",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      expect(corrected.outcome).toBe("CORRECTED");
      expect(corrected.reason).toBe("CORRECTS_EARLIER_PERIOD");
      expect(corrected.status).toBe("ACTIVE");
      // A fixed typo is not a disagreement and not a decline.
      expect(corrected.contradictionSetId).toBeNull();
      expect(corrected.confidenceClass).not.toBe("CONFLICTING_EVIDENCE");

      const [before] = await world.tx.sql<{ status: string }[]>`
        select status from q_knowledge.objects where id = ${original.objectId ?? ""}`;
      // Superseded, never deleted: it is what June looked like before.
      expect(before?.status).toBe("SUPERSEDED");

      const lineage = await world.tx.sql<{ relationship: string }[]>`
        select relationship from q_knowledge.lineage
         where parent_object_id = ${original.objectId ?? ""}
           and child_object_id = ${corrected.objectId ?? ""}`;
      expect(lineage.map((l) => l.relationship)).toEqual(["supersedes"]);

      const history = await world.query.historyForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.arr",
      );
      expect(history).toHaveLength(2);
    });
  });

  it("KNW3-004: a candidate cannot supersede a figure by claiming to correct it", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      const june = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId, {
          ...period("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      // Same key, DIFFERENT period, but asserting a correction. The periods
      // do not match, so the flag decides nothing.
      const pretender = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "ARR was USD 9m in August.",
          structuredValue: {
            kind: "MONEY",
            amount: 9_000_000,
            currency: "USD",
          },
          ...period("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
          correctsEarlier: true,
          reason: "CORRECTION",
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(pretender.outcome).not.toBe("CORRECTED");
      const [row] = await world.tx.sql<{ status: string }[]>`
        select status from q_knowledge.objects where id = ${june.objectId ?? ""}`;
      expect(row?.status).toBe("ACTIVE");
    });
  });

  it("KNW3-005: both sides of a disagreement travel, and only a person settles it", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      const incumbent = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const challenger = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "Annual recurring revenue is approximately USD 1.9m.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_900_000,
            currency: "USD",
          },
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const setId = challenger.contradictionSetId ?? "";
      expect(setId).not.toBe("");

      const subject = {
        subjectType: "COMPANY" as const,
        subjectId: world.a.companyId,
      };
      const disputes = await world.query.disputesForSubject(
        ownerScope(world.a),
        subject,
      );
      expect(disputes).toHaveLength(1);
      // Neither number was chosen, and neither travels alone.
      expect(disputes[0]?.members).toHaveLength(2);
      expect(disputes[0]?.set.materiality).toBe("UNDETERMINED");
      expect(disputes[0]?.members.map((m) => m.object.id).sort()).toEqual(
        [incumbent.objectId, challenger.objectId].sort(),
      );
      // The reading Q still holds says it is contested.
      const current = await world.query.currentForKey(
        ownerScope(world.a),
        subject,
        "financial.arr",
      );
      expect(current?.disputed).toBe(true);

      // A second conflicting candidate joins the argument rather than
      // starting a parallel one.
      const third = await world.seedEvidence({ tenant: world.a });
      const again = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, third.evidenceItemId, {
          statement: "Annual recurring revenue is approximately USD 1.7m.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_700_000,
            currency: "USD",
          },
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      expect(again.contradictionSetId).toBe(setId);

      // Nothing automatic may settle it.
      const machine = await world.gate.settleContradiction({
        actor: { ...world.a.actor, actorType: "SYSTEM" },
        setId,
        status: "RESOLVED",
        reason: "FOUNDER_CONFIRMED",
        chosenObjectId: incumbent.objectId ?? "",
      });
      expect(machine.outcome).toBe("REFUSED");
      expect(machine.reason).toBe("NOT_A_HUMAN_DECISION");

      // And a person cannot choose a reading that is not in the set.
      const stray = await world.gate.settleContradiction({
        actor: world.a.actor,
        setId,
        status: "RESOLVED",
        reason: "FOUNDER_CONFIRMED",
        chosenObjectId: world.a.companyId,
      });
      expect(stray.reason).toBe("CHOICE_NOT_A_MEMBER");

      const settled = await world.gate.settleContradiction({
        actor: world.a.actor,
        setId,
        status: "RESOLVED",
        reason: "FOUNDER_CONFIRMED",
        chosenObjectId: incumbent.objectId ?? "",
      });
      expect(settled.outcome).toBe("SETTLED");
      expect(settled.standingObjectId).toBe(incumbent.objectId);

      // Every member survives; the ones not chosen are superseded, not gone.
      const [total] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects
         where tenant_id = ${world.a.tenantId}`;
      expect(total?.n).toBe(3);
      const [standing] = await world.tx.sql<{ status: string }[]>`
        select status from q_knowledge.objects where id = ${incumbent.objectId ?? ""}`;
      expect(standing?.status).toBe("ACTIVE");
      expect(
        await world.query.disputesForSubject(ownerScope(world.a), subject),
      ).toHaveLength(0);
    });
  });

  it("KNW3-006 BLOCKER: a disagreement is never filed more openly than what it is about", async () => {
    await withWorld(async (world) => {
      const first = await world.seedEvidence({ tenant: world.a });
      const second = await world.seedEvidence({ tenant: world.a });
      await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, first.evidenceItemId),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const challenger = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, second.evidenceItemId, {
          statement: "Annual recurring revenue is approximately USD 1.9m.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_900_000,
            currency: "USD",
          },
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      const [set] = await world.tx.sql<
        { visibility_scope: string; sensitivity_class: string }[]
      >`select visibility_scope, sensitivity_class from q_knowledge.contradiction_sets
          where id = ${challenger.contradictionSetId ?? ""}`;
      // "These two figures conflict" discloses as much as the figures do.
      expect(set?.visibility_scope).toBe("founder_private");
      expect(set?.sensitivity_class).toBe("CONFIDENTIAL");

      // A counterparty envelope reaches neither the set nor its members.
      expect(
        await world.query.disputesForSubject(counterpartyScope(world.b), {
          subjectType: "COMPANY",
          subjectId: world.a.companyId,
        }),
      ).toEqual([]);
    });
  });

  it("KNW3-007: an unauthorised later reading never suppresses an authorised earlier one", async () => {
    await withWorld(async (world) => {
      const open = await world.seedEvidence({
        tenant: world.a,
        visibility: "network_visible",
        sensitivity: "NETWORK_VISIBLE",
      });
      const closed = await world.seedEvidence({ tenant: world.a });
      const shared = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, open.evidenceItemId, {
          statement: "ARR was USD 1.8m in January.",
          structuredValue: {
            kind: "MONEY",
            amount: 1_800_000,
            currency: "USD",
          },
          ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, closed.evidenceItemId, {
          statement: "ARR was USD 2.4m in August.",
          structuredValue: {
            kind: "MONEY",
            amount: 2_400_000,
            currency: "USD",
          },
          ...period("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      // Derived knowledge is never as open as its source: a network-visible
      // document yields organisation-private understanding. The August
      // figure is narrower still, so a viewer holding only the wider scope
      // sees January — not silence, and not the private figure.
      const seen = await world.query.currentForSubject(
        {
          tenantId: world.a.tenantId,
          constraints: [
            {
              scopeKind: "COMPANY_PROFILE",
              layer: "KNOWLEDGE_OBJECTS",
              subjectIds: [world.a.companyId],
              visibilityScopes: ["organisation_private"],
              sensitivityCeiling: "CONFIDENTIAL",
              canDiscloseExistence: true,
              canQuote: true,
              canProvideLink: false,
            } satisfies RetrievalScopeConstraint,
          ],
        },
        { subjectType: "COMPANY", subjectId: world.a.companyId },
      );
      expect(seen.map((k) => k.object.id)).toEqual([shared.objectId]);
    });
  });

  it("KNW3-008: an aged understanding goes stale without changing what it says", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      const recorded = await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          knowledgeKey: "financial.cash_balance",
          statement: "Cash on hand was USD 900k in May.",
          structuredValue: { kind: "MONEY", amount: 900_000, currency: "USD" },
          ...period("2026-05-01T00:00:00.000Z", null),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });

      const swept = await world.gate.reassessForFreshness({
        actor: world.a.actor,
        subject: { subjectType: "COMPANY", subjectId: world.a.companyId },
        now: new Date("2026-09-01T00:00:00.000Z"),
      });
      expect(swept.map((r) => r.objectId)).toEqual([recorded.objectId]);

      const [row] = await world.tx.sql<
        {
          status: string;
          statement: string;
          visibility_scope: string;
          sensitivity_class: string;
        }[]
      >`select status, statement, visibility_scope, sensitivity_class
          from q_knowledge.objects where id = ${recorded.objectId ?? ""}`;
      expect(row?.status).toBe("STALE");
      // Stale is not false, and it is never a permission.
      expect(row?.statement).toBe("Cash on hand was USD 900k in May.");
      expect(row?.visibility_scope).toBe("founder_private");
      expect(row?.sensitivity_class).toBe("CONFIDENTIAL");

      // It still answers "what was it in May", and no longer answers "now".
      const subject = {
        subjectType: "COMPANY" as const,
        subjectId: world.a.companyId,
      };
      expect(
        (
          await world.query.asOfForKey(
            ownerScope(world.a),
            subject,
            "financial.cash_balance",
            new Date("2026-05-15T00:00:00.000Z"),
          )
        )?.object.id,
      ).toBe(recorded.objectId);
      expect(
        await world.query.currentForKey(
          ownerScope(world.a),
          subject,
          "financial.cash_balance",
        ),
      ).toBeNull();
    });
  });

  it("KNW3-009: a read reports age without a model and without widening scope", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      await world.gate.submit({
        actor: world.a.actor,
        candidate: candidate(world.a, evidenceItemId, {
          knowledgeKey: "financial.cash_balance",
          ...period("2026-05-01T00:00:00.000Z", null),
        }),
        correlationId: CORRELATION(),
        automatic: true,
      });
      const read = await world.query.currentForKey(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        "financial.cash_balance",
      );
      expect(read?.freshness.policyVersion).toBe("knowledge-freshness-v1");
      expect(read?.freshness.ageDays).toBeGreaterThan(45);
      expect(read?.object.visibilityScope).toBe("founder_private");
    });
  });

  it("bounds what one read can return", async () => {
    await withWorld(async (world) => {
      const { evidenceItemId } = await world.seedEvidence({ tenant: world.a });
      for (const key of [
        "financial.arr",
        "financial.mrr",
        "team.employee_count",
      ]) {
        await world.gate.submit({
          actor: world.a.actor,
          candidate: candidate(world.a, evidenceItemId, { knowledgeKey: key }),
          correlationId: CORRELATION(),
          automatic: true,
        });
      }
      const all = await world.query.currentForSubject(ownerScope(world.a), {
        subjectType: "COMPANY",
        subjectId: world.a.companyId,
      });
      expect(all).toHaveLength(3);
      const bounded = await world.query.currentForSubject(
        ownerScope(world.a),
        { subjectType: "COMPANY", subjectId: world.a.companyId },
        { limit: 2 },
      );
      expect(bounded).toHaveLength(2);
    });
  });
});
