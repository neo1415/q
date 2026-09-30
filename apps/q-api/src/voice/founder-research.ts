import {
  COUNTRY_OPTIONS,
  FOUNDER_STEPS,
  STAGE_OPTIONS,
} from "@capital-q/founder-onboarding";
import type { QRecommendationPublicSourceType } from "@capital-q/onboarding";
import type { FounderResearchReaderResult } from "@capital-q/q-core";
import { quoteOccursIn } from "@capital-q/q-knowledge";

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
const COUNTRY_KEYS = new Set(COUNTRY_OPTIONS.map((o) => o.optionKey));

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
): readonly ResearchFinding[] {
  if (reading.wrongSubject) return [];
  const findings: ResearchFinding[] = [];
  const push = (
    stepKey: string,
    value: ResearchFinding["value"],
    field: { readonly sourceIndex: number; readonly quote: string },
  ) => {
    const page = pages[field.sourceIndex];
    if (page === undefined) return;
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
    const key = reading.country.value.trim().toLowerCase();
    if (COUNTRY_KEYS.has(key))
      push(FOUNDER_STEPS.country, key, reading.country);
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
