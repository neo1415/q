/**
 * Where The Q Daily reads (DAILY spec §2). Reference data, in code.
 *
 * RSS feeds are what a publisher offers for syndicated display: headline,
 * summary, link and its own thumbnail. The Q Daily uses exactly that, with
 * the publisher named and the article linked; it never re-publishes an
 * article. A feed that fails is skipped for that edition.
 */
export type DailyFeed = {
  readonly publisher: string;
  readonly url: string;
  /** The markets a feed mostly covers, as printed topic words. */
  readonly markets: readonly string[];
};

export const DAILY_FEEDS: readonly DailyFeed[] = [
  {
    publisher: "TechCabal",
    url: "https://techcabal.com/feed/",
    markets: ["Africa", "Nigeria", "Kenya", "West Africa"],
  },
  {
    publisher: "Techpoint Africa",
    url: "https://techpoint.africa/feed/",
    markets: ["Africa", "Nigeria", "West Africa"],
  },
  {
    publisher: "Disrupt Africa",
    url: "https://disrupt-africa.com/feed/",
    markets: ["Africa", "Kenya", "South Africa", "Egypt", "East Africa"],
  },
  {
    publisher: "TechCrunch",
    url: "https://techcrunch.com/category/venture/feed/",
    markets: ["Global", "United States", "North America"],
  },
  {
    publisher: "Crunchbase News",
    url: "https://news.crunchbase.com/feed/",
    markets: ["Global", "United States", "North America"],
  },
  {
    publisher: "Sifted",
    url: "https://sifted.eu/feed",
    markets: ["Europe", "United Kingdom"],
  },
];

/**
 * Feeds worth reading for these markets: those covering one of them, plus
 * the global ones. At most four, so a gathering stays quick.
 */
export function feedsFor(markets: readonly string[]): readonly DailyFeed[] {
  const wanted = new Set(markets.map((market) => market.toLowerCase()));
  const matching = DAILY_FEEDS.filter((feed) =>
    feed.markets.some((market) => wanted.has(market.toLowerCase())),
  );
  const global = DAILY_FEEDS.filter((feed) => feed.markets.includes("Global"));
  const chosen = [...matching, ...global];
  return [...new Map(chosen.map((feed) => [feed.url, feed])).values()].slice(
    0,
    4,
  );
}

/** Publishers known for business and funding reporting: ranked a little higher. */
const KNOWN_PUBLISHERS: Readonly<Record<string, string>> = {
  "techcabal.com": "TechCabal",
  "techpoint.africa": "Techpoint Africa",
  "disrupt-africa.com": "Disrupt Africa",
  "techcrunch.com": "TechCrunch",
  "news.crunchbase.com": "Crunchbase News",
  "sifted.eu": "Sifted",
  "reuters.com": "Reuters",
  "bloomberg.com": "Bloomberg",
  "ft.com": "Financial Times",
  "wsj.com": "The Wall Street Journal",
  "businessday.ng": "BusinessDay",
  "thisdaylive.com": "ThisDay",
  "nairametrics.com": "Nairametrics",
  "techeconomy.ng": "Techeconomy",
  "weetracker.com": "WeeTracker",
  "africa.businessinsider.com": "Business Insider Africa",
  "venturebeat.com": "VentureBeat",
  "fortune.com": "Fortune",
  "forbes.com": "Forbes",
  "theinformation.com": "The Information",
  "axios.com": "Axios",
  "pitchbook.com": "PitchBook",
  "cnbc.com": "CNBC",
  "bbc.co.uk": "BBC",
  "bbc.com": "BBC",
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The publisher's name for a link: a known name, or the site's own host. */
export function publisherOf(url: string): string {
  const host = hostOf(url);
  if (host === null) return "Source";
  return KNOWN_PUBLISHERS[host] ?? host;
}

export function isKnownPublisher(url: string): boolean {
  const host = hostOf(url);
  return host !== null && KNOWN_PUBLISHERS[host] !== undefined;
}
