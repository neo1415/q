import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  importSiteMarkdown,
  type AdminSitePageDetailDto,
  type AdminSitePageSummaryDto,
  type ImportedSitePage,
  type SiteSettings,
} from "@capital-q/contracts";

/**
 * The design-review harness's data: the real default content
 * (content/defaults), imported exactly as the seed imports it. Nothing
 * here touches the API or a database.
 */

const FILES: Readonly<Record<string, string>> = {
  pricing: "pricing.md",
  faq: "faq.md",
  terms: "terms-of-service.md",
  privacy: "privacy-policy.md",
  cookies: "cookie-policy.md",
  "landing-hero": "landing-hero.md",
  "landing-trust": "landing-trust.md",
};

export const HARNESS_SETTINGS: SiteSettings = {
  companyName: "Capital Q",
  legalEntity: null,
  registeredAddress: null,
  contactEmail: "privacy@example.invalid",
  governingLawCity: null,
};

export function harnessSlugs(): readonly string[] {
  return Object.keys(FILES);
}

export function harnessPage(slug: string): ImportedSitePage | null {
  const file = FILES[slug];
  if (file === undefined) return null;
  const root = join(process.cwd(), "..", "..", "content", "defaults");
  return importSiteMarkdown(readFileSync(join(root, file), "utf8"));
}

const AT = "2026-11-18T09:00:00.000Z";

function summaryOf(page: ImportedSitePage): AdminSitePageSummaryDto {
  const live = page.kind !== "legal";
  return {
    slug: page.slug,
    kind: page.kind,
    title: page.title,
    summary: page.summary,
    status: live ? "PUBLISHED" : "DRAFT_PENDING_LEGAL_REVIEW",
    order: page.order,
    publishedVersion: live ? 1 : null,
    latestVersion: 1,
    unpublishedChanges: !live,
    lawyerNotes: page.blocks.filter(
      (b) => b.type === "legalClause" && (b.lawyerNote ?? "") !== "",
    ).length,
    updatedAt: AT,
  };
}

export function harnessIndex(): AdminSitePageSummaryDto[] {
  return harnessSlugs().flatMap((slug) => {
    const page = harnessPage(slug);
    return page === null ? [] : [summaryOf(page)];
  });
}

export function harnessDetail(slug: string): AdminSitePageDetailDto | null {
  const page = harnessPage(slug);
  if (page === null) return null;
  const summary = summaryOf(page);
  return {
    page: summary,
    effectiveDate: page.effectiveDate,
    draft: {
      title: page.title,
      summary: page.summary,
      blocks: page.blocks,
      revision: 1,
      baseVersion: 1,
      updatedAt: AT,
      updatedByName: null,
    },
    versions: [
      {
        versionNumber: 1,
        source: "SEED",
        restoredFrom: null,
        authorName: null,
        createdAt: AT,
        live: summary.status === "PUBLISHED",
      },
    ],
    history:
      summary.status === "PUBLISHED"
        ? [
            {
              action: "PUBLISH",
              versionNumber: 1,
              actorName: null,
              reason: null,
              at: AT,
            },
          ]
        : [],
    settings: HARNESS_SETTINGS,
  };
}
