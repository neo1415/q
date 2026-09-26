import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import type { CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
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

import {
  createPostgresPublicIdentityRepository,
  createPublicIdentityService,
  HandleUnavailableError,
  QCardSubjectNotFoundError,
  QCardVersionConflictError,
  type PublicIdentityService,
  type SubjectFacts,
} from "../src/index.js";

/**
 * Handles and the Q Card against the real local database (BIZ-004). Every
 * test runs in one rolled-back transaction with savepoints for the
 * service's own transactions.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly service: PublicIdentityService;
  readonly adminA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly companyA: string;
  readonly companyB: string;
  /** Mutable facts the fake directory serves, as the companies context would. */
  readonly facts: Map<string, SubjectFacts>;
  readonly clock: { now: Date };
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

describe("@capital-q/public-identity against local PostgreSQL", () => {
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

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantA = await insertTenant(tx, "Handle Tenant A");
        const tenantB = await insertTenant(tx, "Handle Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "org-a");
        const orgB = await insertOrganisation(tx, tenantB, "org-b");
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
        const companyA = randomUUID();
        const companyB = randomUUID();
        await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
          (${companyA}, ${tenantA}, ${orgA}, 'Kivu Freight', 'kivu'),
          (${companyB}, ${tenantB}, ${orgB}, 'Other Co', 'other')`;

        const facts = new Map<string, SubjectFacts>([
          [
            companyA,
            {
              tenantId: tenantA,
              organisationId: orgA,
              name: "Kivu Freight",
              facts: {
                canonicalName: "Kivu Freight",
                shortDescription: "Cross-border freight booking.",
                websiteUrl: "https://kivu.example",
                currentStageCode: "seed",
                headquartersCountry: "KE",
                primaryDescription: "FOUNDER-PRIVATE-MARKER-DO-NOT-EMIT",
              },
              verified: { organisation: false, founderIdentity: false },
            },
          ],
          [
            companyB,
            {
              tenantId: tenantB,
              organisationId: orgB,
              name: "Other Co",
              facts: { canonicalName: "Other Co" },
              verified: { organisation: false, founderIdentity: false },
            },
          ],
        ]);
        const clock = { now: new Date("2026-09-26T10:00:00.000Z") };
        const service = createPublicIdentityService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          audit: createPostgresMaterialActionAuditWriter(),
          repository: createPostgresPublicIdentityRepository(),
          subjects: {
            find: (subject) =>
              Promise.resolve(facts.get(subject.subjectId) ?? null),
          },
          now: () => clock.now,
        });
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          if (resolution.status !== "RESOLVED") throw new Error("no context");
          return resolution.context;
        };
        await work({
          tx,
          service,
          adminA: await resolve(adminA),
          memberA: await resolve(memberA),
          adminB: await resolve(adminB),
          companyA,
          companyB,
          facts,
          clock,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
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
    slug: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${slug}, ${slug})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
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
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  const company = (id: string) => ({
    subjectType: "COMPANY" as const,
    subjectId: id,
  });

  it("an admin claims a handle: the card is made with defaults, and a retry changes nothing", async () => {
    await withWorld(async ({ tx, service, adminA, companyA }) => {
      const card = await service.claimHandle({
        actor: adminA,
        subject: company(companyA),
        handle: "@Kivu-Freight",
        correlationId: CORRELATION(),
      });
      expect(card).toMatchObject({
        handle: "kivu-freight",
        indexable: false,
        version: 1,
        scansLast30Days: 0,
        fieldScopes: {
          canonicalName: "public_external",
          currentStageCode: "network_visible",
        },
      });
      const retry = await service.claimHandle({
        actor: adminA,
        subject: company(companyA),
        handle: "kivu-freight",
        correlationId: CORRELATION(),
      });
      expect(retry.publicCode).toBe(card.publicCode);
      const [count] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from core.handles where subject_id = ${companyA}`;
      expect(count?.n).toBe(1);
      const audits = await tx.sql<{ action_type: string }[]>`
        select action_type from audit.material_actions where resource_id = ${companyA}`;
      expect(audits.map((row) => row.action_type)).toEqual(["handle.claimed"]);
    });
  });

  it("refuses a reserved handle, a malformed one, and one another organisation holds", async () => {
    await withWorld(async ({ service, adminA, adminB, companyA, companyB }) => {
      await expect(
        service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "Support",
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "RESERVED" });
      await expect(
        service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "no--way",
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "SHAPE" });
      await service.claimHandle({
        actor: adminB,
        subject: company(companyB),
        handle: "taken-name",
        correlationId: CORRELATION(),
      });
      await expect(
        service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "TAKEN-NAME",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(HandleUnavailableError);
    });
  });

  it("a rename redirects the old handle and holds it for 90 days, then releases it", async () => {
    await withWorld(
      async ({ service, adminA, adminB, companyA, companyB, clock }) => {
        await service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "kivu",
          correlationId: CORRELATION(),
        });
        await service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "kivu-freight",
          correlationId: CORRELATION(),
        });
        expect(
          await service.resolveHandle({ handle: "kivu", audience: "PUBLIC" }),
        ).toEqual({ kind: "REDIRECT", handle: "kivu-freight" });
        // Within the hold nobody else may take it.
        clock.now = new Date("2026-12-24T10:00:00.000Z");
        expect(await service.handleAvailable("kivu")).toBe(false);
        await expect(
          service.claimHandle({
            actor: adminB,
            subject: company(companyB),
            handle: "kivu",
            correlationId: CORRELATION(),
          }),
        ).rejects.toMatchObject({ reason: "TAKEN" });
        // After 90 days the redirect stops and the handle is free.
        clock.now = new Date("2026-12-26T10:00:00.000Z");
        expect(
          await service.resolveHandle({ handle: "kivu", audience: "PUBLIC" }),
        ).toBeNull();
        const claimed = await service.claimHandle({
          actor: adminB,
          subject: company(companyB),
          handle: "kivu",
          correlationId: CORRELATION(),
        });
        expect(claimed.handle).toBe("kivu");
      },
    );
  });

  it("a subject may take back its own held handle", async () => {
    await withWorld(async ({ service, adminA, companyA }) => {
      for (const handle of ["kivu", "kivu-freight", "kivu"]) {
        await service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle,
          correlationId: CORRELATION(),
        });
      }
      expect(
        await service.resolveHandle({
          handle: "kivu-freight",
          audience: "PUBLIC",
        }),
      ).toEqual({ kind: "REDIRECT", handle: "kivu" });
    });
  });

  it("a verified organisation's old handle is retired and never recycled", async () => {
    await withWorld(
      async ({
        tx,
        service,
        adminA,
        adminB,
        companyA,
        companyB,
        facts,
        clock,
      }) => {
        const verified = facts.get(companyA);
        if (verified === undefined) throw new Error("fixture");
        facts.set(companyA, {
          ...verified,
          verified: { organisation: true, founderIdentity: false },
        });
        await service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "kivu",
          correlationId: CORRELATION(),
        });
        await service.claimHandle({
          actor: adminA,
          subject: company(companyA),
          handle: "kivu-freight",
          correlationId: CORRELATION(),
        });
        const [row] = await tx.sql<{ status: string }[]>`
          select status from core.handles where handle = 'kivu'`;
        expect(row?.status).toBe("RETIRED");
        clock.now = new Date("2030-01-01T00:00:00.000Z");
        expect(await service.handleAvailable("kivu")).toBe(false);
        await expect(
          service.claimHandle({
            actor: adminB,
            subject: company(companyB),
            handle: "kivu",
            correlationId: CORRELATION(),
          }),
        ).rejects.toMatchObject({ reason: "TAKEN" });
        expect(
          await service.resolveHandle({ handle: "kivu", audience: "PUBLIC" }),
        ).toEqual({ kind: "REDIRECT", handle: "kivu-freight" });
      },
    );
  });

  it("only an admin of the owning organisation may claim; another tenant's company is not found", async () => {
    await withWorld(async ({ tx, service, memberA, adminB, companyA }) => {
      await expect(
        service.claimHandle({
          actor: memberA,
          subject: company(companyA),
          handle: "kivu",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      await expect(
        service.claimHandle({
          actor: adminB,
          subject: company(companyA),
          handle: "kivu",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QCardSubjectNotFoundError);
      await expect(
        service.getCard({ actor: adminB, subject: company(companyA) }),
      ).rejects.toBeInstanceOf(QCardSubjectNotFoundError);
      const [count] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from core.handles where subject_id = ${companyA}`;
      expect(count?.n).toBe(0);
    });
  });

  it("the public page shows only public_external fields; a participant also sees network_visible; the marker never appears", async () => {
    await withWorld(async ({ service, adminA, companyA }) => {
      await service.claimHandle({
        actor: adminA,
        subject: company(companyA),
        handle: "kivu",
        correlationId: CORRELATION(),
      });
      const visitor = await service.resolveHandle({
        handle: "KIVU",
        audience: "PUBLIC",
      });
      expect(visitor).toMatchObject({
        kind: "CARD",
        name: "Kivu Freight",
        audience: "PUBLIC",
        indexable: false,
      });
      const publicFields =
        visitor?.kind === "CARD" ? visitor.fields.map((f) => f.key) : [];
      expect(publicFields).toEqual(["shortDescription", "websiteUrl"]);
      const participant = await service.resolveHandle({
        handle: "kivu",
        audience: "PARTICIPANT",
      });
      const participantFields =
        participant?.kind === "CARD"
          ? participant.fields.map((f) => `${f.key}:${f.scope}`)
          : [];
      expect(participantFields).toContain("currentStageCode:network_visible");
      expect(JSON.stringify([visitor, participant])).not.toContain(
        "FOUNDER-PRIVATE-MARKER",
      );
    });
  });

  it("the owner changes scopes and opts in to indexing with the version they read; a stale write conflicts", async () => {
    await withWorld(async ({ service, adminA, memberA, companyA }) => {
      const card = await service.claimHandle({
        actor: adminA,
        subject: company(companyA),
        handle: "kivu",
        correlationId: CORRELATION(),
      });
      const updated = await service.updateCard({
        actor: adminA,
        subject: company(companyA),
        input: {
          expectedVersion: card.version,
          fieldScopes: { currentStageCode: "public_external" },
          indexable: true,
        },
        correlationId: CORRELATION(),
      });
      expect(updated).toMatchObject({
        version: 2,
        indexable: true,
        fieldScopes: {
          canonicalName: "public_external",
          currentStageCode: "public_external",
        },
      });
      // Fields not named are no longer on the card.
      expect(updated.fieldScopes.websiteUrl).toBeUndefined();
      await expect(
        service.updateCard({
          actor: adminA,
          subject: company(companyA),
          input: { expectedVersion: 1, indexable: false },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(QCardVersionConflictError);
      await expect(
        service.updateCard({
          actor: memberA,
          subject: company(companyA),
          input: { expectedVersion: 2, indexable: false },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      // A member may read the card.
      expect(
        (await service.getCard({ actor: memberA, subject: company(companyA) }))
          ?.handle,
      ).toBe("kivu");
    });
  });

  it("a QR code resolves to the current handle and is counted, aggregate only", async () => {
    await withWorld(async ({ tx, service, adminA, companyA }) => {
      const card = await service.claimHandle({
        actor: adminA,
        subject: company(companyA),
        handle: "kivu",
        correlationId: CORRELATION(),
      });
      expect(await service.resolveCode(card.publicCode)).toEqual({
        handle: "kivu",
      });
      await service.resolveCode(card.publicCode);
      expect(await service.resolveCode("zzzzzzzzzz")).toBeNull();
      expect(await service.resolveCode("../../etc")).toBeNull();
      const [row] = await tx.sql<{ scans: number }[]>`
        select scans from core.shareable_identity_scans s
          join core.shareable_identities i on i.id = s.shareable_identity_id
         where i.subject_id = ${companyA}`;
      expect(row?.scans).toBe(2);
      expect(
        (await service.getCard({ actor: adminA, subject: company(companyA) }))
          ?.scansLast30Days,
      ).toBe(2);
    });
  });
});
