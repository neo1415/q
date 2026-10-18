import type { QAttentionItem } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { AttentionPort } from "@capital-q/q-tools";

/**
 * RECOVERY-2026-10 B1: the "what needs you" sources no tool port holds,
 * read from the person's own rows. Every predicate is their user id (or
 * their own organisation and tenant, from the resolved actor), never an
 * input. A query that throws marks its source unread in the report; it is
 * never swallowed into an empty list here.
 *
 * Held drafts and stopped workforce jobs: q_runtime.workforce_* (theirs).
 * Notices: their unread NEEDS_YOU notifications.
 * Document requests: data-room access requests to their own company with
 * no decision yet.
 * New matches: companies in their organisation's current Discover slate
 * that were not in the slate they had at `since`.
 * Activity: counts of what Q and its agents recorded doing since `since`.
 */
export function createAttentionSources(dependencies: {
  readonly sql: DatabaseExecutor;
}): AttentionPort {
  const { sql } = dependencies;
  return {
    sources: {
      HELD_DRAFT: [
        async (actor) => {
          const rows = await sql<
            {
              draft_id: string;
              job_id: string;
              counterpart_name: string | null;
              reason: string | null;
              created_at: Date;
            }[]
          >`
            select o.draft_id, o.job_id, d.counterpart_name, o.reason, o.created_at
              from q_runtime.workforce_draft_outcomes o
              join q_runtime.workforce_drafts d on d.id = o.draft_id
             where o.user_id = ${actor.userId}
               and o.tenant_id = ${actor.tenantId}
               and o.outcome = 'HELD'
               and not exists (
                 select 1 from q_runtime.workforce_draft_outcomes later
                  where later.draft_id = o.draft_id
                    and later.outcome in ('SENT', 'OFFERED'))
             order by o.created_at desc
             limit 20`;
          return rows.map((row): QAttentionItem => ({
            key: `held:${row.draft_id}`,
            source: "HELD_DRAFT",
            title:
              row.counterpart_name === null
                ? "Q held back a draft for you to look at"
                : `Q held back a draft to ${row.counterpart_name.slice(0, 120)}`,
            ...(row.reason === null
              ? {}
              : ({
                  note: `Why: ${row.reason}`,
                } satisfies Partial<QAttentionItem>)),
            entity: { kind: "JOB", id: row.job_id },
            ...(row.counterpart_name === null
              ? {}
              : { counterpart: row.counterpart_name.slice(0, 120) }),
            since: new Date(row.created_at).toISOString(),
            decidable: true,
          }));
        },
      ],
      AGENT_BLOCKED: [
        async (actor) => {
          const rows = await sql<
            { id: string; goal: string; status: string; updated_at: Date }[]
          >`
            select id, goal, status, updated_at
              from q_runtime.workforce_jobs
             where user_id = ${actor.userId}
               and tenant_id = ${actor.tenantId}
               and status in ('HELD', 'FAILED')
               and updated_at > now() - interval '14 days'
             order by updated_at desc
             limit 20`;
          return rows.map((row): QAttentionItem => ({
            key: `job:${row.id}:${row.status}`,
            source: "AGENT_BLOCKED",
            title: `${row.status === "FAILED" ? "An agent's job stopped" : "An agent's job is waiting on you"}: ${row.goal.slice(0, 140)}`,
            entity: { kind: "JOB", id: row.id },
            since: new Date(row.updated_at).toISOString(),
            decidable: true,
          }));
        },
      ],
      NOTICE: [
        async (actor) => {
          const rows = await sql<
            {
              id: string;
              title: string;
              body: string | null;
              created_at: Date;
            }[]
          >`
            select id, title, body, created_at
              from communication.notifications
             where user_id = ${actor.userId}
               and tenant_id = ${actor.tenantId}
               and read_at is null
               and priority = 'NEEDS_YOU'
             order by created_at desc
             limit 20`;
          return rows.map((row): QAttentionItem => ({
            key: `notice:${row.id}`,
            source: "NOTICE",
            title: row.title.slice(0, 200),
            ...(row.body === null
              ? {}
              : ({
                  note: row.body.slice(0, 600),
                } satisfies Partial<QAttentionItem>)),
            since: new Date(row.created_at).toISOString(),
            decidable: false,
          }));
        },
      ],
      DOCUMENT_REQUEST: [
        async (actor) => {
          if (actor.organisationId === undefined) return [];
          const rows = await sql<
            {
              id: string;
              relationship_id: string;
              investor_name: string | null;
              document_title: string | null;
              created_at: Date;
            }[]
          >`
            select r.id, r.relationship_id,
                   i.display_name as investor_name,
                   d.title as document_title, r.created_at
              from evidence.data_room_access_requests r
              join core.companies c
                on c.id = r.company_id and c.tenant_id = r.tenant_id
              left join core.investor_organisations i
                on i.id = r.investor_organisation_id
              left join evidence.documents d on d.id = r.document_id
              left join evidence.data_room_request_decisions k
                on k.request_id = r.id
             where c.tenant_id = ${actor.tenantId}
               and c.organisation_id = ${actor.organisationId}
               and k.request_id is null
             order by r.created_at desc
             limit 20`;
          return rows.map((row): QAttentionItem => ({
            key: `dataroom:${row.id}`,
            source: "DOCUMENT_REQUEST",
            title: `${row.investor_name ?? "An investor"} asked for ${row.document_title === null ? "access to your data room" : `"${row.document_title.slice(0, 100)}"`}`,
            entity: { kind: "RELATIONSHIP", id: row.relationship_id },
            ...(row.investor_name === null
              ? {}
              : { counterpart: row.investor_name.slice(0, 120) }),
            since: new Date(row.created_at).toISOString(),
            decidable: true,
          }));
        },
      ],
      NEW_MATCHES: [
        async (actor, { since }) => {
          if (actor.organisationId === undefined) return [];
          const rows = await sql<
            { names: string[] | null; n: number; published_at: Date | null }[]
          >`
            with current_slate as (
              select s.id, s.published_at
                from recommendation.slates s
               where s.tenant_id = ${actor.tenantId}
                 and s.investor_organisation_id = ${actor.organisationId}
                 and s.mode = 'INVESTOR_DISCOVER'
                 and s.status = 'CURRENT'
               order by s.published_at desc nulls last
               limit 1),
            earlier_slate as (
              select s.id
                from recommendation.slates s
               where s.tenant_id = ${actor.tenantId}
                 and s.investor_organisation_id = ${actor.organisationId}
                 and s.mode = 'INVESTOR_DISCOVER'
                 and s.published_at <= ${since}
               order by s.published_at desc
               limit 1),
            fresh as (
              select i.company_id, i.rank
                from recommendation.slate_items i
                join current_slate cs on cs.id = i.slate_id
               where exists (select 1 from earlier_slate)
                 and not exists (
                   select 1 from recommendation.slate_items p
                     join earlier_slate es on es.id = p.slate_id
                    where p.company_id = i.company_id))
            select (select array_agg(c.canonical_name order by f.rank)
                      from (select * from fresh order by rank limit 3) f
                      join core.companies c on c.id = f.company_id) as names,
                   (select count(*)::int from fresh) as n,
                   (select published_at from current_slate) as published_at`;
          const row = rows[0];
          if (row === undefined || row.n === 0) return [];
          const names = (row.names ?? []).filter(
            (name): name is string => typeof name === "string",
          );
          return [
            {
              key: `matches:${(row.published_at ?? since).toISOString()}`,
              source: "NEW_MATCHES",
              title: `${String(row.n)} new ${row.n === 1 ? "company matches" : "companies match"} your mandate since your last visit`,
              ...(names.length === 0
                ? {}
                : ({
                    note: `Including ${names.join(", ").slice(0, 560)}`,
                  } satisfies Partial<QAttentionItem>)),
              since: new Date(row.published_at ?? since).toISOString(),
              decidable: false,
            },
          ];
        },
      ],
    },
    activity: async (actor, { since }) => {
      const rows = await sql<
        {
          sent: number;
          held: number;
          jobs_done: number;
          messages: number;
          calls: number;
          interest: number;
          names: string[] | null;
        }[]
      >`
        select
          (select count(*)::int from q_runtime.workforce_draft_outcomes
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and outcome = 'SENT' and created_at > ${since}) as sent,
          (select count(*)::int from q_runtime.workforce_draft_outcomes
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and outcome = 'HELD' and created_at > ${since}) as held,
          (select count(*)::int from q_runtime.workforce_jobs
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and status = 'DONE' and updated_at > ${since}) as jobs_done,
          (select count(*)::int from q_runtime.instruction_steps
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and status = 'DONE' and created_at > ${since}
              and action like 'chat.message%') as messages,
          (select count(*)::int from q_runtime.instruction_steps
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and status = 'DONE' and created_at > ${since}
              and action like '%meeting%') as calls,
          (select count(*)::int from q_runtime.instruction_steps
            where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
              and status = 'DONE' and created_at > ${since}
              and action like '%interest%') as interest,
          (select array_agg(distinct d.counterpart_name)
             from q_runtime.workforce_draft_outcomes o
             join q_runtime.workforce_drafts d on d.id = o.draft_id
            where o.user_id = ${actor.userId} and o.tenant_id = ${actor.tenantId}
              and o.outcome = 'SENT' and o.created_at > ${since}
              and d.counterpart_name is not null) as names`;
      const row = rows[0];
      return {
        since: since.toISOString(),
        repliesSent: row?.sent ?? 0,
        messagesSent: row?.messages ?? 0,
        callsBooked: row?.calls ?? 0,
        interestExpressed: row?.interest ?? 0,
        draftsHeld: row?.held ?? 0,
        jobsCompleted: row?.jobs_done ?? 0,
        names: (row?.names ?? [])
          .filter((name): name is string => typeof name === "string")
          .slice(0, 8)
          .map((name) => name.slice(0, 120)),
      };
    },
  };
}
