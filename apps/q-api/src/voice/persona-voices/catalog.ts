import { CATALOG_VOICES } from "./catalog-data.js";

/**
 * REHEARSE: the voices a person Q plays can speak with, and the picker that
 * chooses one for them (ported from Kuuza's voice_db.py).
 *
 * The catalog is generated from the ElevenLabs account by
 * src/dev/sync-voice-catalog.ts and committed as data (catalog-data.ts).
 *
 * The people Q plays speak English, so each voice is graded on how well it
 * can:
 *   tier 0  an English-labelled voice
 *   tier 1  another language, verified for English
 *   tier 2  another language, multilingual but not verified for English
 *   none    a single-language non-English voice: never used for English
 * A non-English voice speaking English keeps its native accent, which is
 * how a Gulf investor gets Arabic-accented English.
 *
 * Where a person is based (free text: "Lagos, Nigeria", "Dubai", "GB")
 * maps to an accent key, then through regional fallbacks, so a persona
 * never lands on an unrelated accent while a closer one has voices. An
 * unknown place stays unknown: the voice is a neutral American or British
 * one, never a guessed nationality.
 */

export type AgeGroup = "young_adult" | "middle_aged" | "senior";
export const AGE_GROUPS: readonly AgeGroup[] = [
  "young_adult",
  "middle_aged",
  "senior",
];

/** One account voice, as the sync script writes it. Public data only. */
export type CatalogVoice = {
  readonly id: string;
  readonly name: string;
  /** "premade" voices exist on every account; "professional" are library voices. */
  readonly category: string;
  /** ElevenLabs language label, lowercased ISO-ish code ("en", "ar"). */
  readonly language: string;
  /** ElevenLabs accent label, lowercased ("british", "saudi"); may be empty. */
  readonly accent: string;
  readonly gender: string;
  readonly ageGroup: AgeGroup | null;
  readonly verifiedLanguages: readonly string[];
};

export type AccentKey =
  | "nigerian"
  | "south_african"
  | "american"
  | "british"
  | "irish"
  | "australian"
  | "indian"
  | "singaporean"
  | "chinese"
  | "cantonese"
  | "japanese"
  | "korean"
  | "italian"
  | "indonesian"
  | "arabic"
  | "turkish"
  | "russian"
  | "german"
  | "dutch"
  | "french"
  | "spanish"
  | "latin_american"
  | "brazilian";

export const ACCENT_LABELS: Readonly<Record<AccentKey, string>> = {
  nigerian: "Nigerian English",
  south_african: "South African English",
  american: "American English",
  british: "British English",
  irish: "Irish English",
  australian: "Australian English",
  indian: "Indian English",
  singaporean: "Singaporean English",
  chinese: "Mandarin-accented English",
  cantonese: "Cantonese-accented English",
  japanese: "Japanese-accented English",
  korean: "Korean-accented English",
  italian: "Italian-accented English",
  indonesian: "Indonesian-accented English",
  arabic: "Arabic-accented English",
  turkish: "Turkish-accented English",
  russian: "Russian-accented English",
  german: "German-accented English",
  dutch: "Dutch-accented English",
  french: "French-accented English",
  spanish: "Spanish-accented English",
  latin_american: "Latin American-accented English",
  brazilian: "Brazilian-accented English",
};

/** "City, ST": the two-letter US state codes (lower case). */
const US_STATE_CODES: ReadonlySet<string> = new Set(
  (
    "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms " +
    "mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc"
  ).split(" "),
);

const isAccentKey = (value: string): value is AccentKey =>
  Object.hasOwn(ACCENT_LABELS, value);

/** English voices keyed by their ElevenLabs accent label. */
const ENGLISH_ACCENT_KEYS: Readonly<Record<string, AccentKey>> = {
  "us southern": "american",
  "south african": "south_african",
};

/** Non-English voices keyed by language, then accent label ("" = any label). */
const LANGUAGE_ACCENT_KEYS: Readonly<
  Record<string, Readonly<Record<string, AccentKey>>>
> = {
  zh: { "hong kong cantonese": "cantonese", "": "chinese" },
  ar: { "": "arabic" },
  tr: { "": "turkish" },
  hi: { "": "indian" },
  ta: { "": "indian" },
  ru: { "": "russian" },
  de: { "": "german" },
  nl: { "": "dutch" },
  fr: { "": "french" },
  es: { "latin american": "latin_american", "": "spanish" },
  pt: { "": "brazilian" },
  ja: { "": "japanese" },
  id: { "": "indonesian" },
  ko: { "": "korean" },
  it: { "": "italian" },
};

/** Next-closest accents when an accent has no voice for the persona's gender. */
const REGIONAL_FALLBACK: Readonly<Record<AccentKey, readonly AccentKey[]>> = {
  nigerian: ["south_african"],
  south_african: ["british", "nigerian"],
  british: ["irish", "australian"],
  irish: ["british", "australian"],
  australian: ["british"],
  american: ["british"],
  indian: ["singaporean"],
  singaporean: ["chinese", "indian"],
  chinese: ["cantonese", "singaporean"],
  cantonese: ["chinese", "singaporean"],
  japanese: ["korean"],
  korean: ["japanese"],
  indonesian: ["singaporean"],
  arabic: ["indian"],
  turkish: ["arabic"],
  russian: ["german"],
  german: ["dutch"],
  dutch: ["german"],
  french: ["spanish"],
  italian: ["spanish", "french"],
  spanish: ["latin_american"],
  latin_american: ["spanish"],
  brazilian: ["latin_american", "spanish"],
};

/** Last resort for any persona: neutral, well-stocked English accents. */
const NEUTRAL: readonly AccentKey[] = ["american", "british"];

const group = (
  accent: AccentKey,
  names: readonly string[],
): [string, AccentKey][] => names.map((name) => [name, accent]);

/**
 * Nationalities, countries, ISO 3166 alpha-2 codes and the cities investors
 * are commonly based in, each to an accent key. A place's accent is a
 * default, not a claim about the person: Q has no nationality for them, and
 * where they are based is the nearest public thing it has.
 */
const PLACE_TO_ACCENT: ReadonlyMap<string, AccentKey> = new Map([
  ...group("nigerian", [
    "nigerian",
    "nigeria",
    "ng",
    "lagos",
    "abuja",
    "ibadan",
    "port harcourt",
    "kano",
    "ghanaian",
    "ghana",
    "gh",
    "accra",
    "kumasi",
    "kenyan",
    "kenya",
    "ke",
    "nairobi",
    "mombasa",
    "ugandan",
    "uganda",
    "ug",
    "kampala",
    "tanzanian",
    "tanzania",
    "tz",
    "dar es salaam",
    "cameroonian",
    "cameroon",
    "cm",
    "douala",
    "ethiopian",
    "ethiopia",
    "et",
    "addis ababa",
    "rwandan",
    "rwanda",
    "rw",
    "kigali",
    "senegalese",
    "senegal",
    "sn",
    "dakar",
    "ivorian",
    "cote d'ivoire",
    "côte d'ivoire",
    "ivory coast",
    "ci",
    "abidjan",
    "african",
  ]),
  ...group("south_african", [
    "south african",
    "south africa",
    "za",
    "johannesburg",
    "cape town",
    "durban",
    "pretoria",
    "sandton",
    "zimbabwean",
    "zimbabwe",
    "zw",
    "harare",
    "zambian",
    "zambia",
    "zm",
    "lusaka",
    "namibian",
    "namibia",
    "na",
    "windhoek",
    "botswanan",
    "motswana",
    "botswana",
    "bw",
    "gaborone",
    "malawian",
    "malawi",
    "mw",
    "mozambican",
    "mozambique",
    "mz",
    "maputo",
  ]),
  ...group("american", [
    "american",
    "us",
    "usa",
    "united states",
    "united states of america",
    "new york",
    "san francisco",
    "silicon valley",
    "palo alto",
    "menlo park",
    "boston",
    "los angeles",
    "chicago",
    "seattle",
    "austin",
    "miami",
    "washington",
    "canadian",
    "canada",
    "ca",
    "toronto",
    "vancouver",
    "montreal",
    "filipino",
    "philippines",
    "ph",
    "manila",
  ]),
  ...group("british", [
    "british",
    "english",
    "scottish",
    "welsh",
    "uk",
    "gb",
    "united kingdom",
    "great britain",
    "england",
    "scotland",
    "wales",
    "london",
    "manchester",
    "edinburgh",
    "cambridge",
    "oxford",
    "birmingham",
    "bristol",
  ]),
  ...group("irish", ["irish", "ireland", "ie", "dublin", "cork"]),
  ...group("australian", [
    "australian",
    "australia",
    "au",
    "sydney",
    "melbourne",
    "brisbane",
    "perth",
    "new zealander",
    "kiwi",
    "new zealand",
    "nz",
    "auckland",
    "wellington",
  ]),
  ...group("indian", [
    "indian",
    "india",
    "in",
    "mumbai",
    "bangalore",
    "bengaluru",
    "delhi",
    "new delhi",
    "gurgaon",
    "gurugram",
    "hyderabad",
    "chennai",
    "pune",
    "pakistani",
    "pakistan",
    "pk",
    "karachi",
    "lahore",
    "islamabad",
    "bangladeshi",
    "bangladesh",
    "bd",
    "dhaka",
    "sri lankan",
    "sri lanka",
    "lk",
    "colombo",
    "nepali",
    "nepalese",
    "nepal",
    "np",
    "kathmandu",
  ]),
  ...group("singaporean", [
    "singaporean",
    "singapore",
    "sg",
    "malaysian",
    "malaysia",
    "my",
    "kuala lumpur",
  ]),
  ...group("chinese", [
    "chinese",
    "china",
    "cn",
    "beijing",
    "shanghai",
    "shenzhen",
    "hangzhou",
    "taiwanese",
    "taiwan",
    "tw",
    "taipei",
    "mandarin",
  ]),
  ...group("cantonese", [
    "hong konger",
    "hongkonger",
    "hong kong",
    "hk",
    "cantonese",
    "macanese",
    "macau",
    "mo",
  ]),
  ...group("japanese", ["japanese", "japan", "jp", "tokyo", "osaka"]),
  ...group("korean", [
    "korean",
    "south korean",
    "south korea",
    "korea",
    "kr",
    "seoul",
  ]),
  ...group("italian", ["italian", "italy", "it", "milan", "rome"]),
  ...group("indonesian", ["indonesian", "indonesia", "id", "jakarta"]),
  ...group("turkish", [
    "turkish",
    "turk",
    "turkey",
    "turkiye",
    "türkiye",
    "tr",
    "istanbul",
    "ankara",
    "izmir",
  ]),
  ...group("arabic", [
    "arabic",
    "arab",
    "saudi",
    "saudi arabian",
    "saudi arabia",
    "sa",
    "riyadh",
    "jeddah",
    "emirati",
    "uae",
    "united arab emirates",
    "ae",
    "dubai",
    "abu dhabi",
    "sharjah",
    "qatari",
    "qatar",
    "qa",
    "doha",
    "kuwaiti",
    "kuwait",
    "kw",
    "omani",
    "oman",
    "om",
    "muscat",
    "bahraini",
    "bahrain",
    "bh",
    "manama",
    "egyptian",
    "egypt",
    "eg",
    "cairo",
    "jordanian",
    "jordan",
    "jo",
    "amman",
    "lebanese",
    "lebanon",
    "lb",
    "beirut",
    "syrian",
    "syria",
    "sy",
    "iraqi",
    "iraq",
    "iq",
    "baghdad",
    "moroccan",
    "morocco",
    "ma",
    "casablanca",
    "rabat",
    "algerian",
    "algeria",
    "dz",
    "tunisian",
    "tunisia",
    "tn",
    "tunis",
    "libyan",
    "libya",
    "ly",
    "palestinian",
    "palestine",
    "ps",
    "yemeni",
    "yemen",
    "ye",
    "gcc",
    "gulf",
    "middle east",
    "mena",
  ]),
  ...group("russian", [
    "russian",
    "russia",
    "ru",
    "moscow",
    "ukrainian",
    "ukraine",
    "ua",
    "kyiv",
    "kiev",
    "belarusian",
    "belarus",
    "by",
    "kazakh",
    "kazakhstan",
    "kz",
    "almaty",
  ]),
  ...group("german", [
    "german",
    "germany",
    "de",
    "berlin",
    "munich",
    "hamburg",
    "frankfurt",
    "austrian",
    "austria",
    "at",
    "vienna",
    "swiss",
    "switzerland",
    "ch",
    "zurich",
    "geneva",
  ]),
  ...group("dutch", [
    "dutch",
    "netherlands",
    "nl",
    "the netherlands",
    "holland",
    "amsterdam",
    "rotterdam",
    "belgian",
    "belgium",
    "be",
    "brussels",
    "flemish",
    "antwerp",
  ]),
  ...group("french", ["french", "france", "fr", "paris", "lyon"]),
  ...group("spanish", ["spanish", "spain", "es", "madrid", "barcelona"]),
  ...group("latin_american", [
    "latin american",
    "latin america",
    "latam",
    "mexican",
    "mexico",
    "mx",
    "mexico city",
    "colombian",
    "colombia",
    "co",
    "bogota",
    "bogotá",
    "medellin",
    "argentine",
    "argentinian",
    "argentina",
    "ar",
    "buenos aires",
    "chilean",
    "chile",
    "cl",
    "santiago",
    "peruvian",
    "peru",
    "pe",
    "lima",
    "venezuelan",
    "venezuela",
    "ve",
    "cuban",
    "cuba",
    "cu",
    "puerto rican",
    "puerto rico",
    "pr",
    "ecuadorian",
    "ecuador",
    "ec",
    "dominican",
    "dominican republic",
    "do",
    "guatemalan",
    "guatemala",
    "gt",
  ]),
  ...group("brazilian", [
    "brazilian",
    "brazil",
    "br",
    "sao paulo",
    "são paulo",
    "rio de janeiro",
    "portuguese",
    "portugal",
    "pt",
    "lisbon",
  ]),
]);

const AGE_ORDER: Readonly<Record<AgeGroup, number>> = {
  young_adult: 0,
  middle_aged: 1,
  senior: 2,
};

type GradedVoice = {
  readonly voice: CatalogVoice;
  readonly accent: AccentKey | null;
  readonly englishTier: 0 | 1 | 2 | null;
};

function accentKeyOf(language: string, accent: string): AccentKey | null {
  if (language === "en") {
    const key = ENGLISH_ACCENT_KEYS[accent] ?? accent;
    return isAccentKey(key) ? key : null;
  }
  const byLabel = LANGUAGE_ACCENT_KEYS[language];
  if (byLabel === undefined) return null;
  return byLabel[accent] ?? byLabel[""] ?? null;
}

function englishTierOf(voice: CatalogVoice): 0 | 1 | 2 | null {
  if (voice.language === "en") return 0;
  if (voice.verifiedLanguages.includes("en")) return 1;
  return voice.verifiedLanguages.length > 1 ? 2 : null;
}

function grade(voices: readonly CatalogVoice[]): readonly GradedVoice[] {
  return voices.map((voice) => ({
    voice,
    accent: accentKeyOf(voice.language, voice.accent),
    englishTier: englishTierOf(voice),
  }));
}

const DEFAULT_GRADED = grade(CATALOG_VOICES);

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/ english$/u, "")
    .trim();
}

/**
 * The accent for a free-text place or nationality: "Lagos, Nigeria",
 * "Dubai, UAE", "GB", "Emirati". Each comma part is tried from the last
 * (usually the country) to the first. Null when nothing is recognised:
 * unknown stays unknown.
 */
export function accentForPlace(
  place: string | null | undefined,
): AccentKey | null {
  if (place === null || place === undefined) return null;
  const parts = place
    .split(/[,;/|()]/u)
    .map(normalise)
    .filter((part) => part.length > 0)
    .reverse();
  // 2026-10-23: a two-letter part is a code only when nothing longer is
  // known ("Boston, MA" was Morocco, "Denver, CO" Colombia); after a city
  // it is a US state when it is one.
  const named = parts.filter((part) => part.length > 2);
  for (const part of named) {
    const direct = PLACE_TO_ACCENT.get(part);
    if (direct !== undefined) return direct;
    const key = part.replace(/ /gu, "_");
    if (isAccentKey(key)) return key;
  }
  for (const part of parts) {
    if (part.length !== 2) continue;
    if (named.length > 0 && US_STATE_CODES.has(part)) return "american";
    const coded = PLACE_TO_ACCENT.get(part);
    if (coded !== undefined) return coded;
  }
  // "Greater London Area", "Dubai Internet City": a known name inside.
  for (const part of parts) {
    for (const word of part.split(" ")) {
      // Two-letter words are codes only on their own ("in", "it" are words).
      if (word.length < 3) continue;
      const found = PLACE_TO_ACCENT.get(word);
      if (found !== undefined) return found;
    }
    for (const [name, accent] of PLACE_TO_ACCENT) {
      if (name.includes(" ") && part.includes(name)) return accent;
    }
  }
  return null;
}

function accentChain(
  accent: AccentKey | null,
  strict: boolean,
): readonly AccentKey[] {
  if (strict) return accent === null ? [] : [accent];
  const chain: AccentKey[] = [];
  if (accent !== null) chain.push(accent, ...REGIONAL_FALLBACK[accent]);
  chain.push(...NEUTRAL);
  return [...new Set(chain)];
}

function candidates(
  graded: readonly GradedVoice[],
  accent: AccentKey,
  gender: string,
): readonly GradedVoice[] {
  return graded.filter(
    (entry) =>
      entry.accent === accent &&
      entry.englishTier !== null &&
      (gender.length === 0 || entry.voice.gender === gender),
  );
}

/** A steady, non-cryptographic hash: the same seed always picks the same voice. */
function seedHash(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function choose(
  pool: readonly GradedVoice[],
  ageGroup: AgeGroup | null,
  seed: string,
): CatalogVoice {
  const best = Math.min(...pool.map((entry) => entry.englishTier ?? 9));
  // Tiers 0 and 1 both speak English well; tier 2 only when nothing better.
  let narrowed = pool.filter(
    (entry) =>
      entry.englishTier === best ||
      (best <= 1 && entry.englishTier !== null && entry.englishTier <= 1),
  );
  if (ageGroup !== null) {
    const target = AGE_ORDER[ageGroup];
    const distance = (entry: GradedVoice) =>
      Math.abs(
        (entry.voice.ageGroup === null ? 1 : AGE_ORDER[entry.voice.ageGroup]) -
          target,
      );
    const nearest = Math.min(...narrowed.map(distance));
    narrowed = narrowed.filter((entry) => distance(entry) === nearest);
  }
  // Sorted by id first, so a catalog re-sync in another order keeps the pick.
  const ordered = [...narrowed].sort((a, b) =>
    a.voice.id.localeCompare(b.voice.id),
  );
  const picked = ordered[seedHash(seed) % ordered.length];
  if (picked === undefined) throw new Error("empty voice pool");
  return picked.voice;
}

export type VoicePick = {
  readonly voice: CatalogVoice;
  /** The accent the voice speaks with. */
  readonly accent: AccentKey;
  /** The accent asked for; null when the place was unknown. */
  readonly wanted: AccentKey | null;
  /** True when the voice is a regional or neutral fallback for `wanted`. */
  readonly fellBack: boolean;
};

/**
 * Pick a voice for a persona: the accent chain is the place's accent, its
 * regional fallbacks, then American and British. In the first accent that
 * has a voice of this gender: best English tier, then nearest age, then a
 * steady choice by `seed` (the counterpart), so the same person keeps the
 * same voice rehearsal after rehearsal.
 *
 * `strict`: the accent was chosen by a person, so no cross-accent fallback;
 * null when that accent has no voice of this gender.
 */
export function pickVoice(input: {
  readonly accent: AccentKey | null;
  readonly gender: "male" | "female" | null;
  readonly ageGroup: AgeGroup | null;
  readonly seed: string;
  readonly strict?: boolean | undefined;
  /** For tests: another catalog. */
  readonly catalog?: readonly CatalogVoice[] | undefined;
}): VoicePick | null {
  const graded =
    input.catalog === undefined ? DEFAULT_GRADED : grade(input.catalog);
  const gender = input.gender ?? "";
  for (const accent of accentChain(input.accent, input.strict === true)) {
    const pool = candidates(graded, accent, gender);
    if (pool.length === 0) continue;
    return {
      voice: choose(pool, input.ageGroup, input.seed),
      accent,
      wanted: input.accent,
      fellBack: accent !== input.accent,
    };
  }
  return null;
}

/** Whether a voice id is one the catalog lists (the relay's allow-list). */
export function catalogVoice(
  id: string,
  catalog: readonly CatalogVoice[] = CATALOG_VOICES,
): CatalogVoice | undefined {
  return catalog.find((voice) => voice.id === id);
}

export const CATALOG_VOICE_IDS: ReadonlySet<string> = new Set(
  CATALOG_VOICES.map((voice) => voice.id),
);

/** Accents that can voice an English-speaking persona, with per-gender counts. */
export function accentOptions(
  catalog: readonly CatalogVoice[] = CATALOG_VOICES,
): readonly {
  readonly accent: AccentKey;
  readonly male: number;
  readonly female: number;
}[] {
  const counts = new Map<AccentKey, { male: number; female: number }>();
  for (const entry of grade(catalog)) {
    if (entry.accent === null || entry.englishTier === null) continue;
    const gender = entry.voice.gender;
    if (gender !== "male" && gender !== "female") continue;
    const count = counts.get(entry.accent) ?? { male: 0, female: 0 };
    count[gender] += 1;
    counts.set(entry.accent, count);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accent, count]) => ({ accent, ...count }));
}

/**
 * Age carried through cadence and steadiness, on top of whichever voice the
 * picker found, so a senior persona still sounds senior when no
 * senior-labelled voice exists. Unknown age changes nothing.
 *
 *   senior       speed at most 0.88, stability at most 0.7
 *   young_adult  speed at least 1.0
 */
export function shapeForAge(
  settings: { readonly speed: number; readonly stability: number },
  ageGroup: AgeGroup | null,
): { readonly speed: number; readonly stability: number } {
  if (ageGroup === "senior") {
    return {
      speed: Math.min(settings.speed, 0.88),
      stability: Math.min(settings.stability, 0.7),
    };
  }
  if (ageGroup === "young_adult") {
    return {
      speed: Math.max(settings.speed, 1),
      stability: settings.stability,
    };
  }
  return settings;
}

/**
 * 2026-10-23 (owner: "maybe even speaking the local language occasionally"):
 * the language a persona greets in, from where they are based, with the
 * script it is written in so the multilingual voice says it properly.
 * Null for English-speaking places and unknown ones: unknown stays unknown.
 */
export type LocalLanguage = {
  readonly language: string;
  readonly script: string;
};

const LOCAL_LANGUAGE: Readonly<Partial<Record<AccentKey, LocalLanguage>>> = {
  arabic: { language: "Arabic", script: "Arabic script" },
  turkish: { language: "Turkish", script: "Latin script" },
  indian: { language: "Hindi", script: "Devanagari" },
  chinese: { language: "Mandarin", script: "simplified Chinese characters" },
  cantonese: {
    language: "Cantonese",
    script: "traditional Chinese characters",
  },
  japanese: { language: "Japanese", script: "Japanese script" },
  korean: { language: "Korean", script: "Hangul" },
  italian: { language: "Italian", script: "Latin script" },
  indonesian: { language: "Indonesian", script: "Latin script" },
  russian: { language: "Russian", script: "Cyrillic" },
  german: { language: "German", script: "Latin script" },
  dutch: { language: "Dutch", script: "Latin script" },
  french: { language: "French", script: "Latin script" },
  spanish: { language: "Spanish", script: "Latin script" },
  latin_american: { language: "Spanish", script: "Latin script" },
  brazilian: { language: "Portuguese", script: "Latin script" },
};

/** Nigeria's main languages by city; Pidgin where no city says otherwise. */
const NIGERIAN_CITY_LANGUAGE: readonly [RegExp, string][] = [
  [
    /\b(lagos|ibadan|abeokuta|ogun|oyo|osun|ondo|ekiti|ilorin|ikeja|lekki)\b/iu,
    "Yoruba",
  ],
  [
    /\b(kano|kaduna|katsina|sokoto|zaria|maiduguri|bauchi|jos|abuja)\b/iu,
    "Hausa",
  ],
  [/\b(enugu|onitsha|owerri|aba|awka|nsukka|umuahia)\b/iu, "Igbo"],
];

export function localLanguageFor(
  place: string | null | undefined,
): LocalLanguage | null {
  const accent = accentForPlace(place);
  if (accent === null) return null;
  if (accent === "nigerian") {
    const found = NIGERIAN_CITY_LANGUAGE.find(([test]) =>
      test.test(place ?? ""),
    );
    return {
      language: found?.[1] ?? "Nigerian Pidgin",
      script: "Latin script",
    };
  }
  return LOCAL_LANGUAGE[accent] ?? null;
}
