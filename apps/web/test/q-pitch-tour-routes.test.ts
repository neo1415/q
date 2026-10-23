import { tourStartFor } from "@/features/q-pitch/tour-start";
import { describe, expect, it } from "vitest";

import { TOUR_PAGES, routeMatchesPattern } from "@capital-q/q-pitch";

import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";
import { investorPath } from "@/features/q-pitch/use-tour-ports";

/**
 * Lane qpf, 17 Oct: openTourPage failed NOT_FOUND because its page was not
 * in the app's route table. Every page a tour opens by name is a route the
 * navigation layer knows.
 */
const known = (path: string) =>
  APP_ROUTE_PATTERNS.some((pattern) =>
    routeMatchesPattern(pattern, path.split(/[?#]/u)[0] ?? path),
  );

describe("pages a tour opens are app routes", () => {
  it.each(Object.values(TOUR_PAGES))("%s", (path) => {
    expect(known(path)).toBe(true);
  });

  it.each(["PROFILE", "RELATIONSHIP", "REHEARSE"] as const)(
    "a fictional investor's %s page",
    (page) => {
      const path = investorPath(page, "savanna-seed-partners");
      expect(path).not.toBeNull();
      expect(known(path ?? "")).toBe(true);
    },
  );
});

describe("where Q's Q_PITCH move starts the tour", () => {
  it("opens the story (v7) for everyone, on a new Home conversation", () => {
    expect(tourStartFor()).toBe("/home?qpitch=story&new=1");
  });
});
