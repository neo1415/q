import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type {
  DelegationRef,
  LanePatch,
  LaneStage,
  Notice,
  ShortlistPick,
} from "@capital-q/q-orchestrator";

/**
 * Q's delegated work, as rows (AUTO, ADR 0030; migration 20261112000000).
 *
 * The person reads their own delegations through the routes and tools that
 * call this store with their own resolved actor; every read and write below
 * is filtered by the person's own user and tenant, never by an id alone.
 * The runner writes as the platform, for the delegation it is advancing.
 */

export type DelegationKind = "INVESTOR_OUTREACH" | "FOUNDER_STAND_IN";
export type DelegationStatus =
  "ACTIVE" | "DONE" | "STOPPED" | "FAILED" | "EXPIRED";

export type DelegationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  organisation_id: string | null;
  kind: DelegationKind;
  q_action_id: string;
  grant_plan: unknown;
  status: DelegationStatus;
  summary: string | null;
  thread_id: string;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type LaneRow = {
  id: string;
  delegation_id: string;
  company_id: string | null;
  investor_organisation_id: string | null;
  relationship_id: string | null;
  counterpart_name: string;
  stage: LaneStage;
  match_reasons: unknown;
  learned: unknown;
  interview: unknown;
  needs: unknown;
  report: unknown;
  report_at: Date | null;
  meeting_id: string | null;
  replies_sent: number;
  observed_fingerprint: string | null;
  last_step: string | null;
  updated_at: Date;
};

export const TERMINAL_STAGES: readonly LaneStage[] = [
  "DECLINED",
  "DONE",
  "STOPPED",
  "FAILED",
];

type Owner = { readonly tenantId: string; readonly userId: string };

/**
 * A plain JSON value for a jsonb parameter. Sent through the driver's own
 * json serialiser: a pre-stringified value cast to jsonb is stored as a
 * JSON *string*, which the object checks reject.
 */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const LANE_COLUMNS = (sql: DatabaseExecutor) => sql`
  id, delegation_id, company_id, investor_organisation_id, relationship_id,
  counterpart_name, stage, match_reasons, learned, interview, needs, report,
  report_at, meeting_id, replies_sent, observed_fingerprint, last_step, updated_at`;

export function createPostgresWorkStore(sql: DatabaseExecutor) {
  const delegation = async (id: string): Promise<DelegationRow | null> => {
    const rows = await sql<DelegationRow[]>`
      select * from q_runtime.delegations where id = ${id}`;
    return rows[0] ?? null;
  };

  const ownDelegation = async (
    owner: Owner,
    id: string,
  ): Promise<DelegationRow | null> => {
    const rows = await sql<DelegationRow[]>`
      select * from q_runtime.delegations
       where id = ${id} and user_id = ${owner.userId} and tenant_id = ${owner.tenantId}`;
    return rows[0] ?? null;
  };

  return {
    delegation,
    ownDelegation,

    /** One delegation per approved action, however often it executes. */
    insertDelegation: async (input: {
      readonly owner: Owner & { readonly organisationId: string | null };
      readonly kind: DelegationKind;
      readonly qActionId: string;
      readonly grant: unknown;
      readonly expiresAt: Date;
      readonly summary: string;
    }): Promise<string> => {
      const id = randomUUID();
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.delegations
          (id, tenant_id, user_id, organisation_id, kind, q_action_id, grant_plan,
           summary, thread_id, expires_at)
        values (${id}, ${input.owner.tenantId}, ${input.owner.userId},
                ${input.owner.organisationId}, ${input.kind}, ${input.qActionId},
                ${sql.json(asJson(input.grant))}, ${input.summary.slice(0, 300)},
                ${`work:${id}`}, ${input.expiresAt})
        on conflict (q_action_id) do update set updated_at = q_runtime.delegations.updated_at
        returning id`;
      const filed = rows[0]?.id;
      if (filed === undefined) throw new Error("delegation not filed");
      return filed;
    },

    /** A founder has one stand-in at a time: a new approval replaces the old. */
    stopOtherStandIns: async (owner: Owner, keepId: string): Promise<void> => {
      await sql`
        update q_runtime.delegations
           set status = 'STOPPED', summary = 'Replaced by a newer stand-in.',
               updated_at = clock_timestamp()
         where user_id = ${owner.userId} and tenant_id = ${owner.tenantId}
           and kind = 'FOUNDER_STAND_IN' and status = 'ACTIVE' and id <> ${keepId}`;
    },

    active: async (limit: number): Promise<readonly DelegationRow[]> =>
      sql<DelegationRow[]>`
        select * from q_runtime.delegations
         where status = 'ACTIVE'
         order by updated_at
         limit ${limit}`,

    /** Active delegations with a lane still open on this relationship. */
    waitingOn: async (
      relationshipId: string,
    ): Promise<readonly DelegationRow[]> =>
      sql<DelegationRow[]>`
        select d.* from q_runtime.delegations d
         where d.status = 'ACTIVE'
           and exists (
             select 1 from q_runtime.delegation_lanes l
              where l.delegation_id = d.id and l.relationship_id = ${relationshipId}
                and l.stage not in ('DECLINED', 'DONE', 'STOPPED', 'FAILED'))
         limit 10`,

    touch: async (id: string): Promise<void> => {
      await sql`
        update q_runtime.delegations set updated_at = clock_timestamp()
         where id = ${id}`;
    },

    lanes: async (delegationId: string): Promise<readonly LaneRow[]> =>
      sql<LaneRow[]>`
        select ${LANE_COLUMNS(sql)} from q_runtime.delegation_lanes
         where delegation_id = ${delegationId}
         order by created_at`,

    lane: async (laneId: string): Promise<LaneRow | null> => {
      const rows = await sql<LaneRow[]>`
        select ${LANE_COLUMNS(sql)} from q_runtime.delegation_lanes where id = ${laneId}`;
      return rows[0] ?? null;
    },

    openLane: async (
      ref: DelegationRef,
      lane: {
        readonly companyId: string | null;
        readonly investorOrganisationId?: string | null;
        readonly relationshipId: string | null;
        readonly counterpartName: string;
        readonly stage: LaneStage;
        readonly reasons: ShortlistPick["reasons"];
      },
    ): Promise<string> => {
      const rows =
        lane.companyId !== null
          ? await sql<{ id: string }[]>`
              insert into q_runtime.delegation_lanes
                (delegation_id, tenant_id, user_id, company_id, relationship_id,
                 counterpart_name, stage, match_reasons)
              values (${ref.delegationId}, ${ref.tenantId}, ${ref.userId}, ${lane.companyId},
                      ${lane.relationshipId}, ${lane.counterpartName.slice(0, 200)},
                      ${lane.stage}, ${sql.json(asJson(lane.reasons.slice(0, 5)))})
              on conflict (delegation_id, company_id) where company_id is not null
                do update set updated_at = q_runtime.delegation_lanes.updated_at
              returning id`
          : await sql<{ id: string }[]>`
              insert into q_runtime.delegation_lanes
                (delegation_id, tenant_id, user_id, investor_organisation_id,
                 relationship_id, counterpart_name, stage, match_reasons)
              values (${ref.delegationId}, ${ref.tenantId}, ${ref.userId},
                      ${lane.investorOrganisationId ?? null}, ${lane.relationshipId},
                      ${lane.counterpartName.slice(0, 200)}, ${lane.stage}, ${sql.json(asJson(lane.reasons.slice(0, 5)))})
              on conflict (delegation_id, relationship_id) where relationship_id is not null
                do update set updated_at = q_runtime.delegation_lanes.updated_at
              returning id`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("lane not opened");
      return id;
    },

    updateLane: async (laneId: string, patch: LanePatch): Promise<void> => {
      await sql`
        update q_runtime.delegation_lanes
           set stage = coalesce(${patch.stage ?? null}, stage),
               relationship_id = coalesce(${patch.relationshipId ?? null}, relationship_id),
               last_step = coalesce(${patch.lastStep?.slice(0, 300) ?? null}, last_step),
               learned = coalesce(${patch.learned === undefined ? null : sql.json(asJson(patch.learned))}, learned),
               interview = coalesce(${patch.interview === undefined ? null : sql.json(asJson(patch.interview))}, interview),
               needs = case when ${patch.needs === undefined} then needs
                            else ${patch.needs === undefined || patch.needs === null ? null : sql.json(asJson(patch.needs))} end,
               meeting_id = coalesce(${patch.meetingId ?? null}, meeting_id),
               replies_sent = coalesce(${patch.repliesSent ?? null}, replies_sent),
               updated_at = clock_timestamp()
         where id = ${laneId}
           and stage not in ('STOPPED')`;
    },

    fingerprint: async (laneId: string, value: string): Promise<void> => {
      await sql`
        update q_runtime.delegation_lanes set observed_fingerprint = ${value.slice(0, 200)}
         where id = ${laneId}`;
    },

    saveReport: async (laneId: string, report: unknown): Promise<void> => {
      await sql`
        update q_runtime.delegation_lanes
           set report = ${sql.json(asJson(report))}, report_at = clock_timestamp(),
               updated_at = clock_timestamp()
         where id = ${laneId}`;
    },

    step: async (
      ref: DelegationRef,
      laneId: string | null,
      key: string,
      words: string,
    ): Promise<void> => {
      await sql`
        insert into q_runtime.delegation_steps
          (delegation_id, lane_id, tenant_id, user_id, step_key, words)
        values (${ref.delegationId}, ${laneId}, ${ref.tenantId}, ${ref.userId},
                ${key.slice(0, 200)}, ${words.slice(0, 500)})
        on conflict (delegation_id, step_key) do nothing`;
    },

    notify: async (
      ref: DelegationRef,
      kind: DelegationKind,
      notice: Notice,
    ): Promise<void> => {
      // Same-origin paths only (the column's own check repeats this).
      const link =
        notice.link !== null &&
        /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(notice.link)
          ? notice.link
          : null;
      await sql`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        values (${ref.tenantId}, ${ref.userId},
                ${kind === "FOUNDER_STAND_IN" ? "Q_STAND_IN" : "Q_WORK"},
                ${notice.title.slice(0, 200)},
                ${notice.body === null ? null : notice.body.slice(0, 1000)}, ${link},
                ${`work:${ref.delegationId}:${notice.key}`.slice(0, 200)},
                ${notice.priority})
        on conflict (user_id, dedupe_key) do nothing`;
    },

    finish: async (
      id: string,
      status: Exclude<DelegationStatus, "ACTIVE">,
      summary: string,
    ): Promise<void> => {
      await sql`
        update q_runtime.delegations
           set status = ${status}, summary = ${summary.slice(0, 300)},
               updated_at = clock_timestamp()
         where id = ${id} and status = 'ACTIVE'`;
    },

    summarise: async (id: string, summary: string): Promise<void> => {
      await sql`
        update q_runtime.delegations set summary = ${summary.slice(0, 300)}
         where id = ${id} and status = 'ACTIVE'`;
    },

    /** The person's own work: active first, then the most recent. */
    own: async (owner: Owner): Promise<readonly DelegationRow[]> =>
      sql<DelegationRow[]>`
        select * from q_runtime.delegations
         where user_id = ${owner.userId} and tenant_id = ${owner.tenantId}
         order by (status = 'ACTIVE') desc, created_at desc
         limit 10`,

    steps: async (
      owner: Owner,
      delegationId: string,
    ): Promise<readonly { words: string; created_at: Date }[]> =>
      sql<{ words: string; created_at: Date }[]>`
        select words, created_at from q_runtime.delegation_steps
         where delegation_id = ${delegationId} and user_id = ${owner.userId}
           and tenant_id = ${owner.tenantId}
         order by created_at desc
         limit 200`,

    /** The person stops their own delegation (or one lane); nothing more runs. */
    stop: async (
      owner: Owner,
      delegationId: string,
      laneId: string | null,
    ): Promise<boolean> => {
      const own = await ownDelegation(owner, delegationId);
      if (own === null || own.status !== "ACTIVE") return false;
      if (laneId === null) {
        await sql`
          update q_runtime.delegations
             set status = 'STOPPED', summary = 'You stopped this.',
                 updated_at = clock_timestamp()
           where id = ${delegationId} and status = 'ACTIVE'`;
        await sql`
          update q_runtime.delegation_lanes
             set stage = 'STOPPED', last_step = 'You stopped this.', needs = null,
                 updated_at = clock_timestamp()
           where delegation_id = ${delegationId}
             and stage not in ('DECLINED', 'DONE', 'STOPPED', 'FAILED')`;
        return true;
      }
      const rows = await sql<{ id: string }[]>`
        update q_runtime.delegation_lanes
           set stage = 'STOPPED', last_step = 'You stopped this one.', needs = null,
               updated_at = clock_timestamp()
         where id = ${laneId} and delegation_id = ${delegationId}
           and stage not in ('DECLINED', 'DONE', 'STOPPED', 'FAILED')
        returning id`;
      return rows.length > 0;
    },

    /** The person's word on one lane, for the engine to read next tick. */
    answer: async (
      owner: Owner,
      delegationId: string,
      laneId: string,
      answer:
        | { readonly kind: "BOOK_AT"; readonly at: string }
        | {
            readonly kind: "PASS";
          },
    ): Promise<"ACCEPTED" | "NOT_FOUND" | "NOT_ACTIVE"> => {
      const own = await ownDelegation(owner, delegationId);
      if (own === null || own.kind !== "INVESTOR_OUTREACH") return "NOT_FOUND";
      if (own.status !== "ACTIVE") return "NOT_ACTIVE";
      const answerJson = sql.json(asJson({ ...answer, id: randomUUID() }));
      const rows = await sql<{ id: string }[]>`
        update q_runtime.delegation_lanes
           set needs = coalesce(needs, '{}'::jsonb) || jsonb_build_object('answer', ${answerJson}),
               observed_fingerprint = null, updated_at = clock_timestamp()
         where id = ${laneId} and delegation_id = ${delegationId}
           and stage not in ('DECLINED', 'DONE', 'STOPPED', 'FAILED')
        returning id`;
      if (rows.length === 0) return "NOT_ACTIVE";
      await sql`
        update q_runtime.delegations set updated_at = clock_timestamp() - interval '1 day'
         where id = ${delegationId}`;
      return "ACCEPTED";
    },

    /** The answer was acted on: it never acts twice. */
    clearAnswer: async (laneId: string, answerId: string): Promise<void> => {
      await sql`
        update q_runtime.delegation_lanes set needs = needs - 'answer'
         where id = ${laneId} and needs -> 'answer' ->> 'id' = ${answerId}`;
    },

    // --- presence ------------------------------------------------------------
    seen: async (owner: Owner): Promise<void> => {
      await sql`
        insert into q_runtime.presence (user_id, tenant_id, last_seen_at, away)
        values (${owner.userId}, ${owner.tenantId}, clock_timestamp(), false)
        on conflict (user_id) do update
          set last_seen_at = clock_timestamp(), tenant_id = excluded.tenant_id,
              updated_at = clock_timestamp()`;
    },
    setAway: async (owner: Owner, away: boolean): Promise<void> => {
      await sql`
        insert into q_runtime.presence (user_id, tenant_id, last_seen_at, away)
        values (${owner.userId}, ${owner.tenantId}, clock_timestamp(), ${away})
        on conflict (user_id) do update
          set away = excluded.away, tenant_id = excluded.tenant_id,
              last_seen_at = case when excluded.away then q_runtime.presence.last_seen_at
                                  else clock_timestamp() end,
              updated_at = clock_timestamp()`;
    },
    presence: async (
      userId: string,
    ): Promise<{
      readonly lastSeenAt: Date | null;
      readonly away: boolean;
    }> => {
      const rows = await sql<{ last_seen_at: Date; away: boolean }[]>`
        select last_seen_at, away from q_runtime.presence where user_id = ${userId}`;
      const row = rows[0];
      return row === undefined
        ? { lastSeenAt: null, away: false }
        : { lastSeenAt: row.last_seen_at, away: row.away };
    },

    /** Relationships of a company with investor messages in the last week. */
    recentInvestorThreads: async (
      companyId: string,
    ): Promise<readonly string[]> => {
      const rows = await sql<{ relationship_id: string }[]>`
        select c.relationship_id
          from communication.conversations c
          join network.relationships r on r.id = c.relationship_id
         where r.company_id = ${companyId}
           and exists (
             select 1 from communication.messages m
              where m.conversation_id = c.id and m.sender_side = 'INVESTOR'
                and m.created_at > now() - interval '7 days')
         order by (select max(m.created_at) from communication.messages m
                    where m.conversation_id = c.id) desc
         limit 10`;
      return rows.map((row) => row.relationship_id);
    },

    /** A company's ready founder pitches, newest first (ids only). */
    pitchIds: async (companyId: string): Promise<readonly string[]> => {
      const rows = await sql<{ id: string }[]>`
        select id from media.media_assets
         where owner_type = 'COMPANY' and owner_id = ${companyId}
           and purpose = 'FOUNDER_PITCH' and status = 'READY'
         order by ready_at desc nulls last
         limit 2`;
      return rows.map((row) => row.id);
    },
  };
}

export type WorkStore = ReturnType<typeof createPostgresWorkStore>;
