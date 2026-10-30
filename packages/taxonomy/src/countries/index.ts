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
