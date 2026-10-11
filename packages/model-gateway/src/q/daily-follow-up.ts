import type { ArrivalDailyStory, ArrivalSnapshot } from "@capital-q/contracts";
import {
  dailyFollowUpKind,
  dailyGistWords,
  dailyMoreWords,
  spokenHeadline,
  storyOrdinal,
  welcomeStories,
} from "@capital-q/q-core";

import type { ArrivalReply } from "./arrival-answer.js";

/**
 * P4: a follow-up on the Q Daily stories Q just mentioned ("give me the
 * gist", "tell me more", "open it", "show me that section") is answered by
 * code from the Arrival Snapshot's prepared story objects: no model, no
 * web read, no tool. Pure. Null when the turn is not such a follow-up, no
 * story is prepared, or the referent is not a Daily story, so the normal
 * path handles it (nothing is ever invented).
 *
 * The referent is the story Q last mentioned: the newest Q message that
 * names a prepared story's headline; or, before Q has said anything in this
 * conversation and with nothing waiting on the person, the stories the
 * quiet-day welcome named.
 */

const SECTION_WORDS: Readonly<Record<string, string>> = {
  YOUR_SECTOR: "your sector",
  YOUR_MARKET: "your market",
  DEALS: "deals",
  PEOPLE: "people",
  BRIEF: "the briefs",
  Q_TAKE: "Q's take",
};

function mentionedIn(
  text: string,
  stories: readonly ArrivalDailyStory[],
): readonly ArrivalDailyStory[] {
  const flat = text.toLowerCase();
  return stories.filter((story) =>
    flat.includes(spokenHeadline(story.headline).toLowerCase()),
  );
}

/** A story whose headline's own words the turn names (two or more). */
function namedInTurn(
  text: string,
  stories: readonly ArrivalDailyStory[],
): ArrivalDailyStory | null {
  const flat = text.toLowerCase();
  const hits = stories.filter((story) => {
    const words = new Set(
      spokenHeadline(story.headline)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 5),
    );
    return [...words].filter((word) => flat.includes(word)).length >= 2;
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

function keyWordsShared(text: string, story: ArrivalDailyStory): number {
  const flat = text.toLowerCase();
  const words = new Set(
    spokenHeadline(story.headline)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 5),
  );
  return [...words].filter((word) => flat.includes(word.slice(0, 6))).length;
}

type Referent =
  | { readonly kind: "ONE"; readonly story: ArrivalDailyStory }
  | { readonly kind: "MANY"; readonly stories: readonly ArrivalDailyStory[] }
  | { readonly kind: "NONE" };

function referentOf(
  text: string,
  snapshot: ArrivalSnapshot,
  qMessages: readonly string[],
): Referent {
  const stories = snapshot.daily;
  const named = namedInTurn(text, stories);
  if (named !== null) return { kind: "ONE", story: named };
  const last = qMessages.at(-1);
  let pool: readonly ArrivalDailyStory[];
  if (last !== undefined) {
    // The story Q last talked about, even in its own words (an answer
    // that paraphrased the headline still names its key words), looking
    // back over Q's last three lines (live 2026-10-11).
    pool = [];
    for (const said of qMessages.slice(-3).reverse()) {
      const exact = mentionedIn(said, stories);
      const found =
        exact.length > 0
          ? exact
          : stories.filter((story) => keyWordsShared(said, story) >= 3);
      if (found.length > 0) {
        pool = found;
        break;
      }
    }
  } else if (snapshot.items.length === 0) {
    // Nothing was said yet and nothing waits: the welcome named these.
    pool = welcomeStories(stories);
  } else {
    pool = [];
  }
  if (pool.length === 0) return { kind: "NONE" };
  const ordinal = storyOrdinal(text);
  // Q's last line was one story's gist, which opens with its headline:
  // "open it" / "that section" means that story, not "which one?"
  // (live 2026-10-11).
  if (pool.length > 1 && ordinal === null && last !== undefined) {
    const lead = pool.find((story) =>
      last
        .toLowerCase()
        .startsWith(spokenHeadline(story.headline).toLowerCase()),
    );
    if (lead !== undefined) return { kind: "ONE", story: lead };
  }
  if (pool.length > 1 && ordinal !== null) {
    const picked = pool[ordinal === 1 ? pool.length - 1 : 0];
    if (picked !== undefined) return { kind: "ONE", story: picked };
  }
  const only = pool[0];
  return pool.length === 1 && only !== undefined
    ? { kind: "ONE", story: only }
    : { kind: "MANY", stories: pool };
}

function openReply(
  story: ArrivalDailyStory,
  wantsSection: boolean,
): ArrivalReply {
  const section =
    wantsSection && story.sectionPath !== null ? story.sectionPath : story.path;
  const anchor = section.split("#")[1];
  const label = SECTION_WORDS[story.sectionCode];
  return {
    itemKey: `daily:${story.storyId}`,
    text:
      wantsSection && story.sectionPath !== null && label !== undefined
        ? `Opening the ${label} section of the Daily.`
        : `Opening the story in the Daily: ${spokenHeadline(story.headline)}.`,
    open: {
      page: "DAILY_EDITION",
      id: story.editionId,
      ...(anchor === undefined ? {} : { anchor }),
    },
  };
}

export function dailyFollowUpAnswer(
  text: string,
  snapshot: ArrivalSnapshot | null,
  qMessages: readonly string[],
): ArrivalReply | null {
  if (snapshot === null || snapshot.daily.length === 0) return null;
  // "the first one" / "the other one", said in reply to two stories Q
  // named, picks that story and hears its gist (live 2026-10-11: the
  // bare ordinal fell to the analyst).
  const bareOrdinal =
    storyOrdinal(text) !== null &&
    text.trim().split(/\s+/u).length <= 5 &&
    !/\b(?:compan|investor|deal|meeting|card)/iu.test(text);
  const kind = dailyFollowUpKind(text) ?? (bareOrdinal ? "GIST" : null);
  if (kind === null) return null;
  const referent = referentOf(text, snapshot, qMessages);
  if (referent.kind === "NONE") return null;
  if (referent.kind === "MANY") {
    const names = referent.stories.map((one) => spokenHeadline(one.headline));
    if (kind === "GIST") {
      const [first, ...others] = referent.stories;
      if (first === undefined) return null;
      const other = others[0];
      return {
        itemKey: `daily:${first.storyId}`,
        text: dailyGistWords(first)
          .replace(/ Want more.*$/u, "")
          .concat(
            other === undefined
              ? " Want more, or shall I open it?"
              : ` The other story was ${spokenHeadline(other.headline)}. Want that one, or shall I open this one?`,
          ),
      };
    }
    return {
      itemKey: "daily:ambiguous",
      text: `Which one do you mean: ${names.slice(0, 2).join(", or ")}?`,
    };
  }
  const story = referent.story;
  switch (kind) {
    case "GIST":
      return { itemKey: `daily:${story.storyId}`, text: dailyGistWords(story) };
    case "MORE":
      return { itemKey: `daily:${story.storyId}`, text: dailyMoreWords(story) };
    case "OPEN":
      return openReply(story, false);
    case "SECTION":
      return openReply(story, true);
  }
}
