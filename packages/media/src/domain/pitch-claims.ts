import type { TimedCue } from "./web-vtt.js";

/**
 * What a founder says in their pitch, read from its transcript (founder,
 * 2026-10-08: "they literally say it in the video ... the overview says
 * it's not shared").
 *
 * Deterministic on purpose: a fixed reading of the founder's own words,
 * never a model's interpretation of them, so the same transcript always
 * gives the same claims, it costs nothing to run on every read, and a
 * reading can be checked against the moment it cites. It is versioned so a
 * change in what it reads is a change someone made, not drift.
 *
 * Every claim is the company's own claim (USER_CLAIM, SELF_REPORTED): a
 * founder saying "$4 million seed" proves only that they said it. It is
 * part of the pitch, never a separate disclosure -- it reaches exactly the
 * people who may play the pitch, through the same rule.
 *
 * Unknown stays unknown: a figure said without a currency is not money, a
 * round said without a figure is no raise, and a pitch that says nothing
 * readable gives no claims, never zeros.
 */

export const PITCH_CLAIMS_READER_VERSION = 1 as const;

export type PitchClaimKind =
  "RAISE" | "STAGE" | "INSTRUMENT" | "TRACTION" | "USE_OF_FUNDS";

export type PitchClaim = {
  readonly kind: PitchClaimKind;
  /** The founder's words, as transcribed (bounded). */
  readonly statement: string;
  /** Where in the pitch the sentence starts (the cue that holds it). */
  readonly atMs: number;
  /** RAISE: the amount as a decimal string and an ISO currency. */
  readonly money?: { readonly amount: string; readonly currency: string };
  /** RAISE / STAGE: the stage code as the onboarding options name it. */
  readonly stageCode?: string;
  /** RAISE / INSTRUMENT: SAFE, convertible note, equity. */
  readonly instrument?: string;
};

const STATEMENT_MAX = 280;
const TRACTION_MAX = 6;

type Span = { readonly text: string; readonly start: number };

/** One running text with each cue's offset, so a sentence finds its time. */
function joined(cues: readonly TimedCue[]): {
  readonly text: string;
  readonly timeAt: (offset: number) => number;
} {
  const starts: number[] = [];
  let text = "";
  for (const cue of cues) {
    if (text !== "") text += " ";
    starts.push(text.length);
    text += cue.text.replace(/\s+/g, " ").trim();
  }
  return {
    text,
    timeAt: (offset) => {
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if ((starts[i] ?? Infinity) <= offset) index = i;
        else break;
      }
      return cues[index]?.startMs ?? 0;
    },
  };
}

/** Sentences, kept with where they start in the running text. */
function sentences(text: string): Span[] {
  const out: Span[] = [];
  // A full stop inside a number ("1.5 million") does not end a sentence.
  const pattern = /[^.!?]+(?:\.(?=\d)[^.!?]*)*[.!?]*/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed !== "") out.push({ text: trimmed, start: match.index + lead });
  }
  return out;
}

/** Clauses of a sentence, split at commas and semicolons. */
function clauses(sentence: Span): Span[] {
  const out: Span[] = [];
  for (const match of sentence.text.matchAll(/[^,;]+/g)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim().replace(/[.!?]+$/, "");
    if (trimmed !== "") {
      out.push({ text: trimmed, start: sentence.start + match.index + lead });
    }
  }
  return out;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
  "₦": "NGN",
};
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  ngn: "NGN",
  naira: "NGN",
};
const SCALE: Readonly<Record<string, number>> = {
  k: 3,
  thousand: 3,
  m: 6,
  mm: 6,
  mn: 6,
  million: 6,
  b: 9,
  bn: 9,
  billion: 9,
};

/** "1.5" scaled by 10^exponent, as a decimal string; never a float. */
function scaled(number: string, exponent: number): string {
  const [whole = "0", fraction = ""] = number.replace(/,/g, "").split(".");
  const point = whole.length + exponent;
  const digits = (whole + fraction).padEnd(point, "0");
  const integer = digits.slice(0, point).replace(/^0+/, "") || "0";
  const rest = digits.slice(point).replace(/0+$/, "");
  return rest === "" ? integer : `${integer}.${rest}`;
}

const MONEY = new RegExp(
  String.raw`(?:(\$|£|€|₦)|\b(USD|GBP|EUR|NGN)\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|mm|mn|m|bn|b|thousand|million|billion)?\b(?:\s+(US\s+dollars|dollars?|pounds?|euros?|naira))?`,
  "i",
);

/** The first money said in a phrase, only with a currency said too. */
export function moneyIn(
  phrase: string,
): { readonly amount: string; readonly currency: string } | null {
  for (const match of phrase.matchAll(new RegExp(MONEY.source, "gi"))) {
    const [, symbol, code, number, scale, word] = match;
    if (number === undefined) continue;
    const currency =
      (symbol === undefined ? undefined : CURRENCY_SYMBOLS[symbol]) ??
      (code === undefined ? undefined : CURRENCY_WORDS[code.toLowerCase()]) ??
      (word === undefined
        ? undefined
        : CURRENCY_WORDS[word.toLowerCase().replace(/^us\s+/, "")]);
    // No currency said: not money (unknown stays unknown).
    if (currency === undefined) continue;
    const exponent =
      scale === undefined ? 0 : (SCALE[scale.toLowerCase()] ?? 0);
    return { amount: scaled(number, exponent), currency };
  }
  return null;
}

const STAGES: readonly (readonly [RegExp, string])[] = [
  [/\bpre[-\s]?seed\b/i, "pre_seed"],
  [/\bseed\b/i, "seed"],
  [/\bseries\s+a\b/i, "series_a"],
  [/\bseries\s+b\b/i, "series_b"],
  [/\bseries\s+[c-z]\b/i, "series_c_plus"],
];
const INSTRUMENTS: readonly (readonly [RegExp, string])[] = [
  [/\bsafes?\b/i, "SAFE"],
  [/\bconvertible(?:\s+loan)?\s+notes?\b/i, "Convertible note"],
  [/\bpriced\s+(?:equity\s+)?round\b/i, "Priced equity round"],
];

const RAISING =
  /\b(?:raising|looking to raise|seeking|we(?:'re| are) looking for|the (?:round|raise) is|our (?:round|raise) is)\b/i;
const USE_OF_FUNDS =
  /\b(?:the (?:money|funds|capital|round) (?:will|goes|go)|use (?:of )?(?:the |this )?(?:money|funds|capital|round)|we(?:'ll| will) use (?:it|the|this)|(?:funds|money) will (?:go|be used))\b/i;

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|hundreds|thousand|thousands|dozens?";
const HAS_NUMBER = new RegExp(String.raw`\d|\b(?:${NUMBER_WORDS})\b`, "i");
const TRACTION_NOUN =
  /\b(?:customers?|clients?|users?|design partners?|pilots?|contracts?|requests?|revenue|ARR|MRR|GMV|transactions?|downloads?|subscribers?|merchants?|retention|waitlist|LOIs?|letters of intent|bookings|orders|patients|hospitals|schools|banks|deployments?|installs?|sign-?ups?|paying)\b/i;

function bounded(text: string): string {
  return text.length <= STATEMENT_MAX
    ? text
    : `${text.slice(0, STATEMENT_MAX - 1).trimEnd()}…`;
}

/**
 * The claims a pitch makes, in the order they are said: the raise (with
 * its stage and instrument when said in the same sentence), traction
 * figures, and what the money is for.
 */
export function extractPitchClaims(cues: readonly TimedCue[]): PitchClaim[] {
  if (cues.length === 0) return [];
  const { text, timeAt } = joined(cues);
  const out: PitchClaim[] = [];
  let raised = false;
  let traction = 0;
  for (const sentence of sentences(text)) {
    const atMs = timeAt(sentence.start);
    if (!raised && RAISING.test(sentence.text)) {
      // The raise clause itself, so "served. We're raising $4M" quotes the raise.
      const clause =
        clauses(sentence).find((c) => RAISING.test(c.text)) ?? sentence;
      const money = moneyIn(clause.text) ?? moneyIn(sentence.text);
      if (money !== null) {
        raised = true;
        const stageCode = STAGES.find(([p]) => p.test(sentence.text))?.[1];
        const instrument = INSTRUMENTS.find(([p]) =>
          p.test(sentence.text),
        )?.[1];
        out.push({
          kind: "RAISE",
          statement: bounded(sentence.text),
          atMs,
          money,
          ...(stageCode === undefined ? {} : { stageCode }),
          ...(instrument === undefined ? {} : { instrument }),
        });
        if (stageCode !== undefined) {
          out.push({
            kind: "STAGE",
            statement: bounded(sentence.text),
            atMs,
            stageCode,
          });
        }
        if (instrument !== undefined) {
          out.push({
            kind: "INSTRUMENT",
            statement: bounded(sentence.text),
            atMs,
            instrument,
          });
        }
        continue;
      }
    }
    if (USE_OF_FUNDS.test(sentence.text)) {
      out.push({
        kind: "USE_OF_FUNDS",
        statement: bounded(sentence.text),
        atMs,
      });
      continue;
    }
    for (const clause of clauses(sentence)) {
      if (traction >= TRACTION_MAX) break;
      if (HAS_NUMBER.test(clause.text) && TRACTION_NOUN.test(clause.text)) {
        traction += 1;
        out.push({
          kind: "TRACTION",
          statement: bounded(
            clause.text.charAt(0).toUpperCase() + clause.text.slice(1),
          ),
          atMs: timeAt(clause.start),
        });
      }
    }
  }
  return out;
}

/** "0:43", "1:02:05": a moment in a pitch as people say it. */
export function pitchMomentLabel(atMs: number): string {
  const total = Math.max(0, Math.floor(atMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}
