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
  short_description: string | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
};

/** What a page must be about to be surfaced as news about their company. */
export type ScoutEntity = {
  readonly name: string;
  readonly websiteUrl: string | null;
  readonly description: string | null;
  readonly city: string | null;
  /** ISO 3166 alpha-2. */
  readonly country: string | null;
};

const hostOf = (url: string | null): string | null => {
  if (url === null) return null;
  try {
    return new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return null;
  }
};

const ENGLISH = new Set([
  "the",
  "and",
  "of",
  "to",
  "in",
  "for",
  "is",
  "on",
  "with",
  "a",
  "an",
  "by",
  "as",
  "at",
  "from",
  "its",
  "it",
  "this",
  "that",
  "are",
  "was",
  "has",
  "have",
  "be",
  "new",
  "about",
  "how",
  "who",
  "their",
  "our",
  "your",
]);
const STOP = new Set([
  ...ENGLISH,
  "company",
  "startup",
  "news",
  "today",
  "will",
  "more",
]);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/**
 * Whether the page reads in English: enough of its words are common
 * English words. Too few words to tell is not English (unknown is not
 * surfaced).
 */
export function readsAsEnglish(text: string): boolean {
  const words = wordsOf(text);
  if (words.length < 6) return false;
  const english = words.filter((word) => ENGLISH.has(word)).length;
  return english / words.length >= 0.12;
}

/**
 * Why a search hit is news about THIS company (QA demo pass: "Q found
 * something new about Ajopot" for a page in Albanian and one about dogs):
 * its name AND something that ties the page to the company -- its own
 * site, its city or country, or two words of what it does -- in a page
 * that reads in English. Anything unclear is not surfaced.
 */
export function scoutRelevance(
  hit: {
    readonly url: string;
    readonly title: string | null;
    readonly snippet: string;
  },
  entity: ScoutEntity,
): { readonly surfaced: boolean; readonly why: string } {
  const text = `${hit.title ?? ""} ${hit.snippet}`;
  const lower = ` ${wordsOf(text).join(" ")} `;
  const host = hostOf(entity.websiteUrl);
  const pageHost = hostOf(hit.url);
  const onTheirSite =
    host !== null &&
    pageHost !== null &&
    (pageHost === host || pageHost.endsWith(`.${host}`));
  const name = wordsOf(entity.name).join(" ");
  const named = name.length > 0 && lower.includes(` ${name} `);
  if (!named && !onTheirSite) return { surfaced: false, why: "not named" };
  if (!readsAsEnglish(text)) {
    return { surfaced: false, why: "not in a language they read" };
  }
  if (onTheirSite) return { surfaced: true, why: "their own site" };
  const ties: string[] = [];
  if (host !== null && lower.includes(` ${wordsOf(host).join(" ")} `)) {
    ties.push("their site");
  }
  const city = entity.city === null ? "" : wordsOf(entity.city).join(" ");
  if (city.length > 0 && lower.includes(` ${city} `)) ties.push("their city");
  if (entity.country !== null) {
    const country = new Intl.DisplayNames(["en"], { type: "region" }).of(
      entity.country,
    );
    if (
      country !== undefined &&
      lower.includes(` ${wordsOf(country).join(" ")} `)
    ) {
      ties.push("their country");
    }
  }
  const does = new Set(
    wordsOf(entity.description ?? "").filter(
      (word) => word.length >= 4 && !STOP.has(word) && !name.includes(word),
    ),
  );
  const shared = new Set(wordsOf(text).filter((word) => does.has(word)));
  if (shared.size >= 2) ties.push("what they do");
  return ties.length > 0
    ? { surfaced: true, why: ties.join(", ") }
    : { surfaced: false, why: "the name alone" };
}

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
               m.user_id, c.tenant_id, c.id as company_id, c.canonical_name, c.website_url,
               c.short_description, c.headquarters_city, c.headquarters_country
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
          const entity: ScoutEntity = {
            name: candidate.canonical_name,
            websiteUrl: candidate.website_url,
            description: candidate.short_description,
            city: candidate.headquarters_city,
            country: candidate.headquarters_country,
          };
          for (const hit of result.hits) {
            if (fresh.length >= MAX_NEW_PER_PERSON) break;
            if (!hit.url.startsWith("https://")) continue;
            // Only pages about THIS company, in a language they read.
            const relevance = scoutRelevance(hit, entity);
            if (!relevance.surfaced) {
              logger?.info(
                { companyId: candidate.company_id, why: relevance.why },
                "scout page not about them; not surfaced",
              );
              continue;
            }
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
