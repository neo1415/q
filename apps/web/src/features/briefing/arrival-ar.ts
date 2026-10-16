import {
  ARABIC_CARDS_CLOSE,
  ARABIC_QUIET_PREFIX,
  arabicArrivalGreeting,
  arabicCardLine,
  arabicJobsDoneWords,
  arabicLowdownOf,
  arabicMatchesWords,
  arabicQuestionsWords,
  arabicQuietDayNewsWords,
  arabicSummaryOfCards,
  arabicUnreadWords,
  arabicWaitingWords,
  partOfDay,
  welcomeStories,
} from "@capital-q/q-core/speech";

import type { ArrivalData, ArrivalWords } from "./arrival";
import { decisionFactsOf, WAITING_NAME } from "./arrival";
import { attentionLines } from "./attention";
import { bestFit } from "./matches";
import type { Opener } from "./opener";

/**
 * Q's arrival in Arabic (multilingual Q): every line composed in Arabic by
 * q-core from the same data the English is built from (`arrival-ar.ts` in
 * q-core), never by translating English sentences. Names, figures, the
 * cards' own summaries and what people wrote stay as recorded.
 */

const WARM = [
  "سعيد برؤيتك.",
  "أهلاً بعودتك.",
  "يسعدني وجودك.",
  "سعيد بعودتك.",
] as const;
const AWAY = [
  "مرّت بضعة أيام. سعيد برؤيتك.",
  "مرّ بعض الوقت. أهلاً بعودتك.",
] as const;

/** "You have 3 things waiting.", with Arabic's number agreement. */
export function arabicCount(pending: number, atLeast: boolean): string {
  const least = atLeast ? "على الأقل " : "";
  if (pending === 1) return `لديك ${least}أمر واحد بانتظارك.`;
  if (pending === 2) return `لديك ${least}أمران بانتظارك.`;
  if (pending <= 10) return `لديك ${least}${String(pending)} أمور بانتظارك.`;
  return `لديك ${least}${String(pending)} أمراً بانتظارك.`;
}

export const ARABIC_NOTHING_WAITING = "ما الذي تودّ الاطلاع عليه؟";

export function arabicOpener(opener: Opener, atLeast: boolean): Opener {
  if (!opener.offersChoice) {
    return {
      ...opener,
      question: ARABIC_NOTHING_WAITING,
      line: ARABIC_NOTHING_WAITING,
    };
  }
  const count = arabicCount(opener.pending, atLeast);
  const question =
    opener.pending === 1
      ? "هل تودّ الاطلاع عليه الآن، أم نتحدث عن شيء آخر؟"
      : "هل تودّ الاطلاع عليها الآن، أم نتحدث عن شيء آخر؟";
  return { ...opener, count, question, line: `${count} ${question}` };
}

/** The names of notices still waiting on them; other notices are counted. */
function waitingOf(titles: readonly string[]): {
  readonly names: readonly string[];
  readonly others: number;
} {
  const names: string[] = [];
  let others = 0;
  for (const title of titles) {
    const name = WAITING_NAME.exec(title.trim())?.[1]?.trim();
    if (name === undefined) others += 1;
    else names.push(name);
  }
  return { names, others };
}

/** The arrival in Arabic, from the data; the English supplies only flags. */
export function arabicArrivalWords(
  english: ArrivalWords,
  data: ArrivalData,
  input: {
    readonly firstName: string | null;
    readonly now: Date;
    readonly timeZone: string | null;
    readonly hoursAway: number | null;
    readonly seed: number;
    readonly atLeast: boolean;
  },
): ArrivalWords {
  const greeting = arabicArrivalGreeting(input);
  const late = partOfDay(input.now, input.timeZone) === "LATE";
  const away = input.hoursAway !== null && input.hoursAway >= 72;
  const options = away ? AWAY : WARM;
  const welcome = late ? null : (options[input.seed % options.length] ?? null);
  const opener = arabicOpener(english.opener, input.atLeast);

  const cards = data.cards.map(decisionFactsOf);
  const read = arabicLowdownOf({
    activity: data.activity ?? {},
    decisions: data.cards.length,
    hoursAway: data.hoursAway,
  });
  const waiting = waitingOf(data.waiting ?? []);
  const waitingLine = [
    arabicWaitingWords(waiting.names),
    waiting.others > 0 ? "وهناك إشعارات أخرى في مركز الإشعارات." : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  const unreadLine = arabicUnreadWords(data.attention?.unread ?? []);
  const told = [
    read.quiet ? null : read.text,
    arabicJobsDoneWords(data.jobsDone),
    waitingLine.length === 0 ? null : waitingLine,
    unreadLine,
  ].filter((part): part is string => part !== null);
  const lowdown =
    told.length === 0
      ? read.text
      : read.quiet && unreadLine !== null && told.length === 1
        ? `${ARABIC_QUIET_PREFIX} ${unreadLine}`
        : told.join(" ");

  const matches = data.matches ?? null;
  const best = matches === null ? null : bestFit(matches);
  const matchesLine =
    matches === null
      ? null
      : arabicMatchesWords({
          total: matches.total,
          sinceLastVisit: matches.label === "SINCE_LAST_VISIT",
          names: matches.items.map((item) => item.name),
          best: best?.name ?? null,
        });
  const quietDay =
    read.quiet &&
    told.length === 0 &&
    matchesLine === null &&
    data.cards.length === 0 &&
    (data.attention === null || data.attention === undefined
      ? true
      : attentionLines(data.attention).length === 0);
  const dailyLine = quietDay
    ? arabicQuietDayNewsWords(welcomeStories(data.snapshot?.daily ?? []))
    : null;
  const first = cards[0];
  const firstCard =
    first === undefined ? null : arabicCardLine(first, 1, cards.length);
  const summary = cards.length < 2 ? null : arabicSummaryOfCards(cards);
  const questions = arabicQuestionsWords(data.questions?.length ?? 0);

  return {
    ...english,
    greeting,
    welcome,
    opener,
    lowdown: dailyLine ?? lowdown,
    firstCard,
    summary,
    matches: matchesLine,
    spoken: [greeting, welcome, opener.line]
      .filter((part): part is string => part !== null)
      .join(" "),
    briefing: [
      dailyLine ?? lowdown,
      ...(summary === null ? [firstCard] : [summary, ARABIC_CARDS_CLOSE]),
      matchesLine,
      questions,
    ]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(" "),
  };
}
