# Web research standard — what "excellent" means for Q

Owner, 23 Oct 2026: "Q has no excuse not to have excellent internet searching skills", and "research what excellent internet searching, scraping and pulling skills mean in this context." Q is an institutional investment analyst, so it researches like one: fast, from several independent sources, reading the pages, citing every fact with its date, and saying plainly what it could not find.

Status legend: **DONE** is code merged or in an open PR (#330, #332, this PR). **GAP** is not built yet.

## 1. Plan the search before sending it

- **Disambiguate the entity.** Search the name exactly as the person said it, plus its country or sector when Capital Q knows them. Check that each page is about them (`subjectMatch`, entity resolution) and keep namesakes apart. Two equally plausible matches are reported as ambiguous, never merged. DONE (entity resolution; picture title check).
- **Use several angles at once (2–4 phrasings).** The planned queries cover:
  - the subject itself;
  - its people: public professional profiles such as LinkedIn and Crunchbase-style pages (DONE: `<name> linkedin` for people questions);
  - recent news (DONE: a past-month query sent to the news verticals);
  - money: funding rounds and investors (GAP: a `<name> funding` angle for company questions);
  - filings: Companies House and SEC EDGAR exist for investors (GAP: not yet used for companies).
- **Egress.** Only the person's own words and authorised public identity leave Capital Q (`composeEgressQuery`). DONE.

## 2. Fan out across independent indexes, in parallel

- Brave runs its own index. Serper and SerpApi return Google results. Tavily is its own AI-oriented index. Bright Data (when its zones are set) provides a Google SERP API plus an unblocker. Each misses things the others find.
- Every configured index is asked at once, each under its own deadline. Hits are merged by canonical URL, and agreement between indexes is a ranking signal. DONE (`createFallbackResearchProvider({ parallelSearch: true })`; Brave added in this PR).
- A refused key (401, 402 or 403) rests for 10 minutes and a 429 for 1 minute; the others carry on. DONE (#330).
- The web search starts as soon as the turn is read, beside Capital Q's own reads, never after them. DONE (#330).

## 3. Read the pages, not only the snippets

- Extract the top 4–6 results in parallel, then quote bounded excerpts with the URL, the site and the publish date. DONE:
  - Tavily reads pages in one batch;
  - Serper and ScrapingBee page reads became parallel in this PR;
  - Brave's `extra_snippets` add further passages from each page.
- Treat page text as untrusted data. It is fenced, and prompt-injection signals are counted. DONE.
- Only public pages are read. Nothing behind a login, and no LinkedIn scraping: profile pages come only from the indexes' public results and snippets.

## 4. Turn pages into cited facts

- Every web fact is stated with its source and date. Public material is labelled as such and is never written as verified: no Write Gate promotion without confirmation. DONE (the `WEB_BESIDE_RECORDS_NOTE` rule and source blocks).
- Separate the three source types in the answer: Capital Q's records, the company's own claims, and third-party reporting. DONE (prompt rule).
- **Contradictions coexist.** When sources disagree (two funding amounts, two founding years), show both with their sources and dates. Never pick the favourable one. DONE for the comparison against the record. GAP for source-vs-source reconciliation as a structured block.

## 5. Recency

- Prefer the newest dated sources for "latest" questions, and say how old the newest source is. Keep a separate past-month pass on every search. DONE.
- Never present an undated page as current. GAP: the answer should say "undated" explicitly.

## 6. Pictures

- Show a photo of the person or company from public pages, credited "From <site>", linked, and marked as not a verified identity. Take it from image search across the SERP key and Brave in parallel. Keep it only when the page title names them, and at most one per site. DONE (#332; Brave images added in this PR). Stock photos (Pexels) are only for generic illustration.

## 7. Speed budget (targets)

| Step                                            | Target                                  |
| ----------------------------------------------- | --------------------------------------- |
| First words ("I'm checking what's public on X") | ≤ 2–3 s after the turn is read          |
| Search fan-out (all indexes)                    | ≤ 1.5 s p50; per-index deadline ≈ 6–8 s |
| Page reads (parallel)                           | ≤ 3 s p50                               |
| Pictures                                        | after the words; capped at 2 s          |
| Whole answer with web                           | ≤ 10 s p50                              |

## 8. Honest "not found"

- If the search ran, answer from it. If it truly failed or found nothing relevant, say so in one sentence and give what was found, including what Capital Q holds. Never "I can't browse the internet", and never answer from general model knowledge as if it were evidence. DONE (prompt rule plus the early search).

## Benchmark (23 Oct, `scripts/handoff/live/search-benchmark.mjs`)

**Setup.** The same 10 investment queries (Zino Aviation, its team, Captain Zino Mario, Flutterwave news, Moniepoint funding, Paystack/Stripe, Nigeria seed investors, a Kenya cleantech Series A, Andela layoffs, TLcom fund size), plus 4 news queries.

**Brave (measured from this session).**

| Measure          | Result                                                |
| ---------------- | ----------------------------------------------------- |
| Queries answered | 14/14                                                 |
| Latency, web     | p50 511 ms, max 837 ms                                |
| Latency, news    | about 300–420 ms                                      |
| Results          | 140, of which 86 dated and 65 from the last 12 months |

Relevance, judged by reading the top 5 of each query:

- Zino Aviation: own site, LinkedIn company page, Vanguard and ThisDay articles.
- Flutterwave: Semafor, TechCrunch, Forbes; news vertical TechCabal and Punch.
- TLcom: own site and PitchBook.
- Weak spots were directory and listicle sites on the broad "investors in X" queries.

Spend: 14 queries, about $0.07 at list price.

**Tavily, Serper/SerpApi, Bright Data.** Not measured: their keys exist only on Railway, not in this session. Running the same script with q-api's variables prints the same table for each, at about $0.10–0.30 in total.

**Recommendation.** Keep every index in parallel, adding Brave. Brave is the fastest measured, finds the company's own site, LinkedIn and Nigerian press for the demo entities, and its news vertical answers in about 0.3 s. On cost, Brave and Serper are the cheapest per query at list prices; SerpApi is the most expensive.

## Open gaps, in priority order

1. A funding/investors angle in query planning for company questions.
2. A structured source-vs-source contradiction block.
3. Saying "undated" for undated sources.
4. Companies House and EDGAR for company questions (they are used today for investors only).
5. The workers' presence composition still uses SerpApi directly (not the detecting adapter) and has no Brave.
