import {
  RELATIONSHIP_ACTIVE_MATCH_STATES,
  Q_DAILY_OPTIONAL_SECTIONS,
  QDailyEditionSchema,
  QDailyFrequencySchema,
  QDailyOptionalSectionSchema,
  QDailyStorySchema,
  type QDailyEdition,
  type QDailyOptionalSection,
  type QDailyStory,
} from "@capital-q/contracts";
import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import type { InterestProfile } from "../profile.js";
import { nextDueAt } from "../schedule.js";
import type {
  DailyReaderStore,
  DailyWorkerStore,
  DueReader,
  StoredClusterIssue,
} from "../ports.js";

/**
 * The Q Daily's tables (migration 20261114000000), server-side only.
 *
 * Every read of a person's rows names both the person and their tenant;
 * the profile reads only the person's own organisations' company or
 * mandate and their own CONNECTED relationships (both sides agreed, so
 * the counterpart's name is already theirs to know).
 */

const LEASE_MS = 30 * 60 * 1000;

function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function sectionsOf(value: unknown): QDailyOptionalSection[] {
  if (!Array.isArray(value)) return [...Q_DAILY_OPTIONAL_SECTIONS];
  return value.flatMap((code) => {
    const parsed = QDailyOptionalSectionSchema.safeParse(code);
    return parsed.success ? [parsed.data] : [];
  });
}

function storiesOf(value: unknown): QDailyStory[] {
  const raw = json(value);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((story) => {
    const parsed = QDailyStorySchema.safeParse(story);
    return parsed.success ? [parsed.data] : [];
  });
}

function editionOf(value: unknown): QDailyEdition | null {
  const parsed = QDailyEditionSchema.safeParse(json(value));
  return parsed.success ? parsed.data : null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dateText(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

/** Country name in English from an ISO code; the code itself if unknown. */
function countryName(code: string | null): string | null {
  if (code === null || code.trim().length === 0) return null;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.trim().toUpperCase(),
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function labelsFor(
  sql: DatabaseExecutor,
  vocabularies: readonly string[],
  codes: readonly string[],
): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await sql<{ display_name: string }[]>`
    select n.display_name
      from taxonomy.nodes n
      join taxonomy.vocabularies v on v.id = n.vocabulary_id
     where v.code = any(${[...vocabularies]})
       and n.canonical_code = any(${[...codes]})
     order by n.display_name
     limit 8`;
  return rows.map((row) => row.display_name);
}

function codesIn(value: unknown): string[] {
  const raw = json(value);
  if (typeof raw !== "object" || raw === null) return [];
  const values = (raw as { values?: unknown }).values;
  return Array.isArray(values)
    ? values.filter((code): code is string => typeof code === "string")
    : [];
}

export async function readInterestProfile(
  sql: DatabaseExecutor,
  userId: string,
  tenantId: string,
): Promise<InterestProfile | null> {
  const people = await sql<
    { display_name: string | null; email: string | null }[]
  >`
    select p.display_name, u.email
      from identity.user_profiles p
      left join auth.users u on u.id = p.auth_user_id
     where p.id = ${userId} and p.status = 'active'`;
  const person = people[0];
  if (person === undefined) return null;
  const orgs = (
    await sql<{ organisation_id: string }[]>`
      select organisation_id from identity.organisation_memberships
       where user_id = ${userId} and tenant_id = ${tenantId}
         and membership_status = 'active'`
  ).map((row) => row.organisation_id);
  if (orgs.length === 0) return null;
  const readerName = person.display_name?.trim().split(/\s+/)[0] ?? null;
  const email = person.email?.toLowerCase() ?? null;

  const companies = await sql<
    {
      id: string;
      canonical_name: string;
      headquarters_country: string | null;
      current_stage_code: string | null;
    }[]
  >`
    select id, canonical_name, headquarters_country, current_stage_code
      from core.companies
     where organisation_id = any(${orgs}) and tenant_id = ${tenantId}
     order by created_at asc
     limit 1`;
  const company = companies[0];
  if (company !== undefined) {
    const sectors = (
      await sql<{ display_name: string }[]>`
        select n.display_name
          from taxonomy.entity_assignments a
          join taxonomy.nodes n on n.id = a.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where a.entity_type = 'COMPANY' and a.entity_id = ${company.id}
           and a.tenant_id = ${tenantId} and a.status = 'ACTIVE'
           and v.code = 'industry'
         order by a.created_at asc
         limit 4`
    ).map((row) => row.display_name);
    const stages = await labelsFor(
      sql,
      ["company_stage"],
      company.current_stage_code === null ? [] : [company.current_stage_code],
    );
    const raises = await sql<
      {
        target_stage: string | null;
        target_amount: string | null;
        currency_code: string | null;
      }[]
    >`
      select target_stage, target_amount::text as target_amount, currency_code
        from core.capital_objectives
       where company_id = ${company.id} and tenant_id = ${tenantId}
         and status = 'ACTIVE'
       order by created_at desc
       limit 1`;
    const raise = raises[0];
    const raiseStage =
      raise?.target_stage === null || raise === undefined
        ? []
        : await labelsFor(sql, ["company_stage"], [raise.target_stage]);
    const known = (
      await sql<{ name: string }[]>`
        select io.display_name as name
          from network.relationships r
          join core.investor_organisations io on io.id = r.investor_organisation_id
         where r.company_id = ${company.id}
           and r.current_state = any(${[...RELATIONSHIP_ACTIVE_MATCH_STATES]}::text[])
         order by r.state_updated_at desc
         limit 5`
    ).map((row) => row.name);
    const country = countryName(company.headquarters_country);
    return {
      userId,
      tenantId,
      readerName,
      email,
      role: "FOUNDER",
      sectors,
      stages,
      markets: country === null ? [] : [country],
      ownName: company.canonical_name,
      knownNames: known,
      raise:
        raise === undefined
          ? null
          : [
              raiseStage[0] ?? null,
              raise.target_amount === null
                ? null
                : `${raise.target_amount.replace(/\.0+$/, "")} ${raise.currency_code ?? ""}`.trim(),
            ]
              .filter((part): part is string => part !== null)
              .join(", ") || null,
    };
  }

  const investors = await sql<
    { id: string; display_name: string; hq_country: string | null }[]
  >`
    select id, display_name, hq_country
      from core.investor_organisations
     where organisation_id = any(${orgs}) and tenant_id = ${tenantId}
     order by created_at asc
     limit 1`;
  const investor = investors[0];
  if (investor === undefined) return null;
  const mandates = await sql<
    {
      id: string;
      min_stage_code: string | null;
      max_stage_code: string | null;
    }[]
  >`
    select id, min_stage_code, max_stage_code
      from core.investor_mandates
     where investor_organisation_id = ${investor.id} and tenant_id = ${tenantId}
       and status = 'ACTIVE'
     order by updated_at desc
     limit 1`;
  const mandate = mandates[0];
  let sectors: string[] = [];
  let stages: string[] = [];
  let markets: string[] = [];
  if (mandate !== undefined) {
    // Declared preferences only; avoidances and hard exclusions are not
    // topics to follow.
    const constraints = await sql<
      { dimension: string; value_jsonb: unknown }[]
    >`
      select dimension, value_jsonb
        from core.investor_mandate_constraints
       where mandate_id = ${mandate.id} and tenant_id = ${tenantId}
         and operator in ('EQ', 'IN')
         and importance in ('MUST', 'STRONG', 'NICE')
         and dimension in ('sector', 'stage', 'geography.country')`;
    const codes = (dimension: string): string[] =>
      constraints
        .filter((row) => row.dimension === dimension)
        .flatMap((row) => codesIn(row.value_jsonb));
    sectors = await labelsFor(sql, ["industry"], codes("sector"));
    const preferred = (
      await sql<{ display_name: string }[]>`
        select n.display_name
          from taxonomy.mandate_preferences p
          join taxonomy.nodes n on n.id = p.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where p.mandate_id = ${mandate.id} and p.tenant_id = ${tenantId}
           and not p.is_exclusion and v.code = 'industry'
         limit 4`
    ).map((row) => row.display_name);
    sectors = [...new Set([...sectors, ...preferred])];
    stages = await labelsFor(
      sql,
      ["company_stage"],
      [
        ...codes("stage"),
        ...[mandate.min_stage_code, mandate.max_stage_code].filter(
          (code): code is string => code !== null,
        ),
      ],
    );
    markets = codes("geography.country")
      .map(countryName)
      .filter((name): name is string => name !== null);
  }
  if (markets.length === 0) {
    const home = countryName(investor.hq_country);
    if (home !== null) markets = [home];
  }
  const known = (
    await sql<{ name: string }[]>`
      select c.canonical_name as name
        from network.relationships r
        join core.companies c on c.id = r.company_id
       where r.investor_organisation_id = ${investor.id}
         and r.current_state = any(${[...RELATIONSHIP_ACTIVE_MATCH_STATES]}::text[])
       order by r.state_updated_at desc
       limit 5`
  ).map((row) => row.name);
  return {
    userId,
    tenantId,
    readerName,
    email,
    role: "INVESTOR",
    sectors,
    stages,
    markets,
    ownName: investor.display_name,
    knownNames: known,
    raise: null,
  };
}

export function createPostgresDailyWorkerStore(
  sql: DatabaseExecutor,
): DailyWorkerStore {
  return {
    ensureDefaults: async (now, limit) => {
      // People with an active membership in a company or investor
      // organisation (setup done) and no preferences yet: weekly default.
      const rows = await sql<
        { user_id: string; tenant_id: string; timezone: string | null }[]
      >`
        select distinct on (m.user_id) m.user_id, m.tenant_id, p.timezone
          from identity.organisation_memberships m
          join identity.user_profiles p on p.id = m.user_id and p.status = 'active'
         where m.membership_status = 'active'
           and (exists (select 1 from core.companies c where c.organisation_id = m.organisation_id)
                or exists (select 1 from core.investor_organisations io where io.organisation_id = m.organisation_id))
           and not exists (select 1 from q_runtime.daily_preferences d where d.user_id = m.user_id)
         order by m.user_id, m.joined_at asc
         limit ${limit}`;
      let created = 0;
      for (const row of rows) {
        const due = nextDueAt("WEEKLY", row.timezone, now);
        const inserted = await sql`
          insert into q_runtime.daily_preferences (user_id, tenant_id, frequency, next_due_at)
          values (${row.user_id}, ${row.tenant_id}, 'WEEKLY', ${due})
          on conflict (user_id) do nothing
          returning user_id`;
        created += inserted.length;
      }
      return created;
    },
    claimDue: async (now, limit) => {
      const lease = new Date(now.getTime() + LEASE_MS);
      const rows = await sql<
        {
          user_id: string;
          tenant_id: string;
          frequency: string;
          email: boolean;
          sections: string[];
          requested_at: Date | null;
          timezone: string | null;
        }[]
      >`
        with due as (
          select user_id from q_runtime.daily_preferences
           where next_due_at <= ${now} and (frequency <> 'OFF' or requested_at is not null)
           order by next_due_at asc
           limit ${limit}
           for update skip locked
        )
        update q_runtime.daily_preferences d
           set next_due_at = ${lease}, updated_at = clock_timestamp()
          from due, identity.user_profiles p
         where d.user_id = due.user_id and p.id = d.user_id
        returning d.user_id, d.tenant_id, d.frequency, d.email, d.sections,
                  d.requested_at, p.timezone`;
      return rows.flatMap((row): DueReader[] => {
        const frequency = QDailyFrequencySchema.safeParse(row.frequency);
        if (!frequency.success || frequency.data === "OFF") return [];
        return [
          {
            userId: row.user_id,
            tenantId: row.tenant_id,
            frequency: frequency.data,
            email: row.email,
            sections: sectionsOf(row.sections),
            timeZone: row.timezone,
            requested: row.requested_at !== null,
          },
        ];
      });
    },
    editionsToday: async (now) => {
      const rows = await sql<{ count: number }[]>`
        select count(*)::int as count from q_runtime.daily_editions
         where created_at >= date_trunc('day', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC'`;
      return rows[0]?.count ?? 0;
    },
    profileOf: (userId, tenantId) => readInterestProfile(sql, userId, tenantId),
    clusterIssue: async (clusterKey, issueDate) => {
      const rows = await sql<
        {
          id: string;
          stories: unknown;
          searches_used: number;
          model_calls_used: number;
        }[]
      >`
        select id, stories, searches_used, model_calls_used
          from q_runtime.daily_cluster_issues
         where cluster_key = ${clusterKey} and issue_date = ${issueDate}`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            stories: storiesOf(row.stories),
            searchesUsed: row.searches_used,
            modelCallsUsed: row.model_calls_used,
          };
    },
    saveClusterIssue: async (issue) => {
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.daily_cluster_issues
          (cluster_key, issue_date, topics, stories, searches_used, model_calls_used)
        values (${issue.clusterKey}, ${issue.issueDate},
                ${jsonbParam(sql, issue.topics)}, ${jsonbParam(sql, issue.stories)},
                ${Math.min(issue.searchesUsed, 50)}, ${Math.min(issue.modelCallsUsed, 50)})
        on conflict (cluster_key, issue_date) do nothing
        returning id`;
      const id = rows[0]?.id;
      if (id !== undefined) {
        return {
          id,
          stories: issue.stories,
          searchesUsed: issue.searchesUsed,
          modelCallsUsed: issue.modelCallsUsed,
        } satisfies StoredClusterIssue;
      }
      // Another worker gathered the same topics first: use theirs.
      const existing = await sql<
        {
          id: string;
          stories: unknown;
          searches_used: number;
          model_calls_used: number;
        }[]
      >`
        select id, stories, searches_used, model_calls_used
          from q_runtime.daily_cluster_issues
         where cluster_key = ${issue.clusterKey} and issue_date = ${issue.issueDate}`;
      const row = existing[0];
      if (row === undefined) throw new Error("cluster issue vanished");
      return {
        id: row.id,
        stories: storiesOf(row.stories),
        searchesUsed: row.searches_used,
        modelCallsUsed: row.model_calls_used,
      };
    },
    nextNumber: async (userId) => {
      const rows = await sql<{ next: number }[]>`
        select coalesce(max(number), 0)::int + 1 as next
          from q_runtime.daily_editions where user_id = ${userId}`;
      return rows[0]?.next ?? 1;
    },
    saveEdition: async (edition) => {
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.daily_editions
          (id, user_id, tenant_id, edition_date, number, frequency, cluster_issue_id,
           content, searches_used, model_calls_used)
        values (${edition.id}, ${edition.userId}, ${edition.tenantId},
                ${edition.content.editionDate}, ${edition.content.number},
                ${edition.content.frequency}, ${edition.clusterIssueId},
                ${jsonbParam(sql, edition.content)},
                ${edition.searchesUsed}, ${edition.modelCallsUsed})
        on conflict do nothing
        returning id`;
      return rows[0]?.id ?? null;
    },
    markEmailed: async (editionId, outcome) => {
      await sql`
        update q_runtime.daily_editions
           set emailed_at = ${outcome.ok ? new Date() : null},
               email_error = ${outcome.ok ? null : outcome.error.slice(0, 300)}
         where id = ${editionId}`;
    },
    reschedule: async (userId, next) => {
      await sql`
        update q_runtime.daily_preferences
           set next_due_at = ${next}, requested_at = null, updated_at = clock_timestamp()
         where user_id = ${userId}`;
    },
  };
}

export function createPostgresDailyReaderStore(
  sql: DatabaseExecutor,
): DailyReaderStore {
  return {
    preferences: async (userId, tenantId) => {
      const rows = await sql<
        {
          frequency: string;
          email: boolean;
          sections: string[];
          next_due_at: Date | null;
          requested_at: Date | null;
        }[]
      >`
        select frequency, email, sections, next_due_at, requested_at
          from q_runtime.daily_preferences
         where user_id = ${userId} and tenant_id = ${tenantId}`;
      const row = rows[0];
      if (row === undefined) return null;
      const frequency = QDailyFrequencySchema.safeParse(row.frequency);
      return {
        frequency: frequency.success ? frequency.data : "WEEKLY",
        email: row.email,
        sections: sectionsOf(row.sections),
        nextDueAt: iso(row.next_due_at),
        requestedAt: iso(row.requested_at),
      };
    },
    timeZoneOf: async (userId) => {
      const rows = await sql<{ timezone: string | null }[]>`
        select timezone from identity.user_profiles where id = ${userId}`;
      return rows[0]?.timezone ?? null;
    },
    savePreferences: async (userId, tenantId, preferences) => {
      await sql`
        insert into q_runtime.daily_preferences
          (user_id, tenant_id, frequency, email, sections, next_due_at)
        values (${userId}, ${tenantId}, ${preferences.frequency}, ${preferences.email},
                ${[...preferences.sections]}::text[], ${preferences.nextDueAt})
        on conflict (user_id) do update
           set frequency = excluded.frequency,
               email = excluded.email,
               sections = excluded.sections,
               next_due_at = excluded.next_due_at,
               updated_at = clock_timestamp()
         where q_runtime.daily_preferences.tenant_id = excluded.tenant_id`;
    },
    request: async (userId, tenantId, now) => {
      await sql`
        update q_runtime.daily_preferences
           set requested_at = ${now}, next_due_at = ${now}, updated_at = clock_timestamp()
         where user_id = ${userId} and tenant_id = ${tenantId}`;
    },
    latest: async (userId, tenantId) => {
      const rows = await sql<{ content: unknown }[]>`
        select content from q_runtime.daily_editions
         where user_id = ${userId} and tenant_id = ${tenantId}
         order by edition_date desc, number desc
         limit 1`;
      return rows[0] === undefined ? null : editionOf(rows[0].content);
    },
    edition: async (userId, tenantId, editionId) => {
      const rows = await sql<{ content: unknown }[]>`
        select content from q_runtime.daily_editions
         where id = ${editionId} and user_id = ${userId} and tenant_id = ${tenantId}`;
      return rows[0] === undefined ? null : editionOf(rows[0].content);
    },
    archive: async (userId, tenantId, options) => {
      const rows = await sql<
        {
          id: string;
          number: number;
          edition_date: Date | string;
          frequency: string;
          headline: string | null;
        }[]
      >`
        select id, number, edition_date, frequency,
               content -> 'lead' ->> 'headline' as headline
          from q_runtime.daily_editions
         where user_id = ${userId} and tenant_id = ${tenantId}
           and (${options.before}::date is null or edition_date < ${options.before}::date)
         order by edition_date desc, number desc
         limit ${options.limit}`;
      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        editionDate: dateText(row.edition_date),
        frequency: row.frequency === "DAILY" ? "DAILY" : "WEEKLY",
        headline: row.headline === null ? null : row.headline.slice(0, 200),
      }));
    },
    lastEditionAt: async (userId, tenantId) => {
      const rows = await sql<{ created_at: Date }[]>`
        select created_at from q_runtime.daily_editions
         where user_id = ${userId} and tenant_id = ${tenantId}
         order by created_at desc
         limit 1`;
      return rows[0]?.created_at ?? null;
    },
  };
}
