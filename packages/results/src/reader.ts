import type {
  FounderResults,
  InvestorResults,
  ResultsActivity,
  ResultsDto,
  ResultsRange,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createPostgresDiscoveryRepository,
  explicitFit,
  isExcluded,
} from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";

/**
 * A person's results on Capital Q (spec §5). Every figure is a count of
 * recorded events in the actor's OWN organisation's records: the company
 * of the active context for a founder, the investor organisation for an
 * investor. Nothing here reads another organisation's private records;
 * the one aggregate about other people (investors opening a founder's
 * profile or pitch) is a count of organisations with a floor of 3, so no
 * single investor's browsing can be read off it. No model; no write.
 */

export const ENGAGEMENT_FLOOR = 3;

export type ResultsWindow = {
  readonly from: string | null;
  readonly to: string;
  readonly label: string;
};

export type RaisePort = (
  actor: ActorContext,
  companyId: string,
) => Promise<{
  readonly target: {
    readonly amount: string;
    readonly currencyCode: string;
  } | null;
  readonly totals: readonly {
    readonly currencyCode: string;
    readonly confirmed: string;
    readonly soft: string;
  }[];
  readonly remaining: string | null;
  readonly pipeline: number;
  readonly investors: readonly {
    readonly investorName: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly bucket: "CONFIRMED" | "SOFT";
  }[];
} | null>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The window asked for: a preset, or a custom from/to (inclusive days). */
export function resultsWindow(
  input: {
    readonly range?: ResultsRange | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
  now: Date = new Date(),
): ResultsWindow {
  const today = isoDay(now);
  if (input.from !== undefined && DAY.test(input.from)) {
    const to =
      input.to !== undefined && DAY.test(input.to) && input.to >= input.from
        ? input.to
        : today;
    return { from: input.from, to, label: `${input.from} to ${to}` };
  }
  const range = input.range ?? "30d";
  if (range === "all") return { from: null, to: today, label: "All time" };
  const days =
    range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 365;
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  return {
    from: isoDay(from),
    to: today,
    label: range === "12m" ? "Last 12 months" : `Last ${String(days)} days`,
  };
}

const DAY_MS = 86_400_000;
/** At most this many bars: a long window is the most recent weeks. */
const ACTIVITY_MAX_POINTS = 52;

type ActivityRow = {
  readonly day: string;
  readonly kind: "interest" | "connection" | "meeting";
  readonly count: number;
};

function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const back = (date.getUTCDay() + 6) % 7;
  return isoDay(new Date(date.getTime() - back * DAY_MS));
}

/**
 * Pure: recorded events per day folded into the window's bars. A month or
 * less is a bar a day; longer is a bar a week (from Monday). Every bar in
 * the window is present, zero when nothing was recorded that day, so the
 * gaps read as quiet, not as missing. "All time" starts at the first
 * recorded event (nothing recorded: no bars).
 */
export function activitySeries(
  rows: readonly ActivityRow[],
  window: ResultsWindow,
): ResultsActivity {
  const days = rows.map((row) => row.day).sort();
  const first = window.from ?? days[0] ?? null;
  if (first === null) return { bucket: "WEEK", points: [] };
  const span =
    (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
      DAY_MS +
    1;
  const bucket: ResultsActivity["bucket"] = span <= 31 ? "DAY" : "WEEK";
  const step = bucket === "DAY" ? DAY_MS : 7 * DAY_MS;
  const keyOf = (day: string) => (bucket === "DAY" ? day : mondayOf(day));
  const starts: string[] = [];
  for (
    let at = Date.parse(`${keyOf(first)}T00:00:00Z`);
    at <= Date.parse(`${window.to}T00:00:00Z`);
    at += step
  ) {
    starts.push(isoDay(new Date(at)));
  }
  const kept = starts.slice(-ACTIVITY_MAX_POINTS);
  const points = new Map(
    kept.map((start) => [
      start,
      { start, interests: 0, connections: 0, meetings: 0 },
    ]),
  );
  for (const row of rows) {
    const point = points.get(keyOf(row.day));
    if (point === undefined) continue;
    if (row.kind === "interest") point.interests += row.count;
    else if (row.kind === "connection") point.connections += row.count;
    else point.meetings += row.count;
  }
  return { bucket, points: [...points.values()] };
}

export function createResultsReader(options: {
  readonly sql: DatabaseExecutor;
  readonly raise?: RaisePort | undefined;
}) {
  const { sql } = options;
  const discovery = createPostgresDiscoveryRepository({ sql });

  /** One side's relationships: exactly one of the two ids is set. */
  async function activityOf(
    side: { company: string | null; investor: string | null },
    window: ResultsWindow,
  ): Promise<ResultsActivity> {
    const from = window.from;
    const to = window.to;
    const rows = await sql<
      { day: string; kind: ActivityRow["kind"]; count: number }[]
    >`
      select to_char(x.at at time zone 'UTC', 'YYYY-MM-DD') as day, x.kind, count(*)::int as count
        from (
          select i.created_at as at, 'interest' as kind
            from network.interests i
            join network.relationships r on r.id = i.relationship_id
           where (r.company_id = ${side.company}::uuid or r.investor_organisation_id = ${side.investor}::uuid)
          union all
          select e.occurred_at as at,
                 case e.event_type when 'connection_accepted' then 'connection' else 'meeting' end as kind
            from network.relationship_events e
            join network.relationships r on r.id = e.relationship_id
           where (r.company_id = ${side.company}::uuid or r.investor_organisation_id = ${side.investor}::uuid)
             and e.event_type in ('connection_accepted', 'meeting_held')
        ) x
       where (${from}::date is null or x.at >= ${from}::date) and x.at < ${to}::date + 1
       group by 1, 2`;
    return activitySeries(rows, window);
  }

  /**
   * Interest sent in the window and its answer: the first accept or
   * decline after it. The median is over answered interest only.
   */
  async function responseOf(
    side: { company: string | null; investor: string | null },
    window: ResultsWindow,
  ) {
    const from = window.from;
    const to = window.to;
    const [row] = await sql<
      {
        sent: number;
        accepted: number;
        declined: number;
        median_hours: number | null;
      }[]
    >`
      with sent as (
        select i.created_at,
               (select e.event_type from network.relationship_events e
                 where e.relationship_id = i.relationship_id
                   and e.event_type in ('connection_accepted', 'interest_declined')
                   and e.occurred_at >= i.created_at
                 order by e.occurred_at limit 1) as answer,
               (select e.occurred_at from network.relationship_events e
                 where e.relationship_id = i.relationship_id
                   and e.event_type in ('connection_accepted', 'interest_declined')
                   and e.occurred_at >= i.created_at
                 order by e.occurred_at limit 1) as answered_at
          from network.interests i
          join network.relationships r on r.id = i.relationship_id
         where (r.company_id = ${side.company}::uuid or r.investor_organisation_id = ${side.investor}::uuid)
           and (${from}::date is null or i.created_at >= ${from}::date)
           and i.created_at < ${to}::date + 1
      )
      select count(*)::int as sent,
             (count(*) filter (where answer = 'connection_accepted'))::int as accepted,
             (count(*) filter (where answer = 'interest_declined'))::int as declined,
             (percentile_cont(0.5) within group (
                order by extract(epoch from (answered_at - created_at)) / 3600)
                filter (where answered_at is not null))::float8 as median_hours
        from sent`;
    const sent = row?.sent ?? 0;
    const answered = (row?.accepted ?? 0) + (row?.declined ?? 0);
    return {
      sent,
      accepted: row?.accepted ?? 0,
      declined: row?.declined ?? 0,
      responseTime: {
        medianHours:
          row?.median_hours === null || row?.median_hours === undefined
            ? null
            : Math.round(row.median_hours * 10) / 10,
        answered,
        waiting: Math.max(0, sent - answered),
      },
    };
  }

  async function sideOf(actor: ActorContext) {
    if (actor.organisationId === undefined || actor.tenantId === undefined) {
      return null;
    }
    const [row] = await sql<
      {
        company_id: string | null;
        company_name: string | null;
        investor_id: string | null;
        investor_name: string | null;
      }[]
    >`
      select
        (select c.id from core.companies c
          where c.tenant_id = ${actor.tenantId} and c.organisation_id = ${actor.organisationId}
          limit 1) as company_id,
        (select c.canonical_name from core.companies c
          where c.tenant_id = ${actor.tenantId} and c.organisation_id = ${actor.organisationId}
          limit 1) as company_name,
        (select i.id from core.investor_organisations i
          where i.tenant_id = ${actor.tenantId} and i.organisation_id = ${actor.organisationId}
          limit 1) as investor_id,
        (select i.display_name from core.investor_organisations i
          where i.tenant_id = ${actor.tenantId} and i.organisation_id = ${actor.organisationId}
          limit 1) as investor_name`;
    if (row?.investor_id !== null && row?.investor_id !== undefined) {
      return {
        kind: "INVESTOR" as const,
        id: row.investor_id,
        name: row.investor_name ?? "Your firm",
      };
    }
    if (row?.company_id !== null && row?.company_id !== undefined) {
      return {
        kind: "FOUNDER" as const,
        id: row.company_id,
        name: row.company_name ?? "Your company",
      };
    }
    return null;
  }

  async function founder(
    actor: ActorContext,
    companyId: string,
    name: string,
    window: ResultsWindow,
  ): Promise<FounderResults> {
    const from = window.from;
    const toExclusive = window.to;
    const raise =
      options.raise === undefined
        ? null
        : await options.raise(actor, companyId).catch(() => null);
    const side = { company: companyId, investor: null };
    const [extra, activity, response] = await Promise.all([
      sql<{ engaged: number; requested: number; fulfilled: number }[]>`
        select
          (select count(distinct r.investor_organisation_id)::int
             from network.relationship_events e
             join network.relationships r on r.id = e.relationship_id
            where r.company_id = ${companyId}
              and (${from}::date is null or e.occurred_at >= ${from}::date)
              and e.occurred_at < ${toExclusive}::date + 1) as engaged,
          (select count(*)::int from network.diligence_requests d
             join network.relationships r on r.id = d.relationship_id
            where r.company_id = ${companyId}
              and (${from}::date is null or d.created_at >= ${from}::date)
              and d.created_at < ${toExclusive}::date + 1) as requested,
          (select count(*)::int from network.diligence_requests d
             join network.relationships r on r.id = d.relationship_id
             join network.diligence_fulfilments f on f.request_id = d.id
            where r.company_id = ${companyId}
              and (${from}::date is null or d.created_at >= ${from}::date)
              and d.created_at < ${toExclusive}::date + 1) as fulfilled`,
      activityOf(side, window),
      responseOf(side, window),
    ]);
    const [states, rows, counts, views, rehearsals, documents] =
      await Promise.all([
        sql<{ state: string; count: number }[]>`
        select current_state as state, count(*)::int as count
          from network.relationships where company_id = ${companyId}
         group by current_state order by count desc`,
        sql<
          {
            investor_id: string;
            investor_name: string;
            state: string;
            since: Date;
          }[]
        >`
        select io.id as investor_id, io.display_name as investor_name, r.current_state as state, r.state_updated_at as since
          from network.relationships r
          join core.investor_organisations io on io.id = r.investor_organisation_id
         where r.company_id = ${companyId}
         order by r.state_updated_at desc limit 200`,
        sql<{ interests: number; connections: number; meetings: number }[]>`
        select
          (select count(*)::int from network.interests i
             join network.relationships r on r.id = i.relationship_id
            where r.company_id = ${companyId}
              and (${from}::date is null or i.created_at >= ${from}::date)
              and i.created_at < ${toExclusive}::date + 1) as interests,
          (select count(*)::int from network.relationship_events e
             join network.relationships r on r.id = e.relationship_id
            where r.company_id = ${companyId} and e.event_type = 'connection_accepted'
              and (${from}::date is null or e.occurred_at >= ${from}::date)
              and e.occurred_at < ${toExclusive}::date + 1) as connections,
          (select count(*)::int from network.relationship_events e
             join network.relationships r on r.id = e.relationship_id
            where r.company_id = ${companyId} and e.event_type = 'meeting_held'
              and (${from}::date is null or e.occurred_at >= ${from}::date)
              and e.occurred_at < ${toExclusive}::date + 1) as meetings`,
        sql<{ opens: number; watches: number }[]>`
        select
          (count(distinct investor_organisation_id) filter (where interaction_type = 'PROFILE_OPEN'))::int as opens,
          (count(distinct investor_organisation_id) filter (where interaction_type = 'WATCH_MILESTONE'))::int as watches
          from recommendation.interaction_events
         where company_id = ${companyId}
           and (${from}::date is null or occurred_at >= ${from}::date)
           and occurred_at < ${toExclusive}::date + 1`,
        sql<
          {
            created_at: Date;
            counterpart: string | null;
            outcome: string | null;
            score: number | null;
            dimensions: unknown;
          }[]
        >`
        select h.created_at, h.counterpart_name as counterpart, h.outcome, h.score,
               h.scorecard -> 'dimensions' as dimensions
          from q_runtime.rehearsals h
         where h.user_id = ${actor.userId} and h.status = 'FINISHED'
           and (${from}::date is null or h.created_at >= ${from}::date)
           and h.created_at < ${toExclusive}::date + 1
         order by h.created_at desc limit 100`,
        sql<{ type: string; count: number }[]>`
        select a.type, count(*)::int as count
          from artifacts.artifacts a
         where a.organisation_id = ${actor.organisationId ?? null}::uuid
           and a.archived_at is null
           and (${from}::date is null or a.created_at >= ${from}::date)
           and a.created_at < ${toExclusive}::date + 1
         group by a.type order by count desc`,
      ]);
    const floored = (value: number) =>
      value === 0 || value >= ENGAGEMENT_FLOOR
        ? { value, belowFloor: false }
        : { value: null, belowFloor: true };
    const count = counts[0];
    const view = views[0];
    return {
      side: "FOUNDER",
      organisationName: name,
      window,
      raise:
        raise === null
          ? null
          : {
              target:
                raise.target === null
                  ? null
                  : {
                      amount: raise.target.amount,
                      currencyCode: raise.target.currencyCode,
                    },
              totals: raise.totals.map((t) => ({ ...t })),
              remaining: raise.remaining,
              inConversation: raise.pipeline,
              committedInvestors: raise.investors.map((i) => ({ ...i })),
            },
      pipeline: {
        byState: states,
        rows: rows.map((r) => ({
          investorName: r.investor_name,
          state: r.state,
          since: new Date(r.since).toISOString(),
          investorOrganisationId: r.investor_id,
        })),
      },
      engagement: {
        interestsReceived: count?.interests ?? 0,
        connections: count?.connections ?? 0,
        meetingsHeld: count?.meetings ?? 0,
        profileOpens: floored(view?.opens ?? 0),
        pitchWatches: floored(view?.watches ?? 0),
      },
      rehearsals: rehearsals.map((r) => ({
        at: new Date(r.created_at).toISOString(),
        counterpart: (r.counterpart ?? "Someone").slice(0, 200),
        outcome: r.outcome,
        score: r.score,
        ratings: ratingsOf(r.dimensions),
      })),
      documents,
      investorsEngaged: extra[0]?.engaged ?? 0,
      diligence: {
        requested: extra[0]?.requested ?? 0,
        fulfilled: extra[0]?.fulfilled ?? 0,
      },
      responseTime: response.responseTime,
      activity,
    };
  }

  async function investor(
    actor: ActorContext,
    investorId: string,
    name: string,
    window: ResultsWindow,
  ): Promise<InvestorResults> {
    const from = window.from;
    const to = window.to;
    const [funnel, upcoming, runs, work, pipeline, mandate] = await Promise.all(
      [
        sql<
          {
            seen: number;
            saved: number;
            interest: number;
            connected: number;
            met: number;
            committed: number;
          }[]
        >`
        select
          (select count(distinct company_id)::int from recommendation.interaction_events
            where investor_organisation_id = ${investorId} and interaction_type = 'IMPRESSION'
              and (${from}::date is null or occurred_at >= ${from}::date) and occurred_at < ${to}::date + 1) as seen,
          (select count(distinct company_id)::int from recommendation.interaction_events
            where investor_organisation_id = ${investorId} and interaction_type = 'SAVE'
              and (${from}::date is null or occurred_at >= ${from}::date) and occurred_at < ${to}::date + 1) as saved,
          (select count(distinct r.company_id)::int from network.interests i
             join network.relationships r on r.id = i.relationship_id
            where r.investor_organisation_id = ${investorId}
              and (${from}::date is null or i.created_at >= ${from}::date) and i.created_at < ${to}::date + 1) as interest,
          (select count(distinct r.company_id)::int from network.relationship_events e
             join network.relationships r on r.id = e.relationship_id
            where r.investor_organisation_id = ${investorId} and e.event_type = 'connection_accepted'
              and (${from}::date is null or e.occurred_at >= ${from}::date) and e.occurred_at < ${to}::date + 1) as connected,
          (select count(distinct r.company_id)::int from network.relationship_events e
             join network.relationships r on r.id = e.relationship_id
            where r.investor_organisation_id = ${investorId} and e.event_type = 'meeting_held'
              and (${from}::date is null or e.occurred_at >= ${from}::date) and e.occurred_at < ${to}::date + 1) as met,
          (select count(distinct r.company_id)::int from network.commitments c
             join network.relationships r on r.id = c.relationship_id
            where r.investor_organisation_id = ${investorId} and c.status in ('STATED', 'CONFIRMED')
              and (${from}::date is null or c.created_at >= ${from}::date) and c.created_at < ${to}::date + 1) as committed`,
        sql<{ company_name: string; starts_at: Date }[]>`
        select co.canonical_name as company_name, m.starts_at
          from communication.meetings m
          join network.relationships r on r.id = m.relationship_id
          join core.companies co on co.id = r.company_id
         where r.investor_organisation_id = ${investorId}
           and m.status = 'SCHEDULED' and m.starts_at > now()
         order by m.starts_at limit 50`,
        sql<{ capability: string; runs: number }[]>`
        select capability, count(*)::int as runs from q_runtime.runs
         where actor_user_id = ${actor.userId} and status = 'COMPLETED'
           and (${from}::date is null or created_at >= ${from}::date) and created_at < ${to}::date + 1
         group by capability order by runs desc`,
        sql<{ errands: number; documents: number }[]>`
        select
          (select count(*)::int from q_runtime.errands e
            where e.user_id = ${actor.userId}
              and (${from}::date is null or e.created_at >= ${from}::date) and e.created_at < ${to}::date + 1) as errands,
          (select count(*)::int from artifacts.artifacts a
            where a.organisation_id = ${actor.organisationId ?? null}::uuid and a.archived_at is null
              and (${from}::date is null or a.created_at >= ${from}::date) and a.created_at < ${to}::date + 1) as documents`,
        sql<
          {
            company_id: string;
            company_name: string;
            state: string;
            stage: string | null;
            nodes:
              { node_id: string; vocabulary: string; label: string }[] | null;
          }[]
        >`
        select co.id as company_id, co.canonical_name as company_name, r.current_state as state,
               co.current_stage_code as stage,
               (select jsonb_agg(jsonb_build_object('node_id', n.id, 'vocabulary', v.code, 'label', n.display_name))
                  from taxonomy.entity_assignments a
                  join taxonomy.nodes n on n.id = a.node_id
                  join taxonomy.vocabularies v on v.id = n.vocabulary_id
                 where a.entity_type = 'COMPANY' and a.entity_id = co.id and a.status = 'ACTIVE') as nodes
          from network.relationships r
          join core.companies co on co.id = r.company_id
         where r.investor_organisation_id = ${investorId}
           and r.current_state not in ('DECLINED', 'CLOSED')
         order by r.state_updated_at desc limit 200`,
        discovery.ownActiveMandate(actor).catch(() => null),
      ],
    );
    const side = { company: null, investor: investorId };
    const [states, commitments, activity, response] = await Promise.all([
      sql<{ state: string; count: number }[]>`
        select current_state as state, count(*)::int as count
          from network.relationships where investor_organisation_id = ${investorId}
         group by current_state order by count desc`,
      sql<
        {
          status: "STATED" | "CONFIRMED" | "WITHDRAWN";
          currency_code: string;
          count: number;
          amount: string;
        }[]
      >`
        select c.status, c.currency_code, count(*)::int as count, sum(c.amount)::text as amount
          from network.commitments c
          join network.relationships r on r.id = c.relationship_id
         where r.investor_organisation_id = ${investorId}
           and c.status in ('STATED', 'CONFIRMED', 'WITHDRAWN')
         group by c.status, c.currency_code
         order by c.status, c.currency_code
         limit 30`,
      activityOf(side, window),
      responseOf(side, window),
    ]);
    const met = await sql<{ held: number }[]>`
      select count(*)::int as held from network.relationship_events e
        join network.relationships r on r.id = e.relationship_id
       where r.investor_organisation_id = ${investorId} and e.event_type = 'meeting_held'
         and (${from}::date is null or e.occurred_at >= ${from}::date) and e.occurred_at < ${to}::date + 1`;
    const f = funnel[0];
    return {
      side: "INVESTOR",
      organisationName: name,
      window,
      funnel: {
        seen: f?.seen ?? 0,
        saved: f?.saved ?? 0,
        interest: f?.interest ?? 0,
        connected: f?.connected ?? 0,
        met: f?.met ?? 0,
        committed: f?.committed ?? 0,
      },
      meetings: {
        held: met[0]?.held ?? 0,
        upcoming: upcoming.map((m) => ({
          companyName: m.company_name,
          startsAt: new Date(m.starts_at).toISOString(),
        })),
      },
      qWork: {
        runs,
        errands: work[0]?.errands ?? 0,
        documents: work[0]?.documents ?? 0,
      },
      pipelineFit: pipeline.map((row) => {
        const classifications = (row.nodes ?? []).map((n) => ({
          nodeId: n.node_id,
          vocabulary: n.vocabulary,
          label: n.label,
        }));
        if (mandate === null) {
          return {
            companyName: row.company_name,
            companyId: row.company_id,
            state: row.state,
            excluded: false,
            reasons: [],
          };
        }
        const fit = explicitFit({
          preferences: mandate.preferences,
          classifications,
          companyStage: row.stage,
          minStage: mandate.minStageCode,
          maxStage: mandate.maxStageCode,
        });
        return {
          companyName: row.company_name,
          companyId: row.company_id,
          state: row.state,
          excluded: isExcluded(mandate.preferences, classifications),
          reasons: fit.reasons.map((reason) => ({
            kind: reason.kind,
            detail: reason.detail.slice(0, 200),
          })),
        };
      }),
      hasMandate: mandate !== null,
      pipeline: { byState: states },
      interest: {
        sent: response.sent,
        accepted: response.accepted,
        declined: response.declined,
      },
      responseTime: response.responseTime,
      commitments: commitments.map((c) => ({
        status: c.status,
        currencyCode: c.currency_code,
        count: c.count,
        amount: c.amount,
      })),
      activity,
    };
  }

  return {
    /** The actor's own results for the window; NONE when they have no company or firm yet. */
    read: async (
      actor: ActorContext,
      window: ResultsWindow,
    ): Promise<ResultsDto> => {
      const side = await sideOf(actor);
      if (side === null) return { side: "NONE" };
      return side.kind === "FOUNDER"
        ? founder(actor, side.id, side.name, window)
        : investor(actor, side.id, side.name, window);
    },
  };
}

function ratingsOf(value: unknown): { dimension: string; rating: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, rating } = entry as { name?: unknown; rating?: unknown };
    return typeof name === "string" && typeof rating === "string"
      ? [{ dimension: name, rating }]
      : [];
  });
}

export type ResultsReader = ReturnType<typeof createResultsReader>;
