import { describe, expect, it } from "vitest";

import {
  navigationGroupsFor,
  sectionsFor,
} from "../src/components/app-shell/navigation";

/** WORK-58: the sidebar in a few short groups, Admin for admins only. */
describe("the sidebar's groups", () => {
  it("is the main areas, Workspace and You, with Admin only for a platform admin", () => {
    for (const scope of [
      "founder_private",
      "investor_private",
      "unset",
    ] as const) {
      expect(navigationGroupsFor(scope).map((group) => group.label)).toEqual([
        null,
        "Workspace",
        "You",
      ]);
      expect(
        navigationGroupsFor(scope, { admin: true }).map((g) => g.label),
      ).toEqual([null, "Workspace", "You", "Admin"]);
    }
  });

  it("groups every section once: Work, Usage and the console now included", () => {
    const investor = navigationGroupsFor("investor_private", { admin: true });
    const hrefs = investor.flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual([
      "/discover",
      "/home",
      "/capital",
      "/relationships",
      // F2: GateQ, its own page, first in Workspace.
      "/gateq",
      "/work",
      "/investors",
      "/documents",
      "/rehearsals",
      "/daily",
      "/profile",
      "/results",
      "/settings/usage",
      "/settings",
      "/admin",
    ]);
    const founder = navigationGroupsFor("founder_private").flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(founder).toContain("/pitch");
    expect(founder).toContain("/gateq");
    expect(founder).not.toContain("/investors");
    expect(founder).not.toContain("/admin");
    expect(sectionsFor("unset").map((item) => item.href)).toContain("/search");
  });
});
