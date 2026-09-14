import { countryName, mentionedCountries } from "./geography.js";
import { publicDomainOf } from "./url-safety.js";

/**
 * Deterministic notes comparing public sources with what Capital Q records
 * about the subject (CQ-Q-RESEARCH-001 §17-§19).
 *
 * These are the checks a machine can make honestly without a model: whether
 * a source is the subject's own declared website, which listed countries a
 * source names against the recorded headquarters, whether the source names
 * the subject at all, and whether its publication date is old enough that
 * time may explain a difference. Everything semantic — whether an ARR figure
 * in an article conflicts with a deck — is Q's reading of the excerpts, with
 * these notes as its trusted frame.
 *
 * Vocabulary: the evidence relationship classes Capital Q already uses
 * (SUPPORTS / QUALIFIES / CONTRADICTS) plus INSUFFICIENT_INFORMATION and
 * UNKNOWN. A mention of an extra country is QUALIFIES (it adds context), not
 * CONTRADICTS: a company can operate in more places than its headquarters.
 */

export const COMPARISON_RELATIONSHIPS = [
  "SUPPORTS",
  "QUALIFIES",
  "CONTRADICTS",
  "INSUFFICIENT_INFORMATION",
  "UNKNOWN",
] as const;
export type ComparisonRelationship = (typeof COMPARISON_RELATIONSHIPS)[number];

export const COMPARISON_BASES = [
  "OWN_WEBSITE",
  "GEOGRAPHY_MENTION",
  "NAME_MENTION",
  "TEMPORAL",
] as const;
export type ComparisonBasis = (typeof COMPARISON_BASES)[number];

export const TEMPORAL_CLASSES = [
  "WITHIN_12_MONTHS",
  "OLDER_THAN_12_MONTHS",
  "UNDATED",
] as const;
export type TemporalClass = (typeof TEMPORAL_CLASSES)[number];

/** What Capital Q records and has authorised for comparison. Public identity only. */
export type ComparableSubject = {
  readonly name: string;
  readonly websiteUrl: string | null;
  /** ISO 3166-1 alpha-2, as the company profile records it. */
  readonly headquartersCountry: string | null;
};

export type ComparableSource = {
  readonly index: number;
  readonly url: string;
  readonly text: string;
  readonly publishedAt: string | null;
};

export type ComparisonNote = {
  readonly sourceIndex: number;
  readonly basis: ComparisonBasis;
  readonly relationship: ComparisonRelationship;
  /** One plain sentence Q may quote as Capital Q's own reading. */
  readonly note: string;
};

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export function temporalClassOf(
  publishedAt: string | null,
  now: Date,
): TemporalClass {
  if (publishedAt === null) {
    return "UNDATED";
  }
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) {
    return "UNDATED";
  }
  return now.getTime() - time > TWELVE_MONTHS_MS
    ? "OLDER_THAN_12_MONTHS"
    : "WITHIN_12_MONTHS";
}

function namesSubject(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  return needle.length >= 3 && text.toLowerCase().includes(needle);
}

export function compareSourcesWithSubject(
  subject: ComparableSubject | null,
  sources: readonly ComparableSource[],
  now: Date,
): readonly ComparisonNote[] {
  const notes: ComparisonNote[] = [];
  const ownDomain = publicDomainOf(subject?.websiteUrl);
  const hqCode = subject?.headquartersCountry?.toUpperCase() ?? null;
  const hqName = countryName(hqCode);
  for (const source of sources) {
    const temporal = temporalClassOf(source.publishedAt, now);
    if (temporal === "OLDER_THAN_12_MONTHS") {
      notes.push({
        sourceIndex: source.index,
        basis: "TEMPORAL",
        relationship: "QUALIFIES",
        note: "This source was published more than twelve months ago; a difference from what Capital Q records may be a matter of time rather than a contradiction.",
      });
    } else if (temporal === "UNDATED") {
      notes.push({
        sourceIndex: source.index,
        basis: "TEMPORAL",
        relationship: "UNKNOWN",
        note: "This source carries no publication date; how current it is cannot be established.",
      });
    }
    if (subject === null) {
      continue;
    }
    const sourceDomain = publicDomainOf(source.url);
    if (
      ownDomain !== null &&
      sourceDomain !== null &&
      sourceDomain === ownDomain
    ) {
      notes.push({
        sourceIndex: source.index,
        basis: "OWN_WEBSITE",
        relationship: "SUPPORTS",
        note: `This is the company's own declared website (${ownDomain}); it is the company describing itself, not an independent source.`,
      });
    }
    if (!namesSubject(source.text, subject.name)) {
      notes.push({
        sourceIndex: source.index,
        basis: "NAME_MENTION",
        relationship: "INSUFFICIENT_INFORMATION",
        note: `This source does not name ${subject.name}; treat it as background, not as information about the company.`,
      });
    }
    const countries = mentionedCountries(source.text);
    if (countries.length === 0) {
      continue;
    }
    if (hqCode !== null && countries.includes(hqCode) && hqName !== null) {
      notes.push({
        sourceIndex: source.index,
        basis: "GEOGRAPHY_MENTION",
        relationship: "SUPPORTS",
        note: `This source mentions ${hqName}, consistent with the recorded headquarters.`,
      });
    }
    const others = countries
      .filter((code) => code !== hqCode)
      .map((code) => countryName(code))
      .filter((name): name is string => name !== null);
    if (others.length > 0) {
      notes.push({
        sourceIndex: source.index,
        basis: "GEOGRAPHY_MENTION",
        relationship: "QUALIFIES",
        note:
          hqName === null
            ? `This source mentions ${others.join(", ")}; Capital Q records no headquarters country for the company.`
            : `This source mentions ${others.join(", ")}; Capital Q records headquarters in ${hqName} and no operating markets. Whether these are active markets is for the company to say.`,
      });
    }
  }
  return notes;
}
