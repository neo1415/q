import { join } from "node:path";

import {
  audienceOf,
  Q_SITE_MAP,
  qSiteMapDigest,
  type QSiteMapAudience,
  type QSiteMapPage,
} from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import { APP, read, SRC } from "./support/page-sections";

/**
 * Q Workspace W2 / W4 (integration 2026-11-07): W4 decides access STAYs
 * from the site map's audience, so each tab and section says who the code
 * renders it for. Where the code states it in a form a test can read, the
 * audience is derived from that code here; the rest is pinned case by case.
 */

const page = (route: string): QSiteMapPage => {
  const found = Q_SITE_MAP.pages.find((one) => one.route === route);
  if (found === undefined) throw new Error(`no site-map page ${route}`);
  return found;
};

const tabAudience = (route: string, id: string): QSiteMapAudience => {
  const one = page(route);
  return audienceOf(
    one,
    one.tabs.find((tab) => tab.id === id),
  );
};

const sectionAudience = (route: string, id: string): QSiteMapAudience => {
  const one = page(route);
  const section = one.sections.find((s) => s.id === id);
  if (section === undefined) throw new Error(`no section ${route} ${id}`);
  return audienceOf(
    one,
    one.tabs.find((tab) => tab.id === section.tab),
    section,
  );
};

describe("site-map audiences are the code's (derived)", () => {
  it("Capital's own tabs are FounderTab's cases: founder only; Capital itself is both sides'", () => {
    const screen = read(join(SRC, "features/capital/capital-screen.tsx"));
    const start = screen.indexOf("export async function FounderTab(");
    expect(start).toBeGreaterThan(0);
    const cases = [
      ...screen.slice(start).matchAll(/\bcase "([a-z-]+)":/gu),
    ].map((match) => match[1]);
    expect(cases.length).toBeGreaterThanOrEqual(5);
    for (const tab of cases) {
      if (tab === "overview") continue;
      expect(tabAudience("/relationships", `capital-${String(tab)}`), tab).toBe(
        "FOUNDER",
      );
    }
    // Both sides have a Capital screen (the investor's mandate and book).
    expect(screen).toMatch(/data-capital-investor/u);
    expect(tabAudience("/relationships", "capital")).toBe("ANY");
    expect(sectionAudience("/relationships", "mandate")).toBe("INVESTOR");
    expect(sectionAudience("/relationships", "commitments")).toBe("INVESTOR");
    expect(sectionAudience("/relationships", "capital-overview")).toBe(
      "FOUNDER",
    );
  });

  it("GateQ's tabs: the investor branch's and the founder branch's", () => {
    const gateq = read(join(APP, "(app)/gateq/page.tsx"));
    const founderBranch = gateq.match(
      /context\.kind !== "INVESTOR"[\s\S]*?=== "(\w+)" \? "\w+" : "(\w+)"/u,
    );
    expect(founderBranch).not.toBeNull();
    for (const tab of [founderBranch?.[1], founderBranch?.[2]]) {
      expect(tabAudience("/gateq", String(tab)), String(tab)).toBe("FOUNDER");
    }
    const investorBranch = gateq.match(
      /requested === "(\w+)" \|\| requested === "(\w+)" \? requested : "(\w+)"/u,
    );
    expect(investorBranch).not.toBeNull();
    for (const tab of investorBranch?.slice(1) ?? []) {
      expect(tabAudience("/gateq", tab), tab).toBe("INVESTOR");
    }
    // The inbox's sections are the investor's.
    for (const section of page("/gateq").sections) {
      expect(sectionAudience("/gateq", section.id), section.id).toBe(
        "INVESTOR",
      );
    }
  });
});

describe("purposes are side-neutral where both sides use the page", () => {
  it("a page for both sides never describes it as one side's alone", () => {
    const biased: string[] = [];
    for (const one of Q_SITE_MAP.pages) {
      if (one.audience !== "ANY") continue;
      const text = `${one.title} ${one.purpose}`.toLowerCase();
      const founder = /\bfounder/u.test(text);
      const investor = /\binvestor/u.test(text);
      // Naming one side only, on a page both sides have, told the model the
      // page was not the other's (W4 live: "Open Capital" from an investor).
      if (
        founder !== investor &&
        /\b(?:a|an|the)\s+(?:founder|investor)'s\b/u.test(text)
      ) {
        biased.push(`${one.route}: ${one.purpose}`);
      }
    }
    expect(biased).toEqual([]);
  });

  it("Capital is described for both sides", () => {
    const hub = page("/relationships");
    expect(hub.purpose).toMatch(/founder/u);
    expect(hub.purpose).toMatch(/investor/u);
    expect(page("/capital").audience).toBe("ANY");
  });
});

describe("the digest keeps easily confused places apart (W4 round 3)", () => {
  it("people search and the network's Explore say which is which", () => {
    expect(page("/search").purpose).toMatch(/public web/u);
    expect(page("/explore").purpose).toMatch(/own network/u);
    expect(page("/search").title).not.toBe(page("/explore").title);
  });

  it("Q's team on Work is not the person's colleagues; the company tabs say what each holds", () => {
    const team = page("/work").tabs.find((tab) => tab.id === "team");
    expect(team?.title).toBe("Q's team");
    const company = page("/company/[companyId]");
    for (const tab of company.tabs) {
      expect(tab.purpose, tab.id).toBeDefined();
    }
    const digest = qSiteMapDigest(Q_SITE_MAP);
    expect(digest).toContain('dataroom "Data room": the company\'s documents');
  });
});

describe("site-map audiences (pinned)", () => {
  it("Discover: the investor's feed and tabs, the founder's investors and videos", () => {
    expect(tabAudience("/discover", "for-you")).toBe("INVESTOR");
    expect(tabAudience("/discover", "yours")).toBe("INVESTOR");
    expect(tabAudience("/discover", "founders")).toBe("FOUNDER");
    expect(sectionAudience("/discover", "feed")).toBe("INVESTOR");
    expect(sectionAudience("/discover", "investors")).toBe("FOUNDER");
  });

  it("a company's data-room checklist is its owner's; the profile's branches by side", () => {
    expect(sectionAudience("/company/[companyId]", "missing")).toBe("FOUNDER");
    expect(sectionAudience("/company/[companyId]", "data-room")).toBe("ANY");
    for (const id of ["company", "traction"]) {
      expect(sectionAudience("/profile", id), id).toBe("FOUNDER");
    }
    for (const id of ["mandate", "firm", "thesis"]) {
      expect(sectionAudience("/profile", id), id).toBe("INVESTOR");
    }
  });

  it("a side's digest leaves out the other side's tabs and sections", () => {
    const founder = qSiteMapDigest(Q_SITE_MAP, { side: "FOUNDER" });
    const investor = qSiteMapDigest(Q_SITE_MAP, { side: "INVESTOR" });
    expect(investor).not.toContain('capital-raise "');
    expect(investor).not.toContain('claim "');
    expect(investor).toMatch(/\bcommitments@capital:/u);
    expect(founder).toContain('capital-raise "');
    expect(founder).not.toMatch(/\bcommitments[(@:]/u);
    expect(founder).not.toContain('inbox "Inbox"');
    expect(founder).toContain('claim "Claim"');
    // Both sides together mark who each narrower part is for.
    expect(qSiteMapDigest(Q_SITE_MAP)).toContain('claim "Claim"(founder)');
  });
});

describe("every place says what it is for, in everyday words (DECISIONS 75)", () => {
  const places = Q_SITE_MAP.pages.filter(
    (one) => one.audience !== "ADMIN" && one.redirectsTo === undefined,
  );

  it("every page, tab and section Q can move to has a purpose", () => {
    const missing: string[] = [];
    for (const one of places) {
      if (one.purpose.trim().length < 12) missing.push(one.route);
      for (const tab of one.tabs) {
        if (tab.purpose === undefined)
          missing.push(`${one.route} tab ${tab.id}`);
      }
      for (const section of one.sections) {
        if (section.purpose === undefined) {
          missing.push(`${one.route} section ${section.id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("a purpose is a plain phrase, never a keyword or synonym list", () => {
    const listy: string[] = [];
    const check = (where: string, text: string) => {
      // Slashes, "aka", "e.g." and quoted alternatives are how keyword
      // lists creep in; a purpose says what the place is for instead.
      if (/\/|\baka\b|\be\.g\.|"|\bor\b.*\bor\b.*\bor\b/iu.test(text)) {
        listy.push(`${where}: ${text}`);
      }
    };
    for (const one of places) {
      for (const tab of one.tabs)
        check(`${one.route} ${tab.id}`, tab.purpose ?? "");
      for (const section of one.sections) {
        check(`${one.route} ${section.id}`, section.purpose ?? "");
      }
    }
    expect(listy).toEqual([]);
  });

  it("the digest keeps every place within the budget", () => {
    for (const side of [undefined, "FOUNDER", "INVESTOR"] as const) {
      expect(qSiteMapDigest(Q_SITE_MAP, { side }).length).toBeLessThanOrEqual(
        12_000,
      );
    }
  });

  it("W4's confusable places are told apart by purpose", () => {
    const work = page("/work");
    expect(work.tabs.find((tab) => tab.id === "needs")?.purpose).toMatch(
      /decide or do/u,
    );
    expect(page("/company/data-room").purpose).toMatch(/missing/u);
    expect(page("/profile").purpose).toMatch(/Not how others see you/u);
    expect(page("/company/[companyId]").purpose).toMatch(/as others see it/u);
    expect(
      page("/discover").tabs.find((tab) => tab.id === "yours")?.purpose,
    ).toMatch(/already follow/u);
    expect(page("/settings/plan").purpose).toMatch(/billing/u);
    expect(page("/daily").purpose).toMatch(/today/iu);
    expect(
      page("/gateq").tabs.find((tab) => tab.id === "inbox")?.purpose,
    ).toMatch(/founders sent you/u);
    expect(
      page("/gateq").tabs.find((tab) => tab.id === "applications")?.purpose,
    ).toMatch(/you sent/u);
    expect(sectionAudience("/analytics", "deck-views")).toBe("FOUNDER");
  });
});
