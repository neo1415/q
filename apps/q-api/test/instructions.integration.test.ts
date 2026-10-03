import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { handleEverythingGrant } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createOpenerFacts } from "../src/voice/returning-opener.js";
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

const CONVERSATION_MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261122090000_instruction_conversation.sql",
    import.meta.url,
  ),
);

const TRIGGERS_MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261123090000_instruction_triggers.sql",
    import.meta.url,
  ),
);

const DIGEST_MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261124090000_instruction_digest.sql",
    import.meta.url,
  ),
);

const NOTED_MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261125090000_instruction_noted_steps.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

type Tx = Parameters<
  Parameters<RequestDatabase["transactions"]["run"]>[0]
>[0]["sql"];

/** The instruction migrations, applied inside the rolled-back transaction when missing. */
async function ensureMigrations(tx: Tx): Promise<void> {
  const [present] = await tx<{ found: string | null }[]>`
      select to_regclass('q_runtime.standing_instructions')::text as found`;
  if (present?.found === null) await tx.file(MIGRATION);
  const [column] = await tx<{ found: number }[]>`
      select count(*)::int as found from information_schema.columns
       where table_schema = 'q_runtime' and table_name = 'standing_instructions'
         and column_name = 'conversation_id'`;
  if (column?.found === 0) await tx.file(CONVERSATION_MIGRATION);
  const [cadence] = await tx<{ found: number }[]>`
      select count(*)::int as found from information_schema.columns
       where table_schema = 'q_runtime' and table_name = 'standing_instructions'
         and column_name = 'next_fire_at'`;
  if (cadence?.found === 0) await tx.file(TRIGGERS_MIGRATION);
  const [digestColumn] = await tx<{ found: number }[]>`
      select count(*)::int as found from information_schema.columns
       where table_schema = 'q_runtime' and table_name = 'standing_instructions'
         and column_name = 'last_digest_at'`;
  if (digestColumn?.found === 0) await tx.file(DIGEST_MIGRATION);
  // Re-applied inside this rolled-back transaction: it only widens a check.
  await tx.file(NOTED_MIGRATION);
}

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
        await ensureMigrations(tx);

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

        // S4: due at once after approval; a claim moves it a cadence on.
        // Other ACTIVE rows in this database are pushed out of the way first.
        await tx`update q_runtime.standing_instructions
                    set next_fire_at = now() + interval '1 day'
                  where status = 'ACTIVE' and id <> ${id}`;
        const claimed = await store.claimDue(10);
        expect(claimed.map((claim) => claim.id)).toEqual([id]);
        expect(await store.claimDue(10)).toEqual([]);
        await store.defer(id, 30);
        expect(await store.claimDue(10)).toEqual([]);
        const touched = randomUUID();
        expect(await store.wakeFor(touched)).toBe(0);
        const live = await store.instruction(id);
        if (live === null) throw new Error("no instruction");
        await store.recordStep({
          instruction: live,
          runKey: "run-wake-01",
          stepIndex: 0,
          action: "chat.message.send",
          mode: "ASK",
          status: "ASKED",
          relationshipId: touched,
          words: "Asked to say hello.",
          reasonCode: null,
          qActionId: null,
          idempotencyKey: `instr:${id}:run-wake-01:0`,
        });
        expect(await store.wakeFor(touched)).toBe(1);
        expect((await store.claimDue(10)).map((claim) => claim.id)).toEqual([
          id,
        ]);

        // S5: spend adds up; a new month starts at zero; pause is once.
        await store.addSpend(id, 0.012345);
        await store.addSpend(id, 0.01);
        expect((await store.own(owner, id))?.spent_this_month).toBe("0.022345");
        await tx`update q_runtime.standing_instructions
                    set budget_month = date '2026-01-01' where id = ${id}`;
        expect((await store.own(owner, id))?.spent_this_month).toBe("0");
        await store.addSpend(id, 0.5);
        expect((await store.own(owner, id))?.spent_this_month).toBe("0.500000");
        expect(await store.pause(id, "BUDGET_EXHAUSTED")).toBe(true);
        expect(await store.pause(id, "BUDGET_EXHAUSTED")).toBe(false);
        expect(await store.claimDue(10)).toEqual([]);
        // A yes on the continuation card: the next version, ACTIVE again.
        const resumed = await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: id,
          goal: "Handle all the work for me",
          grant: { ...grant, budgetUsdMonth: "10.00" },
        });
        expect(resumed?.version).toBe(3);
        expect((await store.own(owner, id))?.status).toBe("ACTIVE");

        // S7: a digest is due a day after the last one (or creation),
        // claimed once; a NEEDS_YOU notice is written once per key.
        await tx`update q_runtime.standing_instructions
                    set last_digest_at = now() + interval '1 day'
                  where id <> ${id} and status in ('ACTIVE', 'PAUSED')`;
        expect(await store.claimDigestDue(10)).toEqual([]);
        await tx`update q_runtime.standing_instructions
                    set last_digest_at = now() - interval '25 hours' where id = ${id}`;
        const digests = await store.claimDigestDue(10);
        expect(digests.map((claim) => claim.id)).toEqual([id]);
        expect(await store.claimDigestDue(10)).toEqual([]);
        expect(
          (await store.stepsSince(id, digests[0]?.since ?? new Date(0))).length,
        ).toBeGreaterThan(0);
        const live2 = await store.instruction(id);
        if (live2 === null) throw new Error("no instruction");
        const notice = {
          instruction: live2,
          key: "run-0001:needs",
          title: "1 thing needs your yes",
          body: "- Ask Acme.",
          priority: "NEEDS_YOU" as const,
        };
        expect(await store.notify(notice)).toBe(true);
        expect(await store.notify(notice)).toBe(false);
        // The opener reads it back for them.
        const facts = await createOpenerFacts({ sql: tx })({
          userId: ada,
          tenantId: tenant,
        } as never);
        expect(facts.instructionNews).toContain("1 thing needs your yes");

        expect(await store.stop(owner, id)).toBe(true);
        expect((await store.own(owner, id))?.status).toBe("STOPPED");
        expect(await store.stop(owner, id)).toBe(false);

        // Steps: once per key, counted per person for the message cap.
        const instruction = await store.instruction(id);
        if (instruction === null) throw new Error("no instruction");
        const relationship = randomUUID();
        const step = {
          instruction,
          runKey: "run-0001",
          stepIndex: 0,
          action: "chat.message.send",
          mode: "AUTO" as const,
          status: "DONE" as const,
          relationshipId: relationship,
          words: "Said hello.",
          reasonCode: null,
          qActionId: null,
          idempotencyKey: `instr:${id}:run-0001:0`,
        };
        expect(await store.recordStep(step)).toBe(true);
        expect(
          await store.recordStep({
            ...step,
            status: "NOTED",
            action: "q.note",
            relationshipId: null,
            words: "Waiting for your working hours.",
            idempotencyKey: `instr:${id}:note-hours:2026-10-03`,
          }),
        ).toBe(true);
        expect(await store.recordStep(step)).toBe(false);
        expect(await store.stepDone(step.idempotencyKey)).toBe(true);
        expect((await store.messagesSent(id)).get(relationship)).toBe(1);
        expect(await store.history(id)).toHaveLength(3);
        expect(await store.steps(ben$, id)).toHaveLength(0);
        // Stopped: no wake, no claim, even with a step on the relationship.
        expect(await store.wakeFor(relationship)).toBe(0);
        await store.setConversation(id, randomUUID());
        expect((await store.own(owner, id))?.conversation_id).not.toBeNull();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("a chat message wakes the ACTIVE instructions covering it on the receiving side only (QA run 8a1d57b9)", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        await ensureMigrations(tx);
        const ids = {
          tenantCo: randomUUID(),
          tenantInv: randomUUID(),
          orgCo: randomUUID(),
          orgInv: randomUUID(),
          company: randomUUID(),
          investor: randomUUID(),
          relationship: randomUUID(),
          conversation: randomUUID(),
        };
        const users: string[] = [];
        for (const [tenant, org, type] of [
          [ids.tenantCo, ids.orgCo, "company"],
          [ids.tenantInv, ids.orgInv, "investment_firm"],
        ] as const) {
          await tx`insert into identity.tenants (id, name) values (${tenant}, ${`Wake ${type}`})`;
          await tx`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, ${type}, ${`Wake ${type}`}, ${`wake-${org.slice(0, 8)}`})`;
          await tx`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@wake.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          await tx`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
            values (${tenant}, ${org}, ${profile?.id ?? ""}, 'active')`;
          users.push(profile?.id ?? "");
        }
        const [founder = "", investor = ""] = users;
        await tx`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Clinicrest', ${`clinicrest-${ids.company.slice(0, 8)}`})`;
        await tx`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Savanna Seed')`;
        await tx`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
          values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
        await tx`insert into communication.conversations (id, tenant_id, relationship_id)
          values (${ids.conversation}, ${ids.tenantCo}, ${ids.relationship})`;
        const say = async (side: "COMPANY" | "INVESTOR", key: string) => {
          await tx`insert into communication.messages
              (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
            values (${ids.tenantCo}, ${ids.conversation}, ${side === "COMPANY" ? founder : investor},
                    ${side}, 'TEXT', 'What is your typical cheque size and do you lead?', ${key})`;
        };

        const store = createPostgresInstructionStore(tx);
        const owner = {
          tenantId: ids.tenantInv,
          userId: investor,
          organisationId: ids.orgInv,
        };
        const grant = handleEverythingGrant({
          timeZone: "Europe/London",
          side: "INVESTOR",
        });
        const live = await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: undefined,
          goal: "Handle my founders",
          grant,
        });
        const id = live?.instructionId ?? "";
        const later = async () => {
          await tx`update q_runtime.standing_instructions
                      set next_fire_at = now() + interval '4 hours' where id = ${id}`;
        };
        const due = async () =>
          (
            await tx<{ due: boolean }[]>`
              select next_fire_at <= clock_timestamp() as due
                from q_runtime.standing_instructions where id = ${id}`
          )[0]?.due;

        // The founder writes: the investor's instruction is due at once.
        await say("COMPANY", "wake-msg-0001");
        await later();
        expect(await store.wakeForChat(ids.relationship)).toBe(1);
        expect(await due()).toBe(true);
        // Their own side wrote last: nothing to answer, nothing woken.
        await say("INVESTOR", "wake-msg-0002");
        await later();
        expect(await store.wakeForChat(ids.relationship)).toBe(0);
        expect(await due()).toBe(false);
        // A relationship the grant leaves out, or a listed scope without
        // it, wakes nothing.
        await say("COMPANY", "wake-msg-0003");
        const excluded = await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: id,
          goal: "Handle my founders",
          grant: {
            ...grant,
            counterparts: {
              ...grant.counterparts,
              exclude: [{ counterpartId: ids.company, name: "Clinicrest" }],
            },
          },
        });
        expect(excluded?.version).toBe(2);
        await later();
        expect(await store.wakeForChat(ids.relationship)).toBe(0);
        await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: id,
          goal: "Handle my founders",
          grant: {
            ...grant,
            counterparts: {
              scope: "LISTED",
              relationshipIds: [ids.relationship],
              includeNewCompanies: false,
              exclude: [],
            },
          },
        });
        await later();
        expect(await store.wakeForChat(ids.relationship)).toBe(1);
        // Paused or stopped: never woken, never due, never claimed --
        // even with a firing time in the past (QA run 8a1d57b9).
        const nextFire = async () =>
          (
            await tx<{ next_fire_at: Date | null }[]>`
              select next_fire_at from q_runtime.standing_instructions where id = ${id}`
          )[0]?.next_fire_at;
        await tx`update q_runtime.standing_instructions
                    set next_fire_at = now() + interval '1 day'
                  where status = 'ACTIVE' and id <> ${id}`;
        expect(await store.pause(id, "BUDGET_EXHAUSTED")).toBe(true);
        expect(await nextFire()).toBeNull();
        expect(await store.wakeForChat(ids.relationship)).toBe(0);
        await tx`update q_runtime.standing_instructions
                    set next_fire_at = now() - interval '1 hour' where id = ${id}`;
        expect(await store.claimDue(10)).toEqual([]);
        expect(await store.stop(owner, id)).toBe(true);
        expect(await nextFire()).toBeNull();
        expect(await store.wakeForChat(ids.relationship)).toBe(0);
        expect(await store.wakeFor(ids.relationship)).toBe(0);
        await tx`update q_runtime.standing_instructions
                    set next_fire_at = now() - interval '1 hour' where id = ${id}`;
        expect(await store.claimDue(10)).toEqual([]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("a 'needs your yes' notice is resolved once its cards are answered, and every one on stop (QA run 8a1d57b9)", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        await ensureMigrations(tx);
        const tenant = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Needs tenant')`;
        const authId = randomUUID();
        await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@needs.example.invalid`})`;
        const [profile] = await tx<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        const userId = profile?.id ?? "";
        const owner = { tenantId: tenant, userId, organisationId: null };
        const store = createPostgresInstructionStore(tx);
        const live = await store.activate({
          owner,
          qActionId: randomUUID(),
          instructionId: undefined,
          goal: "Handle my investors",
          grant: handleEverythingGrant({ timeZone: "Europe/London" }),
        });
        const id = live?.instructionId ?? "";
        const row = await store.instruction(id);
        if (row === null) throw new Error("no instruction");
        const [run] = await tx<{ id: string }[]>`
          insert into q_runtime.runs (tenant_id, actor_user_id, objective, capability,
                                      consequence_class, correlation_id)
          values (${tenant}, ${userId}, 'Instruction cards', 'PREPARE_ACTION', 'LOW',
                  ${`cor_${randomUUID()}`})
          returning id`;
        const card = async (status: string) => {
          const actionId = randomUUID();
          await tx`
            insert into q_runtime.actions
              (id, tenant_id, run_id, proposed_by_user_id, action_type, action_version,
               risk_class, target_refs, proposed_payload, proposed_payload_hash, summary,
               status, idempotency_key)
            values (${actionId}, ${tenant}, ${run?.id ?? ""}, ${userId}, 'app.chat.message.send', 1,
                    'CONFIRM_REQUIRED', ${tx.json([{ type: "relationship", id: randomUUID() }])},
                    ${tx.json({})}, ${`sha256:${"a".repeat(64)}`}, 'Send this message',
                    ${status}, ${`q_action:${run?.id ?? ""}:${actionId}`})`;
          return actionId;
        };
        const ask = async (runKey: string, actionId: string, index: number) => {
          await store.recordStep({
            instruction: row,
            runKey,
            stepIndex: index,
            action: "chat.message.send",
            mode: "ASK",
            status: "ASKED",
            relationshipId: null,
            words: "Waiting for your yes: say hello.",
            reasonCode: null,
            qActionId: actionId,
            idempotencyKey: `instr:${id}:${runKey}:${String(index)}`,
          });
          await store.notify({
            instruction: row,
            key: `${runKey}:needs`,
            title: "Things need your yes",
            body: "- Say hello.",
            priority: "NEEDS_YOU",
          });
        };
        const unread = async (runKey: string) =>
          (
            await tx<{ unread: boolean }[]>`
              select read_at is null as unread from communication.notifications
               where dedupe_key = ${`instr:${id}:${runKey}:needs`}`
          )[0]?.unread;

        // One card still waiting, one rejected: the notice stays.
        await ask("run-needs-01", await card("AWAITING_APPROVAL"), 0);
        await ask("run-needs-01", await card("REJECTED"), 1);
        // Every card of this run answered (rejected, withdrawn): resolved.
        await ask("run-needs-02", await card("REJECTED"), 0);
        await ask("run-needs-02", await card("WITHDRAWN"), 1);
        await store.resolveAnswered();
        expect(await unread("run-needs-01")).toBe(true);
        expect(await unread("run-needs-02")).toBe(false);

        // A stop resolves what is left.
        expect(await store.stop(owner, id)).toBe(true);
        expect(await unread("run-needs-01")).toBe(false);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
