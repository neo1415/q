import { GEOGRAPHY_VOCABULARY } from "../reference-data/geography.js";
import { geographyNodeId } from "./node-id.js";

/**
 * Capital Q's one canonical country list (owner 2026-10-30: "hand-made
 * country lists are patching"). Every ISO 3166-1 country is a node of the
 * geography vocabulary with its alpha-2 code in metadata; this module is
 * that list, read from the same reference data the migrations render, so
 * a country is a country everywhere: the founder's country step, the
 * company profile, Discover filters, research and GateQ.
 *
 * Browser-safe: plain data and the platform's ICU (`Intl.DisplayNames`),
 * no database and no Node built-ins.
 *
 * Names: English is the reference name (the name the taxonomy shows);
 * another locale (Arabic) is the platform's ICU name for the code, which
 * every supported runtime ships, so no names are copied into the repo.
 */

export type IsoCountry = {
  /** ISO 3166-1 alpha-2, uppercase ("DK"). */
  readonly iso: string;
  /** The geography node's canonical code ("denmark"). */
  readonly canonicalCode: string;
  /** The geography node's stable id (the same in every environment). */
  readonly nodeId: string;
  /** The reference (English) name ("Denmark"). */
  readonly name: string;
  /** The region node it sits under ("nordics"); null for a root. */
  readonly regionCode: string | null;
};

function readCountries(): readonly IsoCountry[] {
  const out: IsoCountry[] = [];
  for (const node of GEOGRAPHY_VOCABULARY.nodes) {
    const iso = node.metadata?.iso3166Alpha2;
    if (typeof iso !== "string" || !/^[A-Z]{2}$/.test(iso)) continue;
    out.push({
      iso,
      canonicalCode: node.code,
      nodeId: geographyNodeId(node.code),
      name: node.name,
      regionCode: node.parent ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** Every ISO 3166-1 country, by English name. */
export const ISO_COUNTRIES: readonly IsoCountry[] = readCountries();

const BY_ISO: ReadonlyMap<string, IsoCountry> = new Map(
  ISO_COUNTRIES.map((country) => [country.iso, country]),
);
const BY_NODE_ID: ReadonlyMap<string, IsoCountry> = new Map(
  ISO_COUNTRIES.map((country) => [country.nodeId, country]),
);
const BY_CANONICAL_CODE: ReadonlyMap<string, IsoCountry> = new Map(
  ISO_COUNTRIES.map((country) => [country.canonicalCode, country]),
);

/** The country with this alpha-2 code (any case); null when none. */
export function countryOfIso(
  code: string | null | undefined,
): IsoCountry | null {
  if (code === null || code === undefined) return null;
  return BY_ISO.get(code.trim().toUpperCase()) ?? null;
}

/** True for an ISO 3166-1 alpha-2 country code (any case). */
export function isIsoCountryCode(code: string | null | undefined): boolean {
  return countryOfIso(code) !== null;
}

/**
 * The country a geography node names, by its canonical code
 * ("south_africa" -> ZA); null for a region ("west_africa", "global").
 */
export function countryOfCanonicalCode(
  canonicalCode: string | null | undefined,
): IsoCountry | null {
  if (canonicalCode === null || canonicalCode === undefined) return null;
  return BY_CANONICAL_CODE.get(canonicalCode) ?? null;
}

/**
 * The country a geography node id names; null for a region, another
 * vocabulary's node or an unknown id.
 */
export function countryOfNodeId(
  nodeId: string | null | undefined,
): IsoCountry | null {
  if (nodeId === null || nodeId === undefined) return null;
  return BY_NODE_ID.get(nodeId.toLowerCase()) ?? null;
}

const displayNames = new Map<string, Intl.DisplayNames | null>();
function namesFor(locale: string): Intl.DisplayNames | null {
  const cached = displayNames.get(locale);
  if (cached !== undefined) return cached;
  let names: Intl.DisplayNames | null;
  try {
    names = new Intl.DisplayNames([locale], {
      type: "region",
      fallback: "none",
    });
  } catch {
    names = null;
  }
  displayNames.set(locale, names);
  return names;
}

/**
 * A country's name in a locale: the reference name in English, the
 * platform's ICU name otherwise (falling back to the reference name).
 * Null when the code is not a country.
 */
export function countryName(
  code: string | null | undefined,
  locale = "en",
): string | null {
  const country = countryOfIso(code);
  if (country === null) return null;
  if (locale === "en" || locale.startsWith("en-")) return country.name;
  let localised: string | undefined;
  try {
    localised = namesFor(locale)?.of(country.iso);
  } catch {
    localised = undefined;
  }
  return localised === undefined || localised === country.iso
    ? country.name
    : localised;
}

const fold = (words: string): string =>
  words
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .trim()
    .toLowerCase();

let namesByFold: ReadonlyMap<string, string> | null = null;
function byName(): ReadonlyMap<string, string> {
  if (namesByFold !== null) return namesByFold;
  const map = new Map<string, string>();
  const icu = namesFor("en");
  for (const country of ISO_COUNTRIES) {
    map.set(fold(country.name), country.iso);
    let other: string | undefined;
    try {
      other = icu?.of(country.iso);
    } catch {
      other = undefined;
    }
    if (other !== undefined && !map.has(fold(other))) {
      map.set(fold(other), country.iso);
    }
  }
  namesByFold = map;
  return map;
}

/**
 * The country whose name these words are, exactly (accents and case
 * aside): "Denmark", "côte d'ivoire", "Türkiye". A validator's
 * normalisation of a value that is already a country name, never a
 * reading of someone's sentence: "Copenhagen, Denmark" is not a name and
 * yields null here (the taxonomy chooser reads that by meaning).
 */
export function countryOfName(
  words: string | null | undefined,
): IsoCountry | null {
  if (words === null || words === undefined) return null;
  const iso = byName().get(fold(words));
  return iso === undefined ? null : countryOfIso(iso);
}

/**
 * Everyday names for a country that are not its reference or ICU name
 * (owner, live duplex voice 9 Nov: "in the USA" was never saved, and Q
 * asked for the country four times). Lowercase, punctuation already
 * dropped ("U.S.A." is "usa").
 */
const EVERYDAY_NAMES: Readonly<Record<string, string>> = {
  usa: "US",
  "united states of america": "US",
  "the united states": "US",
  "the states": "US",
  "the us": "US",
  "the usa": "US",
  america: "US",
  "new mexico": "US",
  uk: "GB",
  "the uk": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  uae: "AE",
  "the uae": "AE",
  emirates: "AE",
  "the emirates": "AE",
  holland: "NL",
  "the netherlands": "NL",
  "south korea": "KR",
  korea: "KR",
  "ivory coast": "CI",
  drc: "CD",
};

/**
 * Major investor hubs, by the country they are in (owner, 9 Nov: "Doha",
 * "Lagos", "San Francisco" must save the country). Deterministic, so the
 * common cities never wait on a model; any other city is read by the
 * transcript reader (v18: it gives the country of a city). Folded keys:
 * lowercase, no accents ("sao paulo").
 */
const CITY_COUNTRY: Readonly<Record<string, string>> = {
  "new york": "US",
  "new york city": "US",
  nyc: "US",
  manhattan: "US",
  brooklyn: "US",
  "san francisco": "US",
  sf: "US",
  "bay area": "US",
  "silicon valley": "US",
  "palo alto": "US",
  "menlo park": "US",
  "mountain view": "US",
  "san jose": "US",
  "los angeles": "US",
  boston: "US",
  "cambridge ma": "US",
  chicago: "US",
  seattle: "US",
  austin: "US",
  miami: "US",
  "washington dc": "US",
  dc: "US",
  "atlanta ga": "US",
  denver: "US",
  dallas: "US",
  houston: "US",
  philadelphia: "US",
  "san diego": "US",
  "salt lake city": "US",
  boulder: "US",
  nashville: "US",
  raleigh: "US",
  pittsburgh: "US",
  minneapolis: "US",
  detroit: "US",
  phoenix: "US",
  toronto: "CA",
  vancouver: "CA",
  montreal: "CA",
  waterloo: "CA",
  calgary: "CA",
  ottawa: "CA",
  london: "GB",
  manchester: "GB",
  edinburgh: "GB",
  "cambridge uk": "GB",
  oxford: "GB",
  bristol: "GB",
  "birmingham uk": "GB",
  glasgow: "GB",
  dublin: "IE",
  paris: "FR",
  lyon: "FR",
  berlin: "DE",
  munich: "DE",
  hamburg: "DE",
  frankfurt: "DE",
  amsterdam: "NL",
  rotterdam: "NL",
  eindhoven: "NL",
  "the hague": "NL",
  brussels: "BE",
  "luxembourg city": "LU",
  zurich: "CH",
  geneva: "CH",
  zug: "CH",
  lausanne: "CH",
  stockholm: "SE",
  copenhagen: "DK",
  oslo: "NO",
  helsinki: "FI",
  tallinn: "EE",
  madrid: "ES",
  barcelona: "ES",
  lisbon: "PT",
  porto: "PT",
  milan: "IT",
  rome: "IT",
  vienna: "AT",
  warsaw: "PL",
  prague: "CZ",
  "tel aviv": "IL",
  dubai: "AE",
  "abu dhabi": "AE",
  doha: "QA",
  riyadh: "SA",
  jeddah: "SA",
  manama: "BH",
  "kuwait city": "KW",
  muscat: "OM",
  cairo: "EG",
  casablanca: "MA",
  tunis: "TN",
  lagos: "NG",
  abuja: "NG",
  accra: "GH",
  nairobi: "KE",
  kigali: "RW",
  "cape town": "ZA",
  johannesburg: "ZA",
  joburg: "ZA",
  dakar: "SN",
  abidjan: "CI",
  "addis ababa": "ET",
  kampala: "UG",
  "dar es salaam": "TZ",
  mumbai: "IN",
  bombay: "IN",
  bangalore: "IN",
  bengaluru: "IN",
  "new delhi": "IN",
  delhi: "IN",
  gurgaon: "IN",
  gurugram: "IN",
  hyderabad: "IN",
  chennai: "IN",
  pune: "IN",
  karachi: "PK",
  lahore: "PK",
  beijing: "CN",
  shanghai: "CN",
  shenzhen: "CN",
  hangzhou: "CN",
  tokyo: "JP",
  osaka: "JP",
  seoul: "KR",
  taipei: "TW",
  jakarta: "ID",
  "ho chi minh city": "VN",
  hanoi: "VN",
  manila: "PH",
  "kuala lumpur": "MY",
  bangkok: "TH",
  sydney: "AU",
  melbourne: "AU",
  brisbane: "AU",
  perth: "AU",
  auckland: "NZ",
  "sao paulo": "BR",
  "rio de janeiro": "BR",
  "mexico city": "MX",
  "buenos aires": "AR",
  bogota: "CO",
  medellin: "CO",
  santiago: "CL",
  lima: "PE",
  istanbul: "TR",
};

/**
 * Names that are also somewhere else, so never a country by themselves in
 * a sentence: Georgia (the US state).
 */
const CLASHING_NAMES: ReadonlySet<string> = new Set(["georgia"]);

/**
 * The one country a short answer names, and the words that name it: the
 * answer as a country's name, or a country named inside it ("San Francisco,
 * California, in the USA" names the US). Null when it names none, or more
 * than one (that is for the person, or the chooser, to settle). A
 * lowercase "us" is the pronoun, never the country, unless "the us".
 */
export function countryNamedIn(
  words: string | null | undefined,
): { readonly country: IsoCountry; readonly words: string } | null {
  if (words === null || words === undefined) return null;
  const exact = countryOfName(words);
  if (exact !== null) return { country: exact, words: words.trim() };
  // Tokens with their surface form: "U.S.A." is one token, "usa".
  const tokens = [...words.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.'’-]*/gu)].map(
    (match) => {
      const surface = match[0].replace(/\.+$/u, "");
      return {
        surface,
        key: fold(surface.replace(/\./gu, "")),
      };
    },
  );
  const found = new Map<string, string>();
  const names = byName();
  // Longest first, so "new mexico" is read before "mexico".
  const taken = new Set<number>();
  for (let size = 4; size >= 1; size -= 1) {
    for (let at = 0; at + size <= tokens.length; at += 1) {
      const span = tokens.slice(at, at + size);
      if (span.some((_, i) => taken.has(at + i))) continue;
      const key = span.map((token) => token.key).join(" ");
      const surface = span.map((token) => token.surface).join(" ");
      if (CLASHING_NAMES.has(key)) continue;
      // "us" alone counts only as written "US" or "U.S."
      if (key === "us" && !/^U\.?S$/u.test(surface)) continue;
      const iso =
        EVERYDAY_NAMES[key] ??
        (key === "us" ? "US" : undefined) ??
        names.get(key) ??
        CITY_COUNTRY[key];
      if (iso === undefined) continue;
      for (let i = 0; i < size; i += 1) taken.add(at + i);
      if (!found.has(iso)) found.set(iso, surface);
    }
  }
  if (found.size !== 1) return null;
  const [iso, surface] = [...found][0] ?? [];
  const country = countryOfIso(iso);
  return country === null || surface === undefined
    ? null
    : { country, words: surface };
}
