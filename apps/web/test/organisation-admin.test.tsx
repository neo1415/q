// @vitest-environment jsdom
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MyOrganisationDto, TeamRole } from "@capital-q/contracts";

/**
 * The organisation admin at /organisation (admin design 2026-11-19 §3.2;
 * decisions 109 and 110): one section index, a scope bar naming the
 * organisation and the person's role, and every section read-only for a
 * member. What the page draws is a courtesy; the API refuses a member's
 * writes (packages/organisations team-service and apps/api billing tests).
 */

let pathname = "/organisation";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/i18n/server", () => ({
  serverT: () => Promise.resolve((text: string) => text),
}));
vi.mock("@/features/team/team-actions", () => ({
  switchOrganisationAction: vi.fn(),
}));

let context: {
  organisation: MyOrganisationDto;
  role: TeamRole;
  canManage: boolean;
  organisations: readonly MyOrganisationDto[];
} | null = null;
vi.mock("@/features/organisation/org-admin-context", () => ({
  orgAdminContext: () => Promise.resolve(context),
}));

const { OrgReadOnly, OrgScopeBar, OrgSectionNav } =
  await import("../src/features/organisation/org-admin-shell");
const { currentOrgSection, manages, ORG_SECTIONS, scopeParts } =
  await import("../src/features/organisation/org-admin-sections");
const { default: ImportSection } =
  await import("../app/(app)/organisation/import/page");
const { default: DataSection } =
  await import("../app/(app)/organisation/data/page");

afterEach(cleanup);

const org = (
  name: string,
  role: TeamRole,
  active: boolean,
  n = 1,
): MyOrganisationDto => ({
  organisationId: `8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5${String(n)}`,
  name,
  kind: "COMPANY",
  organisationType: "company",
  role,
  memberCount: 4,
  active,
  companyId: null,
});

const asRole = (role: TeamRole) => {
  const one = org("LedgerBridge", role, true);
  context = {
    organisation: one,
    role,
    canManage: manages(role),
    organisations: [one],
  };
};

describe("the section index", () => {
  it("has the eleven sections, each with a page", () => {
    expect(ORG_SECTIONS.map((section) => section.label)).toEqual([
      "General",
      "Members and usage",
      "Roles",
      "Plan and billing",
      "Import",
      "Connections",
      "Export and deletion",
      "Privacy",
      "How Q speaks for us",
      "Gateway and Q Card brand",
      "Activity log",
    ]);
    const root = join(
      import.meta.dirname,
      "..",
      "app",
      "(app)",
      "organisation",
    );
    const built = new Set([
      "/organisation",
      ...readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `/organisation/${entry.name}`),
    ]);
    for (const section of ORG_SECTIONS)
      expect(built.has(section.href)).toBe(true);
  });

  it("marks the current section, General only on its own address", () => {
    expect(currentOrgSection("/organisation")?.label).toBe("General");
    expect(currentOrgSection("/organisation/plan")?.label).toBe(
      "Plan and billing",
    );
    expect(currentOrgSection("/organisation/members/x")?.label).toBe(
      "Members and usage",
    );
    pathname = "/organisation/activity";
    render(<OrgSectionNav />);
    const nav = screen.getByRole("navigation", {
      name: "Organisation sections",
    });
    expect(
      [...nav.querySelectorAll('[aria-current="page"]')].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/organisation/activity"]);
  });
});

describe("the scope bar", () => {
  it("names the organisation, the role and the scope of a change", () => {
    expect(scopeParts("LedgerBridge", "MEMBER")).toEqual([
      "LedgerBridge",
      "You are a member",
      "Changes here apply to LedgerBridge only",
    ]);
    const one = org("LedgerBridge", "OWNER", true);
    render(
      <OrgScopeBar name="LedgerBridge" role="OWNER" organisations={[one]} />,
    );
    const bar = document.querySelector("[data-org-scope-bar]");
    expect(bar?.textContent).toContain("You are an owner");
    expect(bar?.textContent).toContain(
      "Changes here apply to LedgerBridge only",
    );
    // One organisation: nothing to switch to.
    expect(screen.queryByRole("button", { name: /Switch/ })).toBeNull();
  });

  it("offers Switch to someone in two or more organisations", () => {
    render(
      <OrgScopeBar
        name="LedgerBridge"
        role="ADMIN"
        organisations={[
          org("LedgerBridge", "ADMIN", true, 1),
          org("Lagoon Angels", "MEMBER", false, 2),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /Switch/ })).toBeTruthy();
  });
});

describe("decision 110: a member sees the organisation read-only", () => {
  it("disables every control inside and says why", () => {
    render(
      <OrgReadOnly readOnly>
        <button type="button">Invite</button>
        <input aria-label="Email" />
      </OrgReadOnly>,
    );
    expect(
      screen.getByText("Only owners and admins can change this."),
    ).toBeTruthy();
    const group = screen.getByRole("group");
    expect(group.hasAttribute("disabled")).toBe(true);
    // A disabled fieldset disables its controls (HTML), so neither acts.
    expect(
      within(group)
        .getByRole("button", {
          name: "Invite",
        })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      within(group)
        .getByRole("textbox", {
          name: "Email",
        })
        .matches(":disabled"),
    ).toBe(true);
  });

  it("leaves an owner's or admin's controls alone", () => {
    render(
      <OrgReadOnly readOnly={false}>
        <button type="button">Invite</button>
      </OrgReadOnly>,
    );
    expect(
      screen.queryByText("Only owners and admins can change this."),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Invite" }).matches(":disabled"),
    ).toBe(false);
  });

  it("decides from the server's role: owners and admins manage, members don't", () => {
    expect(manages("OWNER")).toBe(true);
    expect(manages("ADMIN")).toBe(true);
    expect(manages("MEMBER")).toBe(false);
    expect(manages(null)).toBe(false);
  });

  it("Import: an admin gets the link, a member a disabled button and the note", async () => {
    asRole("ADMIN");
    render(await ImportSection());
    expect(
      screen
        .getByRole("link", { name: "Import your pipeline" })
        .getAttribute("href"),
    ).toBe("/relationships/import");
    cleanup();
    asRole("MEMBER");
    render(await ImportSection());
    expect(
      screen.queryByRole("link", { name: "Import your pipeline" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", {
          name: "Import your pipeline",
        })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByText("Only owners and admins can change this."),
    ).toBeTruthy();
  });

  it("a section that isn't built says so, and saves nothing", async () => {
    asRole("OWNER");
    render(await DataSection());
    expect(screen.getByRole("heading", { name: "Not built yet" })).toBeTruthy();
    // Decision 112: the person's own export and deletion are one step away.
    expect(
      screen.getByRole("link", { name: "Export or delete your own data" }),
    ).toHaveProperty("pathname", "/settings/data");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
