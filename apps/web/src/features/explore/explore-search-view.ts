import {
  EXPLORE_SEARCH_TABS,
  exploreProfileHref,
  type ExploreSearchDto,
  type ExploreSearchTab,
  type ExploreTileDto,
} from "@capital-q/contracts";

import { COUNTRY_OPTIONS } from "@capital-q/founder-onboarding";

import { countryLabel, stageLabel } from "../company/declared-labels";

/**
 * Search inside Explore (E4): one box, tabs Top · Companies · Investors ·
 * People · Pitches. Every company or investor result opens their PROFILE
 * (the Discover company profile with its tabs; the investor's profile),
 * never a Q card. Pure: the server loader feeds it what the viewer may
 * already see, and nothing here widens that.
 */

export type ProfileResult = {
  readonly kind: "company" | "investor";
  readonly id: string;
  readonly name: string;
  readonly line: string | null;
  readonly meta: string;
  readonly href: string;
  readonly photoUrl?: string | null | undefined;
};

export type SearchChip = {
  readonly label: string;
  readonly kind: "stage" | "sector" | "country";
  /** The query without this word. */
  readonly without: string;
};

export type ExploreSearchView = {
  readonly query: string;
  readonly tab: ExploreSearchTab;
  readonly chips: readonly SearchChip[];
  readonly companies: readonly ProfileResult[];
  readonly investors: readonly ProfileResult[];
  readonly people: readonly ProfileResult[];
  readonly pitches: readonly ExploreTileDto[];
  readonly related: readonly string[];
};

export function searchTabOf(raw: unknown): ExploreSearchTab {
  return typeof raw === "string" &&
    (EXPLORE_SEARCH_TABS as readonly string[]).includes(raw)
    ? (raw as ExploreSearchTab)
    : "top";
}

export const SEARCH_TAB_LABELS: Readonly<Record<ExploreSearchTab, string>> = {
  top: "Top",
  companies: "Companies",
  investors: "Investors",
  people: "People",
  pitches: "Pitches",
};

export type SectorWord = { readonly nodeId: string; readonly label: string };

const STAGE_WORDS: Readonly<Record<string, string>> = {
  "pre-seed": "pre_seed",
  preseed: "pre_seed",
  seed: "seed",
  "series a": "series_a",
  "series b": "series_b",
  "series c": "series_c_plus",
};

/**
 * Read a query into removable chips, deterministically: declared stages,
 * industry sectors and countries by name. What is left is free text. No
 * model reads the query; Q can help, but the results come from the index.
 */
export function parseSearch(
  query: string,
  sectors: readonly SectorWord[],
): {
  readonly chips: readonly SearchChip[];
  readonly sectorNodeIds: readonly string[];
  readonly text: string;
} {
  const original = query.trim().replace(/\s+/g, " ").slice(0, 80);
  let rest = ` ${original.toLowerCase()} `;
  const chips: SearchChip[] = [];
  const sectorNodeIds: string[] = [];
  const take = (phrase: string): boolean => {
    const at = rest.indexOf(` ${phrase} `);
    if (at < 0) return false;
    rest = `${rest.slice(0, at)} ${rest.slice(at + phrase.length + 2)}`;
    return true;
  };
  const without = (phrase: string) =>
    original
      .replace(
        new RegExp(
          `(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
          "i",
        ),
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
  for (const [phrase, code] of Object.entries(STAGE_WORDS)) {
    if (take(phrase)) {
      chips.push({
        label: stageLabel(code) ?? phrase,
        kind: "stage",
        without: without(phrase),
      });
      // Stage words stay in the text: the index matches declared stages.
      rest = `${rest}${phrase} `;
    }
  }
  const bySize = [...sectors].sort((a, b) => b.label.length - a.label.length);
  for (const sector of bySize) {
    const phrase = sector.label.toLowerCase();
    if (phrase.length >= 3 && take(phrase)) {
      chips.push({
        label: sector.label,
        kind: "sector",
        without: without(phrase),
      });
      sectorNodeIds.push(sector.nodeId);
    }
  }
  for (const option of COUNTRY_OPTIONS) {
    const phrase = option.label.toLowerCase();
    if (rest.includes(` ${phrase} `)) {
      chips.push({
        label: option.label,
        kind: "country",
        without: without(phrase),
      });
    }
  }
  return {
    chips,
    sectorNodeIds,
    text: rest.trim().replace(/\s+/g, " "),
  };
}

export function profileFromCompany(
  company: ExploreSearchDto["companies"][number],
): ProfileResult {
  return {
    kind: "company",
    id: company.companyId,
    name: company.canonicalName,
    line: company.shortDescription,
    meta: [
      stageLabel(company.currentStageCode),
      countryLabel(company.headquartersCountry),
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
    href: exploreProfileHref("company", company.companyId),
  };
}

/** Related searches from the results' own declared facts, never from what others searched. */
export function relatedSearches(
  pitches: readonly ExploreTileDto[],
  sectorLabels: ReadonlyMap<string, string>,
  query: string,
): string[] {
  const out: string[] = [];
  for (const pitch of pitches) {
    const sector = pitch.sectorNodeIds
      .map((id) => sectorLabels.get(id))
      .find((label): label is string => label !== undefined);
    const country = countryLabel(pitch.headquartersCountry);
    const phrase =
      sector !== undefined && country !== null
        ? `${sector} in ${country}`
        : (sector ?? null);
    if (
      phrase !== null &&
      phrase.toLowerCase() !== query.toLowerCase() &&
      !out.includes(phrase)
    ) {
      out.push(phrase);
    }
    if (out.length >= 3) break;
  }
  return out;
}

export function searchHref(
  query: string,
  tab: ExploreSearchTab = "top",
): string {
  const params = new URLSearchParams();
  if (query.trim().length > 0) params.set("q", query.trim());
  if (tab !== "top") params.set("tab", tab);
  const text = params.toString();
  return text.length === 0 ? "/explore" : `/explore?${text}`;
}
