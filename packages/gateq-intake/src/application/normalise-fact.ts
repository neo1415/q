import { countryOfIso, countryOfName } from "@capital-q/taxonomy/countries";

import {
  NewApplicationFactSchema,
  type ApplicationDimension,
  type FactProvenance,
  type NewApplicationFact,
} from "../contracts/index.js";
import { countryOfCity } from "./cities.js";
import { amountsIn } from "./stated-amount.js";

/**
 * Every answer the applicant states is saved (owner principle 2026-10-21:
 * make it work instead of explaining the failure). The model reads the
 * right dimension but not always the canonical shape: "Nigeria" where the
 * projector reads `NG`, "Series A" where it reads `series_a`, "$2m" as text
 * where it reads an amount. This puts what was said into the shape the
 * dimension takes, deterministically, instead of refusing it.
 *
 * It never invents: a value is only reshaped from the words the model read,
 * and an amount still has to pass the stated-amount guard afterwards.
 * Null only when the words hold nothing of the shape at all ("somewhere in
 * Europe" is no country); the applicant's sentence stays on the transcript
 * and the dimension stays open, so Q asks it.
 */

type ProposedValue =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "CODE"; readonly code: string }
  | {
      readonly kind: "AMOUNT";
      readonly amount: string;
      readonly currency: string;
    }
  | { readonly kind: "PHRASES"; readonly phrases: readonly string[] }
  | { readonly kind: "NONE"; readonly declined?: true | undefined };

export type NormaliseContext = {
  /** What the applicant just said: an amount's currency may be in it. */
  readonly utterance: string;
  /** The raise currency already on record, if any. */
  readonly currencyOnRecord: string | null;
};

function wordsOf(value: ProposedValue): string | null {
  switch (value.kind) {
    case "TEXT":
      return value.text.trim();
    case "CODE":
      return value.code.trim();
    case "PHRASES":
      return value.phrases.join(", ").trim();
    case "AMOUNT":
      return `${value.amount} ${value.currency}`;
    case "NONE":
      return null;
  }
}

/**
 * Everyday names and ISO alpha-3 codes the canonical country list does not
 * carry as names (synonyms, not a country list: every code here is a
 * country of @capital-q/taxonomy/countries, which a test asserts).
 */
export const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  "united states of america": "US",
  "the us": "US",
  "the usa": "US",
  uk: "GB",
  "u.k.": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "the uk": "GB",
  uae: "AE",
  emirates: "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  ksa: "SA",
  "south korea": "KR",
  korea: "KR",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  "the netherlands": "NL",
  holland: "NL",
  "czech republic": "CZ",
  drc: "CD",
  "dr congo": "CD",
  turkey: "TR",
  russia: "RU",
  vietnam: "VN",
  // ISO 3166 alpha-3 for the most common answers.
  nga: "NG",
  gbr: "GB",
  ken: "KE",
  zaf: "ZA",
  gha: "GH",
  egy: "EG",
  are: "AE",
  deu: "DE",
  fra: "FR",
  ind: "IN",
  can: "CA",
  bra: "BR",
  sau: "SA",
  sgp: "SG",
};

/** "Nigeria", "ng", "NGA", "Lagos, Nigeria", "the UK" → ISO 3166-1 alpha-2. */
export function countryCodeIn(words: string): string | null {
  const wanted = words
    .trim()
    .toLowerCase()
    // "We're based in Lagos", "headquartered out of Nairobi": the place.
    .replace(/^.*?\b(?:in|out of|from)\s+/u, "")
    .replace(/[.!]+$/u, "")
    .trim();
  if (wanted.length === 0) return null;
  if (/^[a-z]{2}$/u.test(wanted)) {
    return countryOfIso(wanted)?.iso ?? null;
  }
  // The one canonical country list names a country; the synonyms above
  // are everyday names it does not carry.
  const named = (part: string): string | null =>
    COUNTRY_ALIASES[part] ?? countryOfName(part)?.iso ?? null;
  const direct = named(wanted) ?? countryOfCity(wanted);
  if (direct !== null) return direct;
  // "Lagos, Nigeria": the part that names a country, last first; else the
  // city it names ("Lagos and London": the first city).
  const parts = wanted.split(/\s*[,/;]\s*|\s+-\s+|\s+and\s+/u);
  for (const part of [...parts].reverse()) {
    const code = named(part);
    if (code !== null) return code;
  }
  for (const part of parts) {
    const code = countryOfCity(part);
    if (code !== null) return code;
  }
  return null;
}

const CURRENCY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\$|\bdollars?\b|\busd\b|\bbucks\b/iu, "USD"],
  [/€|\beuros?\b|\beur\b/iu, "EUR"],
  [/£|\bpounds?\b|\bsterling\b|\bgbp\b/iu, "GBP"],
  [/₦|\bnaira\b|\bngn\b/iu, "NGN"],
  [/\bshillings?\b|\bkes\b|\bksh\b/iu, "KES"],
  [/\brands?\b|\bzar\b/iu, "ZAR"],
  [/\bcedis?\b|\bghs\b/iu, "GHS"],
  [/\bdirhams?\b|\baed\b/iu, "AED"],
  [/\briyals?\b|\bsar\b/iu, "SAR"],
  [/₹|\brupees?\b|\binr\b/iu, "INR"],
];

let isoCurrencies: ReadonlySet<string> | null = null;
function isCurrency(code: string): boolean {
  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return isoCurrencies.has(code);
}

/** The currency a phrase names: an ISO code, a symbol or its word. */
export function currencyCodeIn(words: string): string | null {
  const trimmed = words.trim();
  if (/^[A-Za-z]{3}$/u.test(trimmed) && isCurrency(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  for (const [pattern, iso] of CURRENCY_WORDS) {
    if (pattern.test(trimmed)) return iso;
  }
  for (const match of trimmed.matchAll(/\b([A-Z]{3})\b/gu)) {
    const code = match[1];
    if (code !== undefined && isCurrency(code)) return code;
  }
  return null;
}

/** "Series A" → series_a, "pre-seed" → pre_seed, "Series D" → series_c_plus. */
export function stageCodeIn(words: string): string | null {
  const slug = words
    .trim()
    .toLowerCase()
    .replace(/\b(?:stage|round)\b/gu, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (slug.length === 0) return null;
  if (/^pre_?seed$/u.test(slug)) return "pre_seed";
  // Series C and later are one stage on the gateway (STAGE_WORDS).
  if (/^series_[c-z](?:_|$)/u.test(slug)) return "series_c_plus";
  const code = /^[a-z][a-z0-9_]{0,63}$/u.exec(slug.slice(0, 64))?.[0];
  return code ?? null;
}

/** Free text into the taxonomy resolver's phrases: split at list marks. */
function phrasesIn(words: string): readonly string[] {
  return [
    ...new Set(
      words
        .split(/\s*(?:,|;|\/|\band\b|&)\s*/u)
        .map((phrase) => phrase.trim().slice(0, 120))
        .filter((phrase) => phrase.length > 0),
    ),
  ].slice(0, 12);
}

function decimalOf(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const fixed = (Math.round(value * 100) / 100).toFixed(2);
  const plain = fixed.replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
  return /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/u.test(plain) ? plain : null;
}

function emailIn(words: string): string | null {
  const found = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/iu.exec(
    words,
  )?.[0];
  return found === undefined ? null : found.toLowerCase();
}

function websiteIn(words: string): string {
  const trimmed = words.trim().replace(/[.,;]+$/u, "");
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/iu.test(trimmed)
    ? `https://${trimmed.toLowerCase()}`
    : trimmed;
}

/**
 * The fact in its dimension's canonical shape, or null when the words hold
 * nothing of that shape. Provenance is kept as proposed; the caller still
 * applies its own rules (no minted document support, no unstated amount).
 */
export function normaliseProposedFact(
  proposal: {
    readonly dimension: ApplicationDimension;
    readonly value: ProposedValue;
    readonly provenance: FactProvenance;
  },
  context: NormaliseContext,
): NewApplicationFact | null {
  const { dimension, provenance } = proposal;
  let value: unknown = proposal.value;
  const words = wordsOf(proposal.value);
  if (proposal.value.kind !== "NONE" && words !== null) {
    // Only the dimensions with a shape to put words into; every other one
    // takes the value as read.
    const shaped: string = dimension;
    switch (shaped) {
      case "company.country": {
        const code = countryCodeIn(words);
        value = code === null ? null : { kind: "CODE", code };
        break;
      }
      case "raise.currency": {
        const code = currencyCodeIn(words);
        value = code === null ? null : { kind: "CODE", code };
        break;
      }
      case "company.stage": {
        const code = stageCodeIn(words);
        value = code === null ? null : { kind: "CODE", code };
        break;
      }
      case "company.sector_phrases": {
        const phrases = phrasesIn(words);
        value = phrases.length === 0 ? null : { kind: "PHRASES", phrases };
        break;
      }
      case "raise.amount": {
        if (proposal.value.kind === "AMOUNT") break;
        const [first] = amountsIn(words);
        const amount = first === undefined ? null : decimalOf(first);
        const currency =
          currencyCodeIn(words.replace(/[\d.,\s]+/gu, " ")) ??
          currencyCodeIn(context.utterance) ??
          context.currencyOnRecord;
        value =
          amount === null || currency === null
            ? null
            : { kind: "AMOUNT", amount, currency };
        break;
      }
      case "contact.email": {
        const email = emailIn(words);
        value = email === null ? proposal.value : { kind: "TEXT", text: email };
        break;
      }
      case "company.website":
        value = { kind: "TEXT", text: websiteIn(words) };
        break;
      default:
        break;
    }
  }
  if (value === null) return null;
  const parsed = NewApplicationFactSchema.safeParse({
    dimension,
    value,
    provenance,
  });
  return parsed.success ? parsed.data : null;
}
