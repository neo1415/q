// Web-search provider benchmark (owner 2026-10-23: "check Brave out to see if
// it's better than the ones we have"). The same ten investment-analyst
// queries go to every provider whose key is in this process's environment,
// directly to each vendor, one query at a time. For each provider it prints
// latency (p50/max), how many results came back, how many carry a date and
// how many are from the last 12 months, and each query's top-5 domains, so
// relevance can be judged by reading. No key is ever printed.
//
// Spend: ten queries per configured provider (plus five news queries for
// providers with a news vertical): well under $1 at list prices.
//
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/search-benchmark.mjs
//
// Keys read (any subset): BRAVE_API | BRAVE_SEARCH_API_KEY, TAVILY_API_KEY,
// SERPER_API_KEY, SERP_API_KEY (Serper.dev or SerpApi, detected).

const QUERIES = [
  "Zino Aviation",
  "Zino Aviation team founder",
  "Captain Zino Mario",
  "Flutterwave latest news",
  "Moniepoint funding round 2025",
  "Paystack Stripe acquisition",
  "Nigeria fintech seed investors 2026",
  "Kenya cleantech startup Series A",
  "Andela layoffs",
  "TLcom Capital fund size",
];
const NEWS = QUERIES.filter((query) =>
  /news|funding|layoffs|acquisition/i.test(query),
);

const keyOf = (...names) =>
  names
    .map((name) => process.env[name]?.trim())
    .find((v) => v && !v.startsWith("disabled"));

const domain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
};

async function timed(run) {
  const started = performance.now();
  try {
    const hits = await run();
    return { ms: Math.round(performance.now() - started), hits, error: null };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - started),
      hits: [],
      error: String(error.message ?? error).slice(0, 80),
    };
  }
}

async function json(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const providers = [];
const brave = keyOf("BRAVE_API", "BRAVE_SEARCH_API_KEY");
if (brave) {
  const get = (vertical, query) =>
    fetch(
      `https://api.search.brave.com/res/v1/${vertical}/search?count=10&q=${encodeURIComponent(query)}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": brave },
      },
    ).then(json);
  providers.push({
    name: "brave",
    web: async (q) =>
      ((await get("web", q)).web?.results ?? []).map((r) => ({
        url: r.url,
        date: r.page_age ?? null,
      })),
    news: async (q) =>
      ((await get("news", q)).results ?? []).map((r) => ({
        url: r.url,
        date: r.page_age ?? null,
      })),
  });
}
const tavily = keyOf("TAVILY_API_KEY");
if (tavily) {
  const post = (body) =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tavily}`,
      },
      body: JSON.stringify({ max_results: 10, ...body }),
    }).then(json);
  providers.push({
    name: "tavily",
    web: async (q) =>
      ((await post({ query: q })).results ?? []).map((r) => ({
        url: r.url,
        date: r.published_date ?? null,
      })),
    news: async (q) =>
      ((await post({ query: q, topic: "news" })).results ?? []).map((r) => ({
        url: r.url,
        date: r.published_date ?? null,
      })),
  });
}
const serper = keyOf("SERPER_API_KEY", "SERP_API_KEY");
if (serper) {
  const post = (path, q) =>
    fetch(`https://google.serper.dev/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": serper },
      body: JSON.stringify({ q, num: 10 }),
    }).then(json);
  providers.push({
    name: "serper",
    web: async (q) =>
      ((await post("search", q)).organic ?? []).map((r) => ({
        url: r.link,
        date: r.date ?? null,
      })),
    news: async (q) =>
      ((await post("news", q)).news ?? []).map((r) => ({
        url: r.link,
        date: r.date ?? null,
      })),
  });
}
const serpapi = keyOf("SERP_API_KEY");
if (serpapi) {
  const get = (engine, q) =>
    fetch(
      `https://serpapi.com/search.json?engine=${engine}&num=10&q=${encodeURIComponent(q)}&api_key=${serpapi}`,
    ).then(json);
  providers.push({
    name: "serpapi",
    web: async (q) =>
      ((await get("google", q)).organic_results ?? []).map((r) => ({
        url: r.link,
        date: r.date ?? null,
      })),
    news: async (q) =>
      ((await get("google_news", q)).news_results ?? []).map((r) => ({
        url: r.link,
        date: r.date ?? null,
      })),
  });
}

if (providers.length === 0) {
  console.log("no provider key in this environment");
  process.exit(0);
}

const recent = (date) => {
  if (date === null) return false;
  const parsed = Date.parse(date);
  if (!Number.isNaN(parsed)) return Date.now() - parsed < 365 * 86_400_000;
  // "3 days ago", "2 weeks ago", "5 months ago"
  return /\b(hour|day|week)s?\b|\b([1-9]|1[01]) months?\b/i.test(date);
};

for (const provider of providers) {
  const rows = [];
  for (const query of QUERIES)
    rows.push({
      query,
      kind: "web",
      ...(await timed(() => provider.web(query))),
    });
  for (const query of NEWS)
    rows.push({
      query,
      kind: "news",
      ...(await timed(() => provider.news(query))),
    });
  const ok = rows.filter((row) => row.error === null);
  const ms = ok.map((row) => row.ms).sort((a, b) => a - b);
  const hits = ok.flatMap((row) => row.hits);
  console.log(
    `\n=== ${provider.name}: ${ok.length}/${rows.length} answered; p50 ${ms[Math.floor(ms.length / 2)] ?? "-"} ms, max ${ms.at(-1) ?? "-"} ms; ${hits.length} results, ${hits.filter((h) => h.date).length} dated, ${hits.filter((h) => recent(h.date)).length} from the last 12 months`,
  );
  for (const row of rows) {
    console.log(
      `${row.kind.padEnd(4)} ${String(row.ms).padStart(5)} ms  ${row.query.padEnd(38)} ${
        row.error ??
        row.hits
          .slice(0, 5)
          .map((h) => domain(h.url))
          .join(", ")
      }`,
    );
  }
}
