import type { ArrivalData } from "./arrival";
import { attentionLines, unreadWords } from "./attention";

/**
 * Q's first words on sign-in (owner, 2026-10-16: "it should just greet the
 * user and tell them they have notifications if they do and ask if they'd
 * like to look at them ... or if they want to talk about other things").
 *
 * A short greeting by first name, then one sentence naming what waits
 * (owner 2026-11-06, replacing 2026-10-16's "never the list": at most
 * three named, then "and N more"), then one question with two answers: look at them
 * now, or something else. Nothing waiting: the greeting and "What would you
 * like to look at?", with no urgency of its own. Pure and deterministic: no
 * model, no clock, no I/O, so the opener is instant and a test pins it.
 *
 * The count is the cards' own data (the same `ArrivalData` the stage
 * renders), so it is never a guess; a source that could not be read makes
 * it "at least", and with nothing counted it is said, never read as zero.
 */

export type OpenerChoice = "SHOW" | "OTHER";

/**
 * How a reply to the opener reads. QUESTION: answer it as asked (and move
 * on); SOCIAL: a hello or a thanks, which answers nothing (still asking).
 */
export type OpenerReply = OpenerChoice | "QUESTION" | "SOCIAL";

export type Opener = {
  /** Things waiting, as the cards count them. */
  readonly pending: number;
  /** Whether the two choices are offered (something is waiting). */
  readonly offersChoice: boolean;
  /** "Two things need you: …" -- null with nothing waiting. */
  readonly count: string | null;
  /** The one question Q asks after the greeting. */
  readonly question: string;
  /** What Q says after the greeting, on screen and on voice. */
  readonly line: string;
};

/** What waits on them: the cards the stage shows once they choose to look. */
export function pendingCount(data: ArrivalData): number {
  const decisions = data.cards.length;
  const lines =
    data.attention === null || data.attention === undefined
      ? 0
      : attentionLines(data.attention).length;
  // New since their last visit only; "in your feed, not looked at yet" is
  // the feed, not something waiting on them.
  const matches =
    data.matches?.label === "SINCE_LAST_VISIT" ? data.matches.items.length : 0;
  const questions = data.questions?.length ?? 0;
  // The continue-setup card, shown with the rest once they choose to look.
  const setup = Math.max(0, Math.min(1, data.setupReminders ?? 0));
  // Founders: their deck sections waiting on a check, as one item.
  const deck = (data.deckReview?.pending ?? 0) > 0 ? 1 : 0;
  return decisions + lines + matches + questions + setup + deck;
}

export const SOMETHING_ELSE_QUESTION = "What would you like to know?";
export const NOTHING_WAITING_QUESTION = "What would you like to look at?";
/** The Q page's one question under the greeting (owner 2026-10-17). */
export const OPEN_QUESTION = "What's on your mind today?";

export function openerOf(data: ArrivalData): Opener {
  const pending = pendingCount(data);
  const unread = data.attention?.unread ?? [];
  if (pending === 0) {
    // Unknown is not empty: a source that could not be read is said, once.
    const unknown = unreadWords(unread);
    return {
      pending,
      offersChoice: false,
      count: null,
      question: NOTHING_WAITING_QUESTION,
      line:
        unknown === null
          ? NOTHING_WAITING_QUESTION
          : `${unknown} ${NOTHING_WAITING_QUESTION}`,
    };
  }
  // Owner 2026-11-06: say what is waiting, never a bare "N things" -- the
  // same items the cards hold, so "what are they?" is answered from them.
  const count = waitingSentence(
    waitingPhrases(data),
    pending,
    unread.length > 0,
  );
  const question = `Would you like to look at ${pending === 1 ? "it" : "them"} now, or talk about something else?`;
  return {
    pending,
    offersChoice: true,
    count,
    question,
    line: `${count} ${question}`,
  };
}

/** One named thing waiting, and how many of the count it stands for. */
export type WaitingPhrase = { readonly words: string; readonly weight: number };

const IMPERATIVE =
  /^(Approve|Reply|Send|Email|Book|Share|Follow|Answer|Check|Review|Confirm|Sign|Finish)\b/u;

function trimEnd(words: string): string {
  return words.trim().replace(/[.!?\s]+$/u, "");
}

/** A card's words: who it is for, from the card's own data. */
function cardPhrase(card: ArrivalData["cards"][number]): string {
  const who = card.counterpart?.trim() ?? "";
  if (card.kind === "HELD") {
    return who === ""
      ? "a message Q held back"
      : `a message to ${who} that Q held back`;
  }
  if (who !== "" && card.title === "Reply ready to send") {
    return `approve the reply to ${who}`;
  }
  if (who !== "" && card.title === "Email ready to send") {
    return `approve the email to ${who}`;
  }
  const title = trimEnd(card.title);
  return IMPERATIVE.test(title)
    ? `${title.charAt(0).toLowerCase()}${title.slice(1)}`
    : `approve ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

/**
 * What waits on them, named, in the order `pendingCount` counts it. Every
 * phrase comes from data the arrival already holds: no read of its own.
 */
export function waitingPhrases(data: ArrivalData): readonly WaitingPhrase[] {
  const phrases: WaitingPhrase[] = data.cards.map((card) => ({
    words: cardPhrase(card),
    weight: 1,
  }));
  if (data.attention !== null && data.attention !== undefined) {
    for (const item of attentionLines(data.attention)) {
      phrases.push({ words: trimEnd(item.title), weight: 1 });
    }
  }
  if (data.matches?.label === "SINCE_LAST_VISIT") {
    for (const match of data.matches.items) {
      phrases.push({ words: `${match.name} is a new match`, weight: 1 });
    }
  }
  const questions = data.questions?.length ?? 0;
  if (questions > 0) {
    phrases.push({
      words:
        questions === 1
          ? "a question from Q about your company"
          : `${String(questions)} questions from Q about your company`,
      weight: questions,
    });
  }
  if ((data.setupReminders ?? 0) > 0) {
    phrases.push({ words: "finishing your setup", weight: 1 });
  }
  if ((data.deckReview?.pending ?? 0) > 0) {
    phrases.push({ words: "checking Q's reading of your deck", weight: 1 });
  }
  return phrases;
}

const NUMBER_WORDS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
] as const;
/** At most this many are named; the rest are "and N more". */
const NAMED_AT_MOST = 3;

/**
 * "Two things need you: approve the reply to Brightwell and Apex asked for
 * your cap table." The count is `pendingCount`'s; a source not read makes
 * it "at least" (unknown is not zero).
 */
export function waitingSentence(
  phrases: readonly WaitingPhrase[],
  pending: number,
  atLeast: boolean,
): string {
  const number = NUMBER_WORDS[pending] ?? String(pending);
  const counted = atLeast ? `At least ${number.toLowerCase()}` : number;
  const head = `${counted} ${pending === 1 ? "thing needs" : "things need"} you`;
  const shown = phrases.slice(0, NAMED_AT_MOST);
  if (shown.length === 0) return `${head}.`;
  const named = shown.map((phrase) => phrase.words);
  const rest = pending - shown.reduce((sum, phrase) => sum + phrase.weight, 0);
  if (rest > 0) named.push(`${String(rest)} more`);
  const list =
    named.length === 1
      ? (named[0] ?? "")
      : `${named.slice(0, -1).join(", ")} and ${named.at(-1) ?? ""}`;
  return `${head}: ${list}.`;
}

// ---------------------------------------------------------------------------
// Their answer, typed or spoken. Only a short reply made of nothing but a
// yes (or nothing but a "something else") is a choice; anything carrying a
// question of its own is that question, answered as one.

const SHOW_PHRASES = [
  "yes please",
  "yes",
  "yeah",
  "yep",
  "yup",
  "ya",
  "sure",
  "ok",
  "okay",
  "alright",
  "all right",
  "of course",
  "definitely",
  "go on",
  "go ahead",
  "let's go",
  "show me",
  "show them",
  "show it",
  "show",
  "let's see",
  "let me see",
  "let's have a look",
  "let's look",
  "have a look",
  "take a look",
  "look at them",
  "look at it",
  "look at those",
  "look",
  "bring them up",
  "bring it up",
  "open them",
  "go through them",
  "what are they",
  "what's waiting",
  "what is waiting",
  "the notifications",
  "notifications",
  "now",
  // Multilingual Q: the same short yes, in Arabic (MSA and Gulf).
  "نعم",
  "أجل",
  "ايوه",
  "إيه",
  "اي",
  "طيب",
  "حسنا",
  "حسناً",
  "تمام",
  "أكيد",
  "بالتأكيد",
  "أرني",
  "اعرضها",
  "اعرضه",
  "خلنا نشوف",
  "دعني أرى",
  "الآن",
];

const OTHER_PHRASES = [
  "something else",
  "talk about something else",
  "talk about other things",
  "other things",
  "another thing",
  "something different",
  "not now",
  "not right now",
  "later",
  "maybe later",
  "no thanks",
  "no thank you",
  "no",
  "nope",
  "nah",
  "skip",
  "skip them",
  "skip it",
  "i'll look later",
  "let's talk",
  "شيء آخر",
  "موضوع آخر",
  "شي ثاني",
  "ليس الآن",
  "مو الحين",
  "لاحقا",
  "لاحقاً",
  "بعدين",
  "لا",
  "لا شكرا",
  "لا شكراً",
];

const SOCIAL_PHRASES = [
  "hi",
  "hello",
  "hey",
  "hiya",
  "good morning",
  "good afternoon",
  "good evening",
  "morning",
  "afternoon",
  "evening",
  "how are you",
  "how are you doing",
  "how far",
  "i'm good",
  "i'm fine",
  "fine",
  "good",
  "great",
  "thanks",
  "thank you",
  "cheers",
  "مرحبا",
  "مرحباً",
  "أهلا",
  "أهلاً",
  "السلام عليكم",
  "صباح الخير",
  "مساء الخير",
  "كيف حالك",
  "شكرا",
  "شكراً",
];

/** Words that carry no meaning of their own in a short reply. */
const FILLER = new Set([
  "please",
  "q",
  "thanks",
  "thank",
  "you",
  "them",
  "it",
  "then",
  "right",
  "just",
  "lets",
  "let's",
  "i",
  "want",
  "to",
  "would",
  "like",
  "id",
  "i'd",
  "a",
  "the",
  "and",
  "so",
  "um",
  "uh",
  "oh",
  "well",
  "for",
  "me",
  "rather",
  "about",
  "talk",
  "first",
  "hi",
  "hello",
  "hey",
  "good",
  "great",
  "fine",
  "من",
  "فضلك",
  "لو",
  "يا",
  "شكرا",
  "شكراً",
]);

const MAX_REPLY_WORDS = 10;

function normalised(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escaped(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Whether the words are made of nothing but these phrases and filler. */
function onlyOf(words: string, phrases: readonly string[]): boolean {
  let rest = ` ${words} `;
  let hit = false;
  // Longest first, so "yes please" goes before "yes".
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(` ${escaped(phrase)}(?= )`, "gu");
    if (pattern.test(rest)) {
      hit = true;
      rest = rest.replace(pattern, " ");
    }
  }
  if (!hit) return false;
  return rest
    .trim()
    .split(" ")
    .every((word) => word.length === 0 || FILLER.has(word));
}

/** How a reply to the opener reads, from the person's own words. */
export function readOpenerReply(text: string): OpenerReply {
  const words = normalised(text);
  if (words.length === 0) return "QUESTION";
  if (words.split(" ").length > MAX_REPLY_WORDS) return "QUESTION";
  // "Something else" first: "no, something else" is not a yes.
  if (onlyOf(words, OTHER_PHRASES)) return "OTHER";
  if (onlyOf(words, SHOW_PHRASES)) return "SHOW";
  if (onlyOf(words, SOCIAL_PHRASES)) return "SOCIAL";
  return "QUESTION";
}
