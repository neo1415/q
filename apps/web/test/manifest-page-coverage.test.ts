import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  Q_COMPANY_PROFILE_TABS,
  Q_RECORD_PAGES,
  Q_RELATIONSHIP_TABS,
  Q_SETTINGS_SECTIONS,
  Q_SITE_MAP,
  Q_VOICE_DESTINATIONS,
} from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";
import { recordPagePath, settingsPath } from "@/features/q/client-actions";
import { landingOf } from "@/features/q/site-map/build";
import { SETTINGS_PAGE_SECTIONS } from "@/features/settings/settings-sections";
import { destinationPath } from "@/features/voice/destinations";

import {
  APP,
  pageSectionIds,
  read,
  registers,
  routeKey,
  routeOf,
  SRC,
  walkPages,
} from "./support/page-sections";

/**
 * Lane W (2026-10-15), "Q should always be able to see exactly what is on
 * screen": every page of the web app tells Q what it shows -- it registers
 * at least one manifest section (QSection, useQSection, QPageState or a
 * dialog), itself or through a component it renders -- or it is exempt
 * here with the reason Q has nothing to read there. A new page that is
 * neither fails, so a screen cannot ship that Q is blind to.
 *
 * Read from the source, like the route-capability parity test: the page
 * file and the modules it imports from this app (`@/...` and relative),
 * a few levels deep. Importing a registering component counts, because a
 * page renders what it imports.
 */

const OPERATIONS_CONSOLE =
  "Capital Q's operations console (ADR 0033): platform operators, not a tenant's screen; Q is not offered there";
const DEV =
  "development preview harness (app/dev), not a product surface; fixtures only";
const PUBLIC =
  "public or anonymous surface: no signed-in Q session to send a manifest from";
const AUTH = "sign-in and account recovery: no Q session before sign-in";
const ONBOARDING =
  "onboarding runs its own Q loop (ADR 0016) with the step and its answers as context, not the page manifest";
const CALLBACK = "provider callback or redirect: nothing is shown to read";
const REDIRECT =
  "a redirect only: it renders nothing; the page it sends to registers";

/** Whole route trees exempt, by prefix. */
const EXEMPT_TREES: Readonly<Record<string, string>> = {
  "admin/": OPERATIONS_CONSOLE,
  "dev/": DEV,
};

const EXEMPT: Readonly<Record<string, string>> = {
  "documents/unavailable/page.tsx":
    "the not-found landing for a refused document link (J7): it shows nothing to describe",
  "page.tsx": "the public landing page: signed out, no Q session",
  "paused/page.tsx":
    "the account-paused notice: Q is switched off for a paused account",
  "auth/check-email/page.tsx": AUTH,
  "auth/forgot-password/page.tsx": AUTH,
  "auth/sign-in/page.tsx": AUTH,
  "auth/sign-up/page.tsx": AUTH,
  "auth/update-password/page.tsx": AUTH,
  "auth/two-step/page.tsx": AUTH,
  "settings/security/page.tsx":
    "two-step sign-in: Q is never told what it shows, so the secret and codes stay out of Q",
  "connected/google/page.tsx": CALLBACK,
  "settings/reconnect/google/page.tsx": CALLBACK,
  "settings/billing/page.tsx":
    "an old address: it redirects to Plan and billing, which registers its own section",
  "g/[publicId]/page.tsx": PUBLIC,
  "g/[publicId]/embed/page.tsx": PUBLIC,
  "u/[handle]/page.tsx": PUBLIC,
  "onboarding/founder/page.tsx": ONBOARDING,
  "onboarding/investor/page.tsx": ONBOARDING,
  "crm/page.tsx": REDIRECT,
  // Capital is the CRM's Capital tab (owner 2026-10-16).
  "capital/page.tsx": REDIRECT,
  "find/page.tsx": REDIRECT,
  "gateway/page.tsx": REDIRECT,
  "results/page.tsx": REDIRECT,
  "discover/yours/page.tsx": REDIRECT,
  "investors/[investorOrganisationId]/rehearse/page.tsx": REDIRECT,
};

const pages = walkPages().sort();

describe("every page tells Q what it shows (lane W)", () => {
  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it("registers a manifest section, or is exempt with a reason", () => {
    const blind: string[] = [];
    for (const page of pages) {
      const key = routeKey(page);
      if (Object.keys(EXEMPT_TREES).some((tree) => key.startsWith(tree))) {
        continue;
      }
      if (EXEMPT[key] !== undefined) continue;
      if (!registers(page)) blind.push(key);
    }
    expect(blind).toEqual([]);
  });

  it("keeps no stale exemption: each names a page that exists and does not register", () => {
    const keys = new Set(pages.map(routeKey));
    for (const [tree, reason] of Object.entries(EXEMPT_TREES)) {
      expect(
        [...keys].some((key) => key.startsWith(tree)),
        tree,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(keys.has(key), key).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
      const page = pages.find((one) => routeKey(one) === key);
      if (page !== undefined) expect(registers(page), key).toBe(false);
    }
  });
});

/**
 * Q Workspace W2.2 (DECISIONS 71: "the exact page every single time"):
 * the site map knows every page of `app/`, every tab the contracts and
 * route tables name, and every section a page registers. A page, tab or
 * section added without its site-map entry fails here, as does an entry
 * for a section no page registers. Regenerate the snapshot with
 * `pnpm --filter @capital-q/web site-map:write`.
 */

/** Pages outside the signed-in app: no Q session, so no place for Q to move. */
const OUTSIDE_THE_APP: Readonly<Record<string, string>> = {
  "page.tsx": PUBLIC,
  "paused/page.tsx": "the account-paused notice: Q is switched off",
  "auth/check-email/page.tsx": AUTH,
  "auth/forgot-password/page.tsx": AUTH,
  "auth/sign-in/page.tsx": AUTH,
  "auth/sign-up/page.tsx": AUTH,
  "auth/update-password/page.tsx": AUTH,
  "auth/two-step/page.tsx": AUTH,
  "connected/google/page.tsx": CALLBACK,
  "g/[publicId]/page.tsx": PUBLIC,
  "g/[publicId]/embed/page.tsx": PUBLIC,
  "u/[handle]/page.tsx": PUBLIC,
};

/**
 * Section ids the source scan reaches through a shared module that this
 * page does not render (one file defines both pages' views).
 */
const SCANNED_ELSEWHERE: Readonly<Record<string, readonly string[]>> = {
  "/settings/activity": ["member"],
  "/settings/team/[userId]": ["activity"],
};

/**
 * Sections registered by a computed id from one exported list, which the
 * scan cannot read as literals; the list itself is checked below.
 */
const LISTED: Readonly<Record<string, readonly string[]>> = {
  "/settings": SETTINGS_PAGE_SECTIONS.map((section) => section.id),
};

const siteMap = new Map(Q_SITE_MAP.pages.map((page) => [page.route, page]));

describe("the site map covers every page, tab and section (W2.2)", () => {
  it("has the pages: every app page and every app route, nothing else", () => {
    const missing: string[] = [];
    for (const page of pages) {
      const key = routeKey(page);
      if (key.startsWith("dev/")) continue;
      if (OUTSIDE_THE_APP[key] !== undefined) continue;
      if (!siteMap.has(routeOf(page))) missing.push(routeOf(page));
    }
    expect(missing).toEqual([]);
    expect([...siteMap.keys()].sort()).toEqual([...APP_ROUTE_PATTERNS].sort());
    for (const [key, reason] of Object.entries(OUTSIDE_THE_APP)) {
      expect(
        existsSync(join(APP, key)) || pages.some((p) => routeKey(p) === key),
        key,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("has every section each page registers, and no section a page does not", () => {
    const problems: string[] = [];
    let counted = 0;
    for (const page of pages) {
      const route = routeOf(page);
      const entry = siteMap.get(route);
      if (entry === undefined || route.startsWith("/admin")) continue;
      const scanned = new Set(pageSectionIds(page));
      const elsewhere = new Set(SCANNED_ELSEWHERE[route] ?? []);
      const listed = new Set(LISTED[route] ?? []);
      const declared = new Set(entry.sections.map((section) => section.id));
      counted += declared.size;
      for (const id of scanned) {
        if (!declared.has(id) && !elsewhere.has(id)) {
          problems.push(
            `${route}: registers "${id}", missing from the site map`,
          );
        }
      }
      for (const id of declared) {
        if (!scanned.has(id) && !listed.has(id)) {
          problems.push(
            `${route}: site map names "${id}", the page never registers it`,
          );
        }
      }
      for (const id of elsewhere) {
        expect(scanned.has(id), `${route} ${id}`).toBe(true);
        expect(declared.has(id), `${route} ${id}`).toBe(false);
      }
    }
    expect(problems).toEqual([]);
    expect(counted).toBeGreaterThan(100);
  });

  it("the listed Settings sections are the ones the page registers by id", () => {
    const view = read(join(SRC, "features/settings/settings-view.tsx"));
    expect(view).toContain("const SECTIONS = SETTINGS_PAGE_SECTIONS;");
    expect(view).toMatch(/<QSection id=\{id\} kind="SETTINGS"/u);
  });

  it("has every tab the contracts name: company profile and relationship tabs", () => {
    const company = siteMap.get("/company/[companyId]");
    expect(company?.tabs.map((tab) => tab.id).sort()).toEqual(
      [...Q_COMPANY_PROFILE_TABS].sort(),
    );
    for (const side of [
      "/relationships/company/[companyId]",
      "/relationships/investor/[investorOrganisationId]",
    ]) {
      const ids = siteMap.get(side)?.tabs.map((tab) => tab.id) ?? [];
      for (const tab of Q_RELATIONSHIP_TABS) expect(ids, side).toContain(tab);
    }
  });

  it("every named destination lands on a site-map page, and a tab query on its tab", () => {
    const problems: string[] = [];
    for (const destination of Q_VOICE_DESTINATIONS) {
      const path = destinationPath(destination);
      if (path === null) continue;
      const landing = landingOf(path);
      if (landing === null || !siteMap.has(landing.route)) {
        problems.push(`${destination}: ${path} is on no site-map page`);
        continue;
      }
      if (/[?&](?:tab|view)=/u.test(path) && landing.tab === null) {
        problems.push(`${destination}: ${path} opens a tab the site map lacks`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every record page Q can open lands on a site-map page that lists it", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const page of Q_RECORD_PAGES) {
      const landing = landingOf(recordPagePath(page, id, id));
      expect(landing, page).not.toBeNull();
      expect(siteMap.get(landing?.route ?? "")?.recordPages, page).toContain(
        page,
      );
    }
  });

  it("every Settings section lands on its page, an anchor on a declared section", () => {
    for (const section of Q_SETTINGS_SECTIONS) {
      const path = settingsPath(section);
      const landing = landingOf(path);
      expect(landing, section).not.toBeNull();
      const anchor = path.split("#")[1];
      if (anchor !== undefined) {
        const ids = siteMap.get("/settings")?.sections.map((s) => s.id) ?? [];
        expect(ids, section).toContain(anchor);
      }
    }
  });
});
