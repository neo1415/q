import {
  dailyEditionPagePath,
  dailySectionAnchor,
  dailyStoryAnchor,
  ARRIVAL_DAILY_STORIES_MAX,
  type ArrivalDailyStory,
  type QDailyEdition,
  type QDailyStory,
} from "@capital-q/contracts";
import { cutAtWord } from "@capital-q/q-core";

/**
 * P4: the person's latest Q Daily edition as prepared story objects for
 * the Arrival Snapshot. Pure. The edition is their own (their topics, built
 * for them), so its stories are authorised for them. Only the latest
 * edition, only while it is recent enough to be called news, and nothing
 * when there is none: Q never invents a story.
 */

/** An edition older than this is not "today's news" (weekly is the slowest). */
export const DAILY_FRESH_DAYS = 14;

const clip = (text: string, max: number): string => {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length <= max ? clean : cutAtWord(clean, max);
};

/** Relevance by section: their own sector and market first, opinion never. */
const SECTION_RANK: Readonly<Record<string, number>> = {
  YOUR_SECTOR: 0,
  LEAD: 1,
  YOUR_MARKET: 2,
  DEALS: 3,
  PEOPLE: 4,
  BRIEF: 5,
};

function topicHits(story: QDailyStory, topics: readonly string[]): number {
  const hay = `${story.headline} ${story.standfirst}`.toLowerCase();
  return topics.filter(
    (topic) => topic.trim().length > 2 && hay.includes(topic.toLowerCase()),
  ).length;
}

export function dailyStoriesOf(
  edition: QDailyEdition | null,
  now: Date,
): readonly ArrivalDailyStory[] {
  if (edition === null) return [];
  const generated = Date.parse(edition.generatedAt);
  const age = now.getTime() - (Number.isFinite(generated) ? generated : 0);
  if (!Number.isFinite(generated) || age > DAILY_FRESH_DAYS * 86_400_000) {
    return [];
  }
  const pool: { code: string; story: QDailyStory }[] = [
    ...(edition.lead === null ? [] : [{ code: "LEAD", story: edition.lead }]),
    ...edition.sections
      .filter((section) => section.code !== "Q_TAKE")
      .flatMap((section) =>
        section.stories.map((story) => ({ code: section.code, story })),
      ),
    ...edition.briefs.map((story) => ({ code: "BRIEF", story })),
  ];
  const seen = new Set<string>();
  const ranked = pool
    .filter(({ story }) =>
      seen.has(story.id) ? false : (seen.add(story.id), true),
    )
    .map((one, index) => ({ ...one, index }))
    .sort(
      (a, b) =>
        topicHits(b.story, edition.topics) -
          topicHits(a.story, edition.topics) ||
        (SECTION_RANK[a.code] ?? 9) - (SECTION_RANK[b.code] ?? 9) ||
        a.index - b.index,
    );
  const out: ArrivalDailyStory[] = [];
  for (const { code, story } of ranked) {
    const summary = clip(
      story.standfirst.length > 0
        ? story.standfirst
        : (story.paragraphs[0] ?? ""),
      400,
    );
    if (summary.length === 0 || story.sources.length === 0) continue;
    const detail = clip(story.paragraphs.slice(0, 2).join(" "), 900);
    const section = dailySectionAnchor(code);
    out.push({
      editionId: edition.id,
      editionDate: edition.editionDate,
      sectionCode: code as ArrivalDailyStory["sectionCode"],
      storyId: story.id,
      headline: clip(story.headline, 200),
      summary,
      detail: detail.length === 0 ? null : detail,
      sources: story.sources.slice(0, 3).map((source) => ({
        publisher: source.publisher,
        title: clip(source.title, 300),
        url: source.url,
        publishedAt: source.publishedAt,
      })),
      publishedAt: edition.generatedAt,
      path: dailyEditionPagePath(edition.id, dailyStoryAnchor(story.id)),
      sectionPath:
        section === null ? null : dailyEditionPagePath(edition.id, section),
    });
    if (out.length >= ARRIVAL_DAILY_STORIES_MAX) break;
  }
  return out;
}
