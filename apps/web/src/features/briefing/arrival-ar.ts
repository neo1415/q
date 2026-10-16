import type { ArrivalWords } from "./arrival";
import type { Opener } from "./opener";

/**
 * Q's first words on arrival, in Arabic (multilingual Q). The same facts
 * as the English (how many things wait, whether to look now), composed by
 * code in Modern Standard Arabic: the greeting, the warm half and the
 * opener. The fuller lowdown is still composed in English and is said
 * only once the person chooses to look.
 */

function partOfDay(now: Date, zone: string | null): "MORNING" | "AFTERNOON" | "EVENING" | "LATE" {
  let hour = now.getHours();
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      ...(zone === null ? {} : { timeZone: zone }),
    }).format(now);
    hour = Number.parseInt(formatted, 10);
  } catch {
    // An unknown zone: the device's clock.
  }
  if (hour >= 5 && hour < 12) return "MORNING";
  if (hour >= 12 && hour < 17) return "AFTERNOON";
  if (hour >= 17 && hour < 22) return "EVENING";
  return "LATE";
}

export function arabicGreeting(input: {
  readonly firstName: string | null;
  readonly now: Date;
  readonly timeZone: string | null;
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

/** The arrival's opening words in Arabic; the rest as composed. */
export function arabicArrivalWords(
  words: ArrivalWords,
  input: {
    readonly firstName: string | null;
    readonly now: Date;
    readonly timeZone: string | null;
    readonly hoursAway: number | null;
    readonly seed: number;
    readonly atLeast: boolean;
  },
): ArrivalWords {
  const greeting = arabicGreeting(input);
  const late = partOfDay(input.now, input.timeZone) === "LATE";
  const away = input.hoursAway !== null && input.hoursAway >= 72;
  const options = away ? AWAY : WARM;
  const welcome = late ? null : (options[input.seed % options.length] ?? null);
  const opener = arabicOpener(words.opener, input.atLeast);
  return {
    ...words,
    greeting,
    welcome,
    opener,
    spoken: [greeting, welcome, opener.line]
      .filter((part): part is string => part !== null)
      .join(" "),
  };
}
