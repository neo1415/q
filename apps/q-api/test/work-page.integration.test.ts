import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  QWorkDonePageDtoSchema,
  QWorkDtoSchema,
  QWorkSuggestionListDtoSchema,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createPostgresInstructionStore } from "../src/composition/instructions/store.js";
import { createWorkPort } from "../src/composition/work/actions.js";
import { createWorkPage } from "../src/composition/work/page.js";
import { createPostgresWorkStore } from "../src/composition/work/store.js";
import { createWorkActionBoard } from "../src/composition/work/actions.js";

/**
 * WORK-58 against the local database, inside ONE transaction that is always
 * rolled back (the dismissal migration is applied in it when missing):
 * Running fields, the person's own pause and resume, Not now, and the done
 * page with its links -- each the owner's own and nobody else's.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const DISMISSALS = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261204090000_work_suggestion_dismissals.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

describe("Q's work page against PostgreSQL (WORK-58)", () => {
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

  it("lists running fields, pauses and resumes only the owner's, remembers Not now, pages what is done", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [present] = await tx<{ found: string | null }[]>`
          select to_regclass('q_runtime.work_suggestion_dismissals')::text as found`;
        if (present?.found === null) await tx.file(DISMISSALS);

        const tenant = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Work tenant')`;
        const users: string[] = [];
        for (let index = 0; index < 2; index += 1) {
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@work.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          users.push(profile?.id ?? "");
        }
        const [ada = "", ben = ""] = users;
        const actor = {
          tenantId: tenant,
          userId: ada,
          organisationId: null,
        } as unknown as ActorContext;
        const other = {
          tenantId: tenant,
          userId: ben,
          organisationId: null,
        } as unknown as ActorContext;

        const id = randomUUID();
        await tx`
          insert into q_runtime.standing_instructions
            (id, tenant_id, user_id, goal_text, status, grant_version, spent_usd_month, budget_usd_month, next_fire_at)
          values (${id}, ${tenant}, ${ada}, 'Keep my founder conversations moving', 'ACTIVE', 1, 1.843210, 5.00, now())`;
        await tx`
          insert into q_runtime.instruction_grants (tenant_id, instruction_id, version, grant_payload, payload_hash)
          values (${tenant}, ${id}, 1, '{"actions": []}', ${`sha256:${"c".repeat(64)}`})`;
        await tx`
          insert into q_runtime.instruction_steps
            (tenant_id, user_id, instruction_id, grant_version, run_key, step_index, action, mode, status, words, idempotency_key)
          values (${tenant}, ${ada}, ${id}, 1, 'run:work5801', 0, 'chat.message.send', 'AUTO', 'DONE',
                  'Replied to Tallyloom.', ${`instruction:${id}:w58:0`})`;

        const instructions = createPostgresInstructionStore(tx);
        const work = createWorkPort({
          store: createPostgresWorkStore(tx),
          instructions,
          board: createWorkActionBoard(),
          isInvestor: () => Promise.resolve(true),
          ownCompany: () => Promise.resolve(null),
        });

        // Running fields, structured and contract-valid.
        const [listed] = await work.list(actor);
        const dto = QWorkDtoSchema.parse(listed);
        expect(dto.goal).toBe("Keep my founder conversations moving");
        expect(dto.run).toEqual({ state: "WORKING", pauseReason: null });
        expect(dto.lastStep?.words).toBe("Replied to Tallyloom.");
        expect(dto.spend).toEqual({
          spentUsdMonth: "1.84",
          budgetUsdMonth: "5.00",
        });
        expect(await work.list(other)).toEqual([]);

        // Pause: only the owner's; due never while paused.
        expect(await work.pause(other, id)).toBe(false);
        expect(await work.pause(actor, id)).toBe(true);
        expect(await work.pause(actor, id)).toBe(false);
        const [paused] = await tx<
          { status: string; pause_reason: string; next_fire_at: Date | null }[]
        >`select status, pause_reason, next_fire_at from q_runtime.standing_instructions where id = ${id}`;
        expect(paused).toMatchObject({
          status: "PAUSED",
          pause_reason: "PAUSED_BY_YOU",
          next_fire_at: null,
        });
        expect((await work.list(actor))[0]?.run).toEqual({
          state: "PAUSED",
          pauseReason: "PAUSED_BY_YOU",
        });

        // A budget pause is not theirs to resume with a tap.
        await tx`update q_runtime.standing_instructions set pause_reason = 'BUDGET_EXHAUSTED' where id = ${id}`;
        expect(await work.resume(actor, id)).toBe(false);
        await tx`update q_runtime.standing_instructions set pause_reason = 'PAUSED_BY_YOU' where id = ${id}`;
        expect(await work.resume(other, id)).toBe(false);
        expect(await work.resume(actor, id)).toBe(true);
        const [resumed] = await tx<
          { status: string; next_fire_at: Date | null }[]
        >`select status, next_fire_at from q_runtime.standing_instructions where id = ${id}`;
        expect(resumed?.status).toBe("ACTIVE");
        expect(resumed?.next_fire_at).not.toBeNull();

        // Suggestions run against the real tables; Not now is remembered.
        const relationshipId = randomUUID();
        const kazikit = randomUUID();
        const page = createWorkPage({
          sql: tx,
          reads: {
            relationships: () =>
              Promise.resolve([
                {
                  relationshipId,
                  counterpartKind: "COMPANY" as const,
                  counterpartId: kazikit,
                  name: "Kazikit",
                  nextStep: "AWAIT_ANSWER",
                  stateSince: new Date(
                    Date.now() - 6 * 86_400_000,
                  ).toISOString(),
                },
              ]),
            feed: () => Promise.resolve([{ companyId: randomUUID() }]),
            decisions: () => Promise.resolve([]),
            investorOrganisation: () => Promise.resolve(randomUUID()),
            ownCompany: () => Promise.resolve(null),
          },
        });
        const first = QWorkSuggestionListDtoSchema.parse({
          items: await page.suggestions(actor),
        });
        expect(first.items.map((item) => item.kind)).toEqual([
          "STALLED_REPLY",
          "NEW_MATCHES",
        ]);
        const stalled = first.items[0]?.key ?? "";
        await tx`
          insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
          values (${tenant}, ${ada}, ${stalled}) on conflict (user_id, suggestion_key) do nothing`;
        expect(
          (await page.suggestions(actor)).map((item) => item.kind),
        ).toEqual(["NEW_MATCHES"]);
        // Someone else's Not now changes nothing for them.
        expect(
          (await page.suggestions(other)).map((item) => item.kind),
        ).toContain("STALLED_REPLY");

        // Done: newest first, cursor-paged, nobody else's.
        for (let index = 1; index <= 3; index += 1) {
          await tx`
            insert into q_runtime.instruction_steps
              (tenant_id, user_id, instruction_id, grant_version, run_key, step_index, action, mode, status, words, idempotency_key, created_at)
            values (${tenant}, ${ada}, ${id}, 1, 'run:work5802', ${index}, 'chat.message.send', 'AUTO', 'DONE',
                    ${`Step ${String(index)}`}, ${`instruction:${id}:w58:${String(index)}`},
                    now() + make_interval(secs => ${index}))`;
        }
        const one = QWorkDonePageDtoSchema.parse(
          await page.done(actor, { limit: 2 }),
        );
        expect(one.items.map((item) => item.words)).toEqual([
          "Step 3",
          "Step 2",
        ]);
        expect(one.thisWeek).toBe(4);
        expect(one.items[0]?.linkPath).toBeNull();
        const two = await page.done(actor, {
          cursor: one.nextCursor ?? undefined,
          limit: 2,
        });
        expect(two.items.map((item) => item.words)).toEqual([
          "Step 1",
          "Replied to Tallyloom.",
        ]);
        expect(two.nextCursor).toBeNull();
        expect((await page.done(other, {})).items).toEqual([]);
        // A malformed cursor starts from the first page.
        expect(
          (await page.done(actor, { cursor: "not-a-cursor", limit: 1 }))
            .items[0]?.words,
        ).toBe("Step 3");

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
