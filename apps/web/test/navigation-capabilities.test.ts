import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  MOBILE_NAVIGATION,
  PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
} from "../src/components/app-shell/navigation";
import { destinationPath } from "../src/features/voice/destinations";

/**
 * Every screen in the navigation is one Q can open (R20): a destination
 * of Q's navigation hand maps to it, or it is excluded here with a reason.
 * The capability registry lists one entry per destination (its own
 * completeness test in q-tools), so a screen added to the navigation
 * without a destination fails here.
 */
const EXCLUDED: Readonly<Record<string, string>> = {};

describe("every navigation screen is a screen Q can open", () => {
  it("maps each navigation href to a Q destination, or states why not", () => {
    const reachable = new Set(
      Q_NAVIGATE_DESTINATIONS.map((destination) =>
        destinationPath(destination),
      ),
    );
    const hrefs = new Set(
      [...PRIMARY_NAVIGATION, PROFILE_NAVIGATION, ...MOBILE_NAVIGATION].map(
        (item) => item.href,
      ),
    );
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
