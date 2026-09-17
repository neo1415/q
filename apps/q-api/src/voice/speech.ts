/**
 * Text as Q speaks it (CQ-Q-VOICE-001 C §39, D §57, §66).
 *
 * The Speech Engine synthesises whatever it is sent. What it is sent is
 * conversational text only: markdown structure, citations in brackets,
 * URLs and source lists read badly aloud and carry nothing a listener
 * needs. Long material is never read out; a spoken answer is bounded and
 * the full text stays on screen.
 */

/** A spoken turn stops here; the rest is on screen (§66). */
export const SPOKEN_MAX_CHARS = 1_200;

/**
 * Money and big numbers, as a person says them.
 *
 * "200 000 000 NGN" was read aloud as "two zero zero zero zero zero zero
 * zero zero N G N", because a synthesiser reads digit groups separated by
 * spaces as separate numbers and an ISO code as letters. The record is
 * right to hold the exact decimal and the ISO currency; the voice is wrong
 * to say them that way. This turns a figure into the words somebody would
 * use: two hundred million naira.
 *
 * Only for speech. The stored answer keeps the exact figure.
 */
const CURRENCY_WORDS: Readonly<Record<string, [string, string]>> = {
  NGN: ["naira", "naira"],
  USD: ["dollar", "dollars"],
  GBP: ["pound", "pounds"],
  EUR: ["euro", "euros"],
  KES: ["Kenyan shilling", "Kenyan shillings"],
  GHS: ["cedi", "cedis"],
  ZAR: ["rand", "rand"],
  UGX: ["Ugandan shilling", "Ugandan shillings"],
  TZS: ["Tanzanian shilling", "Tanzanian shillings"],
  RWF: ["Rwandan franc", "Rwandan francs"],
  XOF: ["CFA franc", "CFA francs"],
  EGP: ["Egyptian pound", "Egyptian pounds"],
  CAD: ["Canadian dollar", "Canadian dollars"],
  AUD: ["Australian dollar", "Australian dollars"],
};

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: "USD",
  "\u20a6": "NGN",
  "\u00a3": "GBP",
  "\u20ac": "EUR",
};

/** A number with grouped digits: spaces, thin spaces or commas between groups. */
const GROUPED_NUMBER =
  /\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function compactNumber(digits: string): string {
  const value = Number(digits.replace(/[ ,\u00a0\u202f]/g, ""));
  if (!Number.isFinite(value)) {
    return digits;
  }
  const units: readonly [number, string][] = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  for (const [size, word] of units) {
    if (value >= size) {
      const scaled = value / size;
      // Two decimals at most, and none when they are zero: "two hundred
      // million", "one point five million", "twelve thousand".
      const shown = Number.isInteger(scaled)
        ? String(scaled)
        : String(Math.round(scaled * 100) / 100);
      return `${shown} ${word}`;
    }
  }
  return String(value);
}

/**
 * A figure and, when written, what scales it: "1.5m", "200 million",
 * "250k", "2 billion". The space before the scale belongs to the scale,
 * not to the figure: "\u20a6200 million" once became "200 nairamillion" because
 * the figure's trailing space was eaten and "million" was left stuck to
 * the currency word.
 */
const FIGURE = String.raw`(\d[\d ,\u00a0\u202f.]*\d|\d)(?:\s*(k|m|b|thousand|million|billion)\b)?`;

export function spokenFigures(text: string): string {
  let out = text;
  // A code after the figure: "200 000 000 NGN", "1.5m USD", "200 million NGN".
  out = out.replace(
    new RegExp(
      String.raw`${FIGURE}\s*\b(${Object.keys(CURRENCY_WORDS).join("|")})\b`,
      "gi",
    ),
    (_all: string, figure: string, suffix: string | undefined, code: string) =>
      moneyWords(figure, suffix, code),
  );
  // A code or symbol before the figure: "NGN 200,000,000", "$1.5m", "\u20a6200 million".
  out = out.replace(
    new RegExp(
      String.raw`\b(${Object.keys(CURRENCY_WORDS).join("|")})\s*${FIGURE}`,
      "gi",
    ),
    (_all: string, code: string, figure: string, suffix: string | undefined) =>
      moneyWords(figure, suffix, code),
  );
  out = out.replace(
    new RegExp(String.raw`([$\u20a6\u00a3\u20ac])\s*${FIGURE}`, "gi"),
    (
      _all: string,
      symbol: string,
      figure: string,
      suffix: string | undefined,
    ) => moneyWords(figure, suffix, CURRENCY_SYMBOLS[symbol] ?? "USD"),
  );
  // Any other grouped number: "60,000 merchants" → "60 thousand merchants"
  // only when grouping is present; a plain "2020" is a year and stays.
  out = out.replace(GROUPED_NUMBER, (match: string) =>
    /[ ,\u00a0\u202f]/.test(match) ? compactNumber(match) : match,
  );
  return out;
}

function moneyWords(
  figure: string,
  suffix: string | undefined,
  code: string,
): string {
  const scale = (suffix ?? "").toLowerCase();
  const multiplier =
    scale === "k" || scale === "thousand"
      ? 1e3
      : scale === "m" || scale === "million"
        ? 1e6
        : scale === "b" || scale === "billion"
          ? 1e9
          : 1;
  const value = Number(figure.replace(/[ ,\u00a0\u202f]/g, "")) * multiplier;
  if (!Number.isFinite(value)) {
    return `${figure} ${code}`;
  }
  const [one, many] = CURRENCY_WORDS[code] ?? [code, code];
  const spoken = compactNumber(String(value));
  return `${spoken} ${value === 1 ? one : many}`;
}

/** Markdown and machine punctuation → plain sentences. */
export function speakable(text: string): string {
  return (
    spokenFigures(text)
      // Headings, list bullets, block quotes.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      // Emphasis and code.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
      // Links: keep the words, drop the address.
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1")
      .replace(/\bhttps?:\/\/\S+/g, "")
      // Bracketed citations and source markers.
      .replace(/\s*\((?:public web )?source\s+S\d{1,2}\)/gi, "")
      .replace(/\s*\[(?:S\d{1,2}|\d{1,2})\]/g, "")
      // Tables become nothing a voice can carry.
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/[ \t]+/g, " ")
      // A removed address leaves no orphaned space before punctuation.
      .replace(/ +([.,;:!?])/g, "$1")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/** Bound a spoken answer to what a listener can take in (§66). */
export function bounded(text: string, max = SPOKEN_MAX_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("! "),
  );
  return `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trim()} The rest is on your screen.`;
}

/**
 * Split text into sentence-sized chunks, so a stream can be spoken as it
 * arrives and an interruption loses at most one sentence.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[A-Z0-9"'(])/g;

export function sentences(text: string): readonly string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Re-chunk a stream of arbitrary text deltas into sentences, yielding each
 * as soon as it is complete and flushing the remainder at the end. Stops
 * when the signal aborts: a chunk that was not yielded is never spoken.
 */
export async function* bySentence(
  deltas: AsyncIterable<string>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let buffer = "";
  for await (const delta of deltas) {
    if (signal?.aborted === true) {
      return;
    }
    buffer += delta;
    // Everything up to the last completed sentence boundary is ready; the
    // remainder stays exactly as received so a word is never split.
    let cut = -1;
    for (const match of buffer.matchAll(SENTENCE_BOUNDARY)) {
      cut = match.index + match[0].length;
    }
    if (cut > 0) {
      for (const part of sentences(buffer.slice(0, cut))) {
        yield part;
      }
      buffer = buffer.slice(cut);
    }
  }
  if (signal?.aborted !== true && buffer.trim().length > 0) {
    yield buffer.trim();
  }
}

/**
 * Q says one short filler only when an answer is genuinely taking a while
 * (D §53).
 *
 * It was 2.5 s, then 4.5 s, and both were under the time an ordinary
 * answer takes — so every single reply began "One second" or "Hold on,
 * checking", which is worse than silence because it is a tic rather than
 * information. A person reading a transcript of it sees Q clearing its
 * throat before every sentence.
 *
 * Now above the slowest ordinary answer measured, so it fires for a turn
 * that is genuinely stuck rather than for every turn. A turn that reaches
 * the public web yields its own line ("Checking the public web on that")
 * as its first chunk and never gets here, because that line says
 * something true about what is happening.
 *
 * The durable fix is to speak the answer as it is written rather than
 * after it: a first sentence at a second and a half leaves nothing for a
 * filler to fill.
 */
export const FILLER_AFTER_MS = 8_000;

/**
 * Yield the source's items, and — if the first one has not arrived after
 * `afterMs` — one filler line first. At most one filler per turn, never
 * a promise about time, nothing at all when the answer is quick. Stops
 * when the signal aborts.
 */
export async function* withFiller(
  source: AsyncIterable<string>,
  options: {
    readonly filler: string;
    readonly afterMs?: number | undefined;
    readonly signal?: AbortSignal | undefined;
    /**
     * Only what this needs: schedule one callback, cancel one handle. The
     * global's own type carries Node's `__promisify__`, which a test's
     * two-line clock has no reason to provide.
     */
    readonly setTimeout?:
      | ((callback: () => void, ms: number) => ReturnType<typeof setTimeout>)
      | undefined;
    readonly clearTimeout?:
      ((handle: ReturnType<typeof setTimeout>) => void) | undefined;
  },
): AsyncGenerator<string> {
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const iterator = source[Symbol.asyncIterator]();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const slow = new Promise<"slow">((resolve) => {
    timer = schedule(() => resolve("slow"), options.afterMs ?? FILLER_AFTER_MS);
  });
  // Read through a call each time: the signal flips while this awaits, and
  // a narrowed property read would be stale.
  const isAborted = () => options.signal?.aborted === true;
  const first = iterator.next();
  const outcome = await Promise.race([
    first.then(() => "first" as const),
    slow,
  ]);
  if (outcome === "slow" && !isAborted()) {
    yield options.filler;
  }
  const head = await first;
  if (timer !== undefined) {
    cancel(timer);
  }
  if ((head.done ?? false) || isAborted()) {
    return;
  }
  yield head.value;
  for (;;) {
    const next = await iterator.next();
    if ((next.done ?? false) || isAborted()) {
      return;
    }
    yield next.value;
  }
}
