import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ContractValidationError,
  createEventRegistry,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
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

import {
  ClaimNotFoundError,
  ClaimRevisionConflictError,
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  createPostgresClaimQueryPort,
  createPostgresDocumentQueryPort,
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
  EvidenceItemNotFoundError,
  EvidenceRuleError,
  EvidenceSourceNotFoundError,
  EvidenceSubjectNotFoundError,
  type EvidenceService,
} from "../src/index.js";
import { EVIDENCE_EVENTS } from "../src/events/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test runs in one rolled-back transaction with a savepoint-backed
 * TransactionManager. Two tenants, each with its own organisation and
 * company; every positive test has a cross-tenant or cross-organisation
 * negative twin.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SHA = "b".repeat(64);
const PRIVATE_CLAIM = "PRIVATE-EVIDENCE-CLAIM-DO-NOT-EMIT";
const PRIVATE_SUMMARY = "PRIVATE-EVIDENCE-SUMMARY-DO-NOT-EMIT";
const PRIVATE_TITLE = "PRIVATE-DOCUMENT-TITLE-DO-NOT-EMIT";

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly service: EvidenceService;
  readonly adminA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly tenantA: string;
  readonly orgA: string;
  readonly companyA: string;
  readonly tenantB: string;
  readonly orgB: string;
  readonly companyB: string;
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

const registry = createEventRegistry([...EVIDENCE_EVENTS]);

/** Runs one raw statement in its own savepoint and surfaces its failure. */
function attempt(
  tx: TransactionContext,
  statement: (s: TransactionContext["sql"]) => Promise<unknown>,
): Promise<unknown> {
  return tx.sql.savepoint(async (s) => {
    await statement(s);
  });
}

describe("@capital-q/evidence against local PostgreSQL", () => {
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

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Evidence Tenant A");
        const tenantB = await insertTenant(tx, "Evidence Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Org A", "ev-org-a");
        const orgB = await insertOrganisation(tx, tenantB, "Org B", "ev-org-b");
        const companyA = await insertCompany(tx, tenantA, orgA, "Company A");
        const companyB = await insertCompany(tx, tenantB, orgB, "Company B");
        const adminA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_admin",
        );
        const memberA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminB = await insertMember(
          tx,
          tenantB,
          orgB,
          "organisation_admin",
        );

        const service = createEvidenceService({
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          subjects: createEvidenceSubjectResolverRegistry([
            createCompanyEvidenceSubjectResolver(
              createPostgresCompanyQueryPort({ sql }),
            ),
          ]),
          outbox: createOutboxWriter({ registry }),
          audit: createPostgresMaterialActionAuditWriter(),
        });

        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return resolution.context;
        };

        await work({
          tx,
          service,
          adminA: await resolve(adminA),
          memberA: await resolve(memberA),
          adminB: await resolve(adminB),
          tenantA,
          orgA,
          companyA,
          tenantB,
          orgB,
          companyB,
        });
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

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    name: string,
    slug: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${slug})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`ev-${id.slice(0, 8)}`})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<AuthenticatedPrincipal> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  const subject = (companyId: string) =>
    ({ subjectType: "COMPANY", subjectId: companyId }) as const;

  async function seedDocument(
    world: World,
    actor: ActorContext,
    title = "FY2026 Financial Model",
  ) {
    const document = await world.service.createDocument({
      actor,
      input: {
        title,
        documentType: "FINANCIAL_MODEL",
        companyId: world.companyA,
      },
      correlationId: CORRELATION(),
    });
    const registered = await world.service.registerDocumentVersion({
      actor,
      input: {
        documentId: document.id,
        expectedDocumentVersion: document.version,
        storageBucket: "company-private",
        storageKey: `documents/${document.id}/${randomUUID()}`,
        originalFilename: "model.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 2048,
        sha256: SHA,
      },
      correlationId: CORRELATION(),
    });
    return registered;
  }

  // -------------------------------------------------------------------------
  // Full lifecycle
  // -------------------------------------------------------------------------

  it("source → document → versions → claim → evidence → links, with events and audit carrying ids only", async () => {
    await withWorld(async (world) => {
      const { service, adminA, tx } = world;

      // Document + version 1.
      const first = await seedDocument(world, adminA, PRIVATE_TITLE);
      expect(first.document.visibilityScope).toBe("organisation_private");
      expect(first.document.sensitivityClass).toBe("HIGHLY_CONFIDENTIAL");
      expect(first.document.currentVersionId).toBe(first.version.id);
      expect(first.version.versionNumber).toBe(1);
      expect(first.version.processingStatus).toBe("NOT_STARTED");
      expect(first.version.malwareScanStatus).toBe("PENDING");
      expect(first.duplicateOf).toEqual([]);

      // Version 2 supersedes 1 and moves the pointer; version 1 remains.
      const second = await service.registerDocumentVersion({
        actor: adminA,
        input: {
          documentId: first.document.id,
          expectedDocumentVersion: first.document.version,
          storageBucket: "company-private",
          storageKey: `documents/${first.document.id}/${randomUUID()}`,
          originalFilename: "model-v2.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 4096,
          sha256: "c".repeat(64),
        },
        correlationId: CORRELATION(),
      });
      expect(second.version.versionNumber).toBe(2);
      expect(second.version.supersedesVersionId).toBe(first.version.id);
      expect(second.document.currentVersionId).toBe(second.version.id);
      expect(second.document.version).toBe(first.document.version + 1);
      const versions = await service.listDocumentVersions({
        actor: adminA,
        documentId: first.document.id,
      });
      expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);

      // A stale registration is refused.
      await expect(
        service.registerDocumentVersion({
          actor: adminA,
          input: {
            documentId: first.document.id,
            expectedDocumentVersion: first.document.version,
            storageBucket: "company-private",
            storageKey: `documents/${first.document.id}/${randomUUID()}`,
            originalFilename: "stale.xlsx",
            mimeType: "text/csv",
            sizeBytes: 1,
            sha256: "d".repeat(64),
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ name: "DocumentVersionConflictError" });

      // Source for the document.
      const source = await service.registerEvidenceSource({
        actor: adminA,
        input: {
          sourceType: "DOCUMENT",
          subject: subject(world.companyA),
          title: PRIVATE_TITLE,
          metadata: { documentVersionId: second.version.id, pages: 12 },
        },
        correlationId: CORRELATION(),
      });
      expect(source.visibilityScope).toBe("organisation_private");
      expect(source.reliabilityClass).toBeNull();

      // A user claim, self-reported, current.
      const claim = await service.createClaim({
        actor: adminA,
        input: {
          subject: subject(world.companyA),
          claimType: "metric",
          claimKey: "revenue.arr",
          statement: `${PRIVATE_CLAIM} ARR is USD 2,000,000`,
          structuredValue: { amount: "2000000", currency: "USD" },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          sourceId: source.id,
        },
        correlationId: CORRELATION(),
      });
      expect(claim.currentRevisionNumber).toBe(1);
      expect(claim.lifecycleStatus).toBe("CURRENT");
      expect(claim.assertedByType).toBe("USER");

      // Evidence found in the document, and a contradicting item.
      const supports = await service.createEvidenceItem({
        actor: adminA,
        input: {
          sourceId: source.id,
          evidenceType: "financial.revenue",
          summary: `${PRIVATE_SUMMARY} ARR line shows 2.0M`,
          locator: {
            kind: "document",
            documentVersionId: second.version.id,
            page: 4,
          },
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        correlationId: CORRELATION(),
      });
      expect(supports.sensitivityClass).toBe("CONFIDENTIAL");
      expect(supports.visibilityScope).toBe("organisation_private");
      const contradicts = await service.createEvidenceItem({
        actor: adminA,
        input: {
          sourceId: source.id,
          evidenceType: "financial.revenue",
          summary: "Management accounts show 1.4M",
          locator: {
            kind: "document",
            documentVersionId: second.version.id,
            page: 9,
          },
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        correlationId: CORRELATION(),
      });
      await service.linkClaimEvidence({
        actor: adminA,
        input: {
          claimId: claim.id,
          evidenceItemId: supports.id,
          relationship: "SUPPORTS",
        },
        correlationId: CORRELATION(),
      });
      const again = await service.linkClaimEvidence({
        actor: adminA,
        input: {
          claimId: claim.id,
          evidenceItemId: supports.id,
          relationship: "SUPPORTS",
        },
        correlationId: CORRELATION(),
      });
      expect(again.relationship).toBe("SUPPORTS");
      await service.linkClaimEvidence({
        actor: adminA,
        input: {
          claimId: claim.id,
          evidenceItemId: contradicts.id,
          relationship: "CONTRADICTS",
        },
        correlationId: CORRELATION(),
      });

      // Both links remain; the claim's axes are untouched by linking.
      const detail = await service.getClaim({
        actor: adminA,
        claimId: claim.id,
      });
      expect(detail.evidence.map((l) => l.relationship).sort()).toEqual([
        "CONTRADICTS",
        "SUPPORTS",
      ]);
      expect(detail.claim.truthClass).toBe("USER_CLAIM");
      expect(detail.claim.lifecycleStatus).toBe("CURRENT");
      expect(detail.revisions).toHaveLength(1);

      // Nothing in core changed.
      const [company] = await tx.sql<{ canonical_name: string }[]>`
        select canonical_name from core.companies where id = ${world.companyA}`;
      expect(company?.canonical_name).toBe("Company A");

      // Privacy: no statement, summary or title in events or audit.
      const events =
        await tx.sql`select * from events.outbox where tenant_id = ${world.tenantA}`;
      const audit =
        await tx.sql`select * from audit.material_actions where tenant_id = ${world.tenantA}`;
      expect(events.length).toBeGreaterThanOrEqual(6);
      expect(audit.length).toBeGreaterThanOrEqual(5);
      for (const marker of [
        PRIVATE_CLAIM,
        PRIVATE_SUMMARY,
        PRIVATE_TITLE,
        SHA,
        "documents/",
      ]) {
        expect(JSON.stringify(events)).not.toContain(marker);
        expect(JSON.stringify(audit)).not.toContain(marker);
      }
      const names = events.map((e) =>
        String(e["event_type"] ?? e["type"] ?? ""),
      );
      expect(names.some((n) => n.includes("evidence.claim.changed"))).toBe(
        true,
      );

      // Query ports answer canonical facts without storage keys.
      const doc = await createPostgresDocumentQueryPort({
        sql: tx.sql,
      }).findCanonicalDocument(adminA.tenantId, first.document.id);
      expect(doc).toMatchObject({
        ownerOrganisationId: world.orgA,
        currentVersionId: second.version.id,
      });
      expect(JSON.stringify(doc)).not.toContain("documents/");
      const current = await createPostgresClaimQueryPort({
        sql: tx.sql,
      }).listCurrentClaims(adminA.tenantId, subject(world.companyA), {
        claimKey: "revenue.arr",
      });
      expect(current.map((c) => c.id)).toEqual([claim.id]);
    });
  });

  // -------------------------------------------------------------------------
  // Claim truth axes and revisions
  // -------------------------------------------------------------------------

  it("claims carry the three ADR-001 axes independently; a VERIFIED claim needs verifying evidence and only Q may infer", async () => {
    await withWorld(async (world) => {
      const { service, adminA } = world;
      const make = (input: Record<string, unknown>) =>
        service.createClaim({
          actor: adminA,
          input: {
            subject: subject(world.companyA),
            claimType: "fact",
            claimKey: `k.x${randomUUID().replace(/-/g, "").slice(0, 8)}`,
            statement: "x",
            ...input,
          } as never,
          correlationId: CORRELATION(),
        });
      const cases: ReadonlyArray<readonly [string, string, string]> = [
        ["USER_CLAIM", "SELF_REPORTED", "CURRENT"],
        ["VERIFIED", "PLATFORM_VERIFIED", "CURRENT"],
        ["ESTIMATE", "NO_EVIDENCE", "CURRENT"],
        ["UNKNOWN", "NO_EVIDENCE", "CURRENT"],
        ["USER_CLAIM", "DOCUMENT_SUPPORTED", "HISTORICAL"],
        ["USER_CLAIM", "DOCUMENT_SUPPORTED", "SUPERSEDED"],
        ["USER_CLAIM", "MULTI_SOURCE_SUPPORTED", "DISPUTED"],
        ["USER_CLAIM", "DOCUMENT_SUPPORTED", "CONTRADICTORY"],
        ["ESTIMATE", "NO_EVIDENCE", "STALE"],
      ];
      for (const [truthClass, evidenceStatus, lifecycleStatus] of cases) {
        const claim = await make({
          truthClass,
          evidenceStatus,
          lifecycleStatus,
        });
        expect([
          claim.truthClass,
          claim.evidenceStatus,
          claim.lifecycleStatus,
        ]).toEqual([truthClass, evidenceStatus, lifecycleStatus]);
      }
      await expect(
        make({ truthClass: "VERIFIED", evidenceStatus: "SELF_REPORTED" }),
      ).rejects.toBeInstanceOf(EvidenceRuleError);
      await expect(
        make({ truthClass: "Q_INFERENCE", evidenceStatus: "NO_EVIDENCE" }),
      ).rejects.toBeInstanceOf(EvidenceRuleError);
      // The schema itself accepts Q_INFERENCE for a Q actor; no producer exists.
      const qActor: ActorContext = { ...adminA, actorType: "Q" };
      const inferred = await service.createClaim({
        actor: qActor,
        input: {
          subject: subject(world.companyA),
          claimType: "inference",
          claimKey: "runway.months",
          statement: "roughly nine months",
          truthClass: "Q_INFERENCE",
          evidenceStatus: "NO_EVIDENCE",
        },
        correlationId: CORRELATION(),
      });
      expect(inferred.truthClass).toBe("Q_INFERENCE");
      expect(inferred.assertedByType).toBe("USER");
    });
  });

  it("revising appends revision 2, keeps revision 1 immutable, moves the pointer and refuses stale or direct overwrites", async () => {
    await withWorld(async (world) => {
      const { service, adminA, tx } = world;
      const claim = await service.createClaim({
        actor: adminA,
        input: {
          subject: subject(world.companyA),
          claimType: "metric",
          claimKey: "team.headcount",
          statement: "12 people",
          structuredValue: { count: 12 },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        correlationId: CORRELATION(),
      });
      const revised = await service.reviseClaim({
        actor: adminA,
        input: {
          claimId: claim.id,
          expectedRevisionNumber: 1,
          statement: "14 people",
          structuredValue: { count: 14 },
          evidenceStatus: "DOCUMENT_SUPPORTED",
          changeReason: "Corrected after the payroll export",
        },
        correlationId: CORRELATION(),
      });
      expect(revised.id).toBe(claim.id);
      expect(revised.currentRevisionNumber).toBe(2);
      expect(revised.currentRevisionId).not.toBe(claim.currentRevisionId);
      expect(revised.statement).toBe("14 people");
      expect(revised.truthClass).toBe("USER_CLAIM");
      const { revisions } = await service.getClaim({
        actor: adminA,
        claimId: claim.id,
      });
      expect(
        revisions.map((r) => [r.revisionNumber, r.statement, r.evidenceStatus]),
      ).toEqual([
        [1, "12 people", "SELF_REPORTED"],
        [2, "14 people", "DOCUMENT_SUPPORTED"],
      ]);
      expect(revisions[1]?.changeReason).toBe(
        "Corrected after the payroll export",
      );

      // A stale revision number is refused.
      await expect(
        service.reviseClaim({
          actor: adminA,
          input: {
            claimId: claim.id,
            expectedRevisionNumber: 1,
            lifecycleStatus: "STALE",
            changeReason: "late",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ClaimRevisionConflictError);

      // Lifecycle changes go through a revision too.
      const disputed = await service.reviseClaim({
        actor: adminA,
        input: {
          claimId: claim.id,
          expectedRevisionNumber: 2,
          lifecycleStatus: "DISPUTED",
          changeReason: "Board pack disagrees",
        },
        correlationId: CORRELATION(),
      });
      expect(disputed.lifecycleStatus).toBe("DISPUTED");
      expect(disputed.currentRevisionNumber).toBe(3);

      // Direct rewrites are refused by the database itself.
      await expect(
        attempt(
          tx,
          (s) =>
            s`update evidence.claims set statement = 'rewritten' where id = ${claim.id}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        attempt(
          tx,
          (s) =>
            s`update evidence.claim_revisions set statement = 'rewritten' where claim_id = ${claim.id} and revision_number = 1`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        attempt(
          tx,
          (s) =>
            s`delete from evidence.claim_revisions where claim_id = ${claim.id}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  // -------------------------------------------------------------------------
  // Immutability and processing provenance
  // -------------------------------------------------------------------------

  it("document version file identity is immutable, processing state evolves, and a pipeline registers once per version", async () => {
    await withWorld(async (world) => {
      const { service, adminA, tx } = world;
      const { version } = await seedDocument(world, adminA);
      const attempts: ReadonlyArray<
        (s: TransactionContext["sql"]) => Promise<unknown>
      > = [
        (s) =>
          s`update evidence.document_versions set storage_key = 'documents/other' where id = ${version.id}`,
        (s) =>
          s`update evidence.document_versions set sha256 = ${"e".repeat(64)} where id = ${version.id}`,
        (s) =>
          s`update evidence.document_versions set original_filename = 'renamed.xlsx' where id = ${version.id}`,
        (s) =>
          s`update evidence.document_versions set size_bytes = 1 where id = ${version.id}`,
        (s) =>
          s`update evidence.document_versions set uploaded_at = now() + interval '1 day' where id = ${version.id}`,
      ];
      for (const statement of attempts) {
        await expect(attempt(tx, statement)).rejects.toMatchObject({
          code: "23514",
        });
      }
      await expect(
        attempt(
          tx,
          (s) =>
            s`delete from evidence.document_versions where id = ${version.id}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const scanned = await service.advanceVersionProcessingState({
        tenantId: adminA.tenantId,
        documentVersionId: version.id,
        malwareScanStatus: "CLEAN",
        processingStatus: "QUEUED",
      });
      expect(scanned.malwareScanStatus).toBe("CLEAN");
      expect(scanned.processingStatus).toBe("QUEUED");
      expect(scanned.sha256).toBe(version.sha256);

      const first = await service.registerProcessingRun({
        tenantId: adminA.tenantId,
        documentVersionId: version.id,
        pipelineVersion: "evidence-v1",
      });
      const second = await service.registerProcessingRun({
        tenantId: adminA.tenantId,
        documentVersionId: version.id,
        pipelineVersion: "evidence-v1",
      });
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.run.id).toBe(first.run.id);
      expect(first.run.status).toBe("QUEUED");
      const [count] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from evidence.document_processing_runs where document_version_id = ${version.id}`;
      expect(count?.n).toBe(1);

      const running = await service.transitionProcessingRun({
        tenantId: adminA.tenantId,
        runId: first.run.id,
        status: "RUNNING",
      });
      expect(running.startedAt).not.toBeNull();
      await expect(
        service.transitionProcessingRun({
          tenantId: adminA.tenantId,
          runId: first.run.id,
          status: "QUEUED",
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      const failed = await service.transitionProcessingRun({
        tenantId: adminA.tenantId,
        runId: first.run.id,
        status: "FAILED",
        errorCode: "EXTRACTOR_TIMEOUT",
      });
      expect(failed.errorCode).toBe("EXTRACTOR_TIMEOUT");
      expect(failed.completedAt).not.toBeNull();

      // Another tenant cannot touch the run or the version by guessed id.
      await expect(
        service.transitionProcessingRun({
          tenantId: world.adminB.tenantId,
          runId: first.run.id,
          status: "QUEUED",
        }),
      ).rejects.toBeInstanceOf(DocumentVersionNotFoundError);
      await expect(
        service.advanceVersionProcessingState({
          tenantId: world.adminB.tenantId,
          documentVersionId: version.id,
          malwareScanStatus: "BLOCKED",
        }),
      ).rejects.toBeInstanceOf(DocumentVersionNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication ≠ authorization; ownership
  // -------------------------------------------------------------------------

  it("identical bytes in two tenants are two documents with separate ownership, and a hash never reaches across", async () => {
    await withWorld(async (world) => {
      const { service, adminA, adminB, tx } = world;
      const a = await seedDocument(world, adminA);
      const docB = await service.createDocument({
        actor: adminB,
        input: {
          title: "Their model",
          documentType: "FINANCIAL_MODEL",
          companyId: world.companyB,
        },
        correlationId: CORRELATION(),
      });
      const b = await service.registerDocumentVersion({
        actor: adminB,
        input: {
          documentId: docB.id,
          expectedDocumentVersion: docB.version,
          storageBucket: "company-private",
          storageKey: `documents/${docB.id}/${randomUUID()}`,
          originalFilename: "model.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 2048,
          sha256: SHA,
        },
        correlationId: CORRELATION(),
      });
      expect(b.version.sha256).toBe(a.version.sha256);
      expect(b.duplicateOf).toEqual([]);
      expect(b.document.ownerOrganisationId).toBe(world.orgB);
      expect(a.document.ownerOrganisationId).toBe(world.orgA);
      const [rows] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from evidence.document_versions where sha256 = ${SHA}`;
      expect(rows?.n).toBe(2);

      // A's document is not reachable from B by id, in any form.
      await expect(
        service.getDocument({ actor: adminB, documentId: a.document.id }),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
      await expect(
        service.getDocumentVersion({
          actor: adminB,
          documentVersionId: a.version.id,
        }),
      ).rejects.toBeInstanceOf(DocumentVersionNotFoundError);
      await expect(
        service.registerDocumentVersion({
          actor: adminB,
          input: {
            documentId: a.document.id,
            expectedDocumentVersion: a.document.version,
            storageBucket: "company-private",
            storageKey: `documents/${a.document.id}/${randomUUID()}`,
            originalFilename: "hijack.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: SHA,
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
      // A second upload of the same bytes inside A is reported, not merged.
      const again = await service.registerDocumentVersion({
        actor: adminA,
        input: {
          documentId: a.document.id,
          expectedDocumentVersion: a.document.version,
          storageBucket: "company-private",
          storageKey: `documents/${a.document.id}/${randomUUID()}`,
          originalFilename: "model.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 2048,
          sha256: SHA,
        },
        correlationId: CORRELATION(),
      });
      expect(again.duplicateOf).toEqual([a.version.id]);
      expect(again.version.id).not.toBe(a.version.id);
    });
  });

  it("ownership is the actor's organisation: naming another organisation's company or a foreign subject is not found", async () => {
    await withWorld(async (world) => {
      const { service, adminA, memberA } = world;
      await expect(
        service.createDocument({
          actor: adminA,
          input: { title: "Not mine", companyId: world.companyB },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
      await expect(
        service.registerEvidenceSource({
          actor: adminA,
          input: {
            sourceType: "USER_STATEMENT",
            subject: subject(world.companyB),
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(EvidenceSubjectNotFoundError);
      await expect(
        service.createClaim({
          actor: adminA,
          input: {
            subject: subject(world.companyB),
            claimType: "fact",
            claimKey: "x",
            statement: "x",
            truthClass: "UNKNOWN",
            evidenceStatus: "NO_EVIDENCE",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(EvidenceSubjectNotFoundError);
      // A member may create and view documents but may not register versions.
      const doc = await service.createDocument({
        actor: memberA,
        input: { title: "Member deck", documentType: "PITCH_DECK" },
        correlationId: CORRELATION(),
      });
      expect(doc.sensitivityClass).toBe("CONFIDENTIAL");
      await expect(
        service.registerDocumentVersion({
          actor: memberA,
          input: {
            documentId: doc.id,
            expectedDocumentVersion: doc.version,
            storageBucket: "company-private",
            storageKey: `documents/${doc.id}/${randomUUID()}`,
            originalFilename: "deck.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: SHA,
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ name: "AuthorizationDeniedError" });
      // Sensitivity may be strengthened, never weakened; format allowlist holds.
      await expect(
        service.createDocument({
          actor: adminA,
          input: {
            title: "Weak",
            documentType: "FINANCIAL_MODEL",
            sensitivityClass: "INTERNAL",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(EvidenceRuleError);
      const stronger = await service.createDocument({
        actor: adminA,
        input: {
          title: "Cap table",
          documentType: "CORPORATE",
          sensitivityClass: "RESTRICTED",
        },
        correlationId: CORRELATION(),
      });
      expect(stronger.sensitivityClass).toBe("RESTRICTED");
      await expect(
        service.registerDocumentVersion({
          actor: adminA,
          input: {
            documentId: stronger.id,
            expectedDocumentVersion: stronger.version,
            storageBucket: "company-private",
            storageKey: `documents/${stronger.id}/${randomUUID()}`,
            originalFilename: "run.exe",
            mimeType: "application/x-msdownload",
            sizeBytes: 10,
            sha256: SHA,
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(EvidenceRuleError);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant negatives for every entity
  // -------------------------------------------------------------------------

  it("tenant B cannot read, revise or link tenant A's source, claim, evidence item or document by guessed id", async () => {
    await withWorld(async (world) => {
      const { service, adminA, adminB } = world;
      const source = await service.registerEvidenceSource({
        actor: adminA,
        input: {
          sourceType: "PUBLIC_WEB",
          subject: subject(world.companyA),
          sourceUrl: "https://example.com/about",
          reliabilityClass: "SECONDARY_EXTERNAL",
        },
        correlationId: CORRELATION(),
      });
      const claim = await service.createClaim({
        actor: adminA,
        input: {
          subject: subject(world.companyA),
          claimType: "fact",
          claimKey: "hq.city",
          statement: "Lagos",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        correlationId: CORRELATION(),
      });
      const item = await service.createEvidenceItem({
        actor: adminA,
        input: {
          sourceId: source.id,
          evidenceType: "profile.location",
          summary: "About page lists Lagos",
          locator: { kind: "statement" },
          evidenceStatus: "EXTERNALLY_VERIFIED",
        },
        correlationId: CORRELATION(),
      });
      expect(item.reliabilityClass).toBe("SECONDARY_EXTERNAL");

      await expect(
        service.getEvidenceSource({ actor: adminB, sourceId: source.id }),
      ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);
      await expect(
        service.getClaim({ actor: adminB, claimId: claim.id }),
      ).rejects.toBeInstanceOf(ClaimNotFoundError);
      await expect(
        service.reviseClaim({
          actor: adminB,
          input: {
            claimId: claim.id,
            expectedRevisionNumber: 1,
            statement: "Abuja",
            changeReason: "x",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ClaimNotFoundError);
      await expect(
        service.getEvidenceItem({ actor: adminB, evidenceItemId: item.id }),
      ).rejects.toBeInstanceOf(EvidenceItemNotFoundError);
      await expect(
        service.linkClaimEvidence({
          actor: adminB,
          input: {
            claimId: claim.id,
            evidenceItemId: item.id,
            relationship: "SUPPORTS",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ClaimNotFoundError);
      await expect(
        service.createEvidenceItem({
          actor: adminB,
          input: {
            sourceId: source.id,
            evidenceType: "x",
            summary: "x",
            locator: { kind: "statement" },
            evidenceStatus: "SELF_REPORTED",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);
      await expect(
        service.listClaims({ actor: adminB, subject: subject(world.companyA) }),
      ).rejects.toBeInstanceOf(EvidenceSubjectNotFoundError);
      expect(
        (
          await service.listClaims({
            actor: adminA,
            subject: subject(world.companyA),
          })
        ).map((c) => c.id),
      ).toEqual([claim.id]);

      // Evidence never widens beyond its source; a bogus document locator is refused.
      await expect(
        service.createEvidenceItem({
          actor: adminA,
          input: {
            sourceId: source.id,
            evidenceType: "x",
            summary: "x",
            locator: { kind: "statement" },
            evidenceStatus: "SELF_REPORTED",
            visibilityScope: "network_visible",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        service.createEvidenceItem({
          actor: adminA,
          input: {
            sourceId: source.id,
            evidenceType: "x",
            summary: "x",
            locator: {
              kind: "document",
              documentVersionId: randomUUID(),
              page: 1,
            },
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentVersionNotFoundError);
    });
  });

  it("the database refuses cross-tenant links, foreign supersedes pointers and legacy vocabulary outright", async () => {
    await withWorld(async (world) => {
      const { tx, adminA, adminB, service } = world;
      const a = await seedDocument(world, adminA);
      const docB = await service.createDocument({
        actor: adminB,
        input: { title: "B", companyId: world.companyB },
        correlationId: CORRELATION(),
      });
      // A version in B's document cannot supersede a version in A's document.
      await expect(
        attempt(
          tx,
          (s) => s`insert into evidence.document_versions
            (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename,
             mime_type, size_bytes, sha256, uploaded_by_user_id, supersedes_version_id)
            values (${world.tenantB}, ${docB.id}, 1, 'company-private', 'x/y', 'f.pdf', 'application/pdf', 1,
                    ${SHA}, ${adminB.userId}, ${a.version.id})`,
        ),
      ).rejects.toMatchObject({ code: "23503" });
      // A claim in tenant B cannot link evidence held by tenant A.
      const source = await service.registerEvidenceSource({
        actor: adminA,
        input: {
          sourceType: "USER_STATEMENT",
          subject: subject(world.companyA),
        },
        correlationId: CORRELATION(),
      });
      const item = await service.createEvidenceItem({
        actor: adminA,
        input: {
          sourceId: source.id,
          evidenceType: "x",
          summary: "x",
          locator: { kind: "statement" },
          evidenceStatus: "SELF_REPORTED",
        },
        correlationId: CORRELATION(),
      });
      const claimB = await service.createClaim({
        actor: adminB,
        input: {
          subject: subject(world.companyB),
          claimType: "fact",
          claimKey: "x",
          statement: "x",
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
        },
        correlationId: CORRELATION(),
      });
      await expect(
        attempt(
          tx,
          (
            s,
          ) => s`insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship)
                   values (${world.tenantB}, ${claimB.id}, ${item.id}, 'SUPPORTS')`,
        ),
      ).rejects.toMatchObject({ code: "23503" });
      // Doc 13's superseded vocabulary is not a column and not a value.
      const [cols] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.columns
         where table_schema = 'evidence' and column_name in ('verification_state', 'truth_state')`;
      expect(cols?.n).toBe(0);
      await expect(
        attempt(
          tx,
          (s) =>
            s`update evidence.claims set truth_class = 'document_supported' where id = ${claimB.id}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
