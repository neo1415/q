import {
  demoApplication,
  demoCompany,
  type StoryRoute,
} from "@capital-q/q-pitch";

import type { AnchorPlacement } from "../section-light";

/**
 * Where the story goes and what it lights, by the pages' own stable
 * markers (the investor track's table, investor-anchors.ts, is the model).
 * A page that renames a marker makes the light miss: the verifier then
 * runs the safe fallback and the story carries on, never lighting the
 * wrong thing.
 */
const MANDATE_ROW = (n: number): AnchorPlacement => ({
  select: `[data-mandate-summary] dl > div:nth-child(${String(n)})`,
});

const NAV = (href: string): AnchorPlacement => ({
  select: `nav[data-sidebar-nav] a[href="${href}"], nav.cq-bottom-nav a[href="${href}"]`,
});

export const STORY_ANCHORS: Readonly<Record<string, AnchorPlacement>> = {
  // #35 Discover, the dock, the journey.
  "qs.discover.card": {
    select: '[data-q-control="carousel.feed"] article[data-company-id]',
  },
  "qs.discover.why": {
    select: '[data-q-control="carousel.feed"] article[data-company-id] h3',
  },
  // #39 Express interest is lit, never pressed (a consequential action).
  "qs.discover.interest": {
    select:
      '[data-q-control="carousel.feed"] article[data-company-id] [aria-label="Decide"]',
  },
  "qs.dock": { select: ".cq-q-dock-pill" },
  "qs.nav.discover": NAV("/discover"),
  "qs.nav.explore": NAV("/explore"),
  "qs.nav.crm": NAV("/relationships"),
  // #36 The mandate, one row per word (mandate-summary.tsx's order:
  // Stage, Sectors, Geography, Cheque, Business models and customers,
  // Never shown, Thesis). "Preferences" is the business models and
  // customers row; "Minimum criteria" is what is never shown.
  "qs.mandate": { select: "[data-mandate-summary]" },
  "qs.mandate.stage": MANDATE_ROW(1),
  "qs.mandate.sectors": MANDATE_ROW(2),
  "qs.mandate.geography": MANDATE_ROW(3),
  "qs.mandate.cheque": MANDATE_ROW(4),
  "qs.mandate.preferences": MANDATE_ROW(5),
  "qs.mandate.minimum": MANDATE_ROW(6),
  "qs.mandate.thesis": MANDATE_ROW(7),
  // #40 The profile's Diligence tab and a relationship's meeting prep.
  "qs.profile.diligence": {
    select:
      '[data-overview-fold="company-assumptions"], [data-profile-carousel]',
  },
  "qs.relationship.prep": { select: "[data-relationship-brief]" },
  // #41-44 GateQ.
  "qs.gateq.transcript": {
    select: '[data-q-control="disclosure.gateq-transcript"] > details',
  },
  "qs.gateq.brief": {
    select: 'section[aria-label="Submitted investment brief"]',
  },
  "qs.gateq.gate": { select: 'section[aria-labelledby="gq2-strict"]' },
  "qs.gateq.link": { select: 'section[aria-labelledby="gq2-link"]' },
  "qs.gateq.inbox": { select: ".gq2-list" },
};

/** The fictional demo records the story opens (the v6 track's own). */
const DILIGENCE_COMPANY = "harbourline-cargo";
const PREP_COMPANY = "clinicrest";
const APPLICATION = "maji-loop-application";

/**
 * A story route as a path, or null when its fixture record is not known
 * (the verifier then falls back to the Q stage). The pages authorise the
 * viewer themselves: a path is a navigation, never access.
 */
export function storyPath(route: StoryRoute): string | null {
  switch (route) {
    case "home":
      return "/home";
    case "discover":
      return "/discover";
    case "capital-mandate":
      return "/relationships?view=capital";
    case "company-diligence": {
      const company = demoCompany(DILIGENCE_COMPANY);
      return company === null
        ? null
        : `/company/${encodeURIComponent(company.companyId)}?tab=diligence`;
    }
    case "relationship-prep": {
      const company = demoCompany(PREP_COMPANY);
      return company === null
        ? null
        : `/relationships/company/${encodeURIComponent(company.companyId)}`;
    }
    case "gateq-gate":
      return "/gateq?tab=gate";
    case "gateq-application": {
      const id = demoApplication(APPLICATION);
      return id === null
        ? null
        : `/gateq?tab=inbox&item=${encodeURIComponent(id)}`;
    }
    case "gateq-inbox":
      return "/gateq?tab=inbox";
  }
}

/** Where each story route goes: the app's pages, or a design harness's. */
export type StoryPathFor = (route: StoryRoute) => string | null;

/** Whether `pathname` + `search` is where `route` lands (the ack). */
export function isOnStoryRoute(
  route: StoryRoute,
  location: { readonly pathname: string; readonly search: string },
  pathFor: StoryPathFor = storyPath,
): boolean {
  const path = pathFor(route);
  if (path === null) return false;
  const [pathname, query = ""] = path.split("?");
  if (location.pathname.toLowerCase() !== (pathname ?? "").toLowerCase()) {
    return false;
  }
  const wanted = new URLSearchParams(query);
  const actual = new URLSearchParams(location.search);
  for (const [key, value] of wanted) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}
