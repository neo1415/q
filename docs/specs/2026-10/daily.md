# DAILY: The Q Daily (2026-10)

Owner: DAILY worker, branch `build/daily` (from 1a46bdb3). Migrations
`20261114*`. Lead merges by cherry-pick.

## 1. Goals, in the founder's words

> An agent constantly scouring every part of the internet to give new
> reports on the things that matter to each individual user, working with
> the documents engine to turn that news into a newspaper: complete full
> pages and articles about investments and things that concern the user,
> with real relevant pictures, diagrams and designs, delivered to their
> email (weekly by default, daily opt-in) and their dashboard, without
> waiting for the user to ask. Nothing about investment and capital
> raising should require going elsewhere, even Google.

Acceptance (G1-G8):

- G1 Every onboarded person gets an edition without asking: weekly by
  default (Monday, 07:00 in their time zone), daily if they opt in, off if
  they turn it off.
- G2 Personal: chosen from their own records only (sector, stage,
  geography of their company or mandate; their raise; the companies and
  investors they have a relationship with). Never another person's data.
- G3 A newspaper, not a link list: masthead, lead story, sections (Your
  sector, Your market, Deals and rounds, People you know in the news),
  briefs, a deals diagram, photographs with credits, and **Q's take**,
  labelled as Q inference.
- G4 Every claim cites its source; quotes are verbatim from the source;
  no number that is not in the source; no invented facts.
- G5 Delivered three ways: email (newspaper HTML that works in Gmail and
  Outlook), the dashboard reader "The Q Daily" with an archive, and a PDF
  edition.
- G6 Preferences in Settings (frequency, sections, email on/off, off
  entirely) and through Q ("show me today's Q Daily", "make it weekly").
- G7 Budget guard: hard caps on searches and model calls per edition and
  per day; shared public topic clusters reuse one gathering.
- G8 Nothing in an edition is shown that is not built: no dead buttons.

## 2. Research findings (with sources)

**News sources and licences.**

- Search APIs already in the stack, behind `PublicWebResearchProvider`
  (`packages/q-research`): Tavily (`topic` general|news|finance,
  `time_range` day|week|month|year; returns title, url, content snippet,
  published date) — https://docs.tavily.com/documentation/api-reference/endpoint/search ;
  Bright Data SERP (`tbs=qdr:d|w|m|y`); SerpAPI. The cached fallback
  provider is reused. Freshness gains `PAST_DAY` and `PAST_WEEK`
  (additive) and a `topic: NEWS` hint (Tavily news topic; others ignore).
- RSS of reputable outlets: publishers offer feeds for syndicated display
  of headline, summary and link. Curated list (reference data, code):
  TechCabal, Techpoint Africa, Disrupt Africa, TechCrunch (venture),
  Crunchbase News, Sifted. Only title, summary (≤300 chars), link, date and
  the feed's own `media:thumbnail`/`enclosure` image are used; the article
  is never re-published, only summarised with a link.
- Extraction of the full article text (for quotes) uses the provider's
  `extract`, bounded to the top stories of an issue (≤8 URLs).

**Images.**

- Pexels: free use, credit the photographer ("Photo by X on Pexels") and
  link Pexels; image URLs from the API may be used directly
  (https://help.pexels.com/hc/en-us/articles/900005852323 ,
  https://www.pexels.com/api/documentation/#guidelines). Used for section
  and lead photographs, credit always printed, and the only host whose
  bytes are embedded into the PDF (as for decks: `Q_SLIDE_IMAGE_HOST`).
- Publisher images: only the thumbnail a publisher put in its own RSS
  feed, shown **hotlinked as a linked thumbnail to the article** with the
  publisher credited, never downloaded, re-hosted or embedded in the PDF.
  Search-result images and scraped `og:image` are never used.
- Diagrams: drawn by code from the edition's own deal facts (rounds this
  period by size), each bar sourced to its story; no generated images
  (no image route in the Model Gateway, DOCS §5).

**Newspaper conventions.** Masthead (title, dateline, edition number,
"for <name>"), a lead story with the largest headline, a standfirst and
a photograph with caption and credit; sections with kickers; 2-3 columns
on desktop/PDF, one on phone; briefs as one-paragraph items; "Q's take"
set apart as an opinion column with its label; sources under each
article.

**Email rendering.** Gmail clips HTML over ~102 KB
(https://help.echobox.com/what-is-gmail-email-clipping), so the email
carries the lead, section heads and short summaries (≤ 60 KB, asserted in
a test) and links to the full edition in the reader. Table layout,
inline styles, no web fonts, no scripts, no background images (Outlook),
600 px max width, alt text on every image, plain-text part always sent.

## 3. UX flows

- **Dashboard reader** `/daily`: the latest edition as a newspaper
  (masthead, lead, sections, briefs, diagram, Q's take, sources), an
  archive list (newest first, cursor by date), Download PDF, Settings
  link. Phone: one column; desktop: columns. Light and dark from tokens.
  States: loading skeleton in the page's own shape; empty (no edition yet)
  with **Prepare my first edition** (enqueues one; at most once per 20 h)
  and "Your first edition arrives <day>"; preparing ("Q is gathering your
  edition"); error with retry; turned off ("The Q Daily is off" + Turn on).
- `/daily/<editionId>`: one archived edition.
- **Settings → The Q Daily**: Frequency (Weekly · Daily · Off), Email
  me each edition (on/off), Sections (toggle each of the five), all saved
  on change with the saved state shown.
- **Email**: subject "The Q Daily · <date>: <lead headline>"; lead with
  photo, section summaries, "Read the full edition" link, unsubscribe-style
  "Change how often" link to Settings.
- **Q**: `get_q_daily` ("show me today's Q Daily" → the headlines and a
  link to `/daily`); `set_q_daily_preferences` ("make it weekly", "turn
  it off", "stop emailing it", "add deals").
- Shell: "The Q Daily" in the navigation.

## 4. Data model (migration `20261114000000_q_daily.sql`)

All in `q_runtime` (Q's own runtime state). Server-written only; the
person reads their own rows through RLS (`select` own), nobody else.

- `q_runtime.daily_preferences` (user_id pk, tenant_id, frequency
  `WEEKLY|DAILY|OFF` default WEEKLY, email boolean default true, sections
  text[] of section codes, next_due_at timestamptz, requested_at,
  updated_at). A row is created by the scheduler for every onboarded
  person who has none (weekly default).
- `q_runtime.daily_cluster_issues` (id, cluster_key text, issue_date date,
  topics jsonb of PUBLIC topic labels only, stories jsonb, searches_used,
  model_calls_used, created_at; unique (cluster_key, issue_date)). No
  tenant, no person: it holds public-web stories gathered for public topic
  words. RLS on, no grant to `authenticated` (server only).
- `q_runtime.daily_editions` (id, user_id, tenant_id, edition_date,
  frequency, cluster_issue_id, number, content jsonb (`QDailyEdition`),
  searches_used, model_calls_used, emailed_at, email_error, created_at;
  unique (user_id, edition_date)). Append-only (update only of
  emailed_at/email_error by the sender; delete refused by trigger).
- pgTAP `590_q_daily.test.sql`: own read positive, cross-tenant/other
  user negative, no write grant, cluster table invisible to
  `authenticated`, revoked-grant check.

## 5. Contracts (`packages/contracts/src/q/daily.ts`, DAILY block in index)

`QDailySectionCode` = LEAD · YOUR_SECTOR · YOUR_MARKET · DEALS · PEOPLE ·
Q_TAKE (product structure, not taxonomy). `QDailySource {url, publisher,
title, publishedAt}`; `QDailyQuote {text, speaker, sourceIndex}`;
`QDailyImage {url, alt, credit, creditUrl, kind STOCK|PUBLISHER_THUMBNAIL,
linkUrl}`; `QDailyStory {id, section, headline, standfirst, paragraphs,
quotes, sources (≥1), image?, deal?}`; `QDailyDeal {company, amount
(string as printed in the source), round, sourceIndex}`;
`QDailyEdition {id, number, editionDate, frequency, readerName, topics,
lead, sections[{code,title,stories}], briefs, chart?, qTake?
{paragraphs, storyIds, truthClass: "Q_INFERENCE"}, generatedAt}`.
Paths: `GET /v1/q/daily` (latest + archive page + preferences),
`GET /v1/q/daily/editions/:id`, `GET /v1/q/daily/editions/:id/pdf`,
`GET|PUT /v1/q/daily/preferences`, `POST /v1/q/daily/requests`
(idempotent per 20 h).

## 6. Pipeline (`packages/q-daily`, run by the worker)

```
profile    own records → InterestProfile {public topics, personal names}
cluster    hash(public topics) → reuse today's cluster issue or gather it
gather     RSS (curated) + ≤4 news searches (PAST_WEEK/PAST_DAY)
dedupe     canonical URL + title token overlap
score      code: topic overlap, freshness, source tier, provider relevance
extract    top ≤8 stories' text (≤2 extract calls)
write      DAILY_STORY_WRITER v1 per story (≤8 model calls per cluster):
           headline, standfirst, paragraphs, quotes, deal; code checks
           each quote is verbatim in the source and every number in the
           prose appears in the source, else the story falls back to the
           source's own title and summary with a link
personal   ≤3 searches for the names they have relationships with and
           their own company (PEOPLE section), ≤3 model calls
take       DAILY_Q_TAKE v1 (1 call): Q inference over the stories just
           written and their own sector/stage/raise; cites story ids;
           a take with no valid citation is dropped
images     Pexels for lead/sections (≤3 searches), publisher RSS thumbs
layout     edition content → email HTML, reader, PDF (deck-render
           `layOutNewspaper`, A4 pages, drawn by the existing PDF renderer)
deliver    store edition; email when on; schedule next_due_at
```

Caps (`DAILY_BUDGET`, code): searches per cluster 4, per person 3,
extract calls 2, story-writer calls 8 per cluster + 3 personal, Q's take
1, Pexels 3; editions per worker tick 3, per day 60 (env
`Q_DAILY_MAX_EDITIONS_PER_DAY`, default 60). A step past its cap is
skipped, never errors. No provider configured → RSS-only edition.

Runtime: AUTO's LangGraph runtime is not on the lead head (1a46bdb3), so
this uses the existing worker loop pattern (`runScheduleTicker` style,
60 s tick, `for update skip locked` claim on due preferences).

## 7. Q tools and capability registry (`// DAILY block`)

| tool                      | group    | approval | does                                                      |
| ------------------------- | -------- | -------- | --------------------------------------------------------- |
| `get_q_daily`             | RESEARCH | read     | Their latest edition's headlines, date and link           |
| `set_q_daily_preferences` | SETTINGS | INSTANT  | Frequency, email on/off, sections; their own setting only |

Instant: a preference of their own, like personality or reminders; it
changes nothing anyone else sees and is reversible in Settings.
Preparing an edition on request is the reader's button (rate-limited).

## 8. Authority, Context Firewall and privacy

- The profile reads only the person's own organisation's company or
  mandate and their own relationships (party check by organisation).
- Cluster issues are keyed only by public topic labels (taxonomy display
  names, stage labels, country names). Names of their relationships,
  their company, their raise and their mandate figures never enter a
  cluster; personal sections are written per person and stored only on
  their own edition.
- Queries sent to search providers contain topic words or a public
  organisation name, never a figure, a note or a relationship state.
- Story-writer calls carry public web text only (sensitivity PUBLIC); Q's
  take carries their own stage/sector/raise (CONFIDENTIAL) for their own
  edition.
- Retrieved text is untrusted data in prompts (UNTRUSTED markers).
- Q's take is Q_INFERENCE, labelled in every rendering; stories are
  attributed ("TechCabal reports…"), never stated as verified fact.

## 9. Failure and edge cases

No provider → RSS only; no stories → a short edition "Quiet week in your
markets" with what was checked; model failure → story falls back to the
source title/summary; a quote or number not in the source → removed;
email failure → `email_error` stored, edition still in the reader;
person with no sector/mandate → general private-capital topics for their
country; duplicate tick → unique (user_id, edition_date); person offboarded
→ skipped; OFF → no edition, reader shows Turn on.

## 10. Tests and live checks

Vitest (`packages/q-daily/test`): relevance/dedupe, budget caps (fake
providers count calls), quote/number checks, cluster key excludes private
names, schedule (weekly Monday 07:00 local, daily), edition composition
with fakes end to end, email HTML size < 60 KB and escapes, PDF renders;
q-tools tests for the two tools; contracts parse; pgTAP for the migration.
Live (after the lead deploys): one fictional investor
(@fictional.capitalq.local), one edition prepared on request, read from
`q_runtime.daily_editions` and the reader page; ≤1 edition.

## 11. As built (2026-10-01)

- Package `packages/q-daily` (domain, pipeline, services, Postgres stores,
  gateway writers, Pexels); worker ticker `apps/workers/src/daily`
  (60 s, `Q_DAILY_DISABLED=1` turns it off, `Q_DAILY_MAX_EDITIONS_PER_DAY`
  lowers the cap); q-api `apps/q-api/src/http/daily.ts`; web `/daily`,
  `/daily/[editionId]`, `/api/q-daily/[id]/pdf`, Settings → The Q Daily,
  account menu and sidebar entry; dev preview `/dev/daily`.
- Newspaper PDF is `layOutNewspaper` in `packages/deck-render/src/newspaper.ts`
  over the existing boxes and PDF renderer (DOCS §7 interface), since the
  DOCS branch is not on the lead head; it only adds a file and an export.
- Runtime is the worker loop, not LangGraph (ADR 0032 says why).
- Cluster issues are keyed per UTC day; editions per local day.
- "People you know" = CONNECTED relationships only (both sides agreed).
- The research tool also gains `PAST_WEEK`/`PAST_DAY` freshness.
- Q's take uses EVIDENCE_SYNTHESIS at CONFIDENTIAL sensitivity; story
  writing STRUCTURED_EXTRACTION at PUBLIC.
- Ported onto the lead head (f4184aed): The Q Daily is a navigation
  destination (`navigate.DAILY`, TURN_READER v21); the `q.daily` kill
  switch (ADR 0033) is checked before generating and before emailing;
  jsonb writes use `jsonbParam`; the newspaper uses DOCS's A4
  `DOCUMENT_PAGE` and image `fit`; Pexels is read from `PEXELS_API`.
  Decision record: ADR 0032.
