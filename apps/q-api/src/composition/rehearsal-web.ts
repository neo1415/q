import type { PublicWebResearchProvider } from "@capital-q/q-research";

/**
 * Owner 2026-10-23 (rehearsals made real, R1): what is written about the
 * counterpart online, for the persona. It was one search's snippets; now
 * three searches together (who they are, how they talk in interviews and
 * podcasts, what they write) and the two or three most telling pages read
 * in full, through the research port only (search discovers, extract reads
 * what was discovered: no crawl, no arbitrary fetch). Everything here is
 * public third-party text: data for the persona, never instructions.
 */

export type RehearsalWebSource = {
  readonly kind: "PUBLIC_WEB";
  readonly label: string;
  readonly url: string;
  readonly excerpt: string;
};

export type RehearsalWeb = {
  readonly text: string;
  readonly sources: readonly RehearsalWebSource[];
};

/** What the persona prompt holds of the web (publicPresence). */
export const REHEARSAL_WEB_TEXT_MAX = 6_000;
const PER_QUERY = 4;
const PAGES_READ = 3;
const PAGE_EXCERPT = 1_400;
const SNIPPET_MAX = 260;

/** Pages that show how someone talks and thinks come first. */
const TELLING =
  /interview|podcast|keynote|panel|fireside|blog|essay|thesis|letter|op-?ed|column|q&a|conversation/iu;

export async function rehearsalWeb(
  provider: PublicWebResearchProvider | undefined,
  name: string,
  kind: "COMPANY" | "INVESTOR_ORGANISATION",
  signal?: AbortSignal,
): Promise<RehearsalWeb> {
  if (provider === undefined) return { text: "", sources: [] };
  const who = `"${name.trim().slice(0, 120)}"`;
  const queries =
    kind === "COMPANY"
      ? [
          `${who} startup founder`,
          `${who} founder interview OR podcast`,
          `${who} funding OR launch OR customers`,
        ]
      : [
          `${who} investor`,
          `${who} interview OR podcast OR keynote`,
          `${who} investment thesis OR blog OR portfolio`,
        ];
  const context = { signal: signal ?? AbortSignal.timeout(12_000) };
  const searches = await Promise.all(
    queries.map((query) =>
      provider
        .search(
          {
            query: query.slice(0, 200),
            maxResults: PER_QUERY,
            freshness: "ANY",
            includeDomains: [],
          },
          context,
        )
        .then((result) => result.hits)
        .catch(() => []),
    ),
  );
  // Merged in query order, one entry per URL, https only.
  const seen = new Set<string>();
  const hits = searches
    .flat()
    .filter((hit) => hit.url.startsWith("https://"))
    .filter((hit) => (seen.has(hit.url) ? false : (seen.add(hit.url), true)));
  if (hits.length === 0) return { text: "", sources: [] };

  const telling = (hit: (typeof hits)[number]) =>
    TELLING.test(`${hit.title ?? ""} ${hit.url}`);
  const toRead = [
    ...hits.filter(telling),
    ...hits.filter((hit) => !telling(hit)),
  ]
    .slice(0, PAGES_READ)
    .map((hit) => hit.url);
  const read = await provider
    .extract({ urls: toRead }, { signal: AbortSignal.timeout(15_000) })
    .then((result) => result.pages)
    .catch(() => []);
  const pages = new Map(
    read.map((page) => [page.url, flat(page.text).slice(0, PAGE_EXCERPT)]),
  );

  const lines = new Map<string, string>();
  const sources: RehearsalWebSource[] = [];
  for (const hit of hits) {
    const label = (hit.title ?? hit.url).slice(0, 200);
    const page = pages.get(hit.url);
    const excerpt =
      page !== undefined && page.length > 0
        ? page
        : flat(hit.snippet ?? "").slice(0, SNIPPET_MAX);
    lines.set(
      hit.url,
      page === undefined
        ? `${label}: ${excerpt}`
        : `${label} (read in full, ${hit.url}):\n${excerpt}`,
    );
    sources.push({
      kind: "PUBLIC_WEB",
      label,
      url: hit.url.slice(0, 2_048),
      excerpt: excerpt.slice(0, 600),
    });
  }
  // Pages read in full first, most telling first: they say most about how
  // the person talks; then the rest in search order.
  const readFirst = toRead.filter((url) => pages.has(url));
  const ordered = [
    ...readFirst.map((url) => lines.get(url) ?? ""),
    ...hits
      .filter((hit) => !pages.has(hit.url))
      .map((hit) => lines.get(hit.url) ?? ""),
  ].filter((line) => line.length > 0);
  return {
    text: ordered.join("\n").slice(0, REHEARSAL_WEB_TEXT_MAX),
    sources,
  };
}

function flat(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}
