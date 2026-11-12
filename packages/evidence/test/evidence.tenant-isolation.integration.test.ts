import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
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

import { EVIDENCE_EVENTS } from "../src/events/index.js";
import {
  ClaimIdSchema,
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  DocumentIdSchema,
  DocumentVersionIdSchema,
  EvidenceItemIdSchema,
  EvidenceSourceIdSchema,
  type ClaimId,
  type DocumentId,
  type DocumentVersionId,
  type EvidenceItemId,
  type EvidenceService,
  type EvidenceSourceId,
} from "../src/index.js";

/**
 * Application-path tenant isolation for documents and evidence (security
 * lane, 2026-11-12).
 *
 * Production runs every server statement as `postgres`, which bypasses RLS
 * (ADR 0065; docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md), and evidence.* is
 * server-only, so these use cases are the only fence. Against the local
 * database, as `postgres`, through the real service: an admin of another
 * tenant gets the same answer for a real document, version, source, claim
 * or evidence-item id as for one that never existed, on every read and on
 * the writes that name an id, and nothing is written; a revoked member gets
 * no context, and a stale one reads and writes nothing.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SHA = "c".repeat(64);
const PRIVATE_TITLE = "PRIVATE-ISOLATION-DOCUMENT-DO-NOT-EMIT";
const PRIVATE_STATEMENT = "PRIVATE-ISOLATION-CLAIM-DO-NOT-EMIT";

const WRITE_SURFACE = [
  "evidence.documents",
  "evidence.document_versions",
  "evidence.document_processing_runs",
  "evidence.sources",
  "evidence.claims",
  "evidence.claim_revisions",
  "evidence.evidence_items",
  "evidence.claim_evidence",
  "events.outbox",
  "audit.material_actions",
] as const;

class Rollback extends Error {}

type Outcome =
  | { readonly kind: "value"; readonly value: unknown }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly message: string;
    };

async function outcome(attempt: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "value", value: await attempt() };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { kind: "refused", name: error.name, message: error.message };
    }
    throw error;
  }
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

const registry = createEventRegistry([...EVIDENCE_EVENTS]);

type Ids = {
  readonly documentId: DocumentId;
  readonly documentVersion: number;
  readonly documentVersionId: DocumentVersionId;
  readonly sourceId: EvidenceSourceId;
  readonly claimId: ClaimId;
  readonly evidenceItemId: EvidenceItemId;
  readonly companyId: string;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: EvidenceService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext | null>;
  readonly adminA: ActorContext;
  readonly adminB: ActorContext;
  readonly revokedA: {
    readonly principal: AuthenticatedPrincipal;
    readonly membershipId: string;
    readonly staleContext: ActorContext;
  };
  readonly companyA: string;
};

describe("evidence: tenant isolation on the application path (as postgres)", () => {
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
      values (${id}, ${tenantId}, 'company', ${name}, ${`iso-${id.slice(0, 8)}`})`;
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
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`iso-${id.slice(0, 8)}`})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ) {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    const principal: AuthenticatedPrincipal = {
      authUserId: AuthUserIdSchema.parse(authUserId),
    };
    return { principal, membershipId };
  }

  async function rowCounts(tx: TransactionContext) {
    const out: Record<string, number> = {};
    for (const table of WRITE_SURFACE) {
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from ${tx.sql(table)}`;
      out[table] = row?.n ?? -1;
    }
    return out;
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          return resolution.status === "RESOLVED" ? resolution.context : null;
        };
        const mustResolve = async (principal: AuthenticatedPrincipal) => {
          const context = await resolve(principal);
          if (context === null) throw new Error("context not resolved");
          return context;
        };

        const tenantA = await insertTenant(tx, "Isolation Evidence A");
        const tenantB = await insertTenant(tx, "Isolation Evidence B");
        const orgA = await insertOrganisation(tx, tenantA, "Org A");
        const orgB = await insertOrganisation(tx, tenantB, "Org B");
        const companyA = await insertCompany(tx, tenantA, orgA, "Company A");
        await insertCompany(tx, tenantB, orgB, "Company B");
        const adminA = await mustResolve(
          (await insertMember(tx, tenantA, orgA)).principal,
        );
        const adminB = await mustResolve(
          (await insertMember(tx, tenantB, orgB)).principal,
        );
        const revoked = await insertMember(tx, tenantA, orgA);
        const staleContext = await mustResolve(revoked.principal);

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

        await work({
          tx,
          service,
          resolve,
          adminA,
          adminB,
          revokedA: { ...revoked, staleContext },
          companyA,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  /** One document with a version, a source, a claim and an evidence item, all tenant A's. */
  async function seed(world: World): Promise<Ids> {
    const { service, adminA, companyA } = world;
    const subject = { subjectType: "COMPANY", subjectId: companyA } as const;
    const document = await service.createDocument({
      actor: adminA,
      input: {
        title: PRIVATE_TITLE,
        documentType: "FINANCIAL_MODEL",
        companyId: companyA,
      },
      correlationId: CORRELATION(),
    });
    const registered = await service.registerDocumentVersion({
      actor: adminA,
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
    const source = await service.registerEvidenceSource({
      actor: adminA,
      input: {
        sourceType: "PUBLIC_WEB",
        subject,
        sourceUrl: "https://example.com/about",
        reliabilityClass: "SECONDARY_EXTERNAL",
      },
      correlationId: CORRELATION(),
    });
    const claim = await service.createClaim({
      actor: adminA,
      input: {
        subject,
        claimType: "fact",
        claimKey: "hq.city",
        statement: PRIVATE_STATEMENT,
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
        summary: "About page lists the city",
        locator: { kind: "statement" },
        evidenceStatus: "EXTERNALLY_VERIFIED",
      },
      correlationId: CORRELATION(),
    });
    return {
      documentId: registered.document.id,
      documentVersion: registered.document.version,
      documentVersionId: registered.version.id,
      sourceId: source.id,
      claimId: claim.id,
      evidenceItemId: item.id,
      companyId: companyA,
    };
  }

  function missingIds(): Ids {
    return {
      documentId: DocumentIdSchema.parse(randomUUID()),
      documentVersion: 1,
      documentVersionId: DocumentVersionIdSchema.parse(randomUUID()),
      sourceId: EvidenceSourceIdSchema.parse(randomUUID()),
      claimId: ClaimIdSchema.parse(randomUUID()),
      evidenceItemId: EvidenceItemIdSchema.parse(randomUUID()),
      companyId: randomUUID(),
    };
  }

  /** Every use case that names an id, for one actor and one set of ids. */
  function attempts(
    service: EvidenceService,
    actor: ActorContext,
    ids: Ids,
  ): (readonly [string, () => Promise<unknown>])[] {
    return [
      [
        "getDocument",
        () => service.getDocument({ actor, documentId: ids.documentId }),
      ],
      [
        "listDocumentVersions",
        () =>
          service.listDocumentVersions({ actor, documentId: ids.documentId }),
      ],
      [
        "getDocumentVersion",
        () =>
          service.getDocumentVersion({
            actor,
            documentVersionId: ids.documentVersionId,
          }),
      ],
      [
        "registerDocumentVersion",
        () =>
          service.registerDocumentVersion({
            actor,
            input: {
              documentId: ids.documentId,
              expectedDocumentVersion: ids.documentVersion,
              storageBucket: "company-private",
              storageKey: `documents/${ids.documentId}/${randomUUID()}`,
              originalFilename: "hijack.pdf",
              mimeType: "application/pdf",
              sizeBytes: 10,
              sha256: SHA,
            },
            correlationId: CORRELATION(),
          }),
      ],
      [
        "getEvidenceSource",
        () => service.getEvidenceSource({ actor, sourceId: ids.sourceId }),
      ],
      ["getClaim", () => service.getClaim({ actor, claimId: ids.claimId })],
      [
        "listClaims",
        () =>
          service.listClaims({
            actor,
            subject: { subjectType: "COMPANY", subjectId: ids.companyId },
          }),
      ],
      [
        "reviseClaim",
        () =>
          service.reviseClaim({
            actor,
            input: {
              claimId: ids.claimId,
              expectedRevisionNumber: 1,
              statement: "Somewhere else",
              changeReason: "isolation probe",
            },
            correlationId: CORRELATION(),
          }),
      ],
      [
        "getEvidenceItem",
        () =>
          service.getEvidenceItem({
            actor,
            evidenceItemId: ids.evidenceItemId,
          }),
      ],
      [
        "linkClaimEvidence",
        () =>
          service.linkClaimEvidence({
            actor,
            input: {
              claimId: ids.claimId,
              evidenceItemId: ids.evidenceItemId,
              relationship: "SUPPORTS",
            },
            correlationId: CORRELATION(),
          }),
      ],
      [
        "createEvidenceItem",
        () =>
          service.createEvidenceItem({
            actor,
            input: {
              sourceId: ids.sourceId,
              evidenceType: "x",
              summary: "x",
              locator: { kind: "statement" },
              evidenceStatus: "SELF_REPORTED",
            },
            correlationId: CORRELATION(),
          }),
      ],
    ];
  }

  it("another tenant's admin gets the same answer for every real id as for ids that never existed, and writes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminB } = world;
      const real = await seed(world);
      const before = await rowCounts(tx);

      const viaReal = attempts(service, adminB, real);
      const viaMissing = attempts(service, adminB, missingIds());
      for (let i = 0; i < viaReal.length; i += 1) {
        const [name, attempt] = viaReal[i] ?? ["?", () => Promise.resolve()];
        const seen = await outcome(attempt);
        const missing = await outcome(
          viaMissing[i]?.[1] ?? (() => Promise.resolve()),
        );
        expect({ name, seen }).toEqual({ name, seen: missing });
        expect(seen.kind).toBe("refused");
        expect(JSON.stringify(seen)).not.toContain(PRIVATE_TITLE);
        expect(JSON.stringify(seen)).not.toContain(PRIVATE_STATEMENT);
      }

      // Tenant B's own document list never carries tenant A's document.
      const listed = await service.listDocuments({ actor: adminB });
      expect(listed.map((d) => d.id)).not.toContain(real.documentId);

      expect(await rowCounts(tx)).toEqual(before);
    });
  });

  it("a revoked admin gets no actor context, and a stale context reads nothing and writes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, service, resolve, revokedA } = world;
      const real = await seed(world);
      await tx.sql`update identity.organisation_memberships
        set membership_status = 'revoked', left_at = clock_timestamp()
        where id = ${revokedA.membershipId}`;
      const before = await rowCounts(tx);

      expect(await resolve(revokedA.principal)).toBeNull();

      for (const [name, attempt] of attempts(
        service,
        revokedA.staleContext,
        real,
      )) {
        const seen = await outcome(attempt);
        expect({ name, kind: seen.kind }).toEqual({ name, kind: "refused" });
      }
      expect(
        (
          await outcome(() =>
            service.listDocuments({ actor: revokedA.staleContext }),
          )
        ).kind,
      ).toBe("refused");

      // Recorded, not asserted as desired: getDocument and the other
      // lookup-first reads answer a stale former member "forbidden" for a
      // real id of its former organisation and "not found" for a missing
      // one. Only a context the resolver no longer issues can observe it.
      expect(await rowCounts(tx)).toEqual(before);
    });
  });
});
