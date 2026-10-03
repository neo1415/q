import { createHash } from "node:crypto";

import {
  canonicalJsonStringify,
  type InstructionGrant,
  type StandingInstructionStatus,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Standing instructions as rows (ADR 0043; migration 20261121090000).
 *
 * Every read and stop is filtered by the person's own user and tenant, never
 * by an id alone. Activation runs only from the approved `q.instruction.grant`
 * action, as one statement: the grant version, its hash and the approving
 * action id land together, and a replayed approval finds the same version
 * (unique on approved_q_action_id) instead of filing a second instruction.
 */

type Owner = { readonly tenantId: string; readonly userId: string };

export type InstructionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  organisation_id: string | null;
  goal_text: string;
  status: StandingInstructionStatus;
  grant_version: number | null;
  budget_usd_month: string;
  spent_usd_month: string;
  /** This calendar month's spend (a new month starts at zero). */
  spent_this_month: string;
  pause_reason: string | null;
  expires_at: Date | null;
  stopped_at: Date | null;
  conversation_id: string | null;
  next_fire_at?: Date | null;
  last_fired_at?: Date | null;
  cadence_minutes?: number;
  created_at: Date;
  updated_at: Date;
  grant_payload: unknown;
};

export type InstructionStepRow = {
  run_key: string;
  step_index: number;
  action: string;
  mode: "AUTO" | "ASK";
  status: "DONE" | "ASKED" | "REFUSED" | "FAILED";
  relationship_id: string | null;
  words: string;
  reason_code: string | null;
  q_action_id: string | null;
  created_at: Date;
};

const DAY_MS = 24 * 3_600_000;

/** The hash of exactly what was approved: `sha256:` over canonical JSON. */
export function grantHash(grant: InstructionGrant): string {
  return `sha256:${createHash("sha256").update(canonicalJsonStringify(grant)).digest("hex")}`;
}

function asJson(value: unknown): Parameters<DatabaseExecutor["json"]>[0] {
  return JSON.parse(JSON.stringify(value)) as Parameters<
    DatabaseExecutor["json"]
  >[0];
}

export function createPostgresInstructionStore(sql: DatabaseExecutor) {
  const own = async (
    owner: Owner,
    id: string,
  ): Promise<InstructionRow | null> => {
    const rows = await sql<InstructionRow[]>`
      select i.*, g.grant_payload,
             (case when i.budget_month < date_trunc('month', now())::date
                   then 0 else i.spent_usd_month end)::text as spent_this_month
        from q_runtime.standing_instructions i
        left join q_runtime.instruction_grants g
          on g.instruction_id = i.id and g.version = i.grant_version
       where i.id = ${id} and i.user_id = ${owner.userId}
         and i.tenant_id = ${owner.tenantId}`;
    return rows[0] ?? null;
  };

  return {
    own,

    /**
     * Makes the approved grant current. Without an instruction id, files a new
     * ACTIVE instruction at version 1; with one, adds the next version to the
     * person's own live instruction. Returns null when that instruction is not
     * theirs or no longer live.
     */
    activate: async (input: {
      readonly owner: Owner & { readonly organisationId: string | null };
      readonly qActionId: string;
      readonly instructionId: string | undefined;
      readonly goal: string;
      readonly grant: InstructionGrant;
      readonly now?: Date | undefined;
    }): Promise<{ instructionId: string; version: number } | null> => {
      const now = input.now ?? new Date();
      const expiresAt = new Date(
        now.getTime() + input.grant.expiresInDays * DAY_MS,
      );
      const hash = grantHash(input.grant);
      const payload = sql.json(asJson(input.grant));
      const rows =
        input.instructionId === undefined
          ? await sql<{ instruction_id: string; version: number }[]>`
              with existing as (
                select instruction_id, version from q_runtime.instruction_grants
                 where approved_q_action_id = ${input.qActionId}
              ), filed as (
                insert into q_runtime.standing_instructions
                  (tenant_id, user_id, organisation_id, goal_text, status,
                   grant_version, budget_usd_month, expires_at)
                select ${input.owner.tenantId}, ${input.owner.userId},
                       ${input.owner.organisationId}, ${input.goal.slice(0, 2_000)},
                       'ACTIVE', 1, ${input.grant.budgetUsdMonth}::numeric, ${expiresAt}
                 where not exists (select 1 from existing)
                returning id
              ), granted as (
                insert into q_runtime.instruction_grants
                  (tenant_id, instruction_id, version, grant_payload, payload_hash,
                   approved_q_action_id)
                select ${input.owner.tenantId}, filed.id, 1, ${payload}, ${hash},
                       ${input.qActionId}
                  from filed
                returning instruction_id, version
              )
              select instruction_id, version from existing
              union all
              select instruction_id, version from granted`
          : await sql<{ instruction_id: string; version: number }[]>`
              with existing as (
                select instruction_id, version from q_runtime.instruction_grants
                 where approved_q_action_id = ${input.qActionId}
              ), live as (
                select id, grant_version from q_runtime.standing_instructions
                 where id = ${input.instructionId}
                   and user_id = ${input.owner.userId}
                   and tenant_id = ${input.owner.tenantId}
                   and status in ('ACTIVE', 'PAUSED')
                   and not exists (select 1 from existing)
                 for update
              ), granted as (
                insert into q_runtime.instruction_grants
                  (tenant_id, instruction_id, version, grant_payload, payload_hash,
                   approved_q_action_id)
                select ${input.owner.tenantId}, live.id, coalesce(live.grant_version, 0) + 1,
                       ${payload}, ${hash}, ${input.qActionId}
                  from live
                returning instruction_id, version
              ), moved as (
                update q_runtime.standing_instructions s
                   set grant_version = granted.version, status = 'ACTIVE',
                       pause_reason = null, next_fire_at = null,
                       budget_usd_month = ${input.grant.budgetUsdMonth}::numeric,
                       expires_at = ${expiresAt}, updated_at = clock_timestamp()
                  from granted
                 where s.id = granted.instruction_id
                returning s.id
              )
              select instruction_id, version from existing
              union all
              select instruction_id, version from granted`;
      const row = rows[0];
      return row === undefined
        ? null
        : { instructionId: row.instruction_id, version: row.version };
    },

    /** The person's own instructions, newest first, with the current grant. */
    list: async (
      owner: Owner,
      limit = 10,
    ): Promise<readonly InstructionRow[]> =>
      sql<InstructionRow[]>`
        select i.*, g.grant_payload,
             (case when i.budget_month < date_trunc('month', now())::date
                   then 0 else i.spent_usd_month end)::text as spent_this_month
          from q_runtime.standing_instructions i
          left join q_runtime.instruction_grants g
            on g.instruction_id = i.id and g.version = i.grant_version
         where i.user_id = ${owner.userId} and i.tenant_id = ${owner.tenantId}
         order by i.created_at desc
         limit ${limit}`,

    /** One sentence or one tap: stops the person's own live instruction. */
    stop: async (owner: Owner, id: string): Promise<boolean> => {
      const rows = await sql<{ id: string }[]>`
        update q_runtime.standing_instructions
           set status = 'STOPPED', stopped_at = clock_timestamp(),
               updated_at = clock_timestamp()
         where id = ${id} and user_id = ${owner.userId}
           and tenant_id = ${owner.tenantId}
           and status in ('DRAFT', 'ACTIVE', 'PAUSED')
        returning id`;
      return rows.length > 0;
    },

    /** The platform's read, for the engine advancing this instruction. */
    instruction: async (id: string): Promise<InstructionRow | null> => {
      const rows = await sql<InstructionRow[]>`
        select i.*, g.grant_payload,
             (case when i.budget_month < date_trunc('month', now())::date
                   then 0 else i.spent_usd_month end)::text as spent_this_month
          from q_runtime.standing_instructions i
          left join q_runtime.instruction_grants g
            on g.instruction_id = i.id and g.version = i.grant_version
         where i.id = ${id}`;
      return rows[0] ?? null;
    },

    /** The conversation its cards are asked in, set once. */
    setConversation: async (
      id: string,
      conversationId: string,
    ): Promise<void> => {
      await sql`
        update q_runtime.standing_instructions
           set conversation_id = ${conversationId}, updated_at = clock_timestamp()
         where id = ${id} and conversation_id is null`;
    },

    /**
     * S4: claims the instructions due now, moving each one's next firing
     * forward in the same statement (skip locked), so no two instances
     * fire the same one. Returns each with the instant it was claimed at.
     */
    claimDue: async (
      limit: number,
    ): Promise<readonly { id: string; claimed_at: Date }[]> =>
      sql<{ id: string; claimed_at: Date }[]>`
        update q_runtime.standing_instructions s
           set last_fired_at = clock_timestamp(),
               next_fire_at = clock_timestamp() + make_interval(mins => s.cadence_minutes),
               updated_at = clock_timestamp()
         where s.id in (
           select id from q_runtime.standing_instructions
            where status = 'ACTIVE'
              and (next_fire_at is null or next_fire_at <= clock_timestamp())
            order by next_fire_at nulls first
            limit ${limit}
            for update skip locked)
        returning s.id, s.last_fired_at as claimed_at`,

    /** Outside their hours: try again later, not a full cadence later. */
    defer: async (id: string, minutes: number): Promise<void> => {
      await sql`
        update q_runtime.standing_instructions
           set next_fire_at = clock_timestamp() + make_interval(mins => ${minutes}),
               updated_at = clock_timestamp()
         where id = ${id} and status = 'ACTIVE'`;
    },

    /**
     * Something happened on a relationship Q has worked on under an
     * instruction: that instruction is due now.
     */
    wakeFor: async (relationshipId: string): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        update q_runtime.standing_instructions s
           set next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
         where s.status = 'ACTIVE'
           and exists (
             select 1 from q_runtime.instruction_steps t
              where t.instruction_id = s.id and t.relationship_id = ${relationshipId})
        returning s.id`;
      return rows.length;
    },

    /** S5: model spend under this instruction; a new month starts at zero. */
    addSpend: async (id: string, amountUsd: number): Promise<void> => {
      if (!(amountUsd > 0)) return;
      await sql`
        update q_runtime.standing_instructions
           set spent_usd_month =
                 case when budget_month < date_trunc('month', now())::date
                      then ${amountUsd.toFixed(6)}::numeric
                      else spent_usd_month + ${amountUsd.toFixed(6)}::numeric end,
               budget_month = date_trunc('month', now())::date,
               updated_at = clock_timestamp()
         where id = ${id}`;
    },

    /** S5: paused, waiting for the person (e.g. the month's budget is used). */
    pause: async (id: string, reason: string): Promise<boolean> => {
      const rows = await sql<{ id: string }[]>`
        update q_runtime.standing_instructions
           set status = 'PAUSED', pause_reason = ${reason},
               updated_at = clock_timestamp()
         where id = ${id} and status = 'ACTIVE'
        returning id`;
      return rows.length > 0;
    },

    /** Past its expiry: EXPIRED, once. */
    expire: async (id: string): Promise<void> => {
      await sql`
        update q_runtime.standing_instructions
           set status = 'EXPIRED', updated_at = clock_timestamp()
         where id = ${id} and status in ('ACTIVE', 'PAUSED')
           and expires_at is not null and expires_at <= now()`;
    },

    /**
     * One step, once: a replayed firing finds the step already recorded
     * (unique idempotency key) and records nothing new.
     */
    recordStep: async (step: {
      readonly instruction: Pick<
        InstructionRow,
        "id" | "tenant_id" | "user_id" | "grant_version"
      >;
      readonly runKey: string;
      readonly stepIndex: number;
      readonly action: string;
      readonly mode: "AUTO" | "ASK";
      readonly status: InstructionStepRow["status"];
      readonly relationshipId: string | null;
      readonly words: string;
      readonly reasonCode: string | null;
      readonly qActionId: string | null;
      readonly idempotencyKey: string;
    }): Promise<boolean> => {
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.instruction_steps
          (tenant_id, user_id, instruction_id, grant_version, run_key, step_index,
           action, mode, status, relationship_id, words, reason_code, q_action_id,
           idempotency_key)
        values (${step.instruction.tenant_id}, ${step.instruction.user_id},
                ${step.instruction.id}, ${step.instruction.grant_version ?? 1},
                ${step.runKey}, ${step.stepIndex}, ${step.action.slice(0, 80)},
                ${step.mode}, ${step.status}, ${step.relationshipId},
                ${step.words.slice(0, 500)}, ${step.reasonCode}, ${step.qActionId},
                ${step.idempotencyKey})
        on conflict (idempotency_key) do nothing
        returning id`;
      return rows.length > 0;
    },

    /** Whether this step already ran (a replayed firing skips it). */
    stepDone: async (idempotencyKey: string): Promise<boolean> =>
      (
        await sql<{ found: number }[]>`
          select 1 as found from q_runtime.instruction_steps
           where idempotency_key = ${idempotencyKey}`
      ).length > 0,

    /** Q's sent chat messages per relationship under this instruction. */
    messagesSent: async (
      instructionId: string,
    ): Promise<ReadonlyMap<string, number>> => {
      const rows = await sql<{ relationship_id: string; sent: number }[]>`
        select relationship_id, count(*)::int as sent
          from q_runtime.instruction_steps
         where instruction_id = ${instructionId}
           and action = 'chat.message.send' and status = 'DONE'
           and relationship_id is not null
         group by relationship_id`;
      return new Map(rows.map((row) => [row.relationship_id, row.sent]));
    },

    /** The platform's read of what Q did, newest last, for the planner. */
    history: async (
      instructionId: string,
      limit = 30,
    ): Promise<readonly InstructionStepRow[]> =>
      (
        await sql<InstructionStepRow[]>`
          select run_key, step_index, action, mode, status, relationship_id, words,
                 reason_code, q_action_id, created_at
            from q_runtime.instruction_steps
           where instruction_id = ${instructionId}
           order by created_at desc, step_index desc
           limit ${limit}`
      ).reverse(),

    /** The person's own time zone, when they set one. */
    timeZoneOf: async (owner: Owner): Promise<string | null> =>
      (
        await sql<{ timezone: string | null }[]>`
          select timezone from identity.user_profiles where id = ${owner.userId}`
      )[0]?.timezone ?? null,

    /** What Q did under the person's own instruction, oldest first. */
    steps: async (
      owner: Owner,
      id: string,
      limit = 100,
    ): Promise<readonly InstructionStepRow[]> =>
      sql<InstructionStepRow[]>`
        select s.run_key, s.step_index, s.action, s.mode, s.status,
               s.relationship_id, s.words, s.reason_code, s.q_action_id, s.created_at
          from q_runtime.instruction_steps s
         where s.instruction_id = ${id} and s.user_id = ${owner.userId}
           and s.tenant_id = ${owner.tenantId}
         order by s.created_at, s.step_index
         limit ${limit}`,
  };
}

export type InstructionStore = ReturnType<
  typeof createPostgresInstructionStore
>;
