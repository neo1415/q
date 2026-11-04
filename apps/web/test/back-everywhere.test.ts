import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * "The back icon in all pages" (owner, 2026-11-04; UX-04). Every signed-in
 * page is classified here, so a new page fails this test until someone
 * decides whether it is a root (in the main navigation, no Back), a
 * redirect, or an interior page — and an interior page must render the
 * shared Back control (BackLink, directly or through the account head or
 * the relationship hero), with its parent as the deep-link fallback.
 */

const APP = join(import.meta.dirname, "..", "app", "(app)");
const SRC = join(import.meta.dirname, "..", "src");

/** Main-navigation destinations and their in-page tabs: no Back. */
const ROOTS = [
  "home",
  "discover",
  "explore",
  "relationships",
  "work",
  // Work's board view, chosen from the Work header's tabs.
  "board",
  "profile",
  "settings",
  "pitch",
  "company/data-room",
  "investors",
  "rehearsals",
  "documents",
  "q-pitch",
  "daily",
  "gateq",
  // The admin console and its sections, each a tab of its own nav.
  "admin",
  "admin/accounts",
  "admin/audit",
  "admin/billing",
  "admin/brand",
  "admin/claims",
  "admin/email",
  "admin/etiquette",
  "admin/flags",
  "admin/organisations",
  "admin/q",
  "admin/queue",
  "admin/safety",
  "admin/team",
] as const;

/** Pages that only send the person elsewhere; they render nothing. */
const REDIRECTS = [
  "admin/reviews",
  "admin/verification",
  "capital",
  "crm",
  "discover/yours",
  "find",
  "gateway",
  "results",
  "settings/billing",
  "settings/reconnect/google",
  "investors/[investorOrganisationId]/rehearse",
] as const;

/**
 * Pages whose own controls are the way out: the invitation card's
 * "Not now" and Decline.
 */
const OWN_EXIT = [
  "join/[token]",
  // The not-found landing for refused document links (J7): the app's own
  // not-found page carries the way out.
  "documents/unavailable",
] as const;

type Interior = {
  readonly parent: string;
  readonly via?: readonly string[];
};

/** A relationship's record, its tabs, and its messages, on either side. */
function relationshipPages(base: string): Record<string, Interior> {
  const record: Interior = {
    parent: "/relationships",
    via: ["features/relationships/relationship-detail.tsx"],
  };
  return {
    [`relationships/${base}`]: record,
    [`relationships/${base}/calls`]: record,
    [`relationships/${base}/deal`]: record,
    [`relationships/${base}/diligence`]: record,
    [`relationships/${base}/messages`]: {
      parent: "/relationships",
      via: ["features/relationships/relationship-inbox.tsx"],
    },
  };
}

/**
 * Interior pages, each with its parent (the deep-link fallback) and the
 * source files that render its Back: the page itself unless listed.
 */
const INTERIOR: Readonly<Record<string, Interior>> = {
  "admin/accounts/[userId]": { parent: "/admin/accounts" },
  "admin/organisations/[organisationId]": { parent: "/admin/organisations" },
  "admin/q/runs/[runId]": { parent: "/admin/q" },
  "admin/safety/break-glass/[requestId]": { parent: "/admin/safety" },
  "company/[companyId]": { parent: "/discover" },
  "company/[companyId]/founder/[position]": { parent: "/company/" },
  "company/interest": { parent: "/home" },
  "company/visibility": { parent: "/profile" },
  "daily/[editionId]": { parent: "/daily" },
  "discover/passed": {
    parent: "/discover",
    via: ["features/discover/shortlist-page.tsx"],
  },
  "discover/saved": {
    parent: "/discover",
    via: ["features/discover/shortlist-page.tsx"],
  },
  "discover/saved/compare": {
    parent: "/discover",
    via: ["features/discover/shortlist-page.tsx"],
  },
  "investors/[investorOrganisationId]": {
    parent: "/discover",
    via: ["features/investors/investor-profile.tsx"],
  },
  "investors/top": { parent: "/investors" },
  "pitch/[mediaAssetId]": {
    parent: "/pitch",
    via: ["features/pitch/pitch-video-page.tsx"],
  },
  "pitch/new": {
    parent: "/pitch",
    via: ["features/pitch/pitch-video-page.tsx"],
  },
  "q-pitch/capital-q": { parent: "/q-pitch" },
  "rehearsals/company/[companyId]": {
    parent: "/rehearsals",
    via: ["features/rehearsal/lobby-page.tsx"],
  },
  "rehearsals/investor/[investorOrganisationId]": {
    parent: "/rehearsals",
    via: ["features/rehearsal/lobby-page.tsx"],
  },
  "rehearsals/person/[externalPersonId]": {
    parent: "/rehearsals",
    via: ["features/rehearsal/lobby-page.tsx"],
  },
  // The live room itself is left by its Leave control; Back is on the
  // page when the room can't be shown.
  "rehearsals/live/[rehearsalId]": { parent: "/rehearsals" },
  "rehearsals/meeting/[meetingId]": { parent: "/rehearsals" },
  "rehearsals/r/[rehearsalId]": {
    parent: "/rehearsals",
    via: ["features/rehearsal/rehearsal-review.tsx"],
  },
  ...relationshipPages("company/[companyId]"),
  ...relationshipPages("investor/[investorOrganisationId]"),
  search: { parent: "/home" },
  "settings/activity": {
    parent: "/settings/team",
    via: ["features/organisation/admin-pages.tsx"],
  },
  "settings/memory": {
    parent: "/settings",
    via: ["features/settings/memory-view.tsx"],
  },
  "settings/plan": {
    parent: "/settings",
    via: ["features/billing/plan-view.tsx"],
  },
  "settings/security": { parent: "/settings" },
  "settings/team": {
    parent: "/settings",
    via: ["features/team/team-settings-view.tsx"],
  },
  "settings/team/[userId]": {
    parent: "/settings/team",
    via: ["features/organisation/admin-pages.tsx"],
  },
  "settings/usage": {
    parent: "/settings",
    via: ["features/billing/usage-view.tsx"],
  },
  reviews: { parent: "/settings", via: ["features/reviews/reviews-view.tsx"] },
  verification: {
    parent: "/profile",
    via: ["features/verification/verification-view.tsx"],
  },
  "work/[delegationId]": {
    parent: "/work",
    via: ["features/work/delegation-audit.tsx"],
  },
  "work/[delegationId]/report/[laneId]": {
    parent: "/work",
    via: ["features/work/first-stage-report.tsx"],
  },
};

/** The shared Back, rendered directly or through its two wrappers. */
const BACK =
  /<BackLink\b|<BackToRelationships\b|<AccountHead\b[^>]*?\bback=\{\{\s*href:/su;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const routeOf = (path: string) =>
  relative(APP, path).split(sep).slice(0, -1).join("/") || "";
const routes = pages(APP).map(routeOf).sort();
const pageSource = (route: string) =>
  readFileSync(join(APP, ...route.split("/"), "page.tsx"), "utf8");

describe("Back on every interior page", () => {
  it("classifies every signed-in page as root, redirect, own exit or interior", () => {
    const known = new Set<string>([
      ...ROOTS,
      ...REDIRECTS,
      ...OWN_EXIT,
      ...Object.keys(INTERIOR),
    ]);
    expect(routes.filter((route) => !known.has(route))).toEqual([]);
    expect([...known].filter((route) => !routes.includes(route))).toEqual([]);
  });

  it.each(Object.entries(INTERIOR))(
    "%s renders the shared Back, falling back to its parent",
    (route, { parent, via }) => {
      const page = pageSource(route);
      const sources = [
        page,
        ...(via ?? []).map((file) => {
          // The page really renders the module that carries its Back.
          expect(page).toContain(`@/${file.replace(/\.tsx$/u, "")}"`);
          return readFileSync(join(SRC, file), "utf8");
        }),
      ];
      expect(sources.some((source) => BACK.test(source))).toBe(true);
      const all = sources.join("\n");
      expect(all.includes(`"${parent}`) || all.includes(`\`${parent}`)).toBe(
        true,
      );
    },
  );

  it.each(ROOTS)("%s, a root, has no Back", (route) => {
    expect(pageSource(route)).not.toMatch(/<BackLink\b/u);
  });

  it.each(REDIRECTS)("%s only redirects", (route) => {
    expect(pageSource(route)).toMatch(/\bredirect\(/u);
  });
});
