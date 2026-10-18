import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import { UserIdSchema, type UserId } from "../src/identity/ids.js";
import {
  PersonProfileNotFoundError,
  PersonProfileVersionConflictError,
} from "../src/identity/person-profile.js";
import { createPostgresPersonProfileStore } from "../src/postgres/person-profile-store.js";

/**
 * The person-profile store (BIZ-002) against the real local database: the
 * one write path the profile page and Q's approved person.profile.update
 * share. Every test runs in a transaction that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("PostgresPersonProfileStore", () => {
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

  async function rolledBack(
    work: (
      tx: TransactionContext,
      people: { readonly a: UserId; readonly b: UserId },
    ) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const authA = randomUUID();
        const authB = randomUUID();
        // The auth trigger creates exactly one application profile each.
        await tx.sql`insert into auth.users (id) values (${authA}), (${authB})`;
        const rows = await tx.sql<{ id: string; auth_user_id: string }[]>`
          select id, auth_user_id from identity.user_profiles
           where auth_user_id in (${authA}, ${authB})`;
        const a = UserIdSchema.parse(
          rows.find((row) => row.auth_user_id === authA)?.id,
        );
        const b = UserIdSchema.parse(
          rows.find((row) => row.auth_user_id === authB)?.id,
        );
        await work(tx, { a, b });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  it("reads a new person as version 1 with nothing stated", async () => {
    await rolledBack(async (tx, { a }) => {
      const store = createPostgresPersonProfileStore({ sql: tx.sql });
      const profile = await store.read(a);
      expect(profile).toMatchObject({ userId: a, headline: null, version: 1 });
    });
  });

  it("applies a change at the version read, and increments it", async () => {
    await rolledBack(async (tx, { a, b }) => {
      const store = createPostgresPersonProfileStore({ sql: tx.sql });
      const updated = await store.update({
        userId: a,
        expectedVersion: 1,
        changes: { displayName: "Ada", headline: "Founder, Kivu Freight" },
      });
      expect(updated).toMatchObject({
        displayName: "Ada",
        headline: "Founder, Kivu Freight",
        version: 2,
      });
      // Nobody else moved.
      expect((await store.read(b))?.version).toBe(1);

      // Clearing the headline is an explicit, versioned change.
      const cleared = await store.update({
        userId: a,
        expectedVersion: 2,
        changes: { headline: null },
      });
      expect(cleared).toMatchObject({
        displayName: "Ada",
        headline: null,
        version: 3,
      });
    });
  });

  it("refuses a stale change that would overwrite a newer one", async () => {
    await rolledBack(async (tx, { a }) => {
      const store = createPostgresPersonProfileStore({ sql: tx.sql });
      await store.update({
        userId: a,
        expectedVersion: 1,
        changes: { headline: "Angel investor" },
      });
      await expect(
        store.update({
          userId: a,
          expectedVersion: 1,
          changes: { headline: "Something else" },
        }),
      ).rejects.toBeInstanceOf(PersonProfileVersionConflictError);
      const [row] = await tx.sql<{ headline: string; version: number }[]>`
        select headline, version from identity.user_profiles where id = ${a}`;
      expect(row).toEqual({ headline: "Angel investor", version: 2 });
    });
  });

  it("treats a replay of a change that already landed as success, spending no version", async () => {
    await rolledBack(async (tx, { a }) => {
      const store = createPostgresPersonProfileStore({ sql: tx.sql });
      const first = await store.update({
        userId: a,
        expectedVersion: 1,
        changes: { displayName: "Ada" },
      });
      const replay = await store.update({
        userId: a,
        expectedVersion: 1,
        changes: { displayName: "Ada" },
      });
      expect(replay.version).toBe(first.version);
      expect(replay.version).toBe(2);
    });
  });

  it("does not read or write a suspended profile", async () => {
    await rolledBack(async (tx, { a }) => {
      const store = createPostgresPersonProfileStore({ sql: tx.sql });
      await tx.sql`update identity.user_profiles set status = 'suspended' where id = ${a}`;
      expect(await store.read(a)).toBeNull();
      await expect(
        store.update({
          userId: a,
          expectedVersion: 1,
          changes: { displayName: "Ada" },
        }),
      ).rejects.toBeInstanceOf(PersonProfileNotFoundError);
    });
  });
});
