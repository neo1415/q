/**
 * The one human-safe presentation of a public-web source (CQ-Q-VOICE-001
 * R3). Company Intelligence, the conversational seam and, later, voice all
 * project a source through this and nothing else, so a person never sees or
 * hears a provider label, an evidence id, a tenant, a storage locator or a
 * raw payload — only a title, a domain, a defensible date, the public link
 * and a short provenance phrase.
 */

/** The minimum a research result carries per source. Public fields only. */
export type PublicSourceLike = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
};

export type PublicSourcePresentation = {
  readonly index: number;
  /** The page title, or the domain when the page had none. */
  readonly title: string;
  readonly domain: string;
  /** ISO date (YYYY-MM-DD) when the provider dated the page; otherwise null. */
  readonly publishedOn: string | null;
  readonly retrievedOn: string;
  readonly url: string;
  /** "published 2026-09-02" or "retrieved 2026-09-14": the only defensible date. */
  readonly dateLabel: string;
  /** Short provenance for a person: "Public web source · en.wikipedia.org · published 2026-09-02". */
  readonly provenance: string;
  /** What voice may say for it: the title, never the URL. */
  readonly spoken: string;
};

const TITLE_MAX = 120;

function day(iso: string): string {
  return iso.slice(0, 10);
}

function cleanTitle(title: string | null, domain: string): string {
  const trimmed = (title ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return domain;
  }
  return trimmed.length > TITLE_MAX
    ? `${trimmed.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : trimmed;
}

export function presentPublicSource(
  source: PublicSourceLike,
): PublicSourcePresentation {
  const title = cleanTitle(source.title, source.domain);
  const publishedOn =
    source.publishedAt === null || Number.isNaN(Date.parse(source.publishedAt))
      ? null
      : day(source.publishedAt);
  const retrievedOn = day(source.retrievedAt);
  const dateLabel =
    publishedOn === null
      ? `retrieved ${retrievedOn}`
      : `published ${publishedOn}`;
  return {
    index: source.index,
    title,
    domain: source.domain,
    publishedOn,
    retrievedOn,
    url: source.url,
    dateLabel,
    provenance: `Public web source · ${source.domain} · ${dateLabel}`,
    spoken: title === source.domain ? `a page on ${source.domain}` : title,
  };
}

/** One line a person can read and follow: title (domain, date, link). */
export function describePublicSource(source: PublicSourceLike): string {
  const p = presentPublicSource(source);
  return `${p.title} (${p.domain}, ${p.dateLabel}, ${p.url})`;
}

/**
 * A model that was told to cite a public source by title, domain and date
 * still tends to write "(source S1)". The label is Capital Q's, positional
 * and meaningless to a person, so it is rewritten deterministically into
 * the presentation it stands for. Nothing else in the text changes; an
 * index that names no source is left alone.
 */
export function citePublicSources(
  text: string,
  sources: readonly PublicSourceLike[],
): string {
  if (sources.length === 0) {
    return text;
  }
  const byIndex = new Map(sources.map((source) => [source.index, source]));
  return text.replace(
    /\(?\b(?:public web )?source\s+S(\d{1,2})\b\)?|\bS(\d{1,2})\b(?=[\s.,;:)])/gi,
    (match, a: string | undefined, b: string | undefined) => {
      const source = byIndex.get(Number(a ?? b));
      if (source === undefined) {
        return match;
      }
      const wrapped = match.startsWith("(") && match.endsWith(")");
      const cited = describePublicSource(source);
      return wrapped ? `(${cited})` : cited;
    },
  );
}
