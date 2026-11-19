import { describe, expect, it } from "vitest";

import {
  activeHrefIn,
  activeOrganisation,
  ADMIN_NAVIGATION,
  groupHrefs,
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
        // Q Workspace §8: Analytics, both sides.
        "/analytics",
        "/profile",
        "/settings/usage",
        // D5 (admin design 2026-11-19): plans, from You.
        "/settings/plan",
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

/** Admin design 2026-11-19, slice A1 (D1, D3, D5, D7). */
describe("the organisation's group and one current entry", () => {
  const mine = (role: "OWNER" | "ADMIN" | "MEMBER", active = true) => ({
    organisationId: "8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f",
    name: "LedgerBridge",
    kind: "COMPANY" as const,
    organisationType: "company" as const,
    role,
    memberCount: 3,
    active,
    companyId: null,
  });

  it("is headed by the organisation's name, after the main areas", () => {
    const groups = navigationGroupsFor("founder_private", {
      organisation: { name: "LedgerBridge", role: "OWNER" },
    });
    expect(groups.map((group) => group.label)).toEqual([
      null,
      "Organisation",
      "You",
    ]);
    expect(groups[1]?.title).toBe("LedgerBridge");
  });

  it("offers owners and admins the import; members see Organisation only", () => {
    const items = (role: "OWNER" | "ADMIN" | "MEMBER") =>
      navigationGroupsFor("investor_private", {
        organisation: { name: "Northwind", role },
      })
        .find((group) => group.label === "Organisation")
        ?.items.map((item) => `${item.label} ${item.href}`);
    expect(items("OWNER")).toEqual([
      "Organisation /settings/team",
      "Import pipeline /relationships/import",
    ]);
    expect(items("ADMIN")).toEqual(items("OWNER"));
    expect(items("MEMBER")).toEqual(["Organisation /settings/team"]);
  });

  it("has no organisation group without an active organisation", () => {
    expect(activeOrganisation(undefined)).toBeNull();
    expect(activeOrganisation([mine("OWNER", false)])).toBeNull();
    expect(activeOrganisation([mine("MEMBER")])).toEqual({
      name: "LedgerBridge",
      role: "MEMBER",
    });
    expect(
      navigationGroupsFor("unset", { organisation: null }).map((g) => g.label),
    ).toEqual([null, "You"]);
  });

  it("names the console for its work (D3)", () => {
    expect(ADMIN_NAVIGATION.label).toBe("Operations console");
  });

  it("marks one entry current, the most specific (D7)", () => {
    const hrefs = groupHrefs(
      navigationGroupsFor("founder_private", {
        admin: true,
        organisation: { name: "LedgerBridge", role: "OWNER" },
      }),
    );
    const cases: readonly (readonly [string, string | null])[] = [
      ["/settings/usage", "/settings/usage"],
      ["/settings/plan", "/settings/plan"],
      ["/settings/team/abc", "/settings/team"],
      ["/settings/data", "/settings"],
      ["/settings", "/settings"],
      ["/relationships/import", "/relationships/import"],
      ["/relationships", "/relationships"],
      ["/results", "/relationships"],
      ["/documents", "/work"],
      ["/admin/audit", "/admin"],
      ["/nowhere", null],
    ];
    for (const [path, expected] of cases) {
      expect(activeHrefIn(path, hrefs), path).toBe(expected);
    }
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
