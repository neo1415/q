import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createPostgresMemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { createMemoryService } from "../src/memory/service.js";

/**
 * Memory against the real table (ADR 0012): the write gate's supersession
 * holds under the partial unique indexes, recall is owner- and
 * tenant-scoped, forgetting keeps the row, and nothing about another
 * tenant's person is ever readable.
 *
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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

describe("memory against local PostgreSQL", () => {
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

  async function person(
    tx: TransactionContext,
    label: string,
  ): Promise<ActorContext> {
    const tenantId = randomUUID();
    const authUserId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Memory ${label}`})`;
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    return ActorContextSchema.parse({
      userId: profile.id,
      tenantId,
      actorType: "HUMAN",
    });
  }

  async function withWorld(
    work: (world: {
      readonly tx: TransactionContext;
      readonly a: ActorContext;
      readonly b: ActorContext;
      readonly memory: ReturnType<typeof createMemoryService>;
    }) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await person(tx, "A");
        const b = await person(tx, "B");
        const memory = createMemoryService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          repository: createPostgresMemoryRepository(),
        });
        await work({ tx, a, b, memory });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const candidate = (
    content: string,
    quote: string,
    key = "preference.address_as",
  ) => ({
    memoryType: "preference" as const,
    memoryKey: key,
    content,
    quote,
    subject: null,
    structuredValue: {},
  });

  it("records, dedupes, supersedes and forgets under the table's own constraints", async () => {
    await withWorld(async ({ tx, a, memory }) => {
      const turns = ["please call me Dan", "actually, call me Daniel"];
      const first = await memory.remember({
        actor: a,
        candidate: candidate("Address them as Dan.", "call me Dan"),
        writeMode: "Q_PROPOSED",
        userTurns: turns,
        source: { conversationId: null, runId: null },
      });
      expect(first.outcome).toBe("REMEMBERED");
      const same = await memory.remember({
        actor: a,
        candidate: candidate("address them as dan.", "call me Dan"),
        writeMode: "Q_PROPOSED",
        userTurns: turns,
        source: { conversationId: null, runId: null },
      });
      expect(same.outcome).toBe("UNCHANGED");
      const second = await memory.remember({
        actor: a,
        candidate: candidate("Address them as Daniel.", "call me Daniel"),
        writeMode: "Q_PROPOSED",
        userTurns: turns,
        source: { conversationId: null, runId: null },
      });
      expect(second).toMatchObject({
        outcome: "REMEMBERED",
        reason: "SUPERSEDED_EARLIER",
      });

      const rows = await tx.sql<
        { status: string; content: string; superseded_by: string | null }[]
      >`select status, content, superseded_by from q_knowledge.memory_items
         where owner_context_id = ${a.userId} order by content`;
      expect(rows.map((r) => [r.status, r.content])).toEqual([
        ["superseded", "Address them as Dan."],
        ["active", "Address them as Daniel."],
      ]);
      expect(rows[0]?.superseded_by).not.toBeNull();

      const recalled = await memory.recall({ actor: a });
      expect(recalled.person.map((i) => i.content)).toEqual([
        "Address them as Daniel.",
      ]);

      if (second.outcome !== "REMEMBERED") return;
      const forgotten = await memory.forget({
        actor: a,
        memoryItemId: second.item.id,
      });
      expect(forgotten?.status).toBe("forgotten");
      expect((await memory.recall({ actor: a })).person).toEqual([]);
      // History stays: nothing was deleted.
      const counted = await tx.sql<
        { n: number }[]
      >`select count(*)::int as n from q_knowledge.memory_items where owner_context_id = ${a.userId}`;
      expect(counted[0]?.n).toBe(2);
    });
  });

  it("never recalls another person's memory, in the same or another tenant", async () => {
    await withWorld(async ({ a, b, memory }) => {
      await memory.remember({
        actor: a,
        candidate: candidate("Address them as Dan.", "call me Dan"),
        writeMode: "Q_PROPOSED",
        userTurns: ["call me Dan"],
        source: { conversationId: null, runId: null },
      });
      expect((await memory.recall({ actor: b })).person).toEqual([]);
      const sameTenantOther = ActorContextSchema.parse({
        userId: b.userId,
        tenantId: a.tenantId,
        actorType: "HUMAN",
      });
      expect((await memory.recall({ actor: sameTenantOther })).person).toEqual(
        [],
      );
      // Forgetting somebody else's memory is a no-op, not an error.
      const mine = (await memory.recall({ actor: a })).person[0];
      expect(mine).toBeDefined();
      if (mine === undefined) return;
      expect(
        await memory.forget({ actor: b, memoryItemId: mine.id }),
      ).toBeNull();
      expect((await memory.recall({ actor: a })).person).toHaveLength(1);
    });
  });
});
