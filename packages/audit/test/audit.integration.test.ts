import { randomUUID } from "node:crypto";

import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  defineEvent,
  EventIdSchema,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createAuditEventId } from "../src/contracts/ids.js";
import { AuditEventConflictError, AuditInputError } from "../src/errors.js";
import { createPostgresMaterialActionAuditWriter } from "../src/postgres/material-action-writer.js";
import { createPostgresSecurityEventWriter } from "../src/postgres/security-event-writer.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test creates its synthetic tenant, organisation and people inside a
 * transaction that is rolled back, except the commit-proof tests, which
 * clean their own rows up.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type World = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly userA: string;
  readonly userB: string;
  readonly membershipA: string;
};

async function createWorld(tx: TransactionContext): Promise<World> {
  const { sql } = tx;
  const authA = randomUUID();
  const authB = randomUUID();
  await sql`insert into auth.users (id) values (${authA}), (${authB})`;
  const profiles = await sql<{ id: string; auth_user_id: string }[]>`
    select id, auth_user_id from identity.user_profiles where auth_user_id in (${authA}, ${authB})`;
  const userA = profiles.find((p) => p.auth_user_id === authA)?.id ?? "";
  const userB = profiles.find((p) => p.auth_user_id === authB)?.id ?? "";
  const tenantId = randomUUID();
  const organisationId = randomUUID();
  const membershipA = randomUUID();
  await sql`insert into identity.tenants (id, name) values (${tenantId}, 'Synthetic Audit Tenant')`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${organisationId}, ${tenantId}, 'company', 'Synthetic Org A', 'org-a')`;
  await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
    values (${membershipA}, ${tenantId}, ${organisationId}, ${userA})`;
  return { tenantId, organisationId, userA, userB, membershipA };
}

const FixtureCreated = defineEvent({
  name: "test.fixture.created",
  version: 1,
  owner: "test",
  producer: "capitalq://api/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z.object({ fixtureId: z.uuid() }),
  description: "Test fixture created.",
});
const registry = createEventRegistry([FixtureCreated]);

function fixtureEvent() {
  return {
    specVersion: "1.0" as const,
    id: EventIdSchema.parse(randomUUID()),
    type: FixtureCreated.name,
    source: FixtureCreated.producer,
    time: new Date().toISOString(),
    dataContentType: "application/json" as const,
    eventVersion: 1,
    data: { fixtureId: randomUUID() },
  };
}

function humanAction(world: World, overrides: Record<string, unknown> = {}) {
  return {
    auditEventId: createAuditEventId(),
    tenantId: TenantIdSchema.parse(world.tenantId),
    actorType: "HUMAN" as const,
    actorId: world.userA,
    organisationId: OrganisationIdSchema.parse(world.organisationId),
    actionType: "organisation.member.changed",
    resourceType: "membership",
    resourceId: world.membershipA,
    occurredAt: "2026-09-02T10:00:00.000Z",
    outcome: "SUCCEEDED" as const,
    metadata: { previousRoleId: randomUUID(), newRoleId: randomUUID() },
    correlationId: `cor_${randomUUID()}`,
    ...overrides,
  };
}

describe("@capital-q/audit against local Supabase Postgres", () => {
  let db: RequestDatabase;
  const audit = createPostgresMaterialActionAuditWriter();

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.sql`create schema if not exists cq_audit_test`;
    await db.sql`create table if not exists cq_audit_test.state (id uuid primary key, note text not null)`;
  });

  afterAll(async () => {
    await db.sql`drop schema if exists cq_audit_test cascade`;
    await db.close();
  });

  async function rolledBack(
    work: (tx: TransactionContext, world: World) => Promise<void>,
  ) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        await work(tx, world);
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

  async function readAction(tx: TransactionContext, auditEventId: string) {
    const [row] = await tx.sql<Record<string, unknown>[]>`
      select * from audit.material_actions where event_id = ${auditEventId}`;
    return row;
  }

  it("writes exactly one material-action row with actor, authority, resource, action, outcome and correlation", async () => {
    await rolledBack(async (tx, world) => {
      const input = humanAction(world);
      const id = await audit.record(tx, input);
      expect(id).toBe(input.auditEventId);
      const rows =
        await tx.sql`select 1 from audit.material_actions where event_id = ${id}`;
      expect(rows).toHaveLength(1);
      const row = await readAction(tx, id);
      expect(row).toMatchObject({
        tenant_id: world.tenantId,
        actor_type: "human",
        actor_id: world.userA,
        authority_user_id: world.userA,
        organisation_id: world.organisationId,
        action_type: "organisation.member.changed",
        resource_type: "membership",
        resource_id: world.membershipA,
        outcome: "SUCCEEDED",
        correlation_id: input.correlationId.slice(4),
      });
      expect(row?.["metadata"]).toEqual(input.metadata);
      expect(new Date(String(row?.["occurred_at"])).toISOString()).toBe(
        input.occurredAt,
      );
    });
  });

  it("commits domain state and its audit record together", async () => {
    const stateId = randomUUID();
    const auditEventId = createAuditEventId();
    let tenantId = "";
    try {
      await db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        tenantId = world.tenantId;
        await tx.sql`insert into cq_audit_test.state (id, note) values (${stateId}, 'mutated')`;
        await audit.record(
          tx,
          humanAction(world, { auditEventId, resourceId: stateId }),
        );
      });
      expect(
        await db.sql`select 1 from cq_audit_test.state where id = ${stateId}`,
      ).toHaveLength(1);
      expect(
        await db.sql`select 1 from audit.material_actions where event_id = ${auditEventId}`,
      ).toHaveLength(1);
    } finally {
      await db.sql`delete from audit.material_actions where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.organisations where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.tenants where id = ${tenantId}::uuid`;
      await db.sql`delete from cq_audit_test.state where id = ${stateId}`;
    }
  });

  it("rolls back domain state and the audit record together", async () => {
    const stateId = randomUUID();
    const auditEventId = createAuditEventId();
    class BusinessRuleViolated extends Error {}
    await expect(
      db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        await tx.sql`insert into cq_audit_test.state (id, note) values (${stateId}, 'mutated')`;
        await audit.record(tx, humanAction(world, { auditEventId }));
        throw new BusinessRuleViolated("after both writes");
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolated);
    expect(
      await db.sql`select 1 from cq_audit_test.state where id = ${stateId}`,
    ).toHaveLength(0);
    expect(
      await db.sql`select 1 from audit.material_actions where event_id = ${auditEventId}`,
    ).toHaveLength(0);
  });

  it("state + audit + outbox commit together and roll back together", async () => {
    const outbox = createOutboxWriter({ registry });
    const committed = {
      state: randomUUID(),
      audit: createAuditEventId(),
      event: fixtureEvent(),
    };
    let tenantId = "";
    try {
      await db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        tenantId = world.tenantId;
        await tx.sql`insert into cq_audit_test.state (id, note) values (${committed.state}, 'mutated')`;
        await audit.record(
          tx,
          humanAction(world, { auditEventId: committed.audit }),
        );
        await outbox.enqueue(tx, committed.event);
      });
      expect(
        await db.sql`select 1 from cq_audit_test.state where id = ${committed.state}`,
      ).toHaveLength(1);
      expect(
        await db.sql`select 1 from audit.material_actions where event_id = ${committed.audit}`,
      ).toHaveLength(1);
      expect(
        await db.sql`select 1 from events.outbox where event_id = ${committed.event.id}`,
      ).toHaveLength(1);
    } finally {
      await db.sql`delete from events.outbox where event_id = ${committed.event.id}`;
      await db.sql`delete from audit.material_actions where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.organisation_memberships where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.organisations where tenant_id = ${tenantId}::uuid`;
      await db.sql`delete from identity.tenants where id = ${tenantId}::uuid`;
      await db.sql`delete from cq_audit_test.state where id = ${committed.state}`;
    }

    const aborted = {
      state: randomUUID(),
      audit: createAuditEventId(),
      event: fixtureEvent(),
    };
    class Abort extends Error {}
    await expect(
      db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        await tx.sql`insert into cq_audit_test.state (id, note) values (${aborted.state}, 'mutated')`;
        await audit.record(
          tx,
          humanAction(world, { auditEventId: aborted.audit }),
        );
        await outbox.enqueue(tx, aborted.event);
        throw new Abort();
      }),
    ).rejects.toBeInstanceOf(Abort);
    expect(
      await db.sql`select 1 from cq_audit_test.state where id = ${aborted.state}`,
    ).toHaveLength(0);
    expect(
      await db.sql`select 1 from audit.material_actions where event_id = ${aborted.audit}`,
    ).toHaveLength(0);
    expect(
      await db.sql`select 1 from events.outbox where event_id = ${aborted.event.id}`,
    ).toHaveLength(0);
  });

  it("is idempotent for the same id with the same record, regardless of metadata key order", async () => {
    await rolledBack(async (tx, world) => {
      const input = humanAction(world, { metadata: { a: 1, b: "two" } });
      await audit.record(tx, input);
      await expect(audit.record(tx, input)).resolves.toBe(input.auditEventId);
      await expect(
        audit.record(tx, { ...input, metadata: { b: "two", a: 1 } }),
      ).resolves.toBe(input.auditEventId);
      expect(
        await tx.sql`select 1 from audit.material_actions where event_id = ${input.auditEventId}`,
      ).toHaveLength(1);
    });
  });

  it("refuses the same id with different content and leaves the original untouched", async () => {
    await rolledBack(async (tx, world) => {
      const input = humanAction(world);
      await audit.record(tx, input);
      await expect(
        audit.record(tx, { ...input, outcome: "DENIED" }),
      ).rejects.toBeInstanceOf(AuditEventConflictError);
      await expect(
        audit.record(tx, {
          ...input,
          metadata: { ...input.metadata, extra: true },
        }),
      ).rejects.toBeInstanceOf(AuditEventConflictError);
      const row = await readAction(tx, input.auditEventId);
      expect(row?.["outcome"]).toBe("SUCCEEDED");
      expect(row?.["metadata"]).toEqual(input.metadata);
    });
  });

  it("refuses a Q action without human authority and records one with it", async () => {
    await rolledBack(async (tx, world) => {
      const qAction = {
        ...humanAction(world, {
          actionType: "q.action.executed",
          resourceType: "q_action",
          resourceId: randomUUID(),
          metadata: {
            approvalId: randomUUID(),
            payloadHash: "sha256:0123abcd",
          },
        }),
        actorType: "Q" as const,
        actorId: undefined,
      };
      await expect(audit.record(tx, qAction)).rejects.toBeInstanceOf(
        AuditInputError,
      );
      const id = await audit.record(tx, {
        ...qAction,
        authorityUserId: UserIdSchema.parse(world.userA),
      });
      const row = await readAction(tx, id);
      expect(row).toMatchObject({
        actor_type: "q",
        actor_id: null,
        authority_user_id: world.userA,
      });
      expect(row?.["metadata"]).not.toHaveProperty("payload");
    });
  });

  it("rejects secrets in metadata without echoing the value", async () => {
    await rolledBack(async (tx, world) => {
      let caught: unknown;
      try {
        await audit.record(
          tx,
          humanAction(world, {
            metadata: { accessToken: "super-secret-test-value" },
          }),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuditInputError);
      expect(
        JSON.stringify({
          message: (caught as Error).message,
          issues: (caught as AuditInputError).issues,
        }),
      ).not.toContain("super-secret-test-value");
    });
  });

  it("keeps historical attribution after identity state changes", async () => {
    await rolledBack(async (tx, world) => {
      const input = humanAction(world);
      await audit.record(tx, input);
      // The person leaves the organisation and the organisation is renamed.
      await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = now() where id = ${world.membershipA}`;
      await tx.sql`update identity.organisations set display_name = 'Renamed Org' where id = ${world.organisationId}`;
      const row = await readAction(tx, input.auditEventId);
      expect(row).toMatchObject({
        actor_id: world.userA,
        organisation_id: world.organisationId,
        authority_user_id: world.userA,
      });
      expect(new Date(String(row?.["occurred_at"])).toISOString()).toBe(
        input.occurredAt,
      );
    });
  });

  it("persists a synthetic permission_denied security event with hashes and correlation", async () => {
    await rolledBack(async (tx, world) => {
      const security = createPostgresSecurityEventWriter({ sql: tx.sql });
      const input = {
        auditEventId: createAuditEventId(),
        tenantId: TenantIdSchema.parse(world.tenantId),
        userId: UserIdSchema.parse(world.userB),
        eventType: "permission_denied",
        severity: "MEDIUM" as const,
        resourceType: "document",
        resourceId: randomUUID(),
        occurredAt: "2026-09-02T10:05:00.000Z",
        ipHash: "sha256:9f86d081884c7d659a2feaa0c55ad015",
        userAgentHash: "sha256:2c26b46b68ffc68ff99b453c1d304134",
        metadata: {
          capability: "data_room.share",
          reasonCode: "NO_MATCHING_GRANT",
        },
        correlationId: `cor_${randomUUID()}`,
      };
      const id = await security.record(input);
      await expect(security.record(input)).resolves.toBe(id);
      await expect(
        security.record({ ...input, severity: "HIGH" }),
      ).rejects.toBeInstanceOf(AuditEventConflictError);
      const [row] = await tx.sql<
        Record<string, unknown>[]
      >`select * from audit.security_events where event_id = ${id}`;
      expect(row).toMatchObject({
        tenant_id: world.tenantId,
        user_id: world.userB,
        event_type: "permission_denied",
        severity: "MEDIUM",
        resource_type: "document",
        resource_id: input.resourceId,
        ip_hash: input.ipHash,
        user_agent_hash: input.userAgentHash,
        correlation_id: input.correlationId.slice(4),
      });
      expect(row?.["metadata"]).toEqual(input.metadata);

      // A cross-tenant attempt with no stored request body.
      const crossTenant = await security.record({
        auditEventId: createAuditEventId(),
        tenantId: TenantIdSchema.parse(world.tenantId),
        userId: UserIdSchema.parse(world.userA),
        eventType: "cross_tenant_access_attempt",
        severity: "HIGH",
        resourceType: "company",
        resourceId: randomUUID(),
        occurredAt: "2026-09-02T10:06:00.000Z",
        metadata: { attemptedTenantId: randomUUID() },
      });
      expect(
        await tx.sql`select 1 from audit.security_events where event_id = ${crossTenant}`,
      ).toHaveLength(1);
    });
  });
});
