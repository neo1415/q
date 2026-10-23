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
  "/board": "a Work tab, operated as tab.work-board",
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
    const hrefs = new Set([
      ...scopes
        .flatMap((scope) => [
          ...sectionsFor(scope),
          ...ACCOUNT_NAVIGATION,
          ...MOBILE_NAVIGATION,
          ...youSectionsFor(scope),
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
