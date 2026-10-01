import { createHash } from "node:crypto";

import type {
  QDailyChart,
  QDailyEdition,
  QDailyOptionalSection,
  QDailySection,
  QDailySectionCode,
  QDailyStory,
  QDailyTake,
} from "@capital-q/contracts";
import type { DailyStoryWriterResult } from "@capital-q/q-core";

import { DAILY_BUDGET, type BudgetMeter } from "./budget.js";
import {
  formatUsd,
  inventedNumbers,
  quoteIsVerbatim,
  usdAmount,
} from "./checks.js";
import {
  clusterQueries,
  topicsOf,
  type InterestProfile,
  type PublicInterests,
} from "./profile.js";
import {
  candidateFromHit,
  namesTopic,
  rankCandidates,
  type Candidate,
  type ScoredCandidate,
} from "./relevance.js";
import { feedsFor } from "./sources.js";
import type {
  DailyAttribution,
  DailyFeedReader,
  DailyNewsIndex,
  DailyPhotoPort,
  DailyStoryWriterPort,
  DailyTakePort,
} from "./ports.js";

/**
 * The Q Daily pipeline (DAILY spec §6): gather → dedupe and score in code
 * → read the best stories in full → one model write per story, checked in
 * code → photographs → sections, briefs, a deals diagram and Q's take.
 *
 * Every external step goes through a budget meter first and every failure
 * is local: a search that fails is a search with no hits, a write that
 * fails is a story printed from its source's own headline and summary, a
 * photo that fails is a story without a picture. Nothing here throws for
 * want of news.
 */

export const SECTION_TITLES: Readonly<Record<QDailySectionCode, string>> = {
  LEAD: "Lead",
  YOUR_SECTOR: "Your sector",
  YOUR_MARKET: "Your market",
  DEALS: "Deals and rounds",
  PEOPLE: "People you know in the news",
  Q_TAKE: "Q's take",
};

const EXCERPT_CHARS = 6_000;
const WRITE_CONCURRENCY = 4;

export function storyIdOf(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(
      ...(await Promise.all(items.slice(index, index + size).map(work))),
    );
  }
  return results;
}

function firstSentence(text: string, limit: number): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? trimmed.slice(0, end + 1) : trimmed;
  return sentence.slice(0, limit);
}

/**
 * A story printed from its source alone: the source's headline, its own
 * summary, attributed. Used when the model step failed or wrote something
 * the checks refused.
 */
function storyFromSource(
  candidate: Candidate,
  section: QDailySectionCode,
): QDailyStory {
  const summary = candidate.snippet.trim();
  return {
    id: storyIdOf(candidate.url),
    section,
    headline: candidate.title.slice(0, 200),
    standfirst: firstSentence(summary, 300),
    paragraphs:
      summary.length === 0
        ? []
        : [`${candidate.publisher} reports: ${summary}`.slice(0, 1_200)],
    quotes: [],
    sources: [sourceOf(candidate)],
    image: thumbnailOf(candidate),
    deal: null,
    written: false,
  };
}

function sourceOf(candidate: Candidate): QDailyStory["sources"][number] {
  return {
    url: candidate.url,
    publisher: candidate.publisher.slice(0, 120),
    title: candidate.title.slice(0, 300),
    publishedAt: candidate.publishedAt,
  };
}

function thumbnailOf(candidate: Candidate): QDailyStory["image"] {
  if (candidate.thumbnailUrl === null) return null;
  return {
    url: candidate.thumbnailUrl,
    alt: candidate.title.slice(0, 200),
    credit: `Image: ${candidate.publisher}`.slice(0, 160),
    creditUrl: candidate.url,
    kind: "PUBLISHER_THUMBNAIL",
    linkUrl: candidate.url,
  };
}

function mentions(text: string, name: string): boolean {
  return text.toLowerCase().includes(name.trim().toLowerCase());
}

/**
 * The model's write-up, kept only as far as the checks allow (G4): a
 * number not in the source sends the whole story back to its source's own
 * words; a quote not verbatim is dropped; a speaker or deal detail the
 * source does not name is dropped.
 */
export function checkedStory(
  candidate: Candidate,
  section: QDailySectionCode,
  written: DailyStoryWriterResult | null,
  sourceText: string,
): QDailyStory | null {
  if (written === null) return storyFromSource(candidate, section);
  if (!written.relevant) return null;
  const evidence = [sourceText, candidate.title, candidate.snippet];
  const prose = [written.headline, written.standfirst, ...written.paragraphs];
  if (prose.some((line) => inventedNumbers(line, evidence).length > 0)) {
    return storyFromSource(candidate, section);
  }
  const quotes = written.quotes
    .filter((quote) => quote.sourceIndex === 0)
    .filter((quote) => quoteIsVerbatim(quote.text, [sourceText]))
    .map((quote) => ({
      text: quote.text,
      speaker:
        quote.speaker !== null && mentions(sourceText, quote.speaker)
          ? quote.speaker
          : null,
      sourceIndex: 0,
    }));
  const deal =
    written.deal !== null && mentions(sourceText, written.deal.company)
      ? (() => {
          const amount =
            written.deal.amount !== null &&
            mentions(sourceText, written.deal.amount)
              ? written.deal.amount
              : null;
          return {
            company: written.deal.company,
            amount,
            amountUsd: usdAmount(amount),
            round:
              written.deal.round !== null &&
              mentions(sourceText, written.deal.round)
                ? written.deal.round
                : null,
            sourceIndex: 0,
          };
        })()
      : null;
  return {
    id: storyIdOf(candidate.url),
    section: deal !== null && section !== "PEOPLE" ? "DEALS" : section,
    headline: written.headline.slice(0, 200),
    standfirst: written.standfirst.slice(0, 400),
    paragraphs: written.paragraphs.map((line) => line.slice(0, 1_200)),
    quotes,
    sources: [sourceOf(candidate)],
    image: thumbnailOf(candidate),
    deal,
    written: true,
  };
}

/** Full texts of the best candidates, within the extract budget. */
async function readInFull(
  index: DailyNewsIndex | undefined,
  candidates: readonly Candidate[],
  meter: BudgetMeter,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  if (index === undefined) return texts;
  for (let start = 0; start < candidates.length; start += 5) {
    if (!meter.take("extract")) break;
    const urls = candidates.slice(start, start + 5).map((c) => c.url);
    try {
      const result = await index.extract(
        { urls },
        { ...(signal === undefined ? {} : { signal }) },
      );
      for (const page of result.pages) {
        texts.set(page.url, page.text.slice(0, EXCERPT_CHARS));
      }
    } catch {
      // Unread pages are written from their summary.
    }
  }
  return texts;
}

async function writeStories(
  ports: {
    readonly index?: DailyNewsIndex | undefined;
    readonly writer?: DailyStoryWriterPort | undefined;
  },
  candidates: readonly ScoredCandidate[],
  sectionOf: (candidate: ScoredCandidate) => QDailySectionCode,
  topics: readonly string[],
  meter: BudgetMeter,
  attribution: DailyAttribution,
  signal: AbortSignal | undefined,
): Promise<QDailyStory[]> {
  const texts = await readInFull(ports.index, candidates, meter, signal);
  const stories = await inBatches(
    candidates,
    WRITE_CONCURRENCY,
    async (candidate) => {
      const section = sectionOf(candidate);
      const fullText = texts.get(candidate.url);
      const sourceText = `${candidate.title}\n${candidate.snippet}\n${fullText ?? ""}`;
      const writer = ports.writer;
      if (writer === undefined || !meter.take("write")) {
        return storyFromSource(candidate, section);
      }
      const written = await writer
        .write(
          {
            sectionTitle: SECTION_TITLES[section],
            topics: [...topics],
            sources: [
              {
                index: 0,
                publisher: candidate.publisher.slice(0, 120),
                title: candidate.title.slice(0, 300),
                publishedAt: candidate.publishedAt,
                excerpt: sourceText.slice(0, EXCERPT_CHARS),
              },
            ],
          },
          attribution,
          signal,
        )
        .catch(() => null);
      return checkedStory(candidate, section, written, sourceText);
    },
  );
  return stories.filter((story): story is QDailyStory => story !== null);
}

export type GatherResult = {
  readonly stories: readonly QDailyStory[];
};

/**
 * One shared gathering of public news for a set of public interests (§8:
 * nothing personal reaches it — its inputs are the interests and the
 * window, and its searches are built from them alone).
 */
export async function gatherCluster(input: {
  readonly ports: {
    readonly index?: DailyNewsIndex | undefined;
    readonly feeds?: DailyFeedReader | undefined;
    readonly writer?: DailyStoryWriterPort | undefined;
    readonly photos?: DailyPhotoPort | undefined;
  };
  readonly interests: PublicInterests;
  readonly windowDays: number;
  readonly meter: BudgetMeter;
  readonly attribution: DailyAttribution;
  readonly now: Date;
  readonly signal?: AbortSignal | undefined;
}): Promise<GatherResult> {
  const { ports, interests, meter, signal } = input;
  const topics = topicsOf(interests);
  const freshness = input.windowDays <= 2 ? "PAST_DAY" : "PAST_WEEK";

  const queries = clusterQueries(interests, DAILY_BUDGET.clusterSearches);
  const index = ports.index;
  const searching =
    index === undefined
      ? []
      : queries
          .filter(() => meter.take("search"))
          .map(async (query) => {
            try {
              const result = await index.search(
                {
                  query,
                  maxResults: DAILY_BUDGET.resultsPerSearch,
                  freshness,
                  includeDomains: [],
                  topic: "NEWS",
                },
                { ...(signal === undefined ? {} : { signal }) },
              );
              return result.hits
                .map(candidateFromHit)
                .filter((hit): hit is Candidate => hit !== null);
            } catch {
              return [];
            }
          });
  const feeds = ports.feeds;
  const reading =
    feeds === undefined
      ? []
      : feedsFor(interests.markets).map(async (feed) =>
          (await feeds(feed, DAILY_BUDGET.itemsPerFeed, signal)).map(
            (item): Candidate => ({
              url: item.url,
              title: item.title,
              snippet: item.summary,
              publisher: item.publisher,
              publishedAt: item.publishedAt,
              thumbnailUrl: item.thumbnailUrl,
              providerRelevance: null,
              via: "FEED",
            }),
          ),
        );
  const found = (await Promise.all([...searching, ...reading])).flat();
  const ranked = rankCandidates(found, topics, {
    now: input.now,
    windowDays: input.windowDays,
  }).slice(0, DAILY_BUDGET.clusterStoryWrites + 4);

  const sectorSet = interests.sectors;
  const sectionOf = (candidate: ScoredCandidate): QDailySectionCode => {
    if (candidate.topicHits.some((hit) => sectorSet.includes(hit))) {
      return "YOUR_SECTOR";
    }
    if (candidate.topicHits.some((hit) => interests.markets.includes(hit))) {
      return "YOUR_MARKET";
    }
    return sectorSet.length > 0 ? "YOUR_SECTOR" : "YOUR_MARKET";
  };
  const stories = await writeStories(
    ports,
    ranked,
    sectionOf,
    topics,
    meter,
    input.attribution,
    signal,
  );
  return { stories: await withPhotos(ports.photos, stories, interests, meter) };
}

/**
 * Licensed photographs for the stories that have no picture of their own,
 * best story first, within the photo budget. The search words are public
 * topic labels, never anything from an article or a person.
 */
async function withPhotos(
  photos: DailyPhotoPort | undefined,
  stories: readonly QDailyStory[],
  interests: PublicInterests,
  meter: BudgetMeter,
): Promise<readonly QDailyStory[]> {
  if (photos === undefined) return stories;
  const words = [
    ...interests.sectors.map((sector) => `${sector} business`),
    ...interests.markets.map((market) => `${market} city business`),
    "startup office",
  ];
  const result = [...stories];
  let next = 0;
  const used = new Set<string>();
  for (let position = 0; position < result.length; position += 1) {
    const story = result[position];
    if (story === undefined || story.image !== null) continue;
    const query = words[next % words.length];
    if (query === undefined || !meter.take("photo")) break;
    next += 1;
    const found = await photos.search(query).catch(() => []);
    const photo = found.find((image) => !used.has(image.url));
    if (photo === undefined) continue;
    used.add(photo.url);
    result[position] = { ...story, image: photo };
  }
  return result;
}

/**
 * The person's own section: news naming their company or the companies
 * and investors they have a relationship with. Searched by public name
 * only, written for them alone, stored only on their edition.
 */
export async function gatherPeople(input: {
  readonly ports: {
    readonly index?: DailyNewsIndex | undefined;
    readonly writer?: DailyStoryWriterPort | undefined;
  };
  readonly profile: InterestProfile;
  readonly windowDays: number;
  readonly meter: BudgetMeter;
  readonly attribution: DailyAttribution;
  readonly now: Date;
  readonly excludeIds: ReadonlySet<string>;
  readonly signal?: AbortSignal | undefined;
}): Promise<readonly QDailyStory[]> {
  const { ports, profile, meter, signal } = input;
  const index = ports.index;
  if (index === undefined) return [];
  const names = [
    ...(profile.ownName === null ? [] : [profile.ownName]),
    ...profile.knownNames,
  ]
    .map((name) => name.trim())
    .filter((name) => name.length >= 3)
    .slice(0, DAILY_BUDGET.personalSearches);
  const results = await Promise.all(
    names
      .filter(() => meter.take("search"))
      .map(async (name) => {
        try {
          const result = await index.search(
            {
              query: `"${name}"`,
              maxResults: DAILY_BUDGET.resultsPerSearch,
              freshness: input.windowDays <= 2 ? "PAST_DAY" : "PAST_WEEK",
              includeDomains: [],
              topic: "NEWS",
            },
            { ...(signal === undefined ? {} : { signal }) },
          );
          return result.hits
            .map(candidateFromHit)
            .filter((hit): hit is Candidate => hit !== null)
            .filter((hit) => namesTopic(`${hit.title} ${hit.snippet}`, name));
        } catch {
          return [];
        }
      }),
  );
  const ranked = rankCandidates(results.flat(), names, {
    now: input.now,
    windowDays: input.windowDays,
  })
    .filter((candidate) => !input.excludeIds.has(storyIdOf(candidate.url)))
    .slice(0, DAILY_BUDGET.personalStoryWrites);
  return writeStories(
    ports,
    ranked,
    () => "PEOPLE",
    names,
    meter,
    input.attribution,
    signal,
  );
}

/**
 * Q's take (the only opinion in the paper): kept only when it cites at
 * least one story in this edition and prints no number that is not in a
 * story or in the reader's own raise.
 */
export async function writeTake(input: {
  readonly port?: DailyTakePort | undefined;
  readonly profile: InterestProfile;
  readonly stories: readonly QDailyStory[];
  readonly meter: BudgetMeter;
  readonly attribution: DailyAttribution;
  readonly signal?: AbortSignal | undefined;
}): Promise<QDailyTake | null> {
  const { port, profile, stories, meter } = input;
  if (port === undefined || stories.length === 0) return null;
  if (!meter.take("take")) return null;
  const listed = stories.slice(0, 12);
  const result = await port
    .take(
      {
        readerRole: profile.role,
        readerFocus: topicsOf({
          sectors: profile.sectors,
          stages: profile.stages,
          markets: profile.markets,
        }).slice(0, 12),
        readerRaise: profile.raise,
        stories: listed.map((story) => ({
          id: story.id,
          headline: story.headline.slice(0, 200),
          standfirst: story.standfirst.slice(0, 400),
        })),
      },
      input.attribution,
      input.signal,
    )
    .catch(() => null);
  if (result === null || result.noTake || result.paragraphs.length === 0) {
    return null;
  }
  const ids = new Set(listed.map((story) => story.id));
  const storyIds = [...new Set(result.storyIds)].filter((id) => ids.has(id));
  if (storyIds.length === 0) return null;
  const evidence = [
    ...listed.map((story) => `${story.headline} ${story.standfirst}`),
    profile.raise ?? "",
  ];
  if (
    result.paragraphs.some((line) => inventedNumbers(line, evidence).length > 0)
  ) {
    return null;
  }
  return {
    paragraphs: result.paragraphs.slice(0, 3).map((line) => line.slice(0, 900)),
    storyIds: storyIds.slice(0, 8),
    truthClass: "Q_INFERENCE",
  };
}

/** The deals diagram: rounds a source printed in dollars, largest first. */
export function dealsChart(
  stories: readonly QDailyStory[],
  windowDays: number,
): QDailyChart | null {
  const bars = stories
    .filter((story) => story.deal !== null && story.deal.amountUsd !== null)
    .map((story) => ({
      label: (story.deal?.company ?? "").slice(0, 60),
      value: story.deal?.amountUsd ?? 0,
      formatted: formatUsd(story.deal?.amountUsd ?? 0),
      storyId: story.id,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (bars.length < 2) return null;
  const publishers = [
    ...new Set(
      stories
        .filter((story) => bars.some((bar) => bar.storyId === story.id))
        .map((story) => story.sources[0]?.publisher ?? ""),
    ),
  ]
    .filter((name) => name.length > 0)
    .join(", ");
  return {
    title:
      windowDays <= 2
        ? "Rounds reported today, in US dollars"
        : "Rounds reported this week, in US dollars",
    unit: "USD",
    bars,
    source: `Amounts as reported by ${publishers}`.slice(0, 160),
  };
}

const SECTION_ORDER: readonly QDailyOptionalSection[] = [
  "YOUR_SECTOR",
  "YOUR_MARKET",
  "DEALS",
  "PEOPLE",
];
const STORIES_PER_SECTION = 4;

/**
 * The edition: the lead (always printed), the sections the person keeps
 * on, written stories in sections and the rest as briefs, the deals
 * diagram and Q's take.
 */
export function composeEdition(input: {
  readonly id: string;
  readonly number: number;
  readonly editionDate: string;
  readonly frequency: "WEEKLY" | "DAILY";
  readonly profile: InterestProfile;
  readonly interests: PublicInterests;
  readonly windowDays: number;
  readonly sections: readonly QDailyOptionalSection[];
  readonly cluster: readonly QDailyStory[];
  readonly people: readonly QDailyStory[];
  readonly take: QDailyTake | null;
  readonly now: Date;
}): QDailyEdition {
  const enabled = new Set<string>(input.sections);
  const all = [...input.people, ...input.cluster].filter(
    (story) => story.section === "LEAD" || enabled.has(story.section),
  );
  const pool = all.length > 0 ? all : [...input.cluster];
  const lead =
    pool.find((story) => story.written && story.section !== "PEOPLE") ??
    pool.find((story) => story.written) ??
    pool[0] ??
    null;
  const rest = pool.filter((story) => story !== lead);
  const sections: QDailySection[] = [];
  const briefs: QDailyStory[] = [];
  let printed = lead === null ? 0 : 1;
  for (const code of SECTION_ORDER) {
    if (!enabled.has(code)) continue;
    const inSection = rest.filter((story) => story.section === code);
    const written = inSection.filter((story) => story.written);
    const kept = written.slice(0, STORIES_PER_SECTION);
    printed += kept.length;
    if (kept.length > 0) {
      sections.push({ code, title: SECTION_TITLES[code], stories: kept });
    }
    briefs.push(...inSection.filter((story) => !kept.includes(story)));
  }
  const room = Math.max(0, DAILY_BUDGET.storiesPerEdition - printed);
  const keptBriefs = briefs.slice(0, Math.min(10, room));
  const printedStories = [
    ...(lead === null ? [] : [lead]),
    ...sections.flatMap((section) => section.stories),
    ...keptBriefs,
  ];
  const take =
    enabled.has("Q_TAKE") && input.take !== null
      ? (() => {
          const ids = new Set(printedStories.map((story) => story.id));
          const storyIds = input.take.storyIds.filter((id) => ids.has(id));
          return storyIds.length === 0 ? null : { ...input.take, storyIds };
        })()
      : null;
  return {
    id: input.id,
    number: input.number,
    editionDate: input.editionDate,
    frequency: input.frequency,
    readerName: input.profile.readerName,
    topics: [...topicsOf(input.interests)],
    lead: lead === null ? null : { ...lead, section: "LEAD" },
    sections,
    briefs: keptBriefs,
    chart: enabled.has("DEALS")
      ? dealsChart(printedStories, input.windowDays)
      : null,
    qTake: take,
    generatedAt: input.now.toISOString(),
  };
}
