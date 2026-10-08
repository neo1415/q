import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { sqlStatements } from "./support/sql-statements.js";

/**
 * Compensating control for DEF-A2 (ADR 0065). The services connect as
 * `postgres`, which bypasses RLS, so for server traffic tenant isolation is
 * whatever predicate the hand-written SQL carries. This guard watches the
 * repositories the audit ranked riskiest (raw SQL, cross-app writes, system
 * sweeps) and fails when a statement that touches an application table and
 * names no `tenant_id` appears.
 *
 * It is a ratchet, not an amnesty. The baseline below is every such
 * statement as of 2026-10-08, each one of three reviewed kinds:
 *   - by primary key, after the id came from a tenant-scoped read or from
 *     a row the same call already scoped (e.g. `where id = $1`);
 *   - by the owning person (`user_id = $1`), which is narrower than tenant;
 *   - a system sweep that must see every tenant (due instructions, active
 *     delegations), whose rows are then acted on as their own owner.
 * A new statement must either carry `tenant_id` or be added here in the
 * same change, where a reviewer sees it. A baseline entry that no longer
 * matches must be removed, so the list never outlives the code.
 */

const REPO = resolve(import.meta.dirname, "../../..");

/** First 90 characters of the whitespace-collapsed statement, `$n` for values. */
const BASELINE: Readonly<Record<string, readonly string[]>> = {
  "apps/q-api/src/composition/instructions/store.ts": [
    "update communication.notifications set read_at = clock_timestamp() where user_id = $1 and ",
    "update communication.notifications n set read_at = clock_timestamp() where n.kind = 'Q_WOR",
    "select i.*, g.grant_payload, (case when i.budget_month < date_trunc('month', now())::date ",
    "update q_runtime.standing_instructions set conversation_id = $1, updated_at = clock_timest",
    "update q_runtime.standing_instructions s set last_fired_at = clock_timestamp(), next_fire_",
    "update q_runtime.standing_instructions set next_fire_at = clock_timestamp() + make_interva",
    "update q_runtime.standing_instructions s set next_fire_at = clock_timestamp(), updated_at ",
    "update q_runtime.standing_instructions s set next_fire_at = clock_timestamp(), updated_at ",
    "with latest as ( select m.sender_side from communication.conversations cv join communicati",
    "update q_runtime.standing_instructions s set next_fire_at = least(s.next_fire_at, clock_ti",
    "update q_runtime.standing_instructions set spent_usd_month = case when budget_month < date",
    "update q_runtime.standing_instructions set status = 'PAUSED', pause_reason = $1, next_fire",
    "with due as ( select i.id, coalesce(i.last_digest_at, i.created_at) as since from q_runtim",
    "select run_key, step_index, action, mode, status, relationship_id, words, reason_code, q_a",
    "update q_runtime.standing_instructions set status = 'EXPIRED', updated_at = clock_timestam",
    "select id, scope, enabled_at from q_runtime.instruction_delegations where instruction_id =",
    "select count(*)::int as done from q_runtime.instruction_steps where instruction_id = $1 an",
    "select 1 as found from q_runtime.instruction_steps where idempotency_key = $1",
    "select distinct t.relationship_id from q_runtime.instruction_steps t join q_runtime.action",
    "select relationship_id, count(*)::int as sent from q_runtime.instruction_steps where instr",
    "select run_key, step_index, action, mode, status, relationship_id, words, reason_code, q_a",
    "select timezone from identity.user_profiles where id = $1",
  ],
  "apps/q-api/src/composition/workforce/store.ts": [
    "select id from q_runtime.workforce_agent_runs where job_id = $1 and role = 'LEAD' order by",
    "select * from q_runtime.workforce_agent_runs where job_id = $1 order by started_at limit 2",
    "select * from q_runtime.workforce_handoffs where job_id = $1 order by created_at limit 400",
    "select id, job_id, writer_run_id, attempt, parent_draft_id, channel, counterpart_name, bod",
    "select * from q_runtime.workforce_grades where job_id = $1",
    "select * from q_runtime.workforce_draft_outcomes where job_id = $1",
    "select id, draft_id, job_id, kind, edited_body, note, created_at from q_runtime.workforce_",
  ],
  "apps/q-api/src/composition/work/store.ts": [
    "select * from q_runtime.delegations where id = $1",
    "select * from q_runtime.delegations where status = 'ACTIVE' order by updated_at limit $1",
    "select d.* from q_runtime.delegations d where d.status = 'ACTIVE' and exists ( select 1 fr",
    "update q_runtime.delegations set updated_at = clock_timestamp() where id = $1",
    "select $1 from q_runtime.delegation_lanes where delegation_id = $2 order by created_at",
    "select $1 from q_runtime.delegation_lanes where id = $2",
    "update q_runtime.delegation_lanes set stage = coalesce($1, stage), relationship_id = coale",
    "update q_runtime.delegation_lanes set observed_fingerprint = $1 where id = $2",
    "update q_runtime.delegation_lanes set report = $1, report_at = clock_timestamp(), updated_",
    "update q_runtime.delegations set status = $1, summary = $2, updated_at = clock_timestamp()",
    "update q_runtime.delegations set summary = $1 where id = $2 and status = 'ACTIVE'",
    "update q_runtime.delegations set status = 'STOPPED', summary = 'You stopped this.', update",
    "update q_runtime.delegation_lanes set stage = 'STOPPED', last_step = 'You stopped this.', ",
    "update q_runtime.delegation_lanes set stage = 'STOPPED', last_step = 'You stopped this one",
    "update q_runtime.delegation_lanes set needs = coalesce(needs, '{}'::jsonb) || jsonb_build_",
    "update q_runtime.delegations set updated_at = clock_timestamp() - interval '1 day' where i",
    "update q_runtime.delegation_lanes set needs = needs - 'answer' where id = $1 and needs -> ",
    "select last_seen_at, away from q_runtime.presence where user_id = $1",
    "select c.relationship_id from communication.conversations c join network.relationships r o",
    "select id from media.media_assets where owner_type = 'COMPANY' and owner_id = $1 and purpo",
  ],
};

const TABLE = /\b(?:from|join|update|into)\s+[a-z_]+\.[a-z_]+/i;

function unscoped(file: string): string[] {
  const source = readFileSync(resolve(REPO, file), "utf8");
  return sqlStatements(source)
    .filter((s) => TABLE.test(s.text) && !/\btenant_id\b/.test(s.text))
    .map((s) => s.text.replace(/\s+/g, " ").trim().slice(0, 90));
}

function without(have: string[], allowed: readonly string[]): string[] {
  const left = [...allowed];
  const extra: string[] = [];
  for (const statement of have) {
    const at = left.indexOf(statement);
    if (at >= 0) left.splice(at, 1);
    else extra.push(statement);
  }
  return extra;
}

describe("tenant predicates on raw SQL in the riskiest repositories (DEF-A2)", () => {
  for (const [file, allowed] of Object.entries(BASELINE)) {
    it(`${file}: no new statement without tenant_id`, () => {
      expect(without(unscoped(file), allowed)).toEqual([]);
    });

    it(`${file}: every baseline entry still exists`, () => {
      expect(without([...allowed], unscoped(file))).toEqual([]);
    });
  }

  it("covers the q-work port too, which writes q-api's tables from the api", () => {
    expect(unscoped("apps/api/src/q-work-port.ts")).toEqual([]);
  });

  it("reads statements the way the repositories write them", () => {
    const sample = [
      "const a = await sql<Row[]>`select * from q_runtime.x where id = ${id}`;",
      "await tx.sql`update q_runtime.y set n = ${`k:${id}`} where tenant_id = ${t}`;",
    ].join("\n");
    expect(sqlStatements(sample).map((s) => s.text)).toEqual([
      "select * from q_runtime.x where id = $1",
      "update q_runtime.y set n = $1 where tenant_id = $2",
    ]);
  });
});
