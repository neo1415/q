import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  Q_NAVIGATE_DESTINATIONS,
  Q_SETTINGS_SECTIONS,
  type QNavigateDestination,
} from "@capital-q/contracts";

import { settingsPath } from "../src/features/q/client-actions";
import { destinationPath } from "../src/features/voice/destinations";

/**
 * voice-cards route parity (Zino 2026-10-08: "it still can't take me to
 * some pages"; "the explore page" went to Discover). Destination -> route
 * for every page Q can open; with q-specialists' page-request table
 * (utterance -> destination) this is the utterance -> route table.
 */
const ROUTE: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "/home",
  PROFILE: "/profile",
  // Capital is the CRM's Capital tab (owner 2026-10-16).
  CAPITAL: "/relationships?view=capital",
  DISCOVER: "/discover",
  EXPLORE: "/explore",
  COMPANY_VISIBILITY: "/company/visibility",
  RELATIONSHIPS: "/relationships?view=overview",
  SETTINGS: "/settings",
  VERIFICATION: "/verification",
  PITCH: "/pitch",
  COMPANY_INTEREST: "/company/interest",
  SAVED: "/discover/saved",
  PASSED: "/discover/passed",
  SAVED_COMPARE: "/discover/saved/compare",
  YOUR_COMPANIES: "/discover?tab=yours",
  INVESTORS: "/investors",
  TOP_INVESTORS: "/investors/top",
  CAPITAL_RAISE: "/relationships?view=capital&tab=raise",
  CAPITAL_READINESS: "/relationships?view=capital&tab=readiness",
  CAPITAL_ACTION_PLAN: "/relationships?view=capital&tab=action-plan",
  CAPITAL_PLAN: "/relationships?view=capital&tab=plan",
  CAPITAL_INVESTORS: "/relationships?view=capital&tab=investors",
  CRM_PIPELINE: "/relationships?view=pipeline",
  SEARCH: "/explore",
  PEOPLE_SEARCH: "/search",
  GATEWAY: "/gateq",
  GATEQ_INBOX: "/gateq?tab=inbox",
  GATEQ_FIND: "/gateq?tab=find",
  GATEQ_CLAIM: "/gateq?tab=claim",
  GATEQ_APPLICATIONS: "/gateq?tab=applications",
  MEMORY: "/settings/memory",
  USAGE: "/settings/usage",
  NEW_PITCH: "/pitch/new",
  REHEARSALS: "/rehearsals",
  DOCUMENTS: "/documents",
  DAILY: "/daily",
  RESULTS: "/results",
  REVIEWS: "/reviews",
  WORK: "/work",
  WORK_NEEDS: "/work?view=needs",
  WORK_PROGRESS: "/work?view=progress",
  OWN_DATA_ROOM: "/company/data-room",
  OWN_DECK: "/company/data-room?tab=deck",
  WORK_DONE: "/work?view=done",
  WORK_TEAM: "/work?view=team",
  WORK_COST: "/work?view=cost",
  // Q Pitch v6: the entry starts the tour for the person's side.
  Q_PITCH: "/q-pitch?start=1",
  BOARD: "/board",
};

/**
 * App pages Q does not open by a page name, each with why. Record pages
 * (a company, a chat, a rehearsal, a work item) are opened by the
 * open_page tool from the record's name, or by the card on screen.
 */
const NOT_BY_NAME: Readonly<Record<string, string>> = {
  "/admin": "platform operators only",
  // Owner 2026-10-23: a Work tab (tab.work-board); Q reads and changes it
  // with my_board. Its own destination waits for the reader's next version,
  // which carries the destination list.
  // v6: /q-pitch is Q_PITCH's page; its Capital Q pitch page is the
  // founder track's own step, opened by the tour.
  "/q-pitch/capital-q":
    "the founder track's Capital Q pitch page, opened by the tour",
  "/find": "old address, redirects to /search",
  "/gateway": "old address, redirects to /gateq",
  "/crm": "the CRM's alias, redirects to /relationships (Q's RELATIONSHIPS)",
  "/capital": "old address, redirects to the CRM's Capital tab (Q's CAPITAL)",
  "/discover/yours": "old address, redirects to /discover?tab=yours",
  "/settings/reconnect/google": "a hand-off from Google, not a page to visit",
  "/join": "an invitation link",
  "/settings/activity":
    "the organisation's accountability record, for admins and owners from Team; Q reads no one's activity by design",
};

function pages(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...pages(path));
    else if (name === "page.tsx") found.push(dir);
  }
  return found;
}

describe("every page Q can open has one route (voice-cards)", () => {
  it.each(Q_NAVIGATE_DESTINATIONS.map((destination) => [destination]))(
    "%s",
    (destination) => {
      expect(destinationPath(destination)).toBe(ROUTE[destination]);
    },
  );

  it("never sends Explore to Discover", () => {
    expect(destinationPath("EXPLORE")).toBe("/explore");
    expect(destinationPath("DISCOVER")).toBe("/discover");
  });

  it("opens every Settings section", () => {
    for (const section of Q_SETTINGS_SECTIONS) {
      expect(settingsPath(section)).toMatch(/^\/settings/);
    }
  });

  it("reaches every app page with a fixed address, or says why not", () => {
    const root = join(__dirname, "..", "app", "(app)");
    const reachable = new Set(
      [
        ...Q_NAVIGATE_DESTINATIONS.map((d) => destinationPath(d) ?? ""),
        ...Q_SETTINGS_SECTIONS.map((s) => settingsPath(s)),
      ].map((path) => path.split(/[?#]/u)[0]),
    );
    const missing = pages(root)
      .map((dir) => `/${relative(root, dir).split(sep).join("/")}`)
      // A record's own page ([id]) is opened by name, not as a page.
      .filter((route) => !route.includes("["))
      .filter(
        (route) =>
          !reachable.has(route) &&
          !Object.keys(NOT_BY_NAME).some(
            (prefix) => route === prefix || route.startsWith(`${prefix}/`),
          ),
      );
    expect(missing).toEqual([]);
  });
});
