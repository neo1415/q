import type { QAttentionSource } from "@capital-q/contracts";

import type {
  ActivityCount,
  ArrivalActivity,
  ArrivalFacts,
  DecisionCardFacts,
  Lowdown,
} from "./arrival.js";
import { arrivalSeed, gistOf, partOfDay } from "./arrival.js";

/**
 * Q on arrival, in Arabic (multilingual Q, 2026-10-16). Composed from the
 * same recorded facts as the English (`arrival.ts`), never by translating
 * its sentences: Arabic counts agree with their nouns (one, two, three to
 * ten, eleven and more), lists join with "و", and a sentence is built
 * whole rather than from English fragments. Modern Standard Arabic, the
 * register a Gulf professional uses at work.
 *
 * The same rules hold: nothing is said that a fact does not support, an
 * unread count is absent (never zero), and names, figures and what people
 * wrote are kept exactly as recorded.
 */

/** "صباح الخير، زينو." by their clock; a late-hours hello after 22:00. */
export function arabicArrivalGreeting(input: {
  readonly firstName: string | null;
  readonly now: Date;
  readonly timeZone: string | null | undefined;
}): string {
  const name = input.firstName?.trim().split(/\s+/u)[0] ?? "";
  const to = name.length > 0 ? `، ${name}` : "";
  switch (partOfDay(input.now, input.timeZone)) {
    case "MORNING":
      return `صباح الخير${to}.`;
    case "AFTERNOON":
    case "EVENING":
      return `مساء الخير${to}.`;
    case "LATE":
      return name.length > 0
        ? `مرحباً ${name}، ما زلت مستيقظاً.`
        : "مرحباً، ما زلت مستيقظاً.";
  }
}

/** A noun's forms for Arabic number agreement. */
type Noun = {
  /** "رسالة واحدة" */
  readonly one: string;
  /** "رسالتان" */
  readonly two: string;
  /** 3-10: "3 رسائل" */
  readonly few: string;
  /** 11+: "11 رسالة" */
  readonly many: string;
};

const NOUN = {
  message: {
    one: "رسالة واحدة",
    two: "رسالتين",
    few: "رسائل",
    many: "رسالة",
  },
  meeting: {
    one: "اجتماعاً واحداً",
    two: "اجتماعين",
    few: "اجتماعات",
    many: "اجتماعاً",
  },
  company: {
    one: "شركة واحدة",
    two: "شركتين",
    few: "شركات",
    many: "شركة",
  },
  person: {
    one: "شخص واحد",
    two: "شخصان",
    few: "أشخاص",
    many: "شخصاً",
  },
  match: {
    one: "توافق جديد",
    two: "توافقان جديدان",
    few: "توافقات جديدة",
    many: "توافقاً جديداً",
  },
  thing: {
    one: "أمر واحد",
    two: "أمران",
    few: "أمور",
    many: "أمراً",
  },
  job: {
    one: "مهمة واحدة",
    two: "مهمتين",
    few: "مهام",
    many: "مهمة",
  },
} as const satisfies Readonly<Record<string, Noun>>;

/** "رسالة واحدة", "رسالتين", "3 رسائل", "12 رسالة". Western digits. */
export function arabicCount(n: number, noun: Noun): string {
  if (n === 1) return noun.one;
  if (n === 2) return noun.two;
  if (n >= 3 && n <= 10) return `${String(n)} ${noun.few}`;
  return `${String(n)} ${noun.many}`;
}

/** "أ"، "أ وب"، "أ، ب وج": names exactly as recorded. */
export function arabicList(items: readonly string[]): string {
  const parts = items.filter((item) => item.length > 0);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join("، ")} و${parts.at(-1) ?? ""}`;
}

function pick<T>(options: readonly T[], seed: number, salt = 0): T {
  const chosen = options[(seed + salt * 7919) % options.length];
  if (chosen === undefined) throw new Error("pick from an empty list");
  return chosen;
}

/** Named when one or two (and every name is known), counted otherwise. */
function named(item: ActivityCount, noun: Noun): string {
  const names = item.names.slice(0, 2);
  return item.n <= 2 && names.length === item.n
    ? arabicList(names)
    : arabicCount(item.n, noun);
}

/** What Q did for them: one clause per kind, each a whole Arabic clause. */
function did(activity: ArrivalActivity): string[] {
  const parts: string[] = [];
  const { sent, booked, interest } = activity;
  if (sent !== undefined && sent.n > 0) {
    const names = sent.names.slice(0, 2);
    parts.push(
      sent.n <= 2 && names.length === sent.n
        ? `رددتُ على ${arabicList(names)}`
        : `أرسلتُ ${arabicCount(sent.n, NOUN.message)}`,
    );
  }
  if (booked !== undefined && booked.n > 0) {
    const names = booked.names.slice(0, 1);
    parts.push(
      booked.n === 1 && names.length === 1
        ? `حجزتُ مكالمتك مع ${names[0] ?? ""}`
        : `رتّبتُ ${arabicCount(booked.n, NOUN.meeting)}`,
    );
  }
  if (interest !== undefined && interest.n > 0) {
    parts.push(`أبديتُ اهتماماً بـ${named(interest, NOUN.company)}`);
  }
  return parts;
}

/** What came in, and what Q held back. */
function news(activity: ArrivalActivity): string[] {
  const parts: string[] = [];
  const { replies, matches, held } = activity;
  if (replies !== undefined && replies.n > 0) {
    const names = replies.names.slice(0, 2);
    parts.push(
      replies.n <= 2 && names.length === replies.n
        ? `ردّ ${arabicList(names)}`
        : replies.n === 1
          ? "وصلك ردّ جديد"
          : `ردّ ${arabicCount(replies.n, NOUN.person)}`,
    );
  }
  if (matches !== undefined && matches.n > 0) {
    parts.push(
      matches.n === 1
        ? matches.names[0] === undefined
          ? "هناك توافق جديد"
          : `${matches.names[0]} توافق جديد`
        : `وصل ${arabicCount(matches.n, NOUN.match)}`,
    );
  }
  if (held !== undefined && held.n > 0) {
    const names = held.names.slice(0, 1);
    parts.push(
      held.n === 1 && names.length === 1
        ? `احتفظتُ برسالة إلى ${names[0] ?? ""} لتقرأها`
        : `احتفظتُ بـ${arabicCount(held.n, NOUN.message)} لتقرأها`,
    );
  }
  return parts;
}

function needs(decisions: number, seed: number): string | null {
  if (decisions <= 0) return null;
  if (decisions === 1) {
    return pick(["أمر واحد بانتظار قرارك", "هناك أمر واحد لك"], seed, 3);
  }
  const count = arabicCount(decisions, NOUN.thing);
  return pick([`${count} بانتظار قرارك`, `هناك ${count} لك`], seed, 3);
}

/**
 * The lowdown in Arabic, from the same facts as `lowdownOf`: what Q did,
 * what came in, and how many decisions wait. Quiet when nothing happened
 * and nothing waits; names any spoken version must carry are the same.
 */
export function arabicLowdownOf(facts: ArrivalFacts): Lowdown {
  const seed = arrivalSeed(JSON.stringify(facts));
  const doneParts = did(facts.activity);
  const newsParts = news(facts.activity);
  const waits = needs(facts.decisions, seed);
  const mustSay = [
    ...(facts.activity.sent?.names ?? []).slice(0, 2),
    ...(facts.activity.booked?.names ?? []).slice(0, 1),
    ...(facts.activity.replies?.names ?? []).slice(0, 2),
  ];
  if (doneParts.length === 0 && newsParts.length === 0 && waits === null) {
    return { quiet: true, text: "", mustSay: [] };
  }
  const since =
    facts.hoursAway === null
      ? null
      : facts.hoursAway >= 20
        ? pick(["أثناء غيابك،", "منذ زيارتك الأخيرة،"], seed, 1)
        : pick(["منذ آخر مرة كنت هنا،", "منذ وقت سابق اليوم،"], seed, 1);
  const sentences: string[] = [];
  if (doneParts.length > 0) {
    const what = arabicList(doneParts);
    sentences.push(since === null ? `${what}.` : `${since} ${what}.`);
  }
  const tail = [...newsParts, ...(waits === null ? [] : [waits])];
  if (tail.length > 0) {
    const joined = arabicList(tail);
    sentences.push(
      doneParts.length === 0 && since !== null
        ? `${since} ${joined}.`
        : `${joined}.`,
    );
  }
  return { quiet: false, text: sentences.join(" "), mustSay };
}

// ---------------------------------------------------------------------------
// The decision cards, in Arabic.

const WEEKDAYS_AR: Readonly<Record<string, string>> = {
  monday: "يوم الاثنين",
  tuesday: "يوم الثلاثاء",
  wednesday: "يوم الأربعاء",
  thursday: "يوم الخميس",
  friday: "يوم الجمعة",
  saturday: "يوم السبت",
  sunday: "يوم الأحد",
  today: "اليوم",
  tomorrow: "غداً",
  "this week": "هذا الأسبوع",
  "next week": "الأسبوع المقبل",
};

const WEEKDAY =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|next week)\b|(الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|الأحد|غدا|غداً|اليوم|الأسبوع المقبل)/iu;
const MEETING =
  /\b(call|meet|meeting|chat|catch up|catch-up|zoom|coffee|\d+ ?min(?:ute)?s)\b|(مكالمة|اجتماع|نلتقي|لقاء|زووم|قهوة)/iu;
const DECK =
  /\b(deck|pitch deck|attached|attachment|data ?room|one-pager)\b|(العرض التقديمي|مرفق|غرفة البيانات)/iu;

/** One card in a few words, from its facts alone. */
function cardGist(card: DecisionCardFacts): string {
  const name = card.counterpart ?? "أحدهم";
  if (card.kind === "HELD") return `ردّ ${name} محتجز`;
  if (card.message === null) {
    // The card's own summary is data: quoted as it is, never rewritten.
    return `«${gistOf(card.summary, 10).replace(/[.!?]$/u, "")}»`;
  }
  const said = card.theySaid ?? "";
  if (MEETING.test(said)) {
    const day = WEEKDAY.exec(said);
    const english = day?.[1]?.toLowerCase();
    const when =
      english !== undefined
        ? (WEEKDAYS_AR[english] ?? null)
        : day?.[2] !== undefined
          ? day[2]
          : null;
    return when === null
      ? `${name} يريد مكالمة`
      : `${name} يريد مكالمة ${when}`;
  }
  if (DECK.test(said)) return `أرسل ${name} عرضه التقديمي`;
  if (said.length > 0) return `ردّ ${name}`;
  return `رسالة إلى ${name} جاهزة`;
}

/** "ثلاثة أمور: ...", every pending card in one sentence; null with none. */
export function arabicSummaryOfCards(
  cards: readonly DecisionCardFacts[],
): string | null {
  if (cards.length === 0) return null;
  return `${arabicCount(cards.length, NOUN.thing)}: ${arabicList(cards.map(cardGist))}.`;
}

const ORDINALS_AR = ["بعد ذلك", "ثم", "وبعدها"] as const;

/**
 * One card put to the person, and one question. `position` is 1-based.
 * Their words and the draft stay in the language they were written in.
 */
export function arabicCardLine(
  card: DecisionCardFacts,
  position: number,
  total: number,
): string {
  const seed = arrivalSeed(`${card.summary}|${String(position)}`);
  const lead =
    total <= 1
      ? ""
      : position === 1
        ? "أولاً، "
        : position === total
          ? "والأخير: "
          : `${pick(ORDINALS_AR, seed)}، `;
  const name = card.counterpart ?? "الطرف الآخر";
  if (card.kind === "HELD") {
    return `${lead}احتفظتُ برسالة إلى ${name}. إنها على الشاشة؛ هل أرسلها كما هي، أم أعدّلها، أم أحذفها؟`;
  }
  if (card.message === null) {
    return `${lead}«${gistOf(card.summary)}» هل أمضي في ذلك؟`;
  }
  const said =
    card.theySaid === null
      ? `${lead}صغتُ رسالة إلى ${name}.`
      : `${lead}كتب ${name}: «${gistOf(card.theySaid, 16)}» وصغتُ ردّاً.`;
  return `${said} ${pick(["هل أرسله؟", "هل تريدني أن أرسله؟", "أأرسله؟"], seed, 2)}`;
}

// ---------------------------------------------------------------------------
// The rest of the arrival, each from its own facts.

/** "ما زال لديّ 3 أسئلة..." (Q.01); null with none. */
export function arabicQuestionsWords(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "ما زال لديّ سؤال واحد سيطرحه المستثمرون عليك؛ تجده جانباً حين يتسع وقتك."
    : `ما زالت هناك أسئلة سيطرحها المستثمرون عليك، وعددها ${String(n)}؛ تجدها جانباً حين يتسع وقتك.`;
}

/** What Q's agents finished; null when nothing was. */
export function arabicJobsDoneWords(
  jobs: ActivityCount | null | undefined,
): string | null {
  if (jobs === null || jobs === undefined || jobs.n <= 0) return null;
  const first = jobs.names[0];
  if (jobs.n === 1) {
    return first === undefined
      ? "أنهى أحد وكلائي مهمته."
      : `أنهى أحد وكلائي: ${first.replace(/[.\s]+$/u, "")}.`;
  }
  return `أنهى وكلائي ${arabicCount(jobs.n, NOUN.job)}.`;
}

/** Who waits for their reply, said once per name; null with no one. */
export function arabicWaitingWords(names: readonly string[]): string | null {
  const unique = [...new Set(names.filter((name) => name.length > 0))];
  if (unique.length === 0) return null;
  return unique.length === 1
    ? `${unique[0] ?? ""} بانتظار ردّك.`
    : `${arabicList(unique)} بانتظار ردودك.`;
}

/** The sources that could not be read, as the person thinks of them. */
const UNREAD_AR: Readonly<Record<QAttentionSource, string>> = {
  UNANSWERED_MESSAGE: "رسائلك",
  APPROVAL: "الموافقات",
  HELD_DRAFT: "المسودات المحتجزة",
  AGENT_BLOCKED: "وكلائك",
  DOCUMENT_REQUEST: "طلبات المستندات",
  INTEREST_REQUEST: "طلبات الاهتمام",
  MEETING: "الاجتماعات",
  REMINDER: "التذكيرات",
  NEW_MATCHES: "خلاصتك",
  NOTICE: "الإشعارات",
};

/** With notices unread, these are said beside "your messages and requests". */
const BESIDE_NOTICES: readonly QAttentionSource[] = [
  "APPROVAL",
  "HELD_DRAFT",
  "AGENT_BLOCKED",
  "NEW_MATCHES",
];

/**
 * Unknown is not empty: what could not be checked is said once, in the
 * same terms as the English (`unreadWords`); null when everything was read.
 */
export function arabicUnreadWords(
  unread: readonly QAttentionSource[],
): string | null {
  const sources = [...new Set(unread)];
  if (sources.length === 0) return null;
  if (sources.includes("NOTICE")) {
    const rest = sources
      .filter((source) => BESIDE_NOTICES.includes(source))
      .map((source) => UNREAD_AR[source]);
    return `تعذّر عليّ التحقق من ${arabicList(["رسائلك وطلباتك", ...rest])} الآن، لذا لا أستطيع القول إن لا شيء ينتظرك هناك.`;
  }
  return `تعذّر عليّ التحقق من ${arabicList([...new Set(sources.map((source) => UNREAD_AR[source]))])} الآن.`;
}

/** New matches by name (up to six); the best named only when it is one. */
export function arabicMatchesWords(input: {
  readonly total: number;
  readonly sinceLastVisit: boolean;
  readonly names: readonly string[];
  /** The best fit, only when it is a real fit and not tied at the top. */
  readonly best: string | null;
}): string | null {
  if (input.total <= 0 || input.names.length === 0) return null;
  const more = input.total > input.names.length ? " وغيرها" : "";
  const head =
    input.total === 1
      ? `${input.sinceLastVisit ? "شركة جديدة" : "شركة في خلاصتك"} تطابق تفويضك: ${input.names[0] ?? ""}.`
      : input.total === 2
        ? `شركتان${input.sinceLastVisit ? " جديدتان" : ""} في خلاصتك تطابقان تفويضك: ${arabicList(input.names)}${more}.`
        : `${arabicCount(input.total, NOUN.company)}${input.sinceLastVisit ? " جديدة" : ""} في خلاصتك تطابق تفويضك: ${arabicList(input.names)}${more}.`;
  return input.best === null || input.names.length < 2
    ? head
    : `${head} ${input.best} هي الأنسب.`;
}

/** The close of a briefing with two or more cards. */
export const ARABIC_CARDS_CLOSE = "أخبرني بما تريد فعله بأي منها.";
/** A quiet check whose sources could not all be read. */
export const ARABIC_QUIET_PREFIX = "الهدوء فيما استطعت التحقق منه.";

/** A story from The Q Daily, as the quiet-day welcome names it. */
export type ArabicDailyStory = {
  /** The story's own headline, kept as written. */
  readonly headline: string;
};

/**
 * A quiet day mentions one or two prepared Q Daily stories (P4); their
 * headlines are data and stay as written. Null with none.
 */
export function arabicQuietDayNewsWords(
  stories: readonly ArabicDailyStory[],
): string | null {
  const [first, second] = stories;
  if (first === undefined) return null;
  const a = first.headline.replace(/[.!?\s]+$/u, "");
  if (second === undefined) {
    return `لفتت انتباهي قصة في أحدث عدد من The Q Daily: «${a}». هل تريد الخلاصة؟`;
  }
  const b = second.headline.replace(/[.!?\s]+$/u, "");
  return `قصتان من أحدث عدد من The Q Daily: «${a}» و«${b}». هل تريد خلاصة إحداهما؟`;
}
