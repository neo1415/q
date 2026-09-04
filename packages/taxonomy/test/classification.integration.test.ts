import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  type CompanyId,
} from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createLogger } from "@capital-q/observability";
import {
  AuthorizationDeniedError,
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { TAXONOMY_EVENTS } from "../src/events/index.js";
import {
  createTaxonomyService,
  referenceNode,
  TAXONOMY_CLASSIFIER_IDENTITY,
  TaxonomyClassificationCandidateDecidedError,
  TaxonomyClassificationInputError,
  TaxonomyClassificationRunNotFoundError,
  TaxonomyClassifierNotAvailableError,
  TaxonomyNodeIdSchema,
  TaxonomySubjectNotFoundError,
  TaxonomyVocabularyNotFoundError,
  type TaxonomyNodeId,
  type TaxonomyService,
} from "../src/index.js";

/**
 * The deterministic classifier against the real local database: exact,
 * alias, display-name and lexical (pg_trgm) candidates, scope, ambiguity,
 * abstention, version snapshots, persistent provenance runs, human
 * acceptance / rejection through the canonical assignment path, tenant and
 * authority boundaries, and privacy of the raw text across logs, audit,
 * outbox and run metadata. Every test runs in one rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const MARKER = "PRIVATE-CLASSIFICATION-TEXT-DO-NOT-LOG";
const RAW_STATEMENT = `We build claims automation APIs for insurers across West Africa. ${MARKER}`;

class Rollback extends Error {}

const registry = createEventRegistry([...TAXONOMY_EVENTS]);

const node = (vocabulary: string, code: string): TaxonomyNodeId =>
  TaxonomyNodeIdSchema.parse(referenceNode(vocabulary, code).id);

type World = {
  readonly tx: TransactionContext;
  readonly taxonomy: TaxonomyService;
  readonly logs: string[];
  readonly tenantA: string;
  readonly tenantB: string;
  readonly founderA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly companyA: CompanyId;
  readonly companyB: CompanyId;
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

describe("@capital-q/taxonomy classification against local PostgreSQL", () => {
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
  ): Promise<{ principal: AuthenticatedPrincipal; userId: string }> {
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
      userId: profile.id,
    };
  }

  async function resolveActor(
    tx: TransactionContext,
    principal: AuthenticatedPrincipal,
  ) {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  async function seedWorld(tx: TransactionContext): Promise<World> {
    const tenantA = await insertTenant(tx, "Classification Tenant A");
    const tenantB = await insertTenant(tx, "Classification Tenant B");
    const orgA = await insertOrganisation(tx, tenantA, "company", "Alpha");
    const founder = await insertMember(tx, tenantA, orgA, "organisation_admin");
    const member = await insertMember(tx, tenantA, orgA, "organisation_member");
    const companyAId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyAId}, ${tenantA}, ${orgA}, 'Alpha Rails', ${`alpha-${companyAId.slice(0, 8)}`})`;
    // The member is a founder with a CEO title; neither grants company.edit.
    await tx.sql`insert into core.company_members (tenant_id, company_id, user_id, business_title, is_founder)
      values (${tenantA}, ${companyAId}, ${member.userId}, 'CEO', true)`;
    const orgB = await insertOrganisation(tx, tenantB, "company", "Beta");
    const adminB = await insertMember(tx, tenantB, orgB, "organisation_admin");
    const companyBId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyBId}, ${tenantB}, ${orgB}, 'Beta Co', ${`beta-${companyBId.slice(0, 8)}`})`;

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
    const taxonomy = createTaxonomyService({
      sql: tx.sql,
      transactions: nestedTransactions(tx),
      authorization: createAuthorizationService(
        createPostgresAuthorizationPolicySource({ sql: tx.sql }),
      ),
      companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
      outbox: createOutboxWriter({ registry }),
      audit: createPostgresMaterialActionAuditWriter(),
      logger,
    });
    return {
      tx,
      taxonomy,
      logs,
      tenantA,
      tenantB,
      founderA: await resolveActor(tx, founder.principal),
      memberA: await resolveActor(tx, member.principal),
      adminB: await resolveActor(tx, adminB.principal),
      companyA: CompanyIdSchema.parse(companyAId),
      companyB: CompanyIdSchema.parse(companyBId),
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

  // -------------------------------------------------------------------------
  // Stateless candidate lookup
  // -------------------------------------------------------------------------

  it("resolves exact canonical codes, aliases and display names with normalisation (§26-30, §182)", async () => {
    await withWorld(async ({ taxonomy }) => {
      const find = taxonomy.classification.candidates.findCandidates;

      const code = await find({
        text: "payment_infrastructure",
        vocabularyCodes: ["industry"],
      });
      expect(code.resolution).toBe("EXACT");
      expect(code.candidates[0]).toMatchObject({
        nodeId: node("industry", "payment_infrastructure"),
        rank: 1,
        confidence: "1.0000",
        matchTypes: ["CANONICAL_CODE_EXACT"],
      });
      expect(code.classifier).toEqual(TAXONOMY_CLASSIFIER_IDENTITY);
      expect(code.taxonomyVersions).toEqual({ industry: 1 });

      const alias = await find({
        text: "  Payments   RAILS ",
        vocabularyCodes: ["product_category"],
      });
      expect(alias.resolution).toBe("EXACT");
      expect(alias.candidates[0]).toMatchObject({
        nodeId: node("product_category", "payment_infrastructure"),
        confidence: "0.9500",
        matchTypes: ["ALIAS_EXACT"],
        rationaleSummary: 'Exact curated alias match ("payments rails").',
      });

      const display = await find({
        text: "Cross-Border Payments",
        vocabularyCodes: ["industry"],
      });
      expect(display.resolution).toBe("EXACT");
      expect(display.candidates[0]?.nodeId).toBe(
        node("industry", "cross_border_payments"),
      );
      expect(display.candidates[0]?.matchTypes).toEqual(["DISPLAY_NAME_EXACT"]);

      const unicode = await find({ text: "ﬁntech" });
      expect(unicode.candidates[0]?.nodeId).toBe(node("industry", "fintech"));

      const exactOnly = await find({
        text: "claims automation apis for insurers",
        strategy: "EXACT",
      });
      expect(exactOnly).toMatchObject({
        resolution: "ABSTAINED",
        abstentionReason: "NO_CANDIDATES",
        candidates: [],
      });
    });
  });

  it("keeps a shared alias AMBIGUOUS unless the vocabulary scope discriminates (§29, §183, §187)", async () => {
    await withWorld(async ({ taxonomy }) => {
      const find = taxonomy.classification.candidates.findCandidates;
      const ambiguous = await find({ text: "payments rails" });
      expect(ambiguous.resolution).toBe("AMBIGUOUS");
      expect(ambiguous.abstentionReason).toBe("AMBIGUOUS_CANDIDATES");
      expect(ambiguous.candidates.map((c) => c.vocabularyCode)).toEqual([
        "industry",
        "product_category",
      ]);
      expect(ambiguous.candidates.map((c) => c.confidence)).toEqual([
        "0.9500",
        "0.9500",
      ]);

      const scoped = await find({
        text: "payments",
        vocabularyCodes: ["industry"],
      });
      expect(scoped.resolution).toBe("EXACT");
      expect(
        scoped.candidates.every((c) => c.vocabularyCode === "industry"),
      ).toBe(true);
      expect(
        scoped.candidates.some((c) => c.vocabularyCode === "geography"),
      ).toBe(false);

      await expect(
        find({ text: "payments", vocabularyCodes: ["founder_ethnicity"] }),
      ).rejects.toBeInstanceOf(TaxonomyVocabularyNotFoundError);
    });
  });

  it("lexical search is typo-tolerant, deduplicated, bounded and never semantic (§33-40, §184, §186)", async () => {
    await withWorld(async ({ taxonomy }) => {
      const find = taxonomy.classification.candidates.findCandidates;
      const typo = await find({
        text: "paymnt infrastucture",
        vocabularyCodes: ["product_category"],
        limit: 3,
      });
      expect(typo.resolution).not.toBe("ABSTAINED");
      expect(typo.candidates.slice(0, 3).map((c) => c.nodeId)).toContain(
        node("product_category", "payment_infrastructure"),
      );
      expect(typo.candidates.length).toBeLessThanOrEqual(3);
      for (const candidate of typo.candidates) {
        expect(candidate.matchTypes).toEqual(["LEXICAL"]);
        expect(Number(candidate.confidence)).toBeLessThanOrEqual(0.85);
        expect(candidate.rationaleSummary).not.toContain("paymnt");
      }

      const phrase = await find({
        text: "claims automation APIs for insurers",
        vocabularyCodes: ["product_category"],
      });
      expect(phrase.candidates[0]?.nodeId).toBe(
        node("product_category", "claims_automation"),
      );
      expect(new Set(phrase.candidates.map((c) => c.nodeId)).size).toBe(
        phrase.candidates.length,
      );

      const merged = await find({
        text: "payment infrastructure",
        vocabularyCodes: ["product_category"],
        strategy: "LEXICAL",
      });
      const top = merged.candidates[0];
      expect(top?.nodeId).toBe(
        node("product_category", "payment_infrastructure"),
      );
      expect(top?.matchTypes).toEqual(["DISPLAY_NAME_EXACT", "LEXICAL"]);
      expect(
        merged.candidates.filter((c) => c.nodeId === top?.nodeId),
      ).toHaveLength(1);
    });
  });

  it("abstains on unknown, protected-attribute and injection-shaped input instead of forcing a category (§48-50, §96, §185, §202)", async () => {
    await withWorld(async ({ taxonomy }) => {
      const find = taxonomy.classification.candidates.findCandidates;
      for (const text of [
        "asdkjh qwpoeiru zxmcnv",
        "christian founders only",
        "black-owned and led by women under 30",
        "%_% :* .* '' --",
      ]) {
        const result = await find({ text });
        expect(result.resolution, text).toBe("ABSTAINED");
        expect(result.candidates, text).toEqual([]);
      }
      // Injection-shaped text is data: no SQL error, and only real canonical
      // nodes named by its ordinary words come back.
      for (const text of [
        "'; drop table taxonomy.nodes; --",
        "fintech & (payments | lending) !insurance :* .* \\",
        "payments' or 1=1 --",
      ]) {
        const result = await find({ text });
        for (const candidate of result.candidates) {
          expect(
            await taxonomy.query.findNodeById(
              TaxonomyNodeIdSchema.parse(candidate.nodeId),
            ),
            text,
          ).not.toBeNull();
        }
      }
      expect(
        await count(
          taxonomy.query.listVocabularies().then((v) => [{ count: v.length }]),
        ),
      ).toBe(9);
    });
  });

  it("does not suggest deprecated nodes and reflects vocabulary version changes (§188-189)", async () => {
    await withWorld(async ({ tx, taxonomy }) => {
      const find = taxonomy.classification.candidates.findCandidates;
      const before = await find({ text: "telemedicine" });
      expect(before.candidates[0]?.nodeId).toBe(
        node("product_category", "telehealth"),
      );

      await tx.sql`update taxonomy.nodes set status = 'DEPRECATED', valid_to = clock_timestamp() where id = ${node("product_category", "telehealth")}`;
      const after = await find({ text: "telemedicine" });
      expect(after.candidates.map((c) => c.nodeId)).not.toContain(
        node("product_category", "telehealth"),
      );
      // Historical id resolution still works through the query port.
      expect(
        (
          await taxonomy.query.getNodeById(
            node("product_category", "telehealth"),
          )
        ).status,
      ).toBe("DEPRECATED");

      await tx.sql`update taxonomy.vocabularies set version = 2 where code = 'product_category'`;
      const bumped = await find({
        text: "payments rails",
        vocabularyCodes: ["product_category", "industry"],
      });
      expect(bumped.taxonomyVersions).toEqual({
        industry: 1,
        product_category: 2,
      });
    });
  });

  it("refuses SEMANTIC and MODEL strategies with a typed error (§16)", async () => {
    await withWorld(async ({ taxonomy }) => {
      await expect(
        taxonomy.classification.candidates.findCandidates({
          text: "payments",
          strategy: "SEMANTIC",
        }),
      ).rejects.toBeInstanceOf(TaxonomyClassifierNotAvailableError);
      await expect(
        taxonomy.classification.candidates.findCandidates({
          text: "payments",
          strategy: "MODEL",
        }),
      ).rejects.toBeInstanceOf(TaxonomyClassifierNotAvailableError);
    });
  });

  // -------------------------------------------------------------------------
  // Persistent provenance
  // -------------------------------------------------------------------------

  it("records a deterministic run with honest provenance and ranked candidates (§190, §204)", async () => {
    await withWorld(async ({ tx, taxonomy, founderA, companyA, tenantA }) => {
      const { run, result, candidates } =
        await taxonomy.classification.classifyWithProvenance({
          actor: founderA,
          subject: { subjectType: "COMPANY", subjectId: companyA },
          inputSource: { type: "COMPANY_PROFILE", id: companyA },
          text: RAW_STATEMENT,
          vocabularyCodes: ["product_category", "industry", "geography"],
          correlationId: CORRELATION(),
        });
      expect(run).toMatchObject({
        tenantId: tenantA,
        subjectType: "COMPANY",
        subjectId: companyA,
        inputSourceType: "COMPANY_PROFILE",
        inputSourceId: companyA,
        classifierProvider: "capital_q",
        classifierModel: "deterministic_lexical",
        classifierVersion: "taxonomy-lexical-v1",
        taxonomyVersion: { geography: 1, industry: 1, product_category: 1 },
        status: "COMPLETED",
        costUsd: "0.000000",
      });
      expect(run.completedAt).not.toBeNull();
      expect(run.metadata).toMatchObject({
        strategy: "AUTO",
        resolution: result.resolution,
        candidateCount: candidates.length,
        inputLength: RAW_STATEMENT.length,
      });
      expect(run.metadata.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(run.metadata)).not.toContain(MARKER);
      expect(candidates.map((c) => c.rank)).toEqual(
        candidates.map((_, i) => i + 1),
      );
      expect(candidates.map((c) => c.canonicalCode)).toContain(
        "claims_automation",
      );
      expect(candidates.every((c) => c.accepted === null)).toBe(true);
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.classification_runs where metadata::text like ${`%${MARKER}%`}`,
        ),
      ).toBe(0);
    });
  });

  it("an unknown phrase yields an ABSTAINED run with no candidates, not FAILED (§191)", async () => {
    await withWorld(async ({ taxonomy, founderA, companyA }) => {
      const { run, candidates } =
        await taxonomy.classification.classifyWithProvenance({
          actor: founderA,
          subject: { subjectType: "COMPANY", subjectId: companyA },
          inputSource: null,
          text: "asdkjh qwpoeiru zxmcnv",
          correlationId: CORRELATION(),
        });
      expect(run.status).toBe("ABSTAINED");
      expect(run.metadata.abstentionReason).toMatch(
        /^(NO_CANDIDATES|LOW_CONFIDENCE)$/,
      );
      expect(candidates).toEqual([]);
    });
  });

  it("persistent runs enforce tenant, authority, strategy and input-source rules (§105, §119, §197)", async () => {
    await withWorld(
      async ({ tx, taxonomy, founderA, memberA, companyA, companyB }) => {
        const base = {
          subject: { subjectType: "COMPANY" as const, subjectId: companyA },
          inputSource: null,
          text: "payments rails",
          correlationId: CORRELATION(),
        };
        await expect(
          taxonomy.classification.classifyWithProvenance({
            ...base,
            actor: founderA,
            subject: { subjectType: "COMPANY", subjectId: companyB },
          }),
        ).rejects.toBeInstanceOf(TaxonomySubjectNotFoundError);
        await expect(
          taxonomy.classification.classifyWithProvenance({
            ...base,
            actor: memberA,
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        await expect(
          taxonomy.classification.classifyWithProvenance({
            ...base,
            actor: founderA,
            strategy: "MODEL",
          }),
        ).rejects.toBeInstanceOf(TaxonomyClassifierNotAvailableError);
        await expect(
          taxonomy.classification.classifyWithProvenance({
            ...base,
            actor: founderA,
            inputSource: { type: "COMPANY_PROFILE", id: companyB },
          }),
        ).rejects.toBeInstanceOf(TaxonomyClassificationInputError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from taxonomy.classification_runs`,
          ),
        ).toBe(0);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Human confirmation
  // -------------------------------------------------------------------------

  it("accepting a candidate creates the canonical assignment with provenance, raw language and confirmation (§87-89, §195, §199)", async () => {
    await withWorld(async ({ tx, taxonomy, founderA, companyA, tenantA }) => {
      const aliasesBefore = await count(
        tx.sql`select count(*)::int as count from taxonomy.aliases`,
      );
      const correlationId = CORRELATION();
      const { run, candidates } =
        await taxonomy.classification.classifyWithProvenance({
          actor: founderA,
          subject: { subjectType: "COMPANY", subjectId: companyA },
          inputSource: { type: "COMPANY_PROFILE", id: companyA },
          text: RAW_STATEMENT,
          vocabularyCodes: ["product_category"],
          correlationId,
        });
      const chosen = candidates.find(
        (c) => c.canonicalCode === "claims_automation",
      );
      if (chosen === undefined) {
        throw new Error("expected claims_automation candidate");
      }

      const accepted = await taxonomy.classification.acceptCompanyCandidate({
        actor: founderA,
        runId: run.id,
        nodeId: chosen.nodeId,
        rawSourceText: RAW_STATEMENT,
        correlationId,
      });
      expect(accepted.assignmentCreated).toBe(true);
      expect(accepted.candidate).toMatchObject({
        accepted: true,
        decidedByUserId: founderA.userId,
      });
      expect(accepted.assignment).toMatchObject({
        tenantId: tenantA,
        subjectId: companyA,
        nodeId: chosen.nodeId,
        assignmentSource: "user_selected",
        status: "ACTIVE",
        classificationRunId: run.id,
        confirmedByUserId: founderA.userId,
        rawSourceText: RAW_STATEMENT,
        confidence: null,
      });
      const current = await taxonomy.listCompanyAssignments({
        actor: founderA,
        companyId: companyA,
      });
      expect(current.map((a) => a.nodeId)).toEqual([chosen.nodeId]);

      // The canonical audit/outbox path was used, with the run id as safe provenance.
      const [audit] = await tx.sql<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid and action_type = 'taxonomy.company_assignments.updated'`;
      expect(audit?.metadata).toEqual({
        vocabularyCode: "product_category",
        addedCount: 1,
        removedCount: 0,
        classificationRunId: run.id,
      });
      const events = await tx.sql<{ payload: { data: unknown } }[]>`
        select payload from events.outbox where payload ->> 'correlationId' = ${correlationId} and event_type = 'taxonomy.entity_assignments.changed'`;
      expect(events).toHaveLength(1);
      expect(events[0]?.payload.data).toEqual({
        subjectType: "COMPANY",
        subjectId: companyA,
        changedVocabularyCodes: ["product_category"],
      });

      // A second decision on the same candidate is a conflict, never a toggle.
      await expect(
        taxonomy.classification.acceptCompanyCandidate({
          actor: founderA,
          runId: run.id,
          nodeId: chosen.nodeId,
          correlationId,
        }),
      ).rejects.toBeInstanceOf(TaxonomyClassificationCandidateDecidedError);

      // No alias was created by the user's decision.
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.aliases`,
        ),
      ).toBe(aliasesBefore);

      // The run is provenance and cannot be deleted from under the assignment.
      await expect(
        tx.sql.savepoint(
          (s) =>
            s`delete from taxonomy.classification_runs where id = ${run.id}`,
        ),
      ).rejects.toThrow();
    });
  });

  it("rejecting a candidate records the decision and changes nothing canonical (§91-92, §198)", async () => {
    await withWorld(async ({ tx, taxonomy, founderA, companyA }) => {
      const { run, candidates } =
        await taxonomy.classification.classifyWithProvenance({
          actor: founderA,
          subject: { subjectType: "COMPANY", subjectId: companyA },
          inputSource: null,
          text: "mobile money wallet for merchants",
          vocabularyCodes: ["product_category"],
          correlationId: CORRELATION(),
        });
      const first = candidates[0];
      if (first === undefined) {
        throw new Error("expected a candidate");
      }
      const rejected = await taxonomy.classification.rejectCompanyCandidate({
        actor: founderA,
        runId: run.id,
        nodeId: first.nodeId,
        correlationId: CORRELATION(),
      });
      expect(rejected).toMatchObject({
        accepted: false,
        decidedByUserId: founderA.userId,
      });
      expect(rejected.decidedAt).not.toBeNull();
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.entity_assignments where tenant_id = ${founderA.tenantId}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from audit.material_actions where action_type = 'taxonomy.company_assignments.updated'`,
        ),
      ).toBe(0);
      const { candidates: reread } =
        await taxonomy.classification.getCompanyRun({
          actor: founderA,
          runId: run.id,
        });
      expect(reread.find((c) => c.nodeId === first.nodeId)?.accepted).toBe(
        false,
      );
    });
  });

  it("candidate decisions respect tenant and company.edit boundaries (§118-119, §196-197)", async () => {
    await withWorld(
      async ({ tx, taxonomy, founderA, memberA, adminB, companyA }) => {
        const { run, candidates } =
          await taxonomy.classification.classifyWithProvenance({
            actor: founderA,
            subject: { subjectType: "COMPANY", subjectId: companyA },
            inputSource: null,
            text: "payments rails",
            vocabularyCodes: ["product_category"],
            correlationId: CORRELATION(),
          });
        const target = candidates[0];
        if (target === undefined) {
          throw new Error("expected a candidate");
        }
        const command = {
          runId: run.id,
          nodeId: target.nodeId,
          correlationId: CORRELATION(),
        };
        // Tenant B's admin cannot see, accept or reject a Tenant A run.
        await expect(
          taxonomy.classification.acceptCompanyCandidate({
            ...command,
            actor: adminB,
          }),
        ).rejects.toBeInstanceOf(TaxonomyClassificationRunNotFoundError);
        await expect(
          taxonomy.classification.rejectCompanyCandidate({
            ...command,
            actor: adminB,
          }),
        ).rejects.toBeInstanceOf(TaxonomyClassificationRunNotFoundError);
        await expect(
          taxonomy.classification.getCompanyRun({
            actor: adminB,
            runId: run.id,
          }),
        ).rejects.toBeInstanceOf(TaxonomyClassificationRunNotFoundError);
        // A founder / CEO without company.edit cannot accept.
        await expect(
          taxonomy.classification.acceptCompanyCandidate({
            ...command,
            actor: memberA,
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        const [row] = await tx.sql<{ accepted: boolean | null }[]>`
        select accepted from taxonomy.classification_candidates where classification_run_id = ${run.id} and node_id = ${target.nodeId}`;
        expect(row?.accepted).toBeNull();
        expect(
          await count(
            tx.sql`select count(*)::int as count from taxonomy.entity_assignments`,
          ),
        ).toBe(0);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Privacy
  // -------------------------------------------------------------------------

  it("the raw text never reaches logs, audit, outbox or run metadata (§110, §203-204, §222)", async () => {
    await withWorld(async ({ tx, taxonomy, logs, founderA, companyA }) => {
      await taxonomy.classification.candidates.findCandidates({
        text: `${MARKER} payments rails`,
      });
      const { run } = await taxonomy.classification.classifyWithProvenance({
        actor: founderA,
        subject: { subjectType: "COMPANY", subjectId: companyA },
        inputSource: null,
        text: `${MARKER} insurance claims automation`,
        correlationId: CORRELATION(),
      });
      const joined = logs.join("\n");
      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(joined).not.toContain(MARKER);
      expect(joined).toContain('"inputHash"');
      expect(joined).toContain('"resolution"');
      expect(joined).toContain('"classifierVersion":"taxonomy-lexical-v1"');
      expect(JSON.stringify(run.metadata)).not.toContain(MARKER);
      expect(
        await count(
          tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.classification_runs where metadata::text like ${`%${MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.classification_candidates where rationale_summary like ${`%${MARKER}%`}`,
        ),
      ).toBe(0);
    });
  });
});
