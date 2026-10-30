import type { QMapPlace, QSubjectRef } from "@capital-q/contracts";
import { countryName as canonicalCountryName } from "@capital-q/taxonomy/countries";

/**
 * The pure half of the data blocks (RECOVERY-2026-10 E4): where a subject
 * opens, how a chart's values become marks, and how a map's places split
 * into placed and not published. No numbers are made here; only what the
 * block carries is laid out.
 */

/** The page a referenced record opens on; null: no page of its own. */
export function subjectHref(subject: QSubjectRef | null): string | null {
  if (subject === null) return null;
  switch (subject.kind) {
    case "COMPANY":
      return `/company/${encodeURIComponent(subject.companyId)}`;
    case "INVESTOR_ORGANISATION":
      return `/investors/${encodeURIComponent(subject.investorOrganisationId)}`;
    case "RELATIONSHIP":
    case "CAPITAL_OBJECTIVE":
    case "DOCUMENT":
    case "USER":
    case "ORGANISATION":
      return null;
  }
}

/** Places on the map, and the ones whose location is not published. */
export function splitPlaces(places: readonly QMapPlace[]): {
  readonly placed: readonly (QMapPlace & { readonly countryCode: string })[];
  readonly unplaced: readonly QMapPlace[];
} {
  const placed: (QMapPlace & { readonly countryCode: string })[] = [];
  const unplaced: QMapPlace[] = [];
  for (const place of places) {
    if (place.countryCode === null) unplaced.push(place);
    else placed.push({ ...place, countryCode: place.countryCode });
  }
  return { placed, unplaced };
}

/** A country's name in the reader's language, else its code. */
export function countryName(code: string, locale?: string): string {
  // The one canonical country list; its English name, ICU's otherwise.
  return canonicalCountryName(code, locale ?? "en") ?? code;
}

/**
 * The value axis: zero-based (a bar that starts above zero exaggerates),
 * up to the largest value; negatives extend below zero.
 */
export function valueScale(values: readonly number[]): {
  readonly min: number;
  readonly max: number;
} {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  return { min, max: max === min ? min + 1 : max };
}

/** Merge the supplied category orders without inventing an order or a value. */
export function chartLabels(
  series: readonly { readonly points: readonly { readonly label: string }[] }[],
): string[] | null {
  const edges = new Map<string, Set<string>>();
  const incoming = new Map<string, number>();
  for (const { points } of series) {
    const seen = new Set<string>();
    for (const [i, point] of points.entries()) {
      if (seen.has(point.label)) return null;
      seen.add(point.label);
      if (!edges.has(point.label)) {
        edges.set(point.label, new Set());
        incoming.set(point.label, 0);
      }
      const previous = points[i - 1]?.label;
      if (previous !== undefined && !edges.get(previous)?.has(point.label)) {
        edges.get(previous)?.add(point.label);
        incoming.set(point.label, (incoming.get(point.label) ?? 0) + 1);
      }
    }
  }
  const ready = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([label]) => label);
  const labels: string[] = [];
  for (let i = 0; i < ready.length; i += 1) {
    const label = ready[i];
    if (label === undefined) continue;
    labels.push(label);
    for (const next of edges.get(label) ?? []) {
      const count = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, count);
      if (count === 0) ready.push(next);
    }
  }
  return labels.length === edges.size ? labels : null;
}

/** Figures as the reader reads them, with the currency when there is one. */
export function formatValue(
  value: number,
  currency: string | null,
  locale?: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      ...(currency === null ? {} : { style: "currency", currency }),
      maximumFractionDigits: 2,
      notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    }).format(value);
  } catch {
    return String(value);
  }
}

const TRUTH_WORDS: Readonly<Record<string, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "Claimed by the company",
};
const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  DOCUMENT_SUPPORTED: "backed by a document",
  MULTI_SOURCE_SUPPORTED: "backed by several sources",
  EXTERNALLY_VERIFIED: "checked externally",
  PLATFORM_VERIFIED: "checked by Capital Q",
  SELF_REPORTED: "self-reported",
};

/** "Claimed by the company, backed by a document": the series' standing. */
export function standingWords(
  truthClass: string,
  evidenceStatus: string,
): string {
  const truth = TRUTH_WORDS[truthClass] ?? truthClass;
  const evidence = EVIDENCE_WORDS[evidenceStatus];
  return evidence === undefined ? truth : `${truth}, ${evidence}`;
}

/** A timeline date as words ("8 Oct 2026"). */
export function timelineDate(at: string, locale?: string): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return at;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: /^\d{4}-\d{2}-\d{2}$/u.test(at) ? "UTC" : undefined,
  }).format(time);
}
