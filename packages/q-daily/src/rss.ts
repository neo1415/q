import type { DailyFeed } from "./sources.js";

/**
 * A publisher's RSS or Atom feed, read for what it offers for syndication
 * (DAILY spec §2): title, link, date, a short summary and the publisher's
 * own thumbnail. The feed is machine-written XML from a fixed list of
 * addresses in code; nothing here reads anybody's words.
 *
 * Deliberately small rather than a general XML parser: items are found by
 * their element names, CDATA and the common entities are decoded, markup
 * inside a summary is dropped, and everything is bounded.
 */
export type FeedItem = {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly summary: string;
  /** The publisher's own thumbnail from the feed, https only. */
  readonly thumbnailUrl: string | null;
};

const MAX_FEED_BYTES = 2_000_000;
const MAX_SUMMARY = 600;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Markup out, entities decoded, whitespace collapsed. */
export function plainText(fragment: string): string {
  const unwrapped = unwrapCdata(fragment);
  // Entity-encoded markup (common in RSS descriptions) is decoded first so
  // its tags are dropped too.
  const decodedOnce = /&lt;[a-z/!]/i.test(unwrapped)
    ? decodeEntities(unwrapped)
    : unwrapped;
  const withoutTags = decodedOnce
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function element(block: string, name: string): string | null {
  const pattern = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,
    "i",
  );
  const match = pattern.exec(block);
  return match?.[1] ?? null;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return match === null ? null : decodeEntities(match[2] ?? match[3] ?? "");
}

function httpsUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function linkOf(block: string): string | null {
  // RSS: <link>https://...</link>. Atom: <link rel="alternate" href="..."/>.
  const text = element(block, "link");
  if (text !== null && text.trim().length > 0) {
    return httpsUrl(plainText(text));
  }
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = attribute(tag, "rel");
    if (rel === null || rel === "alternate") {
      const href = httpsUrl(attribute(tag, "href"));
      if (href !== null) return href;
    }
  }
  return null;
}

function thumbnailOf(block: string): string | null {
  const candidates = [
    ...(block.match(/<media:thumbnail\b[^>]*>/gi) ?? []),
    ...(block.match(/<media:content\b[^>]*>/gi) ?? []).filter((tag) => {
      const medium = attribute(tag, "medium");
      const type = attribute(tag, "type");
      return medium === "image" || (type?.startsWith("image/") ?? false);
    }),
    ...(block.match(/<enclosure\b[^>]*>/gi) ?? []).filter(
      (tag) => attribute(tag, "type")?.startsWith("image/") ?? false,
    ),
  ];
  for (const tag of candidates) {
    const url = httpsUrl(attribute(tag, "url"));
    if (url !== null) return url;
  }
  return null;
}

function dateOf(block: string): string | null {
  const raw =
    element(block, "pubDate") ??
    element(block, "published") ??
    element(block, "updated") ??
    element(block, "dc:date");
  if (raw === null) return null;
  const parsed = new Date(plainText(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseFeed(
  xml: string,
  feed: Pick<DailyFeed, "publisher">,
  limit: number,
): readonly FeedItem[] {
  const text = xml.slice(0, MAX_FEED_BYTES);
  const blocks = [
    ...(text.match(/<item\b[\s\S]*?<\/item>/gi) ?? []),
    ...(text.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []),
  ];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    if (items.length >= limit) break;
    const title = plainText(element(block, "title") ?? "").slice(0, 300);
    const url = linkOf(block);
    if (title.length === 0 || url === null) continue;
    const summary = plainText(
      element(block, "description") ??
        element(block, "summary") ??
        element(block, "content") ??
        "",
    ).slice(0, MAX_SUMMARY);
    items.push({
      publisher: feed.publisher,
      title,
      url,
      publishedAt: dateOf(block),
      summary,
      thumbnailUrl: thumbnailOf(block),
    });
  }
  return items;
}

/** Reads one feed over HTTPS with a deadline; a failure is an empty feed. */
export async function readFeed(
  feed: DailyFeed,
  options: {
    readonly limit: number;
    readonly fetch?: typeof fetch | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<readonly FeedItem[]> {
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(8_000);
  try {
    const response = await doFetch(feed.url, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, text/xml;q=0.9",
        "user-agent": "CapitalQ-QDaily/1.0 (+https://capitalq.ai)",
      },
      redirect: "follow",
      signal:
        options.signal === undefined
          ? timeout
          : AbortSignal.any([options.signal, timeout]),
    });
    if (!response.ok) return [];
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_FEED_BYTES) return [];
    return parseFeed(await response.text(), feed, options.limit);
  } catch {
    return [];
  }
}
