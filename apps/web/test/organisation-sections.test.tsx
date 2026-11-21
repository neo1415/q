// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyOrganisationDto, TeamRole } from "@capital-q/contracts";

/**
 * Owner decision 112: Privacy, How Q speaks for us, Gateway and Q Card
 * brand, and Connections are built from what exists. Owners and admins get
 * the controls; a member gets the same page read-only (every control
 * disabled, and why). Each line is the server's answer: a read that fails
 * says so, and "not connected" is never drawn as connected. The API's own
 * refusals of a member's writes are tested beside each API (brand kit:
 * apps/q-api/test/brand-kit-roles.test.ts; visibility: company.edit and
 * investor.edit in the companies and investors packages).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/organisation",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/i18n/server", () => ({
  serverT: () => Promise.resolve((text: string) => text),
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

let own: Record<string, unknown> = { kind: "NONE" };
vi.mock("@/features/q/context", () => ({
  apiSession: () => Promise.resolve({ baseUrl: "https://api.test" }),
  qApiSession: () => Promise.resolve({ baseUrl: "https://q.test" }),
  resolveOwnContext: () => Promise.resolve(own),
}));
vi.mock("@/features/q/q-section", () => ({
  QSection: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The screens that already make these changes, stood in for here: each
// has one control, so read-only can be seen to reach it.
vi.mock("@/features/company/visibility-screen", () => ({
  VisibilityScreen: ({ companyId }: { companyId: string }) => (
    <button type="button" data-visibility-company={companyId}>
      Share
    </button>
  ),
}));
vi.mock("@/features/investor/visibility-screen", () => ({
  InvestorVisibilityScreen: ({
    investorOrganisationId,
  }: {
    investorOrganisationId: string;
  }) => (
    <button type="button" data-visibility-investor={investorOrganisationId}>
      Discoverable
    </button>
  ),
}));
vi.mock("@/features/documents/brand-kit-panel", () => ({
  BrandKitPanel: ({ initial }: { initial: unknown }) => (
    <button type="button" data-brand-kit={initial === null ? "none" : "read"}>
      Edit brand
    </button>
  ),
}));

const api = {
  kyb: vi.fn<() => Promise<unknown>>(),
  providers: vi.fn<() => Promise<unknown>>(),
  google: vi.fn<() => Promise<unknown>>(),
  inbound: vi.fn<() => Promise<unknown>>(),
  guide: vi.fn<() => Promise<unknown>>(),
  brandKit: vi.fn<() => Promise<unknown>>(),
  gateways: vi.fn<() => Promise<unknown>>(),
  appearance: vi.fn<() => Promise<unknown>>(),
};
vi.mock("@capital-q/api-client", () => ({
  getKyb: () => api.kyb(),
  getVerificationProviders: () => api.providers(),
  getGoogleConnection: () => api.google(),
  getInboundEmailAddress: () => api.inbound(),
  getMyEtiquetteGuide: () => api.guide(),
  getQBrandKit: () => api.brandKit(),
  listGateways: () => api.gateways(),
  getGatewayAppearance: () => api.appearance(),
}));

const { manages } =
  await import("../src/features/organisation/org-admin-sections");
const { default: ConnectionsPage } =
  await import("../app/(app)/organisation/connections/page");
const { default: SpeakingPage } =
  await import("../app/(app)/organisation/speaking/page");
const { default: BrandPage } =
  await import("../app/(app)/organisation/brand/page");
const { default: PrivacyPage } =
  await import("../app/(app)/organisation/privacy/page");

const asRole = (role: TeamRole) => {
  const one: MyOrganisationDto = {
    organisationId: "8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e51",
    name: "Savanna Seed Partners",
    kind: "FIRM",
    organisationType: "investment_firm",
    role,
    memberCount: 3,
    active: true,
    companyId: null,
  };
  context = {
    organisation: one,
    role,
    canManage: manages(role),
    organisations: [one],
  };
};

const FIRM = "9a6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e51";

beforeEach(() => {
  own = { kind: "INVESTOR", investorOrganisationId: FIRM };
  api.kyb.mockResolvedValue({ standing: "PENDING", submission: null });
  api.providers.mockResolvedValue({
    providers: [
      {
        provider: "COMPANIES_HOUSE",
        label: "Companies House",
        covers: "UK companies",
        connected: false,
        description: "UK register",
      },
    ],
  });
  api.google.mockResolvedValue({ status: "NOT_CONNECTED" });
  api.inbound.mockResolvedValue({ status: "UNAVAILABLE" });
  api.guide.mockResolvedValue({
    guide: null,
    house: { source: "BUILT_IN", title: "Capital Q etiquette", version: "v1" },
  });
  api.brandKit.mockResolvedValue({});
  api.gateways.mockResolvedValue({
    gateways: [
      {
        id: "7a6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e51",
        publicId: "savanna",
        name: "Savanna intake",
        status: "ACTIVE",
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  });
  api.appearance.mockResolvedValue({
    gatewayId: "7a6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e51",
    revision: 2,
    accentHex: "#C8A24A",
    embedOrigins: [],
    updatedAt: null,
    canChange: true,
    displayName: null,
    logo: null,
  });
});
afterEach(cleanup);

const disabledControls = () =>
  [...document.querySelectorAll("button")].every(
    (button) => button.closest("fieldset[disabled]") !== null,
  );

describe("each section: owners and admins change it, a member reads it", () => {
  for (const [name, page] of [
    ["Privacy", () => PrivacyPage()],
    ["Gateway and Q Card brand", () => BrandPage()],
  ] as const) {
    it(`${name}: an owner and an admin get the controls`, async () => {
      for (const role of ["OWNER", "ADMIN"] as const) {
        asRole(role);
        render(await page());
        expect(document.querySelector("[data-org-read-only]")).toBeNull();
        expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
        expect(
          screen.getAllByRole("button").every((b) => !b.closest("fieldset")),
        ).toBe(true);
        cleanup();
      }
    });

    it(`${name}: a member sees it read-only, every control disabled, and why`, async () => {
      asRole("MEMBER");
      render(await page());
      expect(
        screen.getByText("Only owners and admins can change this."),
      ).toBeTruthy();
      expect(disabledControls()).toBe(true);
    });
  }
});

describe("Privacy", () => {
  it("is the organisation's own visibility screen, for the firm or the company", async () => {
    asRole("OWNER");
    render(await PrivacyPage());
    expect(
      document.querySelector(`[data-visibility-investor="${FIRM}"]`),
    ).not.toBeNull();
    cleanup();
    own = {
      kind: "FOUNDER",
      companyId: "6a6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e51",
    };
    render(await PrivacyPage());
    expect(document.querySelector("[data-visibility-company]")).not.toBeNull();
    // A person's own Q Card is linked, not moved here.
    expect(
      screen.getByRole("link", { name: "Open your profile" }),
    ).toBeTruthy();
  });
});

describe("Gateway and Q Card brand", () => {
  it("shows the brand kit and each gateway's real look", async () => {
    asRole("OWNER");
    render(await BrandPage());
    expect(document.querySelector('[data-brand-kit="read"]')).not.toBeNull();
    expect(screen.getByText("Savanna intake")).toBeTruthy();
    expect(screen.getByText("Accent #C8A24A · No logo")).toBeTruthy();
  });

  it("says a brand kit that could not be read, never a blank one", async () => {
    asRole("OWNER");
    api.brandKit.mockRejectedValue(new Error("down"));
    render(await BrandPage());
    expect(document.querySelector('[data-brand-kit="none"]')).not.toBeNull();
  });
});

describe("Connections: each line is what is true now", () => {
  it("says not connected where nothing is, and what is pending", async () => {
    asRole("MEMBER");
    render(await ConnectionsPage());
    expect(screen.getByText("Being reviewed")).toBeTruthy();
    expect(screen.getAllByText("Not connected").length).toBe(3);
    expect(screen.getByText("Not available on Capital Q yet")).toBeTruthy();
    expect(
      screen.getByText(
        "From a CRM or spreadsheet export. There is no live CRM connection.",
      ),
    ).toBeTruthy();
  });

  it("shows a real connection as connected, with its account", async () => {
    asRole("OWNER");
    api.google.mockResolvedValue({
      status: "CONNECTED",
      email: "amara@savanna.test",
      calendar: "GRANTED",
    });
    api.inbound.mockResolvedValue({
      status: "ACTIVE",
      address: "q-amara@in.capitalq.test",
    });
    render(await ConnectionsPage());
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(
      screen.getByText("amara@savanna.test · Calendar connected"),
    ).toBeTruthy();
    expect(screen.getByText("q-amara@in.capitalq.test")).toBeTruthy();
  });

  it("says a read that failed, never a guessed state", async () => {
    asRole("OWNER");
    api.kyb.mockRejectedValue(new Error("down"));
    api.google.mockRejectedValue(new Error("down"));
    render(await ConnectionsPage());
    expect(screen.getAllByText("Couldn't be read just now.").length).toBe(2);
  });
});

describe("How Q speaks for us", () => {
  it("shows the guide in force read-only and says an organisation guide isn't built", async () => {
    asRole("OWNER");
    render(await SpeakingPage());
    expect(screen.getByText("Capital Q etiquette · Built in")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(
      screen.getByText(
        "An organisation-wide guide isn't built yet: Capital Q doesn't store one, so nothing here can be changed and nothing is saved.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
