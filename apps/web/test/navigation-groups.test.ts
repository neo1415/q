import { describe, expect, it } from "vitest";

import {
  isActiveRoute,
  navigationGroupsFor,
  sectionsFor,
} from "../src/components/app-shell/navigation";
import { workTabs } from "../src/features/work/work-tabs";

/** WORK-58: the sidebar in a few short groups, Admin for admins only. */
describe("the sidebar's groups", () => {
  it("is the main areas and You, with Admin only for a platform admin", () => {
    for (const scope of [
      "founder_private",
      "investor_private",
      "unset",
    ] as const) {
      // Owner 2026-10-18: the Workspace folder became one Work entry.
      expect(navigationGroupsFor(scope).map((group) => group.label)).toEqual([
        null,
        "You",
      ]);
      expect(
        navigationGroupsFor(scope, { admin: true }).map((g) => g.label),
      ).toEqual([null, "You", "Admin"]);
    }
  });

  it("groups every section once: Work is one entry, its pages are its tabs", () => {
    for (const scope of ["founder_private", "investor_private"] as const) {
      const hrefs = navigationGroupsFor(scope, { admin: true }).flatMap(
        (group) => group.items.map((item) => item.href),
      );
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs).toEqual([
        "/discover",
        "/explore",
        "/home",
        // Capital is the CRM's Capital tab (owner 2026-10-16).
        "/relationships",
        // GateQ and company requests are CRM tabs (owner 2026-10-17);
        // Documents, Pitch, Rehearsals and The Q Daily are Work's tabs.
        "/work",
        "/profile",
        "/settings/usage",
        "/settings",
        "/admin",
      ]);
      for (const gone of [
        "/gateq",
        "/investors",
        "/documents",
        "/pitch",
        "/company/data-room",
        "/rehearsals",
        "/daily",
      ]) {
        expect(hrefs).not.toContain(gone);
      }
    }
    expect(sectionsFor("unset").map((item) => item.href)).toContain("/explore");
  });
});

/** Owner-approved 2026-10-18: Work's tabs, each at its own address. */
describe("Work's tabs", () => {
  it("are Tasks, Board, Documents, Pitch (a founder's), Rehearsals and The Q Daily", () => {
    const of = (side: "COMPANY" | "INVESTOR" | "NONE") =>
      workTabs(side).map((tab) => `${tab.label} ${tab.href}`);
    expect(of("COMPANY")).toEqual([
      "Tasks /work",
      "Board /board",
      "Documents /documents",
      "Pitch /pitch",
      "Rehearsals /rehearsals",
      "The Q Daily /daily",
    ]);
    expect(of("INVESTOR")).toEqual([
      "Tasks /work",
      "Board /board",
      "Documents /documents",
      "Rehearsals /rehearsals",
      "The Q Daily /daily",
    ]);
    // Rehearsals are for founders and investors, as the old entry was.
    expect(of("NONE")).toEqual([
      "Tasks /work",
      "Board /board",
      "Documents /documents",
      "The Q Daily /daily",
    ]);
  });

  it("each keeps the Work entry current, the data room (reached from Pitch) too", () => {
    for (const path of [
      "/work",
      "/work/abc",
      "/documents",
      "/pitch",
      "/pitch/new",
      "/company/data-room",
      "/rehearsals/r/1",
      "/daily",
    ]) {
      expect(isActiveRoute(path, "/work"), path).toBe(true);
    }
    for (const path of ["/q-pitch", "/company/abc", "/dailyx", "/home"]) {
      expect(isActiveRoute(path, "/work"), path).toBe(false);
    }
  });
});
