// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AudiencePreviewDto,
  VisibilityStateDto,
} from "@capital-q/contracts";

/**
 * The visibility control centre on screen (CQ-BIZ-003).
 *
 * The page renders the server's answers and nothing it made up: each
 * audience tab shows exactly the preview the server returned for it (and
 * says so when it is nothing), the ledger lists the server's shares with a
 * Revoke that says what revoking cannot undo, and a share is retried with
 * the same key.
 */

const COMPANY = "22222222-0000-4000-8000-000000000001";
const APEX = "88888888-0000-4000-8000-000000000001";
const HORIZON = "88888888-0000-4000-8000-000000000002";
const POLICY = "99999999-0000-4000-8000-000000000001";

const PROFILE = {
  canonicalName: "Alpha Robotics",
  legalName: null,
  websiteUrl: "https://alpha.example",
  foundedDate: null,
  headquartersCountry: "NG",
  headquartersCity: "Lagos",
  currentStageCode: null,
  shortDescription: null,
  primaryDescription: null,
  companyStatus: "active" as const,
};
const RAISE = {
  target: { amount: "5000000", currency: "USD" },
  targetStage: null,
  instrumentCode: null,
  targetCloseDate: null,
};

const previews: Record<string, AudiencePreviewDto> = {
  PUBLIC: {
    audience: "PUBLIC",
    relationshipId: null,
    profile: null,
    capitalObjective: null,
  },
  NETWORK: {
    audience: "NETWORK",
    relationshipId: null,
    profile: PROFILE,
    capitalObjective: null,
  },
  INVESTOR: {
    audience: "INVESTOR",
    relationshipId: APEX,
    profile: PROFILE,
    capitalObjective: RAISE,
  },
  ONLY_US: {
    audience: "ONLY_US",
    relationshipId: null,
    profile: PROFILE,
    capitalObjective: RAISE,
  },
};

const STATE: VisibilityStateDto = {
  companyId: COMPANY,
  objects: [
    {
      object: "COMPANY_PROFILE",
      resourceId: COMPANY,
      scope: "network_visible",
      choices: ["organisation_private", "network_visible"],
      shareable: false,
    },
    {
      object: "CAPITAL_OBJECTIVE",
      resourceId: "33333333-0000-4000-8000-000000000001",
      scope: "founder_private",
      choices: [],
      shareable: true,
    },
  ],
  shares: [
    {
      policyId: POLICY,
      object: "CAPITAL_OBJECTIVE",
      relationshipId: APEX,
      recipientName: "Apex Ventures",
      accessLevel: "view",
      createdAt: "2026-09-25T10:00:00.000Z",
      expiresAt: null,
    },
  ],
  relationships: [
    {
      relationshipId: APEX,
      investorOrganisationId: APEX,
      name: "Apex Ventures",
    },
    {
      relationshipId: HORIZON,
      investorOrganisationId: HORIZON,
      name: "Horizon Capital",
    },
  ],
};

type ActionMock = (...args: string[]) => Promise<unknown>;
const actions = vi.hoisted(() => ({
  loadVisibilityStateAction: vi.fn<ActionMock>(),
  loadAudiencePreviewAction: vi.fn<ActionMock>(),
  shareRaiseAction: vi.fn<ActionMock>(),
  shareRaiseWithNetworkAction: vi.fn<ActionMock>(),
  revokeShareAction: vi.fn<ActionMock>(),
}));
vi.mock("../src/features/company/visibility-actions", () => actions);

const { VisibilityCentre } =
  await import("../src/features/company/visibility-centre");

configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setUp() {
  actions.loadVisibilityStateAction.mockResolvedValue({
    ok: true,
    value: STATE,
  });
  actions.loadAudiencePreviewAction.mockImplementation(
    (_company: string, audience: string) =>
      Promise.resolve({ ok: true, value: previews[audience] }),
  );
  render(<VisibilityCentre companyId={COMPANY} refreshKey="1" />);
}

describe("VisibilityCentre", () => {
  it("P14: the network-wide raise share is off by default, turns on, and turns off by revoking", async () => {
    setUp();
    const toggle = await screen.findByRole("switch", {
      name: "Show my raise to every investor on Capital Q",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    actions.shareRaiseWithNetworkAction.mockResolvedValue({
      ok: true,
      value: { outcome: "CREATED", share: null },
    });
    actions.loadVisibilityStateAction.mockResolvedValue({
      ok: true,
      value: {
        ...STATE,
        networkRaiseShare: {
          policyId: "00000000-0000-4000-8000-0000000000fe",
          createdAt: "2026-10-06T10:00:00.000Z",
        },
      },
    });
    fireEvent.click(toggle);
    await screen.findByText(/Investors on Capital Q can now see your raise/u);
    expect(actions.shareRaiseWithNetworkAction).toHaveBeenCalledWith(
      COMPANY,
      expect.stringMatching(/^share-network:/u),
    );
    const on = await screen.findByRole("switch", {
      name: "Show my raise to every investor on Capital Q",
    });
    expect(on.getAttribute("aria-checked")).toBe("true");
    actions.revokeShareAction.mockResolvedValue({
      ok: true,
      value: { outcome: "REVOKED" },
    });
    fireEvent.click(on);
    await screen.findByText(/no longer shown to the network/u);
    expect(actions.revokeShareAction).toHaveBeenCalledWith(
      COMPANY,
      "00000000-0000-4000-8000-0000000000fe",
    );
  });

  it("shows each audience exactly what the server returned for it", async () => {
    setUp();
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByText("Alpha Robotics");
    expect(within(panel).getByText(/raise is not shown/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Public" }));
    await within(screen.getByRole("tabpanel")).findByText(
      /sees nothing of your company/,
    );
    expect(screen.getByRole("tabpanel").textContent).not.toContain(
      "Alpha Robotics",
    );

    fireEvent.click(screen.getByRole("tab", { name: "A specific investor" }));
    await within(screen.getByRole("tabpanel")).findByText("USD 5,000,000");
    expect(actions.loadAudiencePreviewAction).toHaveBeenLastCalledWith(
      COMPANY,
      "INVESTOR",
      APEX,
    );
    // The tabs are one tablist, one selected at a time.
    expect(
      screen
        .getAllByRole("tab")
        .filter((tab) => tab.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });

  it("never shows one audience's preview under another audience's tab while it loads", async () => {
    setUp();
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByText("Alpha Robotics");
    let release: () => void = () => undefined;
    actions.loadAudiencePreviewAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: previews["PUBLIC"] });
        }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Public" }));
    expect(screen.getByRole("tabpanel").textContent).not.toContain(
      "Alpha Robotics",
    );
    release();
    await within(screen.getByRole("tabpanel")).findByText(
      /sees nothing of your company/,
    );
  });

  it("lists shares from the server and revokes with honest wording", async () => {
    setUp();
    actions.revokeShareAction.mockResolvedValue({
      ok: true,
      value: { outcome: "REVOKED" },
    });
    const shares = await screen.findByRole("list", { name: "Active shares" });
    expect(within(shares).getByText("Apex Ventures")).toBeTruthy();
    fireEvent.click(within(shares).getByRole("button", { name: "Revoke" }));
    await screen.findByText(/what they already saw can't be recalled/);
    expect(actions.revokeShareAction).toHaveBeenCalledWith(COMPANY, POLICY);
  });

  it("offers only investors not already shared with, and retries a share with the same key", async () => {
    setUp();
    actions.shareRaiseAction
      .mockResolvedValueOnce({ ok: false, message: "Try again." })
      .mockResolvedValueOnce({
        ok: true,
        value: { outcome: "CREATED", share: null },
      });
    const select = await screen.findByLabelText("Share your raise with");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Choose an investor", "Horizon Capital"]);
    fireEvent.change(select, { target: { value: HORIZON } });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByText("Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByText(/Horizon Capital can now see your raise/);
    const keys = actions.shareRaiseAction.mock.calls.map((call) => call[2]);
    expect(keys[0]).toBe(keys[1]);
  });
});
