// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  InvestorOrganisationDto,
  MeCapabilitiesDto,
  MyOrganisationDto,
  TeamRole,
} from "@capital-q/contracts";

/**
 * Organisation → General (decisions 109 and 110): owners and admins edit
 * the organisation's own details field by field, through the same save
 * the profile page and Q's approved actions use; a member reads them, and
 * the Edit control is held back with the reason. The server refuses a
 * member's write and another tenant's either way (companies and investors
 * service integration tests: "a member cannot", "cross-tenant writes
 * change nothing").
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/organisation",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const saves: unknown[][] = [];
vi.mock("@/features/profile/profile-actions", () => ({
  savePersonFieldAction: vi.fn(),
  saveCompanyFieldAction: vi.fn(),
  saveInvestorFieldAction: (...args: unknown[]) => {
    saves.push(args);
    return Promise.resolve({ ok: true, value: args[2], version: 6 });
  },
}));
vi.mock("@/features/profile/profile-image-actions", () => ({}));

const { CapabilitiesProvider } =
  await import("../src/features/organisation/capabilities");
const { OrgGeneralView, INVESTOR_GENERAL, COMPANY_GENERAL } =
  await import("../src/features/organisation/org-general");

afterEach(() => {
  cleanup();
  saves.length = 0;
});

const ORG_ID = "8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f";
const FIRM_ID = "9f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f";

const organisation = (role: TeamRole): MyOrganisationDto => ({
  organisationId: ORG_ID,
  name: "Harbourline Capital",
  kind: "FIRM",
  organisationType: "investment_firm",
  role,
  memberCount: 5,
  active: true,
  companyId: null,
});

const FIRM: InvestorOrganisationDto = {
  id: FIRM_ID,
  investorType: "VC",
  displayName: "Harbourline Capital",
  websiteUrl: "https://harbourline.example",
  hqCountry: "GB",
  publicDescription: "Seed and Series A in climate software.",
  deploymentState: "ACTIVELY_INVESTING",
  inboundPreference: null,
  verificationState: "unverified",
  visibility: "network_visible",
  version: 5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const capabilities = (role: TeamRole): MeCapabilitiesDto => ({
  organisationId: ORG_ID,
  membershipId: "7f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f",
  role,
  capabilities:
    role === "MEMBER" ? ["investor.view"] : ["investor.edit", "investor.view"],
  team: {
    invite: role !== "MEMBER",
    changeRoles: role !== "MEMBER",
    removeMembers: role !== "MEMBER",
    own: role === "OWNER",
  },
});

const view = (role: TeamRole) =>
  render(
    <CapabilitiesProvider value={capabilities(role)}>
      <OrgGeneralView
        t={(text) => text}
        organisation={organisation(role)}
        role={role}
        canManage={role !== "MEMBER"}
        company={null}
        investor={FIRM}
        images={null}
      />
    </CapabilitiesProvider>,
  );

describe("Organisation → General", () => {
  it("covers the details the brief names, through the existing profile fields", () => {
    expect(COMPANY_GENERAL).toEqual([
      "canonicalName",
      "websiteUrl",
      "headquartersCountry",
      "headquartersCity",
      "shortDescription",
      "primaryDescription",
    ]);
    // No headquarters city on an investor organisation: no action writes one.
    expect(INVESTOR_GENERAL).toEqual([
      "displayName",
      "websiteUrl",
      "hqCountry",
      "publicDescription",
    ]);
  });

  it("shows an admin the firm's details with Edit, and no 'Not built yet'", () => {
    view("ADMIN");
    const section = document.querySelector("[data-org-general]");
    if (!(section instanceof HTMLElement)) throw new Error("no section");
    expect(
      within(section).getByText("https://harbourline.example"),
    ).toBeTruthy();
    expect(
      within(section).getByText("Seed and Series A in climate software."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit Firm details" }),
    ).toBeTruthy();
    expect(screen.queryByText("Not built yet")).toBeNull();
  });

  it("saves one field through the investor profile save, with the version read", async () => {
    view("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Edit Firm details" }));
    const row = document.querySelector<HTMLElement>(
      '[data-profile-field="websiteUrl"]',
    );
    if (row === null) throw new Error("no website row");
    fireEvent.click(within(row).getByRole("button", { name: /^Edit/ }));
    const website = within(row).getByRole("textbox");
    fireEvent.change(website, {
      target: { value: "https://harbourline.example/fund" },
    });
    fireEvent.submit(website.closest("form") as HTMLFormElement);
    await vi.waitFor(() => {
      expect(saves).toHaveLength(1);
    });
    expect(saves[0]?.slice(0, 2)).toEqual([FIRM_ID, "websiteUrl"]);
    expect(saves[0]?.[3]).toBe(5);
  });

  it("holds Edit back from a member, with the reason", () => {
    view("MEMBER");
    expect(
      screen.queryByRole("button", { name: "Edit Firm details" }),
    ).toBeNull();
    expect(screen.getByText("Admins only")).toBeTruthy();
    expect(
      screen.getByText(
        "Harbourline Capital's own details. Owners and admins change them.",
      ),
    ).toBeTruthy();
  });
});
