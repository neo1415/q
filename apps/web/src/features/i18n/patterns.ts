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
  /**
   * Only placeholders and a joining word ("{a} and {b}"): such a key would
   * match any English sentence with "and" in it, so it applies only when
   * no captured part is English prose left untranslated.
   */
  readonly connective: boolean;
};

/**
 * Lower-case words a sentence is made of and a name is not. Live
 * 2026-10-16: "{a} and {b}" turned "What Capital Q knows about your
 * company, and what investors would see." into "..., وwhat investors...".
 */
const PROSE =
  /(?:^|[^\p{L}])(?:the|what|which|who|why|how|your|you|they|their|it|its|we|our|is|are|was|were|be|would|could|should|might|can|will|to|for|with|about|this|that|have|has|not|before|after|when|if|so|but)(?=$|[^\p{L}])/u;

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
  const literal = key.replace(PLACEHOLDER, " ").match(/\p{L}+/gu) ?? [];
  return {
    regex: new RegExp(`^${source}$`, "s"),
    names,
    template,
    connective: literal.length <= 1,
  };
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

/**
 * "Founders named, Pitch deck" inside a sentence: Arabic only when every
 * item has Arabic, joined with the Arabic comma; otherwise as written.
 */
function listOf(
  catalogue: Readonly<Record<string, string>>,
  value: string,
): string | undefined {
  if (!value.includes(", ")) return undefined;
  const items = value.split(", ").map((item) => catalogue[item]);
  return items.every((item): item is string => item !== undefined)
    ? items.join("، ")
    : undefined;
}

export function matchPattern(
  index: PatternIndex,
  catalogue: Readonly<Record<string, string>>,
  english: string,
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
    let prose = false;
    pattern.names.forEach((name, i) => {
      const value = match[i + 1] ?? "";
      const translated =
        catalogue[value] ??
        (value.length < english.length
          ? matchPattern(index, catalogue, value)
          : undefined) ??
        localiseDate(value) ??
        listOf(catalogue, value);
      if (translated === undefined && PROSE.test(value)) prose = true;
      values.set(name, translated ?? value);
    });
    // A joining pattern over English prose would graft Arabic onto an
    // English sentence: the sentence stays as written instead.
    if (pattern.connective && prose) continue;
    return pattern.template.replace(
      PLACEHOLDER,
      (whole, name: string) => values.get(name) ?? whole,
    );
  }
  return undefined;
}

const MONTHS_AR: Readonly<Record<string, string>> = {
  Jan: "يناير",
  January: "يناير",
  Feb: "فبراير",
  February: "فبراير",
  Mar: "مارس",
  March: "مارس",
  Apr: "أبريل",
  April: "أبريل",
  May: "مايو",
  Jun: "يونيو",
  June: "يونيو",
  Jul: "يوليو",
  July: "يوليو",
  Aug: "أغسطس",
  August: "أغسطس",
  Sep: "سبتمبر",
  Sept: "سبتمبر",
  September: "سبتمبر",
  Oct: "أكتوبر",
  October: "أكتوبر",
  Nov: "نوفمبر",
  November: "نوفمبر",
  Dec: "ديسمبر",
  December: "ديسمبر",
};

const DAYS_AR: Readonly<Record<string, string>> = {
  Mon: "الاثنين",
  Monday: "الاثنين",
  Tue: "الثلاثاء",
  Tuesday: "الثلاثاء",
  Wed: "الأربعاء",
  Wednesday: "الأربعاء",
  Thu: "الخميس",
  Thursday: "الخميس",
  Fri: "الجمعة",
  Friday: "الجمعة",
  Sat: "السبت",
  Saturday: "السبت",
  Sun: "الأحد",
  Sunday: "الأحد",
};

const MONTH = Object.keys(MONTHS_AR).join("|");
const DAY = Object.keys(DAYS_AR).join("|");
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

/**
 * The same date with Arabic month and day names; digits stay Western, as
 * everywhere in the Arabic interface. Undefined when it is not a date.
 */
export function localiseDate(text: string): string | undefined {
  if (!DATE_ONLY.test(text)) return undefined;
  return text.replace(WORD, (word) =>
    word === "at"
      ? "الساعة"
      : word === "am"
        ? "ص"
        : word === "pm"
          ? "م"
          : (MONTHS_AR[word] ?? DAYS_AR[word] ?? word),
  );
}
