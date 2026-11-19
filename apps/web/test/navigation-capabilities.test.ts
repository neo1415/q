import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  ACCOUNT_NAVIGATION,
  MOBILE_NAVIGATION,
  youSectionsFor,
  sectionsFor,
} from "../src/components/app-shell/navigation";
import { destinationPath } from "../src/features/voice/destinations";
import { WORK_DATA_ROOM_HREF, workTabs } from "../src/features/work/work-tabs";

/**
 * Every screen in the navigation is one Q can open (R20): a destination
 * of Q's navigation hand maps to it, or it is excluded here with a reason.
 * The capability registry lists one entry per destination (its own
 * completeness test in q-tools), so a screen added to the navigation
 * without a destination fails here.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  // Owner 2026-10-23: Work's Board tab (tab.work-board); Q reads and
  // changes the board with my_board, and opens it from Work's tab strip.
  // Q Workspace §8 (integration 2026-11-07): the sidebar's Analytics entry.
  // Until W3 adds an ANALYTICS destination (contracts), Q reaches it by
  // the page's own Q tools and the site map, not by NAVIGATE.
  "/analytics": "no NAVIGATE destination yet (W3 owns the contract)",
  // Admin design D1/D5 (2026-11-19, slice A1: web navigation and copy
  // only). A NAVIGATE destination is a contracts change outside A1; Q
  // reaches these through the site map (pages.ts) until one is added.
  "/settings/plan": "no NAVIGATE destination yet (A1 changes no contracts)",
  "/settings/team": "no NAVIGATE destination yet (A1 changes no contracts)",
  // Decisions 109 and 110: a NAVIGATE destination touches contracts, Q
  // tools and the model gateway's receipts; Q reaches it by the site map.
  "/organisation":
    "no NAVIGATE destination yet (a contracts and Q-tools change)",
  "/relationships/import":
    "no NAVIGATE destination yet (A1 changes no contracts)",
};

describe("every navigation screen is a screen Q can open", () => {
  it("maps each navigation href to a Q destination, or states why not", () => {
    const reachable = new Set(
      Q_NAVIGATE_DESTINATIONS.map(
        (destination) => destinationPath(destination)?.split(/[?#]/u)[0],
      ),
    );
    // Every section either side can reach, on the desktop and the phone.
    const scopes = ["founder_private", "investor_private", "unset"] as const;
    // An owner of an organisation sees every entry its group offers.
    const options = {
      organisation: { name: "LedgerBridge", role: "OWNER" as const },
    };
    const hrefs = new Set([
      ...scopes
        .flatMap((scope) => [
          ...sectionsFor(scope, options),
          ...ACCOUNT_NAVIGATION,
          ...MOBILE_NAVIGATION,
          ...youSectionsFor(scope, options),
        ])
        .map((item) => item.href),
      // Work's tabs (owner 2026-10-18) and the data room reached from Pitch.
      ...(["COMPANY", "INVESTOR", "NONE"] as const).flatMap((side) =>
        workTabs(side).map((tab) => tab.href),
      ),
      WORK_DATA_ROOM_HREF,
    ]);
    // Results is the CRM's Reports tab now; the CRM entry is /relationships.
    expect(hrefs).toContain("/relationships");
    expect(hrefs).not.toContain("/results");
    const missing = [...hrefs].filter(
      (href) => !reachable.has(href) && (EXCLUDED[href] ?? "").length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("every Q destination has exactly one route", () => {
    for (const destination of Q_NAVIGATE_DESTINATIONS) {
      expect(destinationPath(destination), destination).toMatch(/^\//);
    }
  });
});
