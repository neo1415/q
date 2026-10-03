import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { handleEverythingGrant } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createPostgresInstructionStore,
  grantHash,
} from "../src/composition/instructions/store.js";

/**
 * ADR 0043 against the local database, inside ONE transaction that is
 * always rolled back: the migration is applied in it when the database does
 * not have it yet, so nothing here outlives the test.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261121090000_standing_instructions.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

describe("standing instructions against PostgreSQL", () => {
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

  it("activates once per approval, versions on change, stops, and stays the owner's", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [present] = await tx<{ found: string | null }[]>`
          select to_regclass('q_runtime.standing_instructions')::text as found`;
        if (present?.found === null) await tx.file(MIGRATION);

        const tenant = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Instruction tenant')`;
        const users: string[] = [];
        for (let index = 0; index < 2; index += 1) {
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@instr.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          users.push(profile?.id ?? "");
        }
        const [ada = "", ben = ""] = users;
        const owner = { tenantId: tenant, userId: ada, organisationId: null };
        const store = createPostgresInstructionStore(tx);
        const grant = handleEverythingGrant({ timeZone: "Europe/London" });
        const approval = randomUUID();

        const first = await store.activate({
          owner,
          qActionId: approval,
          instructionId: undefined,
          goal: "Handle all the work for me",
          grant,
        });
        expect(first?.version).toBe(1);
        // A replayed approval finds the same instruction, never a second one.
        const replay = await store.activate({
          owner,
          qActionId: approval,
          instructionId: undefined,
          goal: "Handle all the work for me",
          grant,
        });
        expect(replay?.instructionId).toBe(first?.instructionId);
        const id = first?.instructionId ?? "";
        expect(
          await store.list({ tenantId: tenant, userId: ada }),
        ).toHaveLength(1);

        const [granted] = await tx<{ payload_hash: string }[]>`
          select payload_hash from q_runtime.instruction_grants where instruction_id = ${id}`;
        expect(granted?.payload_hash).toBe(grantHash(grant));

        // Someone else cannot change, read or stop it.
        const ben$ = { tenantId: tenant, userId: ben, organisationId: null };
        expect(
          await store.activate({
            owner: ben$,
            qActionId: randomUUID(),
            instructionId: id,
            goal: "x",
            grant,
          }),
        ).toBeNull();
        expect(await store.own(ben$, id)).toBeNull();
        expect(await store.stop(ben$, id)).toBe(false);

        // A changed grant is the next version, approved on its own.
        const second = await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: id,
          goal: "Handle all the work for me",
          grant: { ...grant, maxMessagesPerCounterpart: 4 },
        });
        expect(second).toEqual({ instructionId: id, version: 2 });
        const row = await store.own(owner, id);
        expect(row?.grant_version).toBe(2);
        expect(row?.status).toBe("ACTIVE");

        // Grants are append-only.
        await expect(
          tx.savepoint(
            (sp: typeof tx) =>
              sp`update q_runtime.instruction_grants set payload_hash = ${grantHash(grant)} where instruction_id = ${id} and version = 2`,
          ),
        ).rejects.toThrow(/append-only/u);

        expect(await store.stop(owner, id)).toBe(true);
        expect((await store.own(owner, id))?.status).toBe("STOPPED");
        expect(await store.stop(owner, id)).toBe(false);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
