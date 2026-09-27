import { createHash } from "node:crypto";

import {
  canonicalDiscoverFilters,
  isEmptyDiscoverFilters,
  type DiscoverFilterDimension,
  type DiscoverFilters,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * Discover filters at read time (ux/discover-filters; doc 19 §15, ADR 0020).
 *
 * A filter narrows the slate the reader is already served. It never
 * re-ranks, never reaches the slate builder and never becomes a mandate:
 * it is the reader's explicit, momentary ask, and it is applied after the
 * read-time eligibility and suppression guards, so a filter can only ever
 * show less than the unfiltered page would, never more.
 *
 * Unknown never excludes silently. A company whose stage, country or
 * sector is not stated, or whose raise is not shared with this reader, is
 * kept and marked with the filter it could not be checked against —
 * except for the raise when the reader asked for disclosed raises only.
 * "Verified only" and "has pitch" ask for a positive fact, so only a
 * company that has it passes; that is the filter's meaning, not a verdict
 * on the rest.
 */

/** An exact money amount as shared with the reader; never a float. */
export type FilterMoney = {
  readonly amount: string;
  readonly currency: string;
};

/**
 * The facts a filter needs beyond the declared card, each supplied by the
 * context that owns it. A missing function means the fact is not known on
 * this deployment: sector and raise are then unknown (kept and marked),
 * and verification or a pitch cannot be shown to exist (not passed).
 */
export type DiscoverFilterFactsPort = {
  /** Declared sector nodes of each company, with their ancestors. */
  readonly sectors?:
    | ((
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, readonly string[]>>)
    | undefined;
  /**
   * The current raise of each company, only where disclosure lets this
   * reader see it (the Context Firewall: a founder-private raise never
   * narrows, widens or orders an investor's feed). Absent means not shared.
   */
  readonly disclosedRaises?:
    | ((input: {
        readonly actor: ActorContext;
        readonly companyIds: readonly string[];
      }) => Promise<ReadonlyMap<string, FilterMoney>>)
    | undefined;
  /** Companies whose organisation Capital Q has verified. */
  readonly verified?:
    | ((companyIds: readonly string[]) => Promise<ReadonlySet<string>>)
    | undefined;
  /** Companies with a publishable pitch video. */
  readonly withPitch?:
    | ((companyIds: readonly string[]) => Promise<ReadonlySet<string>>)
    | undefined;
};

export type CompanyFilterFacts = {
  readonly stageCode: string | null;
  readonly country: string | null;
  /** Null when sectors were not read; empty when none is declared. */
  readonly sectorNodeIds: readonly string[] | null;
  readonly raise: FilterMoney | null;
  readonly verified: boolean;
  readonly hasPitch: boolean;
};

export type FilterVerdict = {
  readonly pass: boolean;
  /** Filters the company's facts could not answer; it is kept, and marked. */
  readonly unknown: readonly DiscoverFilterDimension[];
};

/** Normalised non-negative decimal compare, exact (no float). */
export function compareAmounts(left: string, right: string): number {
  const split = (value: string): readonly [string, string] => {
    const [whole = "0", fraction = ""] = value.split(".");
    return [whole.replace(/^0+(?=\d)/, ""), fraction.replace(/0+$/, "")];
  };
  const [lw, lf] = split(left);
  const [rw, rf] = split(right);
  if (lw.length !== rw.length) return lw.length < rw.length ? -1 : 1;
  if (lw !== rw) return lw < rw ? -1 : 1;
  const width = Math.max(lf.length, rf.length);
  const a = lf.padEnd(width, "0");
  const b = rf.padEnd(width, "0");
  return a === b ? 0 : a < b ? -1 : 1;
}

export function raiseFilterActive(filters: DiscoverFilters): boolean {
  return filters.raise !== null || filters.raiseDisclosedOnly;
}

export function evaluateDiscoverFilters(
  filters: DiscoverFilters,
  facts: CompanyFilterFacts,
): FilterVerdict {
  const unknown: DiscoverFilterDimension[] = [];
  let pass = true;

  if (filters.sectorNodeIds.length > 0) {
    if (facts.sectorNodeIds === null || facts.sectorNodeIds.length === 0) {
      unknown.push("sector");
    } else {
      const wanted = new Set(filters.sectorNodeIds);
      if (!facts.sectorNodeIds.some((id) => wanted.has(id.toLowerCase()))) {
        pass = false;
      }
    }
  }
  if (filters.stageCodes.length > 0) {
    if (facts.stageCode === null) unknown.push("stage");
    else if (!filters.stageCodes.includes(facts.stageCode)) pass = false;
  }
  if (filters.countryCodes.length > 0) {
    if (facts.country === null) unknown.push("country");
    else if (!filters.countryCodes.includes(facts.country.toUpperCase())) {
      pass = false;
    }
  }
  if (raiseFilterActive(filters)) {
    const range = filters.raise;
    const raise = facts.raise;
    if (raise === null) {
      // Not shared with this reader: kept under "Raise not shared" unless
      // they asked for disclosed raises only.
      if (filters.raiseDisclosedOnly) pass = false;
      else unknown.push("raise");
    } else if (range !== null) {
      if (raise.currency !== range.currency) {
        // No FX conversion is invented: a raise in another currency is not
        // comparable, which is not the same as out of range.
        if (filters.raiseDisclosedOnly) pass = false;
        else unknown.push("raise");
      } else if (
        (range.min !== undefined &&
          compareAmounts(raise.amount, range.min) < 0) ||
        (range.max !== undefined && compareAmounts(raise.amount, range.max) > 0)
      ) {
        pass = false;
      }
    }
  }
  if (filters.verifiedOnly && !facts.verified) pass = false;
  if (filters.hasPitch && !facts.hasPitch) pass = false;
  return { pass, unknown: pass ? unknown : [] };
}

/** Null for no filters, so the unfiltered path stays exactly as it was. */
export function activeFilters(
  filters: DiscoverFilters | null | undefined,
): DiscoverFilters | null {
  if (filters === null || filters === undefined) return null;
  const canonical = canonicalDiscoverFilters(filters);
  return isEmptyDiscoverFilters(canonical) ? null : canonical;
}

/**
 * A short, stable fingerprint of a canonical filter set, carried in the
 * cursor so every page of one scroll is read under the same filters.
 */
export function discoverFiltersFingerprint(filters: DiscoverFilters): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalDiscoverFilters(filters)))
    .digest("hex")
    .slice(0, 16);
}
