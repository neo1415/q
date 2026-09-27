import {
  activeDiscoverFilterCount,
  canonicalDiscoverFilters,
  DiscoverFiltersSchema,
  isEmptyDiscoverFilters,
  NO_DISCOVER_FILTERS,
  QSetDiscoverFiltersIntentSchema,
  type DiscoverFilterDimension,
  type DiscoverFilters,
  type QSetDiscoverFiltersIntent,
} from "@capital-q/contracts";
import { COUNTRY_OPTIONS, STAGE_OPTIONS } from "@capital-q/founder-onboarding";

/**
 * Discover filters in the browser (ux/discover-filters).
 *
 * The filters narrow what the server serves; this module only holds the
 * reader's choice. It is kept per viewer in localStorage as a convenience
 * (a reload keeps the same view), wrapped so a private window, blocked
 * storage or a stale value simply means "no filters", never a broken page.
 * Nothing here is authority and nothing here ranks.
 */

export {
  activeDiscoverFilterCount,
  isEmptyDiscoverFilters,
  NO_DISCOVER_FILTERS,
};
export type { DiscoverFilters };

/** A sector the reader can pick: a node of the industry vocabulary. */
export type SectorOption = {
  readonly nodeId: string;
  readonly code: string;
  readonly label: string;
  readonly depth: number;
};

export type LabelledOption = { readonly value: string; readonly label: string };

export const STAGE_FILTER_OPTIONS: readonly LabelledOption[] =
  STAGE_OPTIONS.filter((option) => option.optionKey !== "unsure").map(
    (option) => ({ value: option.optionKey, label: option.label }),
  );

/** Companies store countries uppercase; "somewhere else" is not a filter. */
export const COUNTRY_FILTER_OPTIONS: readonly LabelledOption[] =
  COUNTRY_OPTIONS.filter((option) => option.optionKey !== "other").map(
    (option) => ({
      value: option.optionKey.toUpperCase(),
      label: option.label,
    }),
  );

/** The currencies a raise range can be stated in; no conversion is made. */
export const RAISE_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
] as const;

export const FILTER_UNKNOWN_TEXT: Readonly<
  Record<DiscoverFilterDimension, string>
> = {
  sector: "Sector not stated",
  stage: "Stage not stated",
  country: "Country not stated",
  raise: "Raise not shared",
};

const STORAGE_KEY = "cq.discover.filters.v1";
const PENDING_KEY = "cq.discover.filters.pending.v1";
/** Fired on this tab when Q sets the filters while Discover is open. */
export const DISCOVER_FILTERS_EVENT = "cq:discover-filters";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A stable identity for a filter set: equal filters, equal keys. */
export function filtersKey(filters: DiscoverFilters): string {
  return JSON.stringify(canonicalDiscoverFilters(filters));
}

export function readStoredFilters(
  storage: StorageLike | null = browserStorage(),
): DiscoverFilters {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return NO_DISCOVER_FILTERS;
    const parsed = DiscoverFiltersSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? canonicalDiscoverFilters(parsed.data)
      : NO_DISCOVER_FILTERS;
  } catch {
    return NO_DISCOVER_FILTERS;
  }
}

export function storeFilters(
  filters: DiscoverFilters,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    if (isEmptyDiscoverFilters(filters)) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, filtersKey(filters));
  } catch {
    // A convenience, not state: the page works without it.
  }
}

/**
 * Q's SET_DISCOVER_FILTERS, held until Discover can resolve its sector
 * codes against the vocabulary it lists (Q may be answered on another
 * page, which then navigates here).
 */
export function queueDiscoverFiltersIntent(
  intent: QSetDiscoverFiltersIntent,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify(intent));
  } catch {
    // Without storage the event below still reaches an open Discover.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DISCOVER_FILTERS_EVENT, { detail: intent }),
    );
  }
}

export function takePendingIntent(
  storage: StorageLike | null = browserStorage(),
): QSetDiscoverFiltersIntent | null {
  try {
    const raw = storage?.getItem(PENDING_KEY) ?? null;
    if (raw === null) return null;
    storage?.removeItem(PENDING_KEY);
    const parsed = QSetDiscoverFiltersIntentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The intent as filters. Sector codes resolve against the listed
 * vocabulary; a code nobody lists is dropped and reported, never guessed.
 */
export function filtersFromIntent(
  intent: QSetDiscoverFiltersIntent,
  sectors: readonly SectorOption[],
): {
  readonly filters: DiscoverFilters;
  readonly unresolved: readonly string[];
} {
  const byCode = new Map(sectors.map((s) => [s.code, s.nodeId] as const));
  const nodeIds: string[] = [];
  const unresolved: string[] = [];
  for (const code of intent.sectorCodes) {
    const id = byCode.get(code);
    if (id === undefined) unresolved.push(code);
    else nodeIds.push(id);
  }
  const parsed = DiscoverFiltersSchema.safeParse({
    sectorNodeIds: nodeIds,
    stageCodes: intent.stageCodes,
    countryCodes: intent.countryCodes,
    raise: intent.raise,
    raiseDisclosedOnly: intent.raiseDisclosedOnly,
    verifiedOnly: intent.verifiedOnly,
    hasPitch: intent.hasPitch,
  });
  return {
    filters: parsed.success
      ? canonicalDiscoverFilters(parsed.data)
      : NO_DISCOVER_FILTERS,
    unresolved,
  };
}

export type ActiveFilterChip = {
  readonly key: string;
  readonly label: string;
  /** The filters without this one. */
  readonly without: DiscoverFilters;
};

function formatAmount(amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function raiseLabel(filters: DiscoverFilters): string | null {
  const raise = filters.raise;
  if (raise === null) {
    return filters.raiseDisclosedOnly ? "Raise shared" : null;
  }
  const min = raise.min === undefined ? null : formatAmount(raise.min);
  const max = raise.max === undefined ? null : formatAmount(raise.max);
  const range =
    min !== null && max !== null
      ? `${raise.currency} ${min}–${max}`
      : min !== null
        ? `${raise.currency} ${min}+`
        : `Up to ${raise.currency} ${max ?? ""}`;
  return filters.raiseDisclosedOnly ? `${range}, shared only` : range;
}

/** One removable chip per active value, in a fixed order. */
export function activeFilterChips(
  filters: DiscoverFilters,
  sectors: readonly SectorOption[],
): readonly ActiveFilterChip[] {
  const sectorLabel = new Map(sectors.map((s) => [s.nodeId, s.label] as const));
  const stageLabel = new Map(
    STAGE_FILTER_OPTIONS.map((o) => [o.value, o.label] as const),
  );
  const countryLabel = new Map(
    COUNTRY_FILTER_OPTIONS.map((o) => [o.value, o.label] as const),
  );
  const chips: ActiveFilterChip[] = [];
  for (const id of filters.sectorNodeIds) {
    chips.push({
      key: `sector:${id}`,
      label: sectorLabel.get(id) ?? "Sector",
      without: {
        ...filters,
        sectorNodeIds: filters.sectorNodeIds.filter((x) => x !== id),
      },
    });
  }
  for (const code of filters.stageCodes) {
    chips.push({
      key: `stage:${code}`,
      label: stageLabel.get(code) ?? code.replace(/_/g, " "),
      without: {
        ...filters,
        stageCodes: filters.stageCodes.filter((x) => x !== code),
      },
    });
  }
  for (const code of filters.countryCodes) {
    chips.push({
      key: `country:${code}`,
      label: countryLabel.get(code) ?? code,
      without: {
        ...filters,
        countryCodes: filters.countryCodes.filter((x) => x !== code),
      },
    });
  }
  const raise = raiseLabel(filters);
  if (raise !== null) {
    chips.push({
      key: "raise",
      label: raise,
      without: { ...filters, raise: null, raiseDisclosedOnly: false },
    });
  }
  if (filters.verifiedOnly) {
    chips.push({
      key: "verified",
      label: "Verified",
      without: { ...filters, verifiedOnly: false },
    });
  }
  if (filters.hasPitch) {
    chips.push({
      key: "pitch",
      label: "Has pitch video",
      without: { ...filters, hasPitch: false },
    });
  }
  return chips;
}

/** Toggles one value in a list, keeping the result canonical. */
export function toggleValue(
  values: readonly string[],
  value: string,
): string[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value].sort();
}
