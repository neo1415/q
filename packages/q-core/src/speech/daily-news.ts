/**
 * P4 (founder 2026-10-11): on a quiet day Q greets and mentions one or two
 * genuinely relevant, dated Q Daily stories, then answers "give me the
 * gist" and "open it" from the SAME prepared story objects, by code, with
 * no model and no web read. Pure. Nothing is said unless a prepared story
 * exists; with none, the welcome is just a plain greeting.
 */

/** The prepared story, as much of it as the words need. */
export type DailyNewsStory = {
  readonly storyId: string;
  readonly headline: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly editionDate: string;
  readonly sources: readonly { readonly publisher: string }[];
};

/** How many stories the welcome mentions. */
export const WELCOME_STORIES_MAX = 2;

/** The stories the welcome names (the first of the ranked list). */
export function welcomeStories<T extends DailyNewsStory>(
  stories: readonly T[],
): readonly T[] {
  return stories.slice(0, WELCOME_STORIES_MAX);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-10-08" as "8 October"; null when it is not a date. */
export function editionDay(editionDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(editionDate);
  if (match === null) return null;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  return month === undefined || day < 1 || day > 31
    ? null
    : `${String(day)} ${month}`;
}

/** A headline said in a sentence: no closing stop, no stray quotes. */
export function spokenHeadline(headline: string): string {
  return headline
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?;:,\s]+$/u, "");
}

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Varies by date and person, and never repeats on consecutive days: the day
 * number steps through the wordings while the person only offsets where.
 */
function wording(count: number, who: string, now: Date): number {
  const day = Math.floor(now.getTime() / 86_400_000);
  return (day + hash(who)) % count;
}

/**
 * The quiet-day news line, or null when there is no prepared story. The
 * stories are the welcome's own (`welcomeStories`), in order.
 */
export function quietDayNewsWords(input: {
  readonly stories: readonly DailyNewsStory[];
  readonly now: Date;
  readonly who: string;
}): string | null {
  const shown = welcomeStories(input.stories);
  const first = shown[0];
  if (first === undefined) return null;
  const when = editionDay(first.editionDate);
  const a = spokenHeadline(first.headline);
  const second = shown[1];
  if (second === undefined) {
    const lines = [
      `One story caught my eye in the ${when === null ? "latest" : when} Daily: ${a}. Want the gist?`,
      `The ${when === null ? "latest" : when} Daily has something on your patch: ${a}. Shall I give you the short version?`,
      `In the Daily from ${when ?? "this week"}: ${a}. Want me to tell you more?`,
    ];
    return lines[wording(lines.length, input.who, input.now)] ?? null;
  }
  const b = spokenHeadline(second.headline);
  const date = when === null ? "latest" : when;
  const lines = [
    `Two stories from the ${date} Daily: ${a}, and ${b}. Want the gist of either?`,
    `The ${date} Daily has a couple worth your time: ${a}; and ${b}. I can give you the gist, or open one.`,
    `Worth a look in the ${date} Daily: ${a}, and also ${b}. Shall I give you the short version?`,
  ];
  return lines[wording(lines.length, input.who, input.now)] ?? null;
}

// ---------------------------------------------------------------------------
// Follow-ups, from the same objects.

export type DailyFollowUpKind = "GIST" | "MORE" | "OPEN" | "SECTION";

const GIST =
  /\b(?:(?:give|gimme)\s+me\s+(?:the\s+)?(?:gist|short\s+version|quick\s+version|summary|rundown|lowdown)|(?:what(?:'s|s|\s+is)\s+(?:the\s+)?(?:gist|summary)|what\s+(?:does|did)\s+(?:it|that|the\s+story)\s+say|what(?:'s|s|\s+is)\s+(?:it|that|this)\s+about)|(?:the\s+)?gist\b|(?:short|quick)\s+version|summari[sz]e\s+(?:it|that|this))/iu;
const MORE =
  /\b(?:tell\s+me\s+more|more\s+(?:on|about)\s+(?:it|that|this)|go\s+on|more\s+detail|what(?:'s|s|\s+is)\s+the\s+(?:full|whole)\s+story|(?:the\s+)?full\s+story|read\s+(?:it|that)\s+(?:to\s+me|out)|expand\s+on\s+(?:it|that))\b/iu;
const SECTION =
  /\b(?:(?:show|take|bring|open|go)\b[^.?!]*\b(?:that|the|this)\s+section|that\s+section)\b/iu;
const OPEN =
  /\b(?:open\s+(?:up\s+)?(?:the\s+)?(?:first|second|1st|2nd|last|latter|former|other|top)(?:\s+(?:one|story|article))?|open\s+(?:it|that|this|the\s+(?:story|article|piece|one))(?:\s+up)?|take\s+me\s+(?:there|to\s+(?:it|that|the\s+story))|show\s+me\s+(?:it|that|the\s+story)|pull\s+(?:it|that)\s+up|let\s+me\s+(?:see|read)\s+(?:it|that)|bring\s+(?:it|that)\s+up|go\s+to\s+(?:it|that|the\s+story)|read\s+the\s+(?:story|article)|open\s+the\s+daily\s+story)\b/iu;

/**
 * The follow-up kind in a turn, or null. Deliberately narrow: the turn must
 * point back ("it", "that", "the story", "there"), so an ordinary request
 * ("open my chat with X", "tell me more about Halyard") is never taken.
 */
export function dailyFollowUpKind(text: string): DailyFollowUpKind | null {
  const t = text.trim();
  if (t.length === 0 || t.length > 160) return null;
  if (SECTION.test(t) && !/\bsettings?\b/iu.test(t)) return "SECTION";
  if (OPEN.test(t)) return "OPEN";
  if (MORE.test(t)) {
    // "tell me more about Halyard" names something else.
    return /\bmore\s+(?:on|about)\s+(?!it\b|that\b|this\b|the\s+(?:first|second|1st|2nd|last|latter|former|other|story|one)\b)/iu.test(
      t,
    )
      ? null
      : "MORE";
  }
  if (GIST.test(t)) return "GIST";
  return null;
}

function attribution(story: DailyNewsStory): string {
  const publisher = story.sources[0]?.publisher;
  return publisher === undefined || publisher.length === 0
    ? ""
    : ` According to ${publisher}.`;
}

function sentence(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return /[.!?…]$/u.test(flat) ? flat : `${flat}.`;
}

/** The gist, spoken: the headline for reference and the prepared summary. */
export function dailyGistWords(story: DailyNewsStory): string {
  return `${spokenHeadline(story.headline)}. ${sentence(story.summary)}${attribution(story)} Want more, or shall I open it?`;
}

/** More: the prepared opening paragraphs (the summary when there is no more). */
export function dailyMoreWords(story: DailyNewsStory): string {
  const body = story.detail ?? story.summary;
  return `${spokenHeadline(story.headline)}. ${sentence(body)}${attribution(story)} Shall I open it?`;
}

/** "the first one" / "the second" / "the other": 0, 1 or null. */
export function storyOrdinal(text: string): 0 | 1 | null {
  if (/\b(?:first|1st|former|top)\b/iu.test(text)) return 0;
  if (/\b(?:second|2nd|last|latter|other)\b/iu.test(text)) return 1;
  return null;
}
