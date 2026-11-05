import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import {
  CONVERSATION_LEDGER_BUILDER_VERSION,
  CONVERSATION_SUMMARY_GATE_VERSION,
  createPostgresQRuntimeRepositories,
  type QConversationState,
} from "../src/index.js";

/**
 * Q intelligence step 2: the conversation state store against real local
 * PostgreSQL, in one rolled-back transaction. The owner reads and writes
 * their own state; another person -- in another tenant, or the same one --
 * reads nothing of it and cannot write over it; a stale writer writes
 * nothing; summaries are revisions, in order.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

async function person(
  tx: TransactionContext,
  tenantId: string,
): Promise<string> {
  const authUserId = randomUUID();
  await tx.sql`insert into auth.users (id) values (${authUserId})`;
  const [profile] = await tx.sql<
    { id: string }[]
  >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
  if (profile === undefined) throw new Error("profile trigger did not run");
  void tenantId;
  return profile.id;
}

describe("conversation states, against local PostgreSQL", () => {
  let db: RequestDatabase;
  const repositories = createPostgresQRuntimeRepositories();
  const states = repositories.conversationStates;

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

  it("keeps a state for its owner only, versioned, with summaries in order", async () => {
    if (states === undefined) throw new Error("no state store composed");
    let checked = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantA = randomUUID();
        const tenantB = randomUUID();
        await tx.sql`insert into identity.tenants (id, name) values
          (${tenantA}, 'State tenant A'), (${tenantB}, 'State tenant B')`;
        const owner = await person(tx, tenantA);
        const other = await person(tx, tenantB);
        const sameTenantOther = await person(tx, tenantA);
        const conversationId = randomUUID();
        await tx.sql`insert into q_runtime.conversations (id, tenant_id, user_id, context_type)
          values (${conversationId}, ${tenantA}, ${owner}, 'PERSONAL')`;

        const first: QConversationState = {
          conversationId,
          tenantId: tenantA,
          userId: owner,
          ledger: {
            entities: [
              {
                ref: "E1",
                kind: "COMPANY",
                id: null,
                name: "Silo Credit",
                firstTurn: 1,
                lastTurn: 1,
                via: ["SAID_BY_THEM"],
                of: null,
                value: null,
              },
            ],
            lists: [],
          },
          openThreads: [],
          throughMessageAt: new Date().toISOString(),
          throughMessageId: randomUUID(),
          messagesFolded: 1,
          builderVersion: CONVERSATION_LEDGER_BUILDER_VERSION,
          version: 0,
        };
        expect(await states.save(tx, first)).toBe(true);
        const read = await states.find(
          tx.sql,
          tenantA as TenantId,
          owner as UserId,
          conversationId,
        );
        expect(read?.ledger.entities[0]?.name).toBe("Silo Credit");
        expect(read?.version).toBe(1);

        // A second writer from the same starting point writes nothing.
        expect(await states.save(tx, first)).toBe(false);
        expect(
          await states.save(tx, { ...first, version: 1, messagesFolded: 2 }),
        ).toBe(true);
        expect(
          await states.save(tx, { ...first, version: 1, messagesFolded: 3 }),
        ).toBe(false);

        // Another tenant's person, and another person in the same tenant,
        // read nothing of it and write nothing over it.
        expect(
          await states.find(
            tx.sql,
            tenantB as TenantId,
            other as UserId,
            conversationId,
          ),
        ).toBeNull();
        expect(
          await states.find(
            tx.sql,
            tenantA as TenantId,
            sameTenantOther as UserId,
            conversationId,
          ),
        ).toBeNull();
        expect(
          await states.save(tx, {
            ...first,
            userId: sameTenantOther,
            version: 2,
          }),
        ).toBe(false);

        const append = (summary: string) =>
          states.appendSummary(tx, {
            tenantId: tenantA as TenantId,
            userId: owner as UserId,
            conversationId,
            summary,
            coversThroughAt: new Date().toISOString(),
            coveredMessages: 4,
            gateVersion: CONVERSATION_SUMMARY_GATE_VERSION,
          });
        expect(await append("They asked about Silo Credit.")).toBe(1);
        expect(await append("Correction: Ledgerline meant Ledgerfold.")).toBe(
          2,
        );
        const latest = await states.latestSummary(
          tx.sql,
          tenantA as TenantId,
          owner as UserId,
          conversationId,
        );
        expect(latest?.revision).toBe(2);
        expect(latest?.summary).toMatch(/Ledgerfold/u);
        expect(
          await states.latestSummary(
            tx.sql,
            tenantB as TenantId,
            other as UserId,
            conversationId,
          ),
        ).toBeNull();
        checked = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(checked).toBe(true);
  });
});
