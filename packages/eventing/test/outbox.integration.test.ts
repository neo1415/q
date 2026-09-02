import { randomUUID } from "node:crypto";

import { z } from "zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  defineEvent,
  EventIdSchema,
  type CapitalQEvent,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import {
  createOutboxWriter,
  DOMAIN_EVENTS_QUEUE,
  OutboxEventConflictError,
  OutboxEventInvalidError,
} from "../src/index.js";
import {
  createOutboxPublisher,
  createOutboxRetryPolicy,
  createPgmqEventDispatcher,
  type EventDispatcher,
} from "../src/publisher/index.js";

/**
 * Real local PostgreSQL + pgmq (`pnpm db:start`), run with
 * `pnpm test:integration`. Writer tests roll back; publisher tests must
 * commit (SKIP LOCKED and pgmq are cross-connection behaviour) and clean up
 * their own test.fixture.* rows and messages afterwards.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Test-only definitions. Nothing here is a production event.
const FixtureCreated = defineEvent({
  name: "test.fixture.created",
  version: 1,
  owner: "test",
  producer: "capitalq://workers/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z.object({
    fixtureId: z.uuid(),
    changedFields: z.array(z.string()),
  }),
  description: "Test fixture created (platform-scoped).",
});

const FixtureScoped = defineEvent({
  name: "test.fixture.scoped",
  version: 1,
  owner: "test",
  producer: "capitalq://workers/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  // tenancy omitted on purpose: the default is TENANT_OWNED.
  dataSchema: z.object({ fixtureId: z.uuid() }),
  description: "Test fixture scoped to a tenant.",
});

const registry = createEventRegistry([FixtureCreated, FixtureScoped]);

function fixtureCreated(
  overrides: Partial<CapitalQEvent<unknown>> = {},
): CapitalQEvent<unknown> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: FixtureCreated.name,
    source: FixtureCreated.producer,
    time: new Date().toISOString(),
    dataContentType: "application/json",
    eventVersion: 1,
    data: { fixtureId: randomUUID(), changedFields: ["name"] },
    ...overrides,
  };
}

class Rollback extends Error {}

const QUEUE_TABLE = `q_${DOMAIN_EVENTS_QUEUE}`;
const ARCHIVE_TABLE = `a_${DOMAIN_EVENTS_QUEUE}`;

describe("@capital-q/eventing against local Supabase Postgres + pgmq", () => {
  let db: RequestDatabase;
  const writer = createOutboxWriter({ registry });
  const pgmq = createPgmqEventDispatcher();

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.sql`create schema if not exists cq_eventing_test`;
    await db.sql`create table if not exists cq_eventing_test.state (id uuid primary key, note text not null)`;
  });

  afterEach(async () => {
    await db.sql`delete from events.outbox where event_type like 'test.fixture.%'`;
    await db.sql`delete from pgmq.${db.sql(QUEUE_TABLE)} where message ->> 'type' like 'test.fixture.%'`;
    await db.sql`delete from pgmq.${db.sql(ARCHIVE_TABLE)} where message ->> 'type' like 'test.fixture.%'`;
    await db.sql`delete from cq_eventing_test.state`;
  });

  afterAll(async () => {
    await db.sql`drop schema if exists cq_eventing_test cascade`;
    await db.close();
  });

  async function rolledBack(work: (tx: TransactionContext) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(tx);
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

  async function outboxRow(eventId: string) {
    const [row] = await db.sql<
      {
        event_type: string;
        event_version: number;
        tenant_id: string | null;
        payload: unknown;
        published_at: string | null;
        attempt_count: number;
        last_error: string | null;
        available_at: string;
      }[]
    >`select event_type, event_version, tenant_id, payload, published_at,
             attempt_count, last_error, available_at
        from events.outbox where event_id = ${eventId}`;
    return row;
  }

  async function queueMessages(eventId: string) {
    return db.sql<{ msg_id: number; message: unknown; read_ct: number }[]>`
      select msg_id, message, read_ct from pgmq.${db.sql(QUEUE_TABLE)}
       where message ->> 'id' = ${eventId}`;
  }

  function publisherWith(dispatcher: EventDispatcher = pgmq, maxAttempts = 10) {
    return createOutboxPublisher({
      transactions: db.transactions,
      registry,
      dispatcher,
      retryPolicy: createOutboxRetryPolicy({ maxAttempts }),
    });
  }

  // -------------------------------------------------------------------------
  // OutboxWriter
  // -------------------------------------------------------------------------

  describe("OutboxWriter", () => {
    it("persists a valid registered event with columns derived from the canonical envelope", async () => {
      await rolledBack(async (tx) => {
        const event = fixtureCreated();
        await expect(writer.enqueue(tx, event)).resolves.toEqual({
          status: "ENQUEUED",
        });

        const [row] = await tx.sql<
          {
            event_type: string;
            event_version: number;
            tenant_id: string | null;
            payload: unknown;
          }[]
        >`select event_type, event_version, tenant_id, payload from events.outbox where event_id = ${event.id}`;
        expect(row).toEqual({
          event_type: "test.fixture.created",
          event_version: 1,
          tenant_id: null,
          payload: event,
        });
        // The stored payload is the full canonical envelope, not just data.
        const parsed = registry.parse(row?.payload);
        expect(parsed.ok).toBe(true);
      });
    });

    it("stores the canonical (validated, stripped) form rather than the raw object", async () => {
      await rolledBack(async (tx) => {
        const event = {
          ...fixtureCreated(),
          unexpected: "field",
        } as CapitalQEvent<unknown>;
        await writer.enqueue(tx, event);
        const [row] = await tx.sql<{ payload: Record<string, unknown> }[]>`
          select payload from events.outbox where event_id = ${event.id}`;
        expect(row?.payload).not.toHaveProperty("unexpected");
      });
    });

    it.each([
      [
        "INVALID_PAYLOAD",
        fixtureCreated({ data: { fixtureId: "not-a-uuid" } }),
      ],
      ["UNKNOWN_TYPE", fixtureCreated({ type: "test.fixture.deleted" })],
      ["UNSUPPORTED_VERSION", fixtureCreated({ eventVersion: 2 })],
      ["INVALID_ENVELOPE", fixtureCreated({ specVersion: "2.0" as "1.0" })],
      [
        "TENANT_REQUIRED",
        fixtureCreated({
          type: FixtureScoped.name,
          data: { fixtureId: randomUUID() },
        }),
      ],
    ] as const)("rejects %s and persists nothing", async (rejection, event) => {
      await rolledBack(async (tx) => {
        let caught: unknown;
        try {
          await writer.enqueue(tx, event);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(OutboxEventInvalidError);
        expect((caught as OutboxEventInvalidError).rejection).toBe(rejection);
        const rows =
          await tx.sql`select 1 from events.outbox where event_id = ${event.id}`;
        expect(rows).toHaveLength(0);
      });
    });

    it("accepts a tenant-owned event when it carries its tenant", async () => {
      await rolledBack(async (tx) => {
        const tenantId = randomUUID();
        await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Synthetic Tenant')`;
        const event = fixtureCreated({
          type: FixtureScoped.name,
          tenantId,
          data: { fixtureId: randomUUID() },
        });
        await expect(writer.enqueue(tx, event)).resolves.toEqual({
          status: "ENQUEUED",
        });
        const [row] = await tx.sql<{ tenant_id: string }[]>`
          select tenant_id from events.outbox where event_id = ${event.id}`;
        expect(row?.tenant_id).toBe(tenantId);
      });
    });

    it("fails the enclosing business transaction when the event is invalid", async () => {
      const stateId = randomUUID();
      let caught: unknown;
      try {
        await db.transactions.run(async (tx) => {
          await tx.sql`insert into cq_eventing_test.state (id, note) values (${stateId}, 'mutated')`;
          await writer.enqueue(
            tx,
            fixtureCreated({ type: "test.fixture.unknown" }),
          );
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OutboxEventInvalidError);
      const state =
        await db.sql`select 1 from cq_eventing_test.state where id = ${stateId}`;
      expect(state).toHaveLength(0);
    });

    it("commits domain state and the outbox row together", async () => {
      const stateId = randomUUID();
      const event = fixtureCreated();
      await db.transactions.run(async (tx) => {
        await tx.sql`insert into cq_eventing_test.state (id, note) values (${stateId}, 'mutated')`;
        await writer.enqueue(tx, event);
      });
      const state =
        await db.sql`select 1 from cq_eventing_test.state where id = ${stateId}`;
      expect(state).toHaveLength(1);
      expect(await outboxRow(event.id)).toMatchObject({
        published_at: null,
        attempt_count: 0,
      });
    });

    it("rolls back domain state and the outbox row together", async () => {
      const stateId = randomUUID();
      const event = fixtureCreated();
      class BusinessRuleViolated extends Error {}
      await expect(
        db.transactions.run(async (tx) => {
          await tx.sql`insert into cq_eventing_test.state (id, note) values (${stateId}, 'mutated')`;
          await writer.enqueue(tx, event);
          throw new BusinessRuleViolated("after both writes");
        }),
      ).rejects.toBeInstanceOf(BusinessRuleViolated);
      const state =
        await db.sql`select 1 from cq_eventing_test.state where id = ${stateId}`;
      expect(state).toHaveLength(0);
      expect(await outboxRow(event.id)).toBeUndefined();
    });

    it("treats the same EventId with the same event as idempotent, regardless of key order", async () => {
      await rolledBack(async (tx) => {
        const event = fixtureCreated();
        await expect(writer.enqueue(tx, event)).resolves.toEqual({
          status: "ENQUEUED",
        });
        await expect(writer.enqueue(tx, event)).resolves.toEqual({
          status: "ALREADY_ENQUEUED",
        });

        const reordered = Object.fromEntries(
          Object.entries(event).reverse(),
        ) as unknown as CapitalQEvent<unknown>;
        await expect(writer.enqueue(tx, reordered)).resolves.toEqual({
          status: "ALREADY_ENQUEUED",
        });

        const rows =
          await tx.sql`select 1 from events.outbox where event_id = ${event.id}`;
        expect(rows).toHaveLength(1);
      });
    });

    it("refuses the same EventId with different content and never overwrites", async () => {
      await rolledBack(async (tx) => {
        const event = fixtureCreated();
        await writer.enqueue(tx, event);
        const different = {
          ...event,
          data: { fixtureId: randomUUID(), changedFields: ["other"] },
        };
        await expect(writer.enqueue(tx, different)).rejects.toBeInstanceOf(
          OutboxEventConflictError,
        );
        const [row] = await tx.sql<{ payload: unknown }[]>`
          select payload from events.outbox where event_id = ${event.id}`;
        expect(row?.payload).toEqual(event);
      });
    });

    it("never schedules availability before the database's now", async () => {
      await rolledBack(async (tx) => {
        const event = fixtureCreated();
        await writer.enqueue(tx, event, {
          availableAt: "2020-01-01T00:00:00Z",
        });
        const [row] = await tx.sql<{ early: boolean }[]>`
          select (available_at < created_at) as early from events.outbox where event_id = ${event.id}`;
        expect(row?.early).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // OutboxPublisher + pgmq
  // -------------------------------------------------------------------------

  describe("OutboxPublisher", () => {
    async function enqueueCommitted(
      event = fixtureCreated(),
      availableAt?: string,
    ) {
      await db.transactions.run(async (tx) => {
        await writer.enqueue(tx, event, { availableAt });
      });
      return event;
    }

    it("publishes a pending row to the queue and marks it in the same transaction", async () => {
      const event = await enqueueCommitted();
      const result = await publisherWith().publishAvailable();

      expect(result).toMatchObject({
        claimed: 1,
        published: 1,
        failed: 0,
        exhausted: 0,
      });
      expect(result.records[0]).toMatchObject({
        eventId: event.id,
        eventType: "test.fixture.created",
        eventVersion: 1,
        tenantId: null,
        attempt: 1,
        outcome: "PUBLISHED",
      });

      const row = await outboxRow(event.id);
      expect(row?.published_at).not.toBeNull();
      expect(row?.attempt_count).toBe(1);
      expect(row?.last_error).toBeNull();

      const messages = await queueMessages(event.id);
      expect(messages).toHaveLength(1);
      // The queue message is the canonical event, nothing more.
      expect(messages[0]?.message).toEqual(event);
      expect(registry.parse(messages[0]?.message).ok).toBe(true);
    });

    it("lets two concurrent publishers claim one row exactly once", async () => {
      const event = await enqueueCommitted();
      const [a, b] = await Promise.all([
        publisherWith().publishAvailable(),
        publisherWith().publishAvailable(),
      ]);
      expect(a.published + b.published).toBe(1);
      expect(a.claimed + b.claimed).toBe(1);
      expect(await queueMessages(event.id)).toHaveLength(1);
      expect((await outboxRow(event.id))?.attempt_count).toBe(1);
    });

    it("publishes bounded batches in creation order", async () => {
      const first = await enqueueCommitted();
      const second = await enqueueCommitted();
      const third = await enqueueCommitted();

      const batch = await publisherWith().publishAvailable({ limit: 2 });
      expect(batch.records.map((r) => r.eventId)).toEqual([
        first.id,
        second.id,
      ]);
      expect((await outboxRow(third.id))?.published_at).toBeNull();

      const rest = await publisherWith().publishAvailable({ limit: 2 });
      expect(rest.records.map((r) => r.eventId)).toEqual([third.id]);
    });

    it("respects a future available_at", async () => {
      const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
      const event = await enqueueCommitted(fixtureCreated(), inAnHour);

      expect((await publisherWith().publishAvailable()).claimed).toBe(0);
      expect(await queueMessages(event.id)).toHaveLength(0);

      await db.sql`update events.outbox set available_at = now() where event_id = ${event.id}`;
      expect((await publisherWith().publishAvailable()).published).toBe(1);
    });

    it("records a bounded failure with backoff when the dispatcher fails, and retries later", async () => {
      const event = await enqueueCommitted();
      const failing: EventDispatcher = {
        publish: async (tx) => {
          // A real SQL failure inside the savepoint, so the batch transaction
          // must survive it to record the attempt.
          await tx.sql`select 1 / 0`;
        },
      };

      const first = await publisherWith(failing).publishAvailable();
      expect(first).toMatchObject({
        claimed: 1,
        published: 0,
        failed: 1,
        exhausted: 0,
      });
      expect(first.records[0]).toMatchObject({ outcome: "FAILED", attempt: 1 });

      let row = await outboxRow(event.id);
      expect(row?.published_at).toBeNull();
      expect(row?.attempt_count).toBe(1);
      expect(row?.last_error).toBe("QUEUE_PUBLISH_FAILED: sqlstate 22012");
      expect(row?.last_error).not.toContain("fixtureId");
      const [delay] = await db.sql<{ seconds: number }[]>`
        select extract(epoch from (available_at - now()))::float as seconds
          from events.outbox where event_id = ${event.id}`;
      expect(delay?.seconds).toBeGreaterThan(3);
      expect(delay?.seconds).toBeLessThanOrEqual(5);
      expect(await queueMessages(event.id)).toHaveLength(0);

      // Not eligible again until the backoff elapses.
      expect((await publisherWith(failing).publishAvailable()).claimed).toBe(0);

      await db.sql`update events.outbox set available_at = now() where event_id = ${event.id}`;
      await publisherWith(failing).publishAvailable();
      row = await outboxRow(event.id);
      expect(row?.attempt_count).toBe(2);
      const [second] = await db.sql<{ seconds: number }[]>`
        select extract(epoch from (available_at - now()))::float as seconds
          from events.outbox where event_id = ${event.id}`;
      expect(second?.seconds).toBeGreaterThan(8);

      // Once the dispatcher works, the row publishes and the error clears.
      await db.sql`update events.outbox set available_at = now() where event_id = ${event.id}`;
      expect((await publisherWith().publishAvailable()).published).toBe(1);
      row = await outboxRow(event.id);
      expect(row?.attempt_count).toBe(3);
      expect(row?.last_error).toBeNull();
    });

    it("stops selecting a row once its attempts are exhausted, leaving it inspectable", async () => {
      const event = await enqueueCommitted();
      const failing: EventDispatcher = {
        publish: () => Promise.reject(new Error("broker down")),
      };
      await db.sql`update events.outbox set attempt_count = 2 where event_id = ${event.id}`;

      const result = await publisherWith(failing, 3).publishAvailable();
      expect(result).toMatchObject({ claimed: 1, failed: 1, exhausted: 1 });
      expect(result.records[0]).toMatchObject({
        attempt: 3,
        exhausted: true,
        error: "Error",
      });

      await db.sql`update events.outbox set available_at = now() where event_id = ${event.id}`;
      // Even a working dispatcher does not pick it up any more.
      expect((await publisherWith(pgmq, 3).publishAvailable()).claimed).toBe(0);
      const row = await outboxRow(event.id);
      expect(row?.published_at).toBeNull();
      expect(row?.attempt_count).toBe(3);
      expect(row?.last_error).toBe("QUEUE_PUBLISH_FAILED: Error");
    });

    it("never publishes a persisted row that no longer validates, and stops retrying it", async () => {
      // Privileged setup only: bypass the writer to plant a row the current
      // registry cannot interpret.
      const poison = fixtureCreated({ type: "test.fixture.removed" });
      await db.sql`insert into events.outbox (event_id, event_type, event_version, payload)
        values (${poison.id}, ${poison.type}, 1, ${JSON.stringify(poison)}::text::jsonb)`;

      const first = await publisherWith(pgmq, 2).publishAvailable();
      expect(first.records[0]).toMatchObject({
        eventId: poison.id,
        outcome: "INVALID",
        error: "UNKNOWN_TYPE",
        attempt: 1,
        exhausted: false,
      });
      expect(await queueMessages(poison.id)).toHaveLength(0);
      expect((await outboxRow(poison.id))?.last_error).toBe(
        "EVENT_SCHEMA_INVALID: UNKNOWN_TYPE",
      );

      await db.sql`update events.outbox set available_at = now() where event_id = ${poison.id}`;
      const second = await publisherWith(pgmq, 2).publishAvailable();
      expect(second.records[0]).toMatchObject({
        outcome: "INVALID",
        attempt: 2,
        exhausted: true,
      });

      await db.sql`update events.outbox set available_at = now() where event_id = ${poison.id}`;
      expect((await publisherWith(pgmq, 2).publishAvailable()).claimed).toBe(0);
      expect(await queueMessages(poison.id)).toHaveLength(0);
    });

    it("delivers a message a consumer can read, validate and archive without pop", async () => {
      const event = await enqueueCommitted();
      await publisherWith().publishAvailable();

      const read = await db.sql<
        { msg_id: number; read_ct: number; message: unknown }[]
      >`
        select msg_id, read_ct, message from pgmq.read(${DOMAIN_EVENTS_QUEUE}, 1, 50)`;
      const ours = read.find(
        (m) => (m.message as { id?: string }).id === event.id,
      );
      expect(ours).toBeDefined();
      expect(ours?.read_ct).toBe(1);

      const parsed = registry.parse(ours?.message);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.message).toEqual(event);
      }

      const [archived] = await db.sql<{ archive: boolean }[]>`
        select pgmq.archive(${DOMAIN_EVENTS_QUEUE}, ${ours?.msg_id ?? -1}::bigint) as archive`;
      expect(archived?.archive).toBe(true);
      expect(await queueMessages(event.id)).toHaveLength(0);
      const inArchive = await db.sql`
        select 1 from pgmq.${db.sql(ARCHIVE_TABLE)} where message ->> 'id' = ${event.id}`;
      expect(inArchive).toHaveLength(1);
    });

    it("is healthy with nothing to do", async () => {
      await expect(publisherWith().publishAvailable()).resolves.toEqual({
        claimed: 0,
        published: 0,
        failed: 0,
        exhausted: 0,
        records: [],
      });
      // An empty production-style registry is equally fine.
      await expect(
        createOutboxPublisher({
          transactions: db.transactions,
          registry: createEventRegistry([]),
          dispatcher: pgmq,
        }).publishAvailable(),
      ).resolves.toMatchObject({ claimed: 0 });
    });
  });
});
