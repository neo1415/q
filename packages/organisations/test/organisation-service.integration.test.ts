import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  type CorrelationId,
  type CreateOrganisationRequest,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
import {
  ActorContextDeniedError,
  AuthorizationDeniedError,
  AuthUserIdSchema,
  capability,
  createAuthorizationService,
  OrganisationIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
  type AuthorizationService,
} from "@capital-q/security";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import {
  createOrganisationService,
  OrganisationCreationConflictError,
  OrganisationNotFoundError,
  OrganisationVersionConflictError,
  type OrganisationService,
} from "../src/index.js";
import { ORGANISATION_EVENTS } from "../src/events/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 *
 * Every test runs inside one rolled-back transaction. The service is given
 * that transaction's executor and a savepoint-backed TransactionManager, so
 * its own `transactions.run` calls nest inside the test transaction: a use
 * case that fails rolls back its savepoint, and the assertions that follow
 * observe exactly what production would have committed -- or not.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const ORGANISATION_VIEW = capability("organisation.view");
const ORGANISATION_ADMIN = capability("organisation.admin");

class Rollback extends Error {}

type Person = {
  readonly principal: AuthenticatedPrincipal;
  readonly userId: string;
};

type Harness = {
  readonly tx: TransactionContext;
  readonly service: OrganisationService;
  readonly authorization: AuthorizationService;
  readonly resolveContext: (person: Person) => Promise<ActorContext>;
  readonly outboxCalls: { count: number };
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

const registry = createEventRegistry([...ORGANISATION_EVENTS]);

describe("@capital-q/organisations against local PostgreSQL", () => {
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

  async function withHarness(
    work: (harness: Harness, people: { a: Person; b: Person }) => Promise<void>,
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
    } = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await createPerson(tx);
        const b = await createPerson(tx);
        const transactions = nestedTransactions(tx);
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql: tx.sql }),
        );
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const realOutbox = createOutboxWriter({ registry });
        const outboxCalls = { count: 0 };
        const countingOutbox: OutboxWriter = {
          enqueue: (...args) => {
            outboxCalls.count += 1;
            return realOutbox.enqueue(...args);
          },
        };
        const service = createOrganisationService({
          sql: tx.sql,
          transactions,
          authorization,
          resolver,
          activeContexts: createPostgresActiveOrganisationContextStore({
            transactions,
          }),
          outbox:
            options.outbox === undefined
              ? countingOutbox
              : options.outbox(countingOutbox),
          audit: createPostgresMaterialActionAuditWriter(),
          securityEvents: createPostgresSecurityEventWriter({ sql: tx.sql }),
        });
        const resolveContext = async (person: Person) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal: person.principal,
          });
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return resolution.context;
        };
        await work(
          { tx, service, authorization, resolveContext, outboxCalls },
          { a, b },
        );
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

  async function createPerson(tx: TransactionContext): Promise<Person> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      userId: profile.id,
    };
  }

  function createRequest(
    displayName: string,
    overrides: Partial<CreateOrganisationRequest> = {},
  ): CreateOrganisationRequest {
    return { displayName, organisationType: "company", ...overrides };
  }

  /**
   * Add `person` to an existing organisation with a role template. joined_at
   * uses the wall clock: inside one test transaction now() is frozen, and the
   * list order (joined_at, id) must be deterministic for the assertions.
   */
  async function addMember(
    tx: TransactionContext,
    person: Person,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<string> {
    const [row] = await tx.sql<{ id: string }[]>`
      insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, joined_at)
      select o.tenant_id, o.id, ${person.userId}, clock_timestamp()
        from identity.organisations o where o.id = ${organisationId}
      returning id`;
    if (row === undefined) {
      throw new Error("membership not created");
    }
    await tx.sql`
      insert into identity.membership_roles (membership_id, role_id)
      select ${row.id}, r.id from permissions.roles r where r.code = ${roleCode}`;
    return row.id;
  }

  async function revoke(tx: TransactionContext, membershipId: string) {
    await tx.sql`
      update identity.organisation_memberships
         set membership_status = 'revoked', left_at = clock_timestamp()
       where id = ${membershipId}`;
  }

  function decide(
    authorization: AuthorizationService,
    actor: ActorContext,
    cap: ReturnType<typeof capability>,
  ) {
    if (actor.organisationId === undefined) {
      throw new Error("actor has no organisation");
    }
    return authorization.authorize({
      actor,
      capability: cap,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  it("creates tenant, organisation, link, membership, admin role, context, audit and events atomically", async () => {
    await withHarness(
      async (
        { tx, service, authorization, resolveContext, outboxCalls },
        { a },
      ) => {
        const correlationId = CORRELATION();
        const view = await service.createOrganisation({
          principal: a.principal,
          input: createRequest("Acme Ventures", {
            countryCode: "GB",
            websiteUrl: "https://acme.example",
          }),
          idempotencyKey: "key-create-0001",
          correlationId,
        });

        const organisation = view.organisation;
        expect(organisation.tenantId).not.toBe(organisation.id);
        expect(organisation.slug).toBe("acme-ventures");
        expect(organisation.status).toBe("active");
        expect(organisation.version).toBe(1);
        expect(organisation.organisationType).toBe("company");
        expect(view.membership.userId).toBe(a.userId);
        expect(view.membership.status).toBe("active");
        expect(view.roleCodes).toEqual(["organisation_admin"]);
        expect(view.isActiveContext).toBe(true);

        const { sql } = tx;
        const [tenants] = await sql<
          { count: number }[]
        >`select count(*)::int as count from identity.tenants where id = ${organisation.tenantId}`;
        expect(tenants?.count).toBe(1);
        const [links] = await sql<
          { count: number }[]
        >`select count(*)::int as count from identity.tenant_organisations where tenant_id = ${organisation.tenantId} and organisation_id = ${organisation.id} and relationship_type = 'primary'`;
        expect(links?.count).toBe(1);
        const memberships = await sql<
          {
            id: string;
            membership_status: string;
            primary_business_title: string | null;
            invited_by_user_id: string | null;
          }[]
        >`
        select id, membership_status, primary_business_title, invited_by_user_id
          from identity.organisation_memberships where user_id = ${a.userId}`;
        expect(memberships).toHaveLength(1);
        expect(memberships[0]?.membership_status).toBe("active");
        // No business title is invented for the creator.
        expect(memberships[0]?.primary_business_title).toBeNull();
        expect(memberships[0]?.invited_by_user_id).toBeNull();
        const roles = await sql<{ code: string }[]>`
        select r.code from identity.membership_roles mr join permissions.roles r on r.id = mr.role_id
         where mr.membership_id = ${view.membership.id}`;
        expect(roles.map((r) => r.code)).toEqual(["organisation_admin"]);
        const [context] = await sql<
          { membership_id: string }[]
        >`select membership_id from identity.user_active_contexts where user_id = ${a.userId}`;
        expect(context?.membership_id).toBe(view.membership.id);

        const audits = await sql<
          {
            action_type: string;
            actor_id: string;
            authority_user_id: string;
            tenant_id: string;
            organisation_id: string;
            resource_type: string;
            resource_id: string;
            outcome: string;
            metadata: unknown;
          }[]
        >`
        select action_type, actor_id, authority_user_id, tenant_id, organisation_id, resource_type, resource_id, outcome, metadata
          from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action_type: "organisation.created",
          actor_id: a.userId,
          authority_user_id: a.userId,
          tenant_id: organisation.tenantId,
          organisation_id: organisation.id,
          resource_type: "organisation",
          resource_id: organisation.id,
          outcome: "SUCCEEDED",
          metadata: { organisationType: "company" },
        });

        const events = await sql<
          {
            event_type: string;
            tenant_id: string;
            payload: { data: unknown; organisationId: string };
          }[]
        >`
        select event_type, tenant_id, payload from events.outbox
         where payload ->> 'correlationId' = ${correlationId} order by event_type`;
        expect(events.map((e) => e.event_type)).toEqual([
          "identity.membership.created",
          "identity.organisation.created",
        ]);
        expect(events.every((e) => e.tenant_id === organisation.tenantId)).toBe(
          true,
        );
        expect(events[1]?.payload.data).toEqual({
          organisationId: organisation.id,
          organisationType: "company",
        });
        expect(outboxCalls.count).toBe(2);

        const [requests] = await sql<
          { count: number }[]
        >`select count(*)::int as count from identity.organisation_creation_requests where user_id = ${a.userId}`;
        expect(requests?.count).toBe(1);

        // Fresh ActorContext resolves to the new workspace, and authority is
        // exactly the two organisation capabilities -- nothing from future domains.
        const actor = await resolveContext(a);
        expect(actor).toMatchObject({
          userId: a.userId,
          tenantId: organisation.tenantId,
          organisationId: organisation.id,
          membershipId: view.membership.id,
          actorType: "HUMAN",
        });
        expect(
          (await decide(authorization, actor, ORGANISATION_VIEW)).outcome,
        ).toBe("ALLOW");
        expect(
          (await decide(authorization, actor, ORGANISATION_ADMIN)).outcome,
        ).toBe("ALLOW");
        for (const future of [
          "company.financials.edit",
          "company.financials.view",
          "data_room.share",
          "q.action.approve",
        ]) {
          expect(
            (await decide(authorization, actor, capability(future))).outcome,
          ).toBe("DENY");
        }
      },
    );
  });

  it("retries with the same key and request return the same organisation; a different request conflicts", async () => {
    await withHarness(async ({ tx, service }, { a }) => {
      const input = createRequest("Retry Co");
      const first = await service.createOrganisation({
        principal: a.principal,
        input,
        idempotencyKey: "key-retry-0001",
        correlationId: CORRELATION(),
      });
      const second = await service.createOrganisation({
        principal: a.principal,
        input: { ...input },
        idempotencyKey: "key-retry-0001",
        correlationId: CORRELATION(),
      });
      expect(second.organisation.id).toBe(first.organisation.id);
      expect(second.membership.id).toBe(first.membership.id);

      await expect(
        service.createOrganisation({
          principal: a.principal,
          input: createRequest("Retry Co", {
            organisationType: "investment_firm",
          }),
          idempotencyKey: "key-retry-0001",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OrganisationCreationConflictError);

      const [orgs] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from identity.organisations where display_name = 'Retry Co'`;
      expect(orgs?.count).toBe(1);
      const [memberships] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from identity.organisation_memberships where user_id = ${a.userId}`;
      expect(memberships?.count).toBe(1);
      const [tenants] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from identity.tenants where name = 'Retry Co'`;
      expect(tenants?.count).toBe(1);
    });
  });

  it("rolls back everything when a late stage fails", async () => {
    await withHarness(
      async ({ tx, service }, { a }) => {
        const correlationId = CORRELATION();
        await expect(
          service.createOrganisation({
            principal: a.principal,
            input: createRequest("Doomed Org"),
            idempotencyKey: "key-doomed-0001",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");

        const { sql } = tx;
        const count = async (query: Promise<{ count: number }[]>) =>
          (await query)[0]?.count;
        expect(
          await count(
            sql`select count(*)::int as count from identity.organisations where display_name = 'Doomed Org'`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from identity.tenants where name = 'Doomed Org'`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from identity.organisation_memberships where user_id = ${a.userId}`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from identity.user_active_contexts where user_id = ${a.userId}`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from events.outbox where payload ->> 'correlationId' = ${correlationId}`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from identity.organisation_creation_requests where user_id = ${a.userId}`,
          ),
        ).toBe(0);
      },
      {
        // Audit has been written by the time the second event is enqueued.
        outbox: (real) => ({
          enqueue: async (tx, event, options) => {
            if (event.type === "identity.membership.created") {
              throw new Error("outbox unavailable");
            }
            return real.enqueue(tx, event, options);
          },
        }),
      },
    );
  });

  it("fails closed when the admin role template is missing, creating nothing", async () => {
    await withHarness(async ({ tx, service }, { a }) => {
      await tx.sql`update permissions.roles set status = 'deprecated' where code = 'organisation_admin'`;
      await expect(
        service.createOrganisation({
          principal: a.principal,
          input: createRequest("No Role Org"),
          idempotencyKey: "key-norole-0001",
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow(/reference data/);
      const [orgs] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from identity.organisations where display_name = 'No Role Org'`;
      expect(orgs?.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  it("lists only the caller's active memberships, paginated by cursor, never the first membership by assumption", async () => {
    await withHarness(async ({ tx, service }, { a, b }) => {
      const a1 = await service.createOrganisation({
        principal: a.principal,
        input: createRequest("A One"),
        idempotencyKey: "key-a1",
        correlationId: CORRELATION(),
      });
      const b1 = await service.createOrganisation({
        principal: b.principal,
        input: createRequest("B One", { organisationType: "investment_firm" }),
        idempotencyKey: "key-b1",
        correlationId: CORRELATION(),
      });

      const listA = await service.listMyOrganisations({
        principal: a.principal,
      });
      expect(listA.items.map((i) => i.organisation.id)).toEqual([
        a1.organisation.id,
      ]);
      const listB = await service.listMyOrganisations({
        principal: b.principal,
      });
      expect(listB.items.map((i) => i.organisation.id)).toEqual([
        b1.organisation.id,
      ]);

      const membershipAinB = await addMember(
        tx,
        a,
        b1.organisation.id,
        "organisation_member",
      );
      const both = await service.listMyOrganisations({
        principal: a.principal,
      });
      expect(both.items.map((i) => i.organisation.id)).toEqual([
        a1.organisation.id,
        b1.organisation.id,
      ]);
      expect(both.items[0]?.isActiveContext).toBe(true);
      expect(both.items[1]?.isActiveContext).toBe(false);
      expect(both.items[1]?.roleCodes).toEqual(["organisation_member"]);
      expect(both.nextCursor).toBeUndefined();

      const page1 = await service.listMyOrganisations({
        principal: a.principal,
        limit: 1,
      });
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).toBeDefined();
      const page2 = await service.listMyOrganisations({
        principal: a.principal,
        limit: 1,
        cursor: page1.nextCursor,
      });
      expect(page2.items.map((i) => i.organisation.id)).toEqual([
        b1.organisation.id,
      ]);
      expect(page2.nextCursor).toBeUndefined();

      // A revoked membership is history, not current access.
      await revoke(tx, membershipAinB);
      const afterRevoke = await service.listMyOrganisations({
        principal: a.principal,
      });
      expect(afterRevoke.items.map((i) => i.organisation.id)).toEqual([
        a1.organisation.id,
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Reading and updating
  // -------------------------------------------------------------------------

  it("reads the current organisation with organisation.view and answers a guessed foreign id with not-found", async () => {
    await withHarness(async ({ service, resolveContext }, { a, b }) => {
      const a1 = await service.createOrganisation({
        principal: a.principal,
        input: createRequest("Read A"),
        idempotencyKey: "key-read-a",
        correlationId: CORRELATION(),
      });
      const b1 = await service.createOrganisation({
        principal: b.principal,
        input: createRequest("Read B"),
        idempotencyKey: "key-read-b",
        correlationId: CORRELATION(),
      });
      const actorA = await resolveContext(a);

      const organisation = await service.getOrganisation({
        actor: actorA,
        organisationId: a1.organisation.id,
      });
      expect(organisation.id).toBe(a1.organisation.id);

      await expect(
        service.getOrganisation({
          actor: actorA,
          organisationId: b1.organisation.id,
        }),
      ).rejects.toBeInstanceOf(OrganisationNotFoundError);
      await expect(
        service.getOrganisation({
          actor: actorA,
          organisationId: OrganisationIdSchema.parse(randomUUID()),
        }),
      ).rejects.toBeInstanceOf(OrganisationNotFoundError);
    });
  });

  it("an ordinary member can view but not administer; type never grants", async () => {
    await withHarness(async ({ tx, service, resolveContext }, { a, b }) => {
      const b1 = await service.createOrganisation({
        principal: b.principal,
        input: createRequest("Firm B", { organisationType: "investment_firm" }),
        idempotencyKey: "key-firm-b",
        correlationId: CORRELATION(),
      });
      await addMember(tx, a, b1.organisation.id, "organisation_member");
      await service.activateOrganisation({
        principal: a.principal,
        organisationId: b1.organisation.id,
        correlationId: CORRELATION(),
      });
      const actorA = await resolveContext(a);
      expect(actorA.organisationId).toBe(b1.organisation.id);

      await expect(
        service.getOrganisation({
          actor: actorA,
          organisationId: b1.organisation.id,
        }),
      ).resolves.toMatchObject({ id: b1.organisation.id });

      await expect(
        service.updateOrganisation({
          actor: actorA,
          organisationId: b1.organisation.id,
          input: { expectedVersion: 1, displayName: "Taken over" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);

      const [row] = await tx.sql<
        { display_name: string; version: number }[]
      >`select display_name, version from identity.organisations where id = ${b1.organisation.id}`;
      expect(row).toEqual({ display_name: "Firm B", version: 1 });
    });
  });

  it("an administrator updates with the expected version; stale and cross-tenant writes change nothing", async () => {
    await withHarness(async ({ tx, service, resolveContext }, { a, b }) => {
      const a1 = await service.createOrganisation({
        principal: a.principal,
        input: createRequest("Update A"),
        idempotencyKey: "key-upd-a",
        correlationId: CORRELATION(),
      });
      const b1 = await service.createOrganisation({
        principal: b.principal,
        input: createRequest("Update B"),
        idempotencyKey: "key-upd-b",
        correlationId: CORRELATION(),
      });
      const actorA = await resolveContext(a);
      const correlationId = CORRELATION();

      const updated = await service.updateOrganisation({
        actor: actorA,
        organisationId: a1.organisation.id,
        input: {
          expectedVersion: 1,
          displayName: "Update A Ltd",
          legalName: "Update A Limited",
          countryCode: "GB",
        },
        correlationId,
      });
      expect(updated.version).toBe(2);
      expect(updated.displayName).toBe("Update A Ltd");
      expect(updated.legalName).toBe("Update A Limited");
      // The slug does not follow the display name.
      expect(updated.slug).toBe("update-a");

      const audits = await tx.sql<
        { action_type: string; metadata: unknown; resource_id: string }[]
      >`
        select action_type, metadata, resource_id from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits).toHaveLength(1);
      expect(audits[0]?.action_type).toBe("organisation.updated");
      expect(audits[0]?.metadata).toEqual({
        changedFields: ["displayName", "legalName", "countryCode"],
        previousVersion: 1,
        newVersion: 2,
      });
      const events = await tx.sql<
        { event_type: string; payload: { data: unknown } }[]
      >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
      expect(events).toHaveLength(1);
      expect(events[0]?.payload.data).toEqual({
        organisationId: a1.organisation.id,
        version: 2,
        changedFields: ["displayName", "legalName", "countryCode"],
      });

      // A second client still holding version 1 is refused; nothing moves.
      await expect(
        service.updateOrganisation({
          actor: actorA,
          organisationId: a1.organisation.id,
          input: { expectedVersion: 1, displayName: "Stale write" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OrganisationVersionConflictError);
      const [row] = await tx.sql<
        { display_name: string; version: number }[]
      >`select display_name, version from identity.organisations where id = ${a1.organisation.id}`;
      expect(row).toEqual({ display_name: "Update A Ltd", version: 2 });

      // A valid foreign id from A's context: not found, not mutated.
      await expect(
        service.updateOrganisation({
          actor: actorA,
          organisationId: b1.organisation.id,
          input: { expectedVersion: 1, displayName: "Cross tenant" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(OrganisationNotFoundError);
      const [bRow] = await tx.sql<
        { display_name: string; version: number }[]
      >`select display_name, version from identity.organisations where id = ${b1.organisation.id}`;
      expect(bRow).toEqual({ display_name: "Update B", version: 1 });

      // An update that changes nothing does not bump the version.
      const noop = await service.updateOrganisation({
        actor: actorA,
        organisationId: a1.organisation.id,
        input: { expectedVersion: 2, displayName: "Update A Ltd" },
        correlationId: CORRELATION(),
      });
      expect(noop.version).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Context switching
  // -------------------------------------------------------------------------

  it("switches context explicitly, re-resolves the ActorContext and re-evaluates capabilities", async () => {
    await withHarness(
      async ({ tx, service, authorization, resolveContext }, { a, b }) => {
        const a1 = await service.createOrganisation({
          principal: a.principal,
          input: createRequest("Switch A"),
          idempotencyKey: "key-sw-a",
          correlationId: CORRELATION(),
        });
        const c = await service.createOrganisation({
          principal: b.principal,
          input: createRequest("Switch C"),
          idempotencyKey: "key-sw-c",
          correlationId: CORRELATION(),
        });
        const membershipAinC = await addMember(
          tx,
          a,
          c.organisation.id,
          "organisation_member",
        );

        const before = await resolveContext(a);
        expect(before.organisationId).toBe(a1.organisation.id);
        expect(
          (await decide(authorization, before, ORGANISATION_ADMIN)).outcome,
        ).toBe("ALLOW");

        const activated = await service.activateOrganisation({
          principal: a.principal,
          organisationId: c.organisation.id,
          correlationId: CORRELATION(),
        });
        expect(activated.view.organisation.id).toBe(c.organisation.id);
        expect(activated.view.membership.id).toBe(membershipAinC);
        expect(activated.view.isActiveContext).toBe(true);
        expect(activated.context).toMatchObject({
          tenantId: c.organisation.tenantId,
          organisationId: c.organisation.id,
          membershipId: membershipAinC,
        });

        const [stored] = await tx.sql<
          { membership_id: string }[]
        >`select membership_id from identity.user_active_contexts where user_id = ${a.userId}`;
        expect(stored?.membership_id).toBe(membershipAinC);

        const after = await resolveContext(a);
        expect(after.organisationId).toBe(c.organisation.id);
        expect(
          (await decide(authorization, after, ORGANISATION_VIEW)).outcome,
        ).toBe("ALLOW");
        expect(
          (await decide(authorization, after, ORGANISATION_ADMIN)).outcome,
        ).toBe("DENY");

        const [securityEvent] = await tx.sql<
          { event_type: string; user_id: string; resource_id: string }[]
        >`
        select event_type, user_id, resource_id from audit.security_events
         where user_id = ${a.userId} and event_type = 'organisation_context_changed'`;
        expect(securityEvent).toEqual({
          event_type: "organisation_context_changed",
          user_id: a.userId,
          resource_id: c.organisation.id,
        });
        // No domain event for a context switch.
        const [contextEvents] = await tx.sql<
          { count: number }[]
        >`select count(*)::int as count from events.outbox where event_type like 'identity.%context%'`;
        expect(contextEvents?.count).toBe(0);
      },
    );
  });

  it("refuses an inaccessible or revoked target and leaves the persisted context untouched", async () => {
    await withHarness(async ({ tx, service, resolveContext }, { a, b }) => {
      const a1 = await service.createOrganisation({
        principal: a.principal,
        input: createRequest("Keep A"),
        idempotencyKey: "key-keep-a",
        correlationId: CORRELATION(),
      });
      const b1 = await service.createOrganisation({
        principal: b.principal,
        input: createRequest("Keep B"),
        idempotencyKey: "key-keep-b",
        correlationId: CORRELATION(),
      });

      await expect(
        service.activateOrganisation({
          principal: a.principal,
          organisationId: b1.organisation.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ActorContextDeniedError);
      await expect(
        service.activateOrganisation({
          principal: a.principal,
          organisationId: OrganisationIdSchema.parse(randomUUID()),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ActorContextDeniedError);

      const membershipAinB = await addMember(
        tx,
        a,
        b1.organisation.id,
        "organisation_member",
      );
      await revoke(tx, membershipAinB);
      await expect(
        service.activateOrganisation({
          principal: a.principal,
          organisationId: b1.organisation.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ActorContextDeniedError);

      const [stored] = await tx.sql<
        { membership_id: string }[]
      >`select membership_id from identity.user_active_contexts where user_id = ${a.userId}`;
      expect(stored?.membership_id).toBe(a1.membership.id);

      // Revoking the current membership: the stale active-context row does
      // not restore access.
      await revoke(tx, a1.membership.id);
      await expect(resolveContext(a)).rejects.toThrow("CONTEXT_REQUIRED");
      await expect(
        service.activateOrganisation({
          principal: a.principal,
          organisationId: a1.organisation.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ActorContextDeniedError);
    });
  });
});
