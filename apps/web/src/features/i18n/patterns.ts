/**
 * Sentences with a name, a figure or a date in them (multilingual Q).
 *
 * A catalogue key may carry placeholders, `"Waiting on {name}."`, so a
 * screen can pass its finished English sentence to `t()` and still get
 * Arabic: the sentence is matched against the pattern keys and the
 * captured parts are put into the Arabic template. A captured part that is
 * itself a catalogue string or pattern (a stage, "3 documents") is
 * translated too; names,
 * figures and dates pass through unchanged. `{n}` (and `{n2}`, `{count}`)
 * matches a figure only, and `{date}` only something with a digit in it.
 */
type Compiled = {
  readonly regex: RegExp;
  readonly names: readonly string[];
  readonly template: string;
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
// Not global: a global regex's `test` moves lastIndex, which `matchAll`
// would then start from.
const HAS_PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9]*\}/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(key: string, template: string): Compiled {
  const names: string[] = [];
  let source = "";
  let last = 0;
  for (const match of key.matchAll(PLACEHOLDER)) {
    source += escape(key.slice(last, match.index));
    const name = match[1] ?? "";
    // {n}, {n2}, {count}: a figure only, so a sentence of someone's own
    // words is never mistaken for one with a number in it.
    source += /^(n\d*|count)$/.test(name) ? "([\\d.,+]+)" : "(.+?)";
    names.push(name);
    last = match.index + match[0].length;
  }
  source += escape(key.slice(last));
  return { regex: new RegExp(`^${source}$`, "s"), names, template };
}

/** Bucketed by the pattern's first character, so a miss stays cheap. */
type PatternIndex = {
  readonly byFirst: ReadonlyMap<string, readonly Compiled[]>;
  readonly open: readonly Compiled[];
};

export function indexPatterns(
  catalogue: Readonly<Record<string, string>>,
): PatternIndex {
  const byFirst = new Map<string, Compiled[]>();
  const open: Compiled[] = [];
  for (const [key, template] of Object.entries(catalogue)) {
    if (!HAS_PLACEHOLDER.test(key)) continue;
    const compiled = compile(key, template);
    if (key.startsWith("{")) {
      open.push(compiled);
      continue;
    }
    const first = key.charAt(0);
    const bucket = byFirst.get(first) ?? [];
    bucket.push(compiled);
    byFirst.set(first, bucket);
  }
  // The most specific pattern (longest key) is tried first.
  const longestFirst = (a: Compiled, b: Compiled) =>
    b.regex.source.length - a.regex.source.length;
  for (const bucket of byFirst.values()) bucket.sort(longestFirst);
  open.sort(longestFirst);
  return { byFirst, open };
}

export function matchPattern(
  index: PatternIndex,
  catalogue: Readonly<Record<string, string>>,
  english: string,
  language: string,
): string | undefined {
  const candidates = [
    ...(index.byFirst.get(english.charAt(0)) ?? []),
    ...index.open,
  ];
  for (const pattern of candidates) {
    const match = pattern.regex.exec(english);
    if (match === null) continue;
    // {date}, {date2}: a date or time only, never someone's words.
    if (
      pattern.names.some(
        (name, i) => name.startsWith("date") && !/\d/.test(match[i + 1] ?? ""),
      )
    ) {
      continue;
    }
    const values = new Map<string, string>();
    pattern.names.forEach((name, i) => {
      const value = match[i + 1] ?? "";
      values.set(
        name,
        catalogue[value] ??
          (value.length < english.length
            ? matchPattern(index, catalogue, value, language)
            : undefined) ??
          localiseDate(value, language, catalogue) ??
          value,
      );
    });
    return pattern.template.replace(
      PLACEHOLDER,
      (whole, name: string) => values.get(name) ?? whole,
    );
  }
  return undefined;
}

/** English month and weekday words as the app writes them (en-GB), by index. */
const MONTHS_EN: readonly (readonly string[])[] = [
  ["Jan", "January"],
  ["Feb", "February"],
  ["Mar", "March"],
  ["Apr", "April"],
  ["May"],
  ["Jun", "June"],
  ["Jul", "July"],
  ["Aug", "August"],
  ["Sep", "Sept", "September"],
  ["Oct", "October"],
  ["Nov", "November"],
  ["Dec", "December"],
];
const DAYS_EN: readonly (readonly string[])[] = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
];
const LONG_FORMS = new Set(
  [...MONTHS_EN, ...DAYS_EN].map((forms) => forms.at(-1) ?? ""),
);

const MONTH = MONTHS_EN.flat().join("|");
const DAY = DAYS_EN.flat().join("|");
/**
 * A date as the app writes it in English (en-GB: "18 Sept", "27 Sept 2026",
 * "Tue 18 Sept, 14:00", "Thu 09:03"), and nothing else.
 */
const TIME = "\\d{1,2}:\\d{2}(?: ?[ap]m)?";
const DATE_ONLY = new RegExp(
  `^(?:(?:${DAY}),? )?(?:\\d{1,2} (?:${MONTH})(?:,? \\d{4})?(?:,? (?:at )?${TIME})?|${TIME})$`,
  "i",
);
const WORD = new RegExp(`\\b(${MONTH}|${DAY}|at|am|pm)\\b`, "g");

type DateWords = {
  readonly month: (index: number, long: boolean) => string;
  readonly day: (index: number, long: boolean) => string;
  readonly am: string;
  readonly pm: string;
};

const WORDS = new Map<string, DateWords | null>();
/** A marker no date contains, for a word that has no translation. */
const DROP = "\u2063";

/** Month, weekday and day-period words in a language, from Intl (Gregorian calendar). */
function dateWords(language: string): DateWords | null {
  const cached = WORDS.get(language);
  if (cached !== undefined) return cached;
  let words: DateWords | null;
  try {
    // Gregorian, whatever the locale's default calendar: the dates are.
    const locale = `${language}-u-ca-gregory`;
    const format = (options: Intl.DateTimeFormatOptions, at: Date) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
        at,
      );
    const period = (hour: number) =>
      new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        hour12: true,
        timeZone: "UTC",
      })
        .formatToParts(new Date(Date.UTC(2026, 0, 5, hour)))
        .find((part) => part.type === "dayPeriod")?.value ??
      (hour < 12 ? "am" : "pm");
    words = {
      month: (index, long) =>
        format(
          { month: long ? "long" : "short" },
          new Date(Date.UTC(2026, index, 15)),
        ),
      // 2026-01-04 was a Sunday.
      day: (index, long) =>
        format(
          { weekday: long ? "long" : "short" },
          new Date(Date.UTC(2026, 0, 4 + index)),
        ),
      am: period(9),
      pm: period(15),
    };
  } catch {
    words = null;
  }
  WORDS.set(language, words);
  return words;
}

const indexIn = (table: readonly (readonly string[])[], word: string): number =>
  table.findIndex((forms) =>
    forms.some((form) => form.toLowerCase() === word.toLowerCase()),
  );

/**
 * The same date with the language's month and day names (Intl); digits
 * stay Western, as everywhere in the interface. "at" is the catalogue's
 * word for it when there is one, else left out. Undefined when it is not
 * a date, or for English.
 */
export function localiseDate(
  text: string,
  language: string,
  catalogue: Readonly<Record<string, string>> = {},
): string | undefined {
  if (!DATE_ONLY.test(text)) return undefined;
  if ((language.split("-")[0] ?? "").toLowerCase() === "en") return undefined;
  const words = dateWords(language);
  if (words === null) return undefined;
  return text
    .replace(WORD, (word) => {
      const lower = word.toLowerCase();
      // No word for "at" in this language: the word and its space go.
      if (lower === "at") return catalogue["at"] ?? DROP;
      if (lower === "am") return words.am;
      if (lower === "pm") return words.pm;
      const long = LONG_FORMS.has(word);
      const month = indexIn(MONTHS_EN, word);
      if (month >= 0) return words.month(month, long);
      const day = indexIn(DAYS_EN, word);
      return day >= 0 ? words.day(day, long) : word;
    })
    .replaceAll(` ${DROP}`, "")
    .replaceAll(DROP, "");
}
