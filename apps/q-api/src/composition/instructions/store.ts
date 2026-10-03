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
  pause_reason: string | null;
  expires_at: Date | null;
  stopped_at: Date | null;
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
      select i.*, g.grant_payload
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
                       pause_reason = null,
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
        select i.*, g.grant_payload
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
