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
  last_digest_at?: Date | null;
  last_fired_at?: Date | null;
  cadence_minutes?: number;
  /** WORK-58: the last thing Q did on it (list reads only). */
  last_step_words?: string | null;
  last_step_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  grant_payload: unknown;
};

export type InstructionStepRow = {
  run_key: string;
  step_index: number;
  action: string;
  mode: "AUTO" | "ASK";
  /** NOTED: what Q tells them about its own work; never counted as done. */
  status: "DONE" | "ASKED" | "REFUSED" | "FAILED" | "NOTED";
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
                   then 0 else i.spent_usd_month end)::text as spent_this_month,
             last.words as last_step_words, last.created_at as last_step_at
          from q_runtime.standing_instructions i
          left join q_runtime.instruction_grants g
            on g.instruction_id = i.id and g.version = i.grant_version
          left join lateral (
            select s.words, s.created_at
              from q_runtime.instruction_steps s
             where s.instruction_id = i.id and s.user_id = i.user_id
             order by s.created_at desc, s.step_index desc
             limit 1) last on true
         where i.user_id = ${owner.userId} and i.tenant_id = ${owner.tenantId}
         order by i.created_at desc
         limit ${limit}`,

    /**
     * WORK-58: the person pauses their own live instruction. Like stop, it
     * is due never while paused; unlike stop, they can resume it. Only an
     * ACTIVE one pauses: a budget pause stays the engine's, resumed through
     * its own approval card.
     */
    pauseByOwner: async (owner: Owner, id: string): Promise<boolean> =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'PAUSED', pause_reason = 'PAUSED_BY_YOU',
                 next_fire_at = null, updated_at = clock_timestamp()
           where id = ${id} and user_id = ${owner.userId}
             and tenant_id = ${owner.tenantId} and status = 'ACTIVE'
          returning id`
      ).length > 0,

    /**
     * WORK-58: resumes only what the person paused themselves, and only
     * while its grant has not expired. It is due at once; the claim then
     * restores its cadence (claimDue sets the next firing).
     */
    resumeByOwner: async (owner: Owner, id: string): Promise<boolean> =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'ACTIVE', pause_reason = null,
                 next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${id} and user_id = ${owner.userId}
             and tenant_id = ${owner.tenantId} and status = 'PAUSED'
             and pause_reason = 'PAUSED_BY_YOU'
             and (expires_at is null or expires_at > clock_timestamp())
          returning id`
      ).length > 0,

    /**
     * One sentence or one tap: stops the person's own live instruction.
     * What it asked them is no longer waiting (QA run 8a1d57b9: "5 things
     * need your yes" stayed after a stop): its NEEDS_YOU notices are
     * resolved (marked read; never deleted).
     */
    stop: async (owner: Owner, id: string): Promise<boolean> => {
      const rows = await sql<{ id: string }[]>`
        update q_runtime.standing_instructions
           set status = 'STOPPED', stopped_at = clock_timestamp(),
               -- QA run 8a1d57b9: a stopped instruction is due never.
               next_fire_at = null,
               updated_at = clock_timestamp()
         where id = ${id} and user_id = ${owner.userId}
           and tenant_id = ${owner.tenantId}
           and status in ('DRAFT', 'ACTIVE', 'PAUSED')
        returning id`;
      if (rows.length === 0) return false;
      await sql`
        update communication.notifications
           set read_at = clock_timestamp()
         where user_id = ${owner.userId} and kind = 'Q_WORK'
           and priority = 'NEEDS_YOU' and read_at is null
           and dedupe_key like ${`instr:${id}:%`}`;
      return true;
    },

    /**
     * QA run 8a1d57b9: "N things need your yes" stayed after every card in
     * it was answered. A run's NEEDS_YOU notice is resolved (marked read)
     * once none of the cards it asked about still waits on the person --
     * approved, rejected, withdrawn or expired alike. Recent notices only.
     */
    resolveAnswered: async (): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        update communication.notifications n
           set read_at = clock_timestamp()
         where n.kind = 'Q_WORK' and n.priority = 'NEEDS_YOU'
           and n.read_at is null
           and n.dedupe_key like 'instr:%:needs'
           and n.created_at > clock_timestamp() - interval '30 days'
           and exists (
             select 1 from q_runtime.instruction_steps t
              where t.user_id = n.user_id and t.status = 'ASKED'
                and n.dedupe_key = 'instr:' || t.instruction_id::text || ':' || t.run_key || ':needs')
           and not exists (
             select 1 from q_runtime.instruction_steps t
               join q_runtime.actions a on a.id = t.q_action_id
              where t.user_id = n.user_id and t.status = 'ASKED'
                and n.dedupe_key = 'instr:' || t.instruction_id::text || ':' || t.run_key || ':needs'
                and a.status in ('PROPOSED', 'AWAITING_APPROVAL'))
        returning n.id`;
      return rows.length;
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
     * S4: claims the instructions due now -- ACTIVE only: a STOPPED or
     * PAUSED one is never claimed, whatever its next_fire_at -- moving each one's next firing
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

    /**
     * QA run 8a1d57b9: a chat message landed on this relationship. Every
     * ACTIVE instruction that covers it -- owned by someone on the side that
     * did NOT write the latest message, with the relationship in its grant's
     * scope and its counterpart not left out -- is due now. Idempotent: a
     * second call finds them due already.
     */
    wakeForChat: async (relationshipId: string): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        with latest as (
          select m.sender_side
            from communication.conversations cv
            join communication.messages m on m.conversation_id = cv.id
           where cv.relationship_id = ${relationshipId}
             and m.revises_message_id is null
           order by m.created_at desc, m.id desc
           limit 1
        ), receiving as (
          select r.id, r.company_id, r.investor_organisation_id,
                 case when latest.sender_side = 'INVESTOR'
                      then c.organisation_id else i.organisation_id end as organisation_id
            from network.relationships r
            join latest on true
            join core.companies c on c.id = r.company_id
            join core.investor_organisations i on i.id = r.investor_organisation_id
           where r.id = ${relationshipId}
        )
        update q_runtime.standing_instructions s
           set next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
          from receiving, q_runtime.instruction_grants g
         where s.status = 'ACTIVE'
           and g.instruction_id = s.id and g.version = s.grant_version
           and exists (
             select 1 from identity.organisation_memberships om
              where om.user_id = s.user_id
                and om.organisation_id = receiving.organisation_id
                and om.membership_status = 'active')
           and (g.grant_payload->'counterparts'->>'scope' = 'ALL_MY_RELATIONSHIPS'
                or coalesce(g.grant_payload->'counterparts'->'relationshipIds', '[]'::jsonb)
                     ? receiving.id::text)
           and not exists (
             select 1
               from jsonb_array_elements(
                      coalesce(g.grant_payload->'counterparts'->'exclude', '[]'::jsonb)) e
              where e->>'counterpartId' in (receiving.company_id::text,
                                            receiving.investor_organisation_id::text))
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
               next_fire_at = null,
               updated_at = clock_timestamp()
         where id = ${id} and status = 'ACTIVE'
        returning id`;
      return rows.length > 0;
    },

    /**
     * S7: a notice to the owner, once per key. NEEDS_YOU for what waits on
     * them; UPDATE for a digest. Links to their own work page.
     */
    notify: async (notice: {
      readonly instruction: Pick<
        InstructionRow,
        "id" | "tenant_id" | "user_id"
      >;
      readonly key: string;
      readonly title: string;
      readonly body: string | null;
      readonly priority: "NEEDS_YOU" | "UPDATE";
    }): Promise<boolean> => {
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        values (${notice.instruction.tenant_id}, ${notice.instruction.user_id},
                'Q_WORK', ${notice.title.slice(0, 200)},
                ${notice.body === null ? null : notice.body.slice(0, 1000)}, '/work',
                ${`instr:${notice.instruction.id}:${notice.key}`.slice(0, 200)},
                ${notice.priority})
        on conflict (user_id, dedupe_key) do nothing
        returning id`;
      return rows.length > 0;
    },

    /**
     * S7: claims the instructions whose digest is due by their grant's
     * cadence (moving last_digest_at to now in the same statement, skip
     * locked) and returns each with the time of the previous digest.
     */
    claimDigestDue: async (
      limit: number,
    ): Promise<readonly { id: string; since: Date; claimed_at: Date }[]> =>
      sql<{ id: string; since: Date; claimed_at: Date }[]>`
        with due as (
          select i.id, coalesce(i.last_digest_at, i.created_at) as since
            from q_runtime.standing_instructions i
            join q_runtime.instruction_grants g
              on g.instruction_id = i.id and g.version = i.grant_version
           where i.status in ('ACTIVE', 'PAUSED')
             and coalesce(g.grant_payload->>'digest', 'DAILY') <> 'OFF'
             and coalesce(i.last_digest_at, i.created_at) <= clock_timestamp() -
                   case when g.grant_payload->>'digest' = 'WEEKLY'
                        then interval '7 days' else interval '1 day' end
           order by i.last_digest_at nulls first
           limit ${limit}
           for update of i skip locked
        )
        update q_runtime.standing_instructions s
           set last_digest_at = clock_timestamp()
          from due
         where s.id = due.id
        returning s.id, due.since, s.last_digest_at as claimed_at`,

    /** S7: what Q did under an instruction since a time, oldest first. */
    stepsSince: async (
      instructionId: string,
      since: Date,
      limit = 200,
    ): Promise<readonly InstructionStepRow[]> =>
      sql<InstructionStepRow[]>`
        select run_key, step_index, action, mode, status, relationship_id, words,
               reason_code, q_action_id, created_at
          from q_runtime.instruction_steps
         where instruction_id = ${instructionId} and created_at > ${since}
         order by created_at, step_index
         limit ${limit}`,

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
