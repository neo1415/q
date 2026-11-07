import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  Q_NAVIGATE_DESTINATIONS,
  Q_RECORD_PAGES,
  Q_SITE_MAP,
  Q_SITE_MAP_DIGEST_MAX_CHARS,
  QSiteMapSchema,
  qSiteMapDigest,
  qSiteMapLandingFor,
  qSiteMapPageFor,
} from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import { buildSiteMap, siteMapSource } from "@/features/q/site-map/build";

import { WEB } from "./support/page-sections";

/**
 * Q Workspace W2.1 / W2.4: the site map is built deterministically from
 * the route table, the page registry and the contract enums, and the
 * checked-in snapshot (`@capital-q/contracts` Q_SITE_MAP) is exactly that
 * build. A page, tab or section added without regenerating fails here.
 *
 * Regenerate: `pnpm --filter @capital-q/web site-map:write`.
 */

const SNAPSHOT = join(
  WEB,
  "../../packages/contracts/src/q/site-map.generated.ts",
);

describe("the Q site map (W2)", () => {
  const built = buildSiteMap();

  it("is the same on every build (deterministic)", () => {
    expect(buildSiteMap()).toEqual(built);
    expect(siteMapSource(buildSiteMap())).toBe(siteMapSource(built));
  });

  it("the checked-in snapshot is the build (run site-map:write after a change)", () => {
    if (process.env["SITE_MAP_WRITE"] === "1") {
      writeFileSync(SNAPSHOT, siteMapSource(built));
      return;
    }
    expect(QSiteMapSchema.parse(Q_SITE_MAP)).toEqual(built);
  });

  it("every navigation target page (destination or record page) lands on its entry (W3 keys)", () => {
    for (const key of [...Q_NAVIGATE_DESTINATIONS, ...Q_RECORD_PAGES]) {
      expect(qSiteMapLandingFor(built, key), key).not.toBeNull();
    }
    expect(qSiteMapLandingFor(built, "CAPITAL_RAISE")?.tab?.id).toBe(
      "capital-raise",
    );
    expect(qSiteMapLandingFor(built, "COMPANY_DECK")?.page.route).toBe(
      "/company/[companyId]",
    );
    expect(qSiteMapLandingFor(built, "NOT_A_PAGE")).toBeNull();
  });

  it("maps a concrete path to its page, literal routes first", () => {
    expect(qSiteMapPageFor(built, "/investors/top")?.route).toBe(
      "/investors/top",
    );
    expect(
      qSiteMapPageFor(
        built,
        "/company/00000000-0000-4000-8000-00000000000a?tab=deck",
      )?.route,
    ).toBe("/company/[companyId]");
    expect(qSiteMapPageFor(built, "/nowhere")).toBeNull();
  });

  it("carries the contract enums: destinations, record pages, settings sections", () => {
    const company = built.pages.find(
      (page) => page.route === "/company/[companyId]",
    );
    expect(company?.recordPages).toEqual(
      expect.arrayContaining(["COMPANY", "COMPANY_DECK", "DATA_ROOM_DOCUMENT"]),
    );
    expect(company?.tabs.find((tab) => tab.id === "deck")?.subs).toHaveLength(
      12,
    );
    const hub = built.pages.find((page) => page.route === "/relationships");
    expect(
      hub?.tabs.find((tab) => tab.id === "capital-raise")?.destinations,
    ).toEqual(["CAPITAL_RAISE"]);
    const settings = built.pages.find((page) => page.route === "/settings");
    expect(settings?.settingsSections).toEqual(
      expect.arrayContaining(["notifications", "privacy"]),
    );
  });
});

describe("the site-map digest for the model (W2.4)", () => {
  const map = buildSiteMap();

  it("fits the cached-prefix budget (about 2-3k tokens), for each side", () => {
    for (const side of [undefined, "FOUNDER", "INVESTOR"] as const) {
      const digest = qSiteMapDigest(map, { side });
      expect(digest.length, side ?? "both").toBeLessThanOrEqual(
        Q_SITE_MAP_DIGEST_MAX_CHARS,
      );
      expect(digest.length).toBeGreaterThan(2_000);
    }
  });

  it("is stable, and leaves out admin pages, redirects and any instance", () => {
    const digest = qSiteMapDigest(map);
    expect(qSiteMapDigest(map)).toBe(digest);
    expect(digest).not.toContain("/admin");
    expect(digest).not.toContain("/crm |");
    expect(digest).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
    expect(digest).toContain("/company/[companyId] [companyId=COMPANY]");
    expect(digest).toContain(
      "deck=Pitch deck [the deck and Q's reading of it, by section](sub:",
    );
  });

  it("a side sees its own pages and the shared ones only", () => {
    const founder = qSiteMapDigest(map, { side: "FOUNDER" });
    const investor = qSiteMapDigest(map, { side: "INVESTOR" });
    expect(founder).toContain("/company/data-room |");
    expect(investor).not.toContain("/company/data-room |");
    expect(investor).toContain("/investors/top |");
    expect(founder).not.toContain("/investors/top |");
  });
});
