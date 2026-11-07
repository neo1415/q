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
    expect(investor).not.toContain("capital-raise=");
    expect(investor).not.toContain("claim=");
    expect(investor).toContain("commitments=");
    expect(founder).toContain("capital-raise=");
    expect(founder).not.toContain("commitments=");
    expect(founder).not.toContain("inbox=Inbox");
    expect(founder).toContain("claim=");
    // Both sides together mark who each narrower part is for.
    expect(qSiteMapDigest(Q_SITE_MAP)).toContain("claim=Claim(founder)");
  });
});
