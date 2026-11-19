// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiSession } from "@capital-q/api-client";
import type { AdminAuditRowDto } from "@capital-q/contracts";

import {
  activeConsoleHref,
  CONSOLE_GROUPS,
  consoleGroupsFor,
} from "../src/features/admin/console-nav";
import {
  AUDIT_NAME_LOOKUPS,
  auditLookups,
  auditResourceHref,
  auditResourceNames,
} from "../src/features/admin/audit-names";

let pathname = "/admin/audit";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const getAdminAccount = vi.fn();
const getAdminOrganisation = vi.fn();
vi.mock("@capital-q/api-client", () => ({
  getAdminAccount: (...args: unknown[]) => getAdminAccount(...args) as unknown,
  getAdminOrganisation: (...args: unknown[]) =>
    getAdminOrganisation(...args) as unknown,
}));

const { ConsoleNav } = await import("../src/features/admin/console-ui");

const EVERY = [
  ...new Set(
    CONSOLE_GROUPS.flatMap((group) =>
      group.sections.flatMap((section) =>
        typeof section.permission === "string"
          ? [section.permission]
          : section.permission,
      ),
    ),
  ),
];

/** Admin design 2026-11-19 §3.1: the console's grouped sidebar. */
describe("the console's sections", () => {
  it("are the same 16 sections as the tab strip, in labelled groups", () => {
    const groups = consoleGroupsFor(EVERY);
    expect(groups.map((group) => group.label)).toEqual([
      null,
      "Customers",
      "Trust",
      "Q",
      "Money",
      "Platform",
      "Governance",
    ]);
    const hrefs = groups.flatMap((g) => g.sections.map((s) => s.href));
    expect(hrefs).toHaveLength(16);
    expect(new Set(hrefs).size).toBe(16);
  });

  it("shows a role only the sections it holds, and drops empty groups", () => {
    const support = consoleGroupsFor(["accounts.read", "audit.read"]);
    expect(support.map((group) => group.label)).toEqual([
      "Customers",
      "Governance",
    ]);
    expect(support.flatMap((g) => g.sections.map((s) => s.href))).toEqual([
      "/admin/organisations",
      "/admin/accounts",
      "/admin/audit",
    ]);
    expect(consoleGroupsFor([])).toEqual([]);
  });

  it("marks one section current, the most specific", () => {
    const hrefs = consoleGroupsFor(EVERY).flatMap((g) =>
      g.sections.map((s) => s.href),
    );
    expect(activeConsoleHref("/admin", hrefs)).toBe("/admin");
    expect(activeConsoleHref("/admin/audit", hrefs)).toBe("/admin/audit");
    expect(activeConsoleHref("/admin/q/runs/abc", hrefs)).toBe("/admin/q");
    expect(activeConsoleHref("/admin/queue", hrefs)).toBe("/admin/queue");
    expect(activeConsoleHref("/admin/quiet", hrefs)).toBe("/admin");
  });

  it("renders the groups, the current page and the server's count only", () => {
    pathname = "/admin/audit";
    render(<ConsoleNav permissions={EVERY} counts={{ people: 1906 }} />);
    const nav = screen.getAllByRole("navigation", {
      name: "Console sections",
    })[0];
    if (nav === undefined) throw new Error("no console navigation");
    const governance = within(nav).getByRole("group", { name: "Governance" });
    const current = [...nav.querySelectorAll('[aria-current="page"]')];
    expect(current.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/audit",
    ]);
    expect(within(governance).getByRole("link", { name: "Audit" })).toBe(
      current[0],
    );
    expect(
      within(nav).getByRole("link", { name: /Accounts/ }).textContent,
    ).toContain("1,906");
    expect(
      within(nav).getByRole("link", { name: "Organisations" }).textContent,
    ).toBe("Organisations");
  });

  it("opens as a sheet on a phone, naming the current section", async () => {
    pathname = "/admin/flags";
    render(<ConsoleNav permissions={EVERY} />);
    const button = screen.getByRole("button", { name: /Sections/ });
    expect(button.textContent).toContain("Kill switches");
    fireEvent.click(button);
    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet)
        .getByRole("link", { name: "Kill switches" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

const row = (resourceType: string, resourceId: string): AdminAuditRowDto => ({
  source: "PLATFORM",
  at: "2026-11-19T10:00:00.000Z",
  actorType: "human",
  actorName: "An operator",
  actorRole: "operator",
  authorityName: null,
  actionType: "account.suspend",
  resourceType,
  resourceId,
  outcome: "SUCCEEDED",
  reason: null,
  breakGlass: false,
  metadata: {},
});
const SESSION: ApiSession = {
  baseUrl: "http://api.test",
  accessToken: "disabled-locally-000000000000",
};
const PERSON = "8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f";
const ORG = "992a9bc3-2c3b-4f7a-9d1e-0a1b2c3d4e5f";

describe("audit rows by name", () => {
  it("looks up each person and organisation once, and nothing else", () => {
    expect(
      auditLookups([
        row("user_profile", PERSON),
        row("user_profile", PERSON),
        row("organisation", ORG),
        row("company", ORG),
        row("organisation", "not-a-uuid"),
      ]),
    ).toEqual([
      { key: `person:${PERSON}`, kind: "person", id: PERSON },
      { key: `organisation:${ORG}`, kind: "organisation", id: ORG },
    ]);
    const many = Array.from({ length: 40 }, (_, n) =>
      row(
        "user_profile",
        `${String(n).padStart(8, "0")}-2c3b-4f7a-9d1e-0a1b2c3d4e5f`,
      ),
    );
    expect(auditLookups(many)).toHaveLength(AUDIT_NAME_LOOKUPS);
    expect(auditResourceHref("person", PERSON)).toBe(
      `/admin/accounts/${PERSON}`,
    );
  });

  it("names what the reads name and keeps the id where a read fails", async () => {
    getAdminAccount.mockResolvedValueOnce({ name: "Amara Okafor" });
    getAdminOrganisation.mockRejectedValueOnce(new Error("refused"));
    const names = await auditResourceNames(
      SESSION,
      [row("user_profile", PERSON), row("organisation", ORG)],
      true,
    );
    expect([...names]).toEqual([[`person:${PERSON}`, "Amara Okafor"]]);
  });

  it("reads nothing for a role that may not read accounts", async () => {
    getAdminAccount.mockClear();
    const names = await auditResourceNames(
      SESSION,
      [row("user_profile", PERSON)],
      false,
    );
    expect(names.size).toBe(0);
    expect(getAdminAccount).not.toHaveBeenCalled();
  });
});
