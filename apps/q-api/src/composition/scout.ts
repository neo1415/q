import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { PublicWebResearchProvider } from "@capital-q/q-research";

/**
 * Q's scout (founder direction 2026-09-29: "scheduled web scouring...
 * surface findings on login").
 *
 * Every few hours Q looks on the public web for what is new this month
 * about each recently active founder's own company, by the name and site
 * they gave -- the same public identity the presence read already uses --
 * and keeps the pages it has not reported before. When there is something
 * new the founder is told once, and Q opens with it when they come back.
 *
 * Bounded so a trial budget lasts: only people who used Q in the last
 * week, each at most once a day, at most SCOUT_BATCH people a run, one
 * search each. Nothing found is silence, never a notice.
 */

export const SCOUT_BATCH = 10;
const SCOUT_PER_PERSON_MS = 24 * 3_600_000;
const ACTIVE_WITHIN_MS = 7 * 24 * 3_600_000;
const MAX_NEW_PER_PERSON = 3;

type Candidate = {
  user_id: string;
  tenant_id: string;
  company_id: string;
  canonical_name: string;
  website_url: string | null;
};

/** The query: their company's own name, pinned to it by their own site. */
export function scoutQuery(name: string, websiteUrl: string | null): string {
  let host = "";
  if (websiteUrl !== null) {
    try {
      host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
  }
  return `"${name.trim()}"${host.length > 0 ? ` OR ${host}` : ""} news`.slice(
    0,
    200,
  );
}

export function createScout(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly provider: PublicWebResearchProvider | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): { readonly tick: () => Promise<number> } {
  const { sql, provider, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  return {
    tick: async () => {
      if (provider === undefined) return 0;
      const current = now();
      const candidates = await sql<Candidate[]>`
        select distinct on (m.user_id)
               m.user_id, c.tenant_id, c.id as company_id, c.canonical_name, c.website_url
          from core.company_members m
          join core.companies c on c.id = m.company_id
          left join communication.scout_cursor s on s.user_id = m.user_id
         where c.canonical_name is not null
           and length(btrim(c.canonical_name)) >= 3
           and exists (
             select 1 from q_runtime.runs r
              where r.actor_user_id = m.user_id
                and r.created_at > ${new Date(current.getTime() - ACTIVE_WITHIN_MS)}
           )
           and (s.last_run_at is null
                or s.last_run_at < ${new Date(current.getTime() - SCOUT_PER_PERSON_MS)})
         order by m.user_id
         limit ${SCOUT_BATCH}`;
      let told = 0;
      for (const candidate of candidates) {
        await sql`
          insert into communication.scout_cursor (user_id, last_run_at)
          values (${candidate.user_id}, ${current})
          on conflict (user_id) do update set last_run_at = excluded.last_run_at`;
        try {
          const result = await provider.search(
            {
              query: scoutQuery(
                candidate.canonical_name,
                candidate.website_url,
              ),
              maxResults: 5,
              freshness: "PAST_MONTH",
              includeDomains: [],
            },
            { signal: AbortSignal.timeout(20_000) },
          );
          const fresh: { url: string; title: string | null }[] = [];
          for (const hit of result.hits) {
            if (fresh.length >= MAX_NEW_PER_PERSON) break;
            if (!hit.url.startsWith("https://")) continue;
            const inserted = await sql<{ id: string }[]>`
              insert into communication.scout_findings
                (tenant_id, user_id, company_id, url, title, published_at)
              values (${candidate.tenant_id}, ${candidate.user_id}, ${candidate.company_id},
                      ${hit.url.slice(0, 2048)}, ${hit.title?.slice(0, 300) ?? null},
                      ${hit.publishedAt === null ? null : new Date(hit.publishedAt)})
              on conflict (user_id, url) do nothing
              returning id`;
            if (inserted.length > 0)
              fresh.push({ url: hit.url, title: hit.title });
          }
          if (fresh.length === 0) continue;
          const first = fresh[0]?.title ?? "a new page";
          await sql`
            insert into communication.notifications
              (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
            values (${candidate.tenant_id}, ${candidate.user_id}, 'Q_SCOUT',
                    ${`Q found something new about ${candidate.canonical_name}`.slice(0, 200)},
                    ${first.slice(0, 1000)}, '/profile', null, null,
                    ${`scout:${candidate.user_id}:${current.toISOString().slice(0, 10)}`})
            on conflict (user_id, dedupe_key) do nothing`;
          told += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, companyId: candidate.company_id },
            "scout read failed for one company",
          );
        }
      }
      return told;
    },
  };
}
