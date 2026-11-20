import { describe, expect, it } from "vitest";

import {
  Q_NAVIGATE_DESTINATIONS,
  Q_SETTINGS_SECTIONS,
} from "@capital-q/contracts";

import {
  ACCOUNT_NAVIGATION,
  MOBILE_NAVIGATION,
  youSectionsFor,
  sectionsFor,
} from "../src/components/app-shell/navigation";
import { settingsPath } from "../src/features/q/client-actions";
import { destinationPath } from "../src/features/voice/destinations";
import { WORK_DATA_ROOM_HREF, workTabs } from "../src/features/work/work-tabs";

/**
 * Every screen in the navigation is one Q can open (R20): a destination
 * of Q's navigation hand (or a Settings section) maps to it.
 * The capability registry lists one entry per destination (its own
 * completeness test in q-tools), so a screen added to the navigation
 * without a destination fails here.
 */
describe("every navigation screen is a screen Q can open", () => {
  it("maps each navigation href to a Q destination", () => {
    // A NAVIGATE destination, or a Settings section Q opens by name
    // (OPEN_SETTINGS: "show my plan" is /settings/plan).
    const reachable = new Set(
      [
        ...Q_NAVIGATE_DESTINATIONS.map((destination) =>
          destinationPath(destination),
        ),
        ...Q_SETTINGS_SECTIONS.map((section) => settingsPath(section)),
      ].map((path) => path?.split(/[?#]/u)[0]),
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
    // Q-NAV (2026-11-20): no exceptions. A screen added to the navigation
    // without a destination or a Settings section fails here.
    const missing = [...hrefs].filter((href) => !reachable.has(href));
    expect(missing).toEqual([]);
  });

  it("every Q destination has exactly one route", () => {
    for (const destination of Q_NAVIGATE_DESTINATIONS) {
      expect(destinationPath(destination), destination).toMatch(/^\//);
    }
  });
});
