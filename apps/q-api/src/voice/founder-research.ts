import { FOUNDER_STEPS, STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import type { QRecommendationPublicSourceType } from "@capital-q/onboarding";
import type { FounderResearchReaderResult } from "@capital-q/q-core";
import { quoteOccursIn } from "@capital-q/q-knowledge";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import type { ResearchFinding, ResearchPage } from "./investor-research.js";

/**
 * Research-first founder onboarding (founder direction 2026-09-30): while
 * Q interviews, a background read of the company's own public pages
 * offers back what they say -- "here's what I found on your site, is that
 * right?" -- only for questions Q would otherwise ask.
 *
 * The same engine and discipline as investor research: the reader model
 * reads, code checks each cited quote is on its page and each choice is
 * one of the journey's own, and a finding is only ever a recommendation
 * with its source until the founder accepts it.
 */

const STAGE_KEYS = new Set(STAGE_OPTIONS.map((o) => o.optionKey));

/** The journey's stages, for the reader's prompt. */
export const FOUNDER_READER_OPTIONS = {
  stageOptions: STAGE_OPTIONS.filter((o) => o.optionKey !== "unsure").map(
    (o) => ({ key: o.optionKey, label: o.label }),
  ),
} as const;

function domainOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceOf(
  page: ResearchPage,
  websiteUrl: string | null,
): { type: QRecommendationPublicSourceType; said: string } {
  const host = domainOf(page.url) ?? "the web";
  if (page.provider === "public_registry") {
    return {
      type: "PUBLIC_REGISTRY",
      said: `found in a public registry (${page.title ?? host})`,
    };
  }
  if (page.provider === "public_profile") {
    return {
      type: "PUBLIC_PROFILE",
      said: `found on the profile link they gave (${host})`,
    };
  }
  const site = domainOf(websiteUrl);
  if (site !== null && (host === site || host.endsWith(`.${site}`))) {
    return { type: "PUBLIC_WEBSITE", said: `found on their website (${host})` };
  }
  return { type: "PUBLIC_WEB", said: `found on a public page (${host})` };
}

/** Words a company name carries that its domain usually drops. */
const LEGAL_SUFFIXES = new Set([
  "ltd",
  "limited",
  "inc",
  "llc",
  "plc",
  "corp",
  "co",
  "company",
  "gmbh",
  "sa",
  "bv",
  "hq",
]);

/**
 * The labels a company's own domain is likely to carry: the whole name
 * squeezed together, and the same without a trailing legal form ("Zino
 * Aviation Ltd" -> zinoaviationltd, zinoaviation).
 */
function nameLabels(companyName: string): ReadonlySet<string> {
  const words = companyName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const labels = new Set<string>();
  const whole = words.join("");
  if (whole.length >= 3) labels.add(whole);
  let trimmed = words;
  while (
    trimmed.length > 1 &&
    LEGAL_SUFFIXES.has(trimmed[trimmed.length - 1] ?? "")
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  const core = trimmed.join("");
  if (core.length >= 3) labels.add(core);
  return labels;
}

/**
 * What ties a public page to THIS company rather than a namesake (lane ob1;
 * live 2026-10-16: the registered name "Kestrel Freightworks" pulled in an
 * unrelated UK shipping agent's description). A name alone is never
 * enough. A page counts only when it is on the website they gave, is a
 * link they gave themselves, or names their founder or their country.
 * With no anchor at all, nothing is proposed: Q asks for the website.
 */
export type FounderResearchAnchors = {
  readonly personName?: string | null | undefined;
  /** The company's country in words ("Nigeria"), when known. */
  readonly country?: string | null | undefined;
};

function mentions(excerpt: string, words: string | null | undefined): boolean {
  const wanted = words?.trim().toLowerCase() ?? "";
  if (wanted.length < 3) return false;
  // The whole name: a surname alone matches too many namesakes.
  return excerpt.toLowerCase().includes(wanted);
}

export function anchoredToCompany(
  page: ResearchPage,
  websiteUrl: string | null,
  anchors: FounderResearchAnchors,
): boolean {
  if (page.provider === "public_profile") return true;
  const site = domainOf(websiteUrl);
  const host = domainOf(page.url);
  if (
    site !== null &&
    host !== null &&
    (host === site || host.endsWith(`.${site}`))
  ) {
    return true;
  }
  return (
    mentions(page.excerpt, anchors.personName) ||
    mentions(page.excerpt, anchors.country)
  );
}

/**
 * Their own site, when research met it and they have not given one (live
 * 2026-09-30: Q asked a YC founder for the website it had just read).
 * Structural, and independent of the reader model: a web page whose host
 * is named for the company is offered as its home page for them to
 * confirm (founder live 2026-10-05: no website was suggested when the
 * reader produced nothing, or the name carried "Ltd").
 */
export function ownWebsiteFinding(
  pages: readonly ResearchPage[],
  websiteUrl: string | null,
  companyName: string,
  anchors?: FounderResearchAnchors,
): readonly ResearchFinding[] {
  if (websiteUrl !== null) return [];
  // A domain named like the company is still a namesake until the page
  // names their founder or country (lane ob1).
  if (anchors !== undefined) {
    pages = pages.filter((page) =>
      anchoredToCompany(page, websiteUrl, anchors),
    );
  }
  const names = nameLabels(companyName);
  if (names.size === 0) return [];
  const own = pages.find((page) => {
    if (
      page.provider === "public_registry" ||
      page.provider === "public_profile"
    ) {
      return false;
    }
    const host = domainOf(page.url);
    if (host === null) return false;
    const label = (host.split(".")[0] ?? "").replace(/-/g, "");
    return [...names].some(
      (named) =>
        label === named || label === `get${named}` || label === `${named}hq`,
    );
  });
  const host = own === undefined ? null : domainOf(own.url);
  if (own === undefined || host === null) return [];
  return [
    {
      stepKey: FOUNDER_STEPS.website,
      value: `https://${host}`,
      because: `found on a public page (${host})`,
      sources: [{ sourceType: "PUBLIC_WEB", url: own.url }],
      after: FOUNDER_STEPS.companyName,
    },
  ];
}

/**
 * The reading, checked and mapped to the founder journey's steps. Code
 * decides nothing about meaning: it checks the cited words are on the
 * cited page and a choice is one of the journey's own. Anything that fails
 * is dropped and stays unknown.
 */
export function validateFounderReading(
  reading: FounderResearchReaderResult,
  pages: readonly ResearchPage[],
  websiteUrl: string | null,
  companyName = "",
  anchors?: FounderResearchAnchors,
): readonly ResearchFinding[] {
  if (reading.wrongSubject) return [];
  const findings: ResearchFinding[] = [];
  findings.push(...ownWebsiteFinding(pages, websiteUrl, companyName, anchors));
  const push = (
    stepKey: string,
    value: ResearchFinding["value"],
    field: { readonly sourceIndex: number; readonly quote: string },
  ) => {
    const page = pages[field.sourceIndex];
    if (page === undefined) return;
    // Lane ob1: nothing is proposed from a page not tied to this company.
    if (
      anchors !== undefined &&
      !anchoredToCompany(page, websiteUrl, anchors)
    ) {
      return;
    }
    if (!quoteOccursIn(field.quote, page.excerpt)) return;
    const source = sourceOf(page, websiteUrl);
    findings.push({
      stepKey,
      value,
      because: source.said.slice(0, 300),
      sources: [{ sourceType: source.type, url: page.url }],
      // The company must be named first: research is about that company.
      after: FOUNDER_STEPS.companyName,
    });
  };

  if (reading.description !== null) {
    push(
      FOUNDER_STEPS.description,
      reading.description.value,
      reading.description,
    );
  }
  if (reading.country !== null) {
    // Any ISO 3166-1 country, offered by its name: a v8 step finds its
    // geography node by that name, a v1-v7 step its option by label.
    const country = countryOfIso(reading.country.value);
    if (country !== null)
      push(FOUNDER_STEPS.country, country.name, reading.country);
  }
  if (reading.stage !== null) {
    const key = reading.stage.value.trim().toLowerCase();
    if (STAGE_KEYS.has(key) && key !== "unsure") {
      push(FOUNDER_STEPS.stage, key, reading.stage);
    }
  }
  if (reading.sectors !== null) {
    push(FOUNDER_STEPS.categories, reading.sectors.value, reading.sectors);
  }
  if (reading.teamSize !== null) {
    const size = Number(reading.teamSize.value.trim());
    if (Number.isInteger(size) && size >= 1 && size <= 100_000) {
      push(FOUNDER_STEPS.teamSize, size, reading.teamSize);
    }
  }
  return findings;
}
