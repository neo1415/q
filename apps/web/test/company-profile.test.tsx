// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyProfileDto } from "@capital-q/contracts";

/**
 * A company's profile from Discover (founder request 2026-10-02): the
 * avatar that opens it, its two tabs, what each role is shown, and that a
 * video is signed only when somebody presses Play. Server actions are
 * mocked at the module boundary; access itself is the API's and is
 * covered in apps/api/test/company-profile.test.ts.
 */

type ActionResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

const recordDecisionAction = vi.fn<(input: unknown) => Promise<ActionResult>>();
const undoPassAction = vi.fn<(input: unknown) => Promise<ActionResult>>();
const authorisePlaybackAction =
  vi.fn<(companyId: string, mediaAssetId: string) => Promise<ActionResult>>();
const downloadDeckAction =
  vi.fn<
    (
      companyId: string,
    ) => Promise<
      | { readonly ok: true; readonly url: string }
      | { readonly ok: false; readonly message: string }
    >
  >();

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  recordDecisionAction: (input: unknown) => recordDecisionAction(input),
  undoPassAction: (input: unknown) => undoPassAction(input),
  loadSlatePageAction: () => Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: (companyId: string, mediaAssetId: string) =>
    authorisePlaybackAction(companyId, mediaAssetId),
}));
vi.mock("../src/features/company/profile-actions", () => ({
  downloadDeckAction: (companyId: string) => downloadDeckAction(companyId),
}));
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: () =>
    Promise.resolve({ ok: false, message: "", retryable: false }),
}));
vi.mock("../src/features/company/explanation-action", () => ({
  explainRecommendationAction: () =>
    Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: () => undefined }),
  useQMomentSource: () => undefined,
}));

const { CompanyAvatarLink } =
  await import("../src/features/company/company-avatar");
const { CompanyProfileView, moneyText } =
  await import("../src/features/company/company-profile-view");

configure({ asyncUtilTimeout: 8000 });

// jsdom has no matchMedia; the player asks it about reduced motion.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

const COMPANY_ID = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const VIDEO_A = "38579af4-cfa2-4fd8-9381-d9f562768c03";
const VIDEO_B = "48579af4-cfa2-4fd8-9381-d9f562768c04";

function video(mediaAssetId: string, title: string | null) {
  return {
    mediaAssetId,
    aspectRatio: "9:16",
    durationSeconds: 75,
    captionState: "NOT_REQUESTED" as const,
    title,
  };
}

function investorProfile(
  overrides: Partial<CompanyProfileDto> = {},
): CompanyProfileDto {
  return {
    viewer: "INVESTOR",
    companyId: COMPANY_ID,
    canonicalName: "Kivu Grid",
    shortDescription: "Batteries for clinics.",
    currentStageCode: "seed",
    headquartersCountry: "NG",
    headquartersCity: "Lagos",
    photoUrl: null,
    overview: {
      legalName: "Kivu Grid Ltd",
      websiteUrl: "https://kivu.example",
      foundedDate: "2024-01-10",
      primaryDescription: "Grid-edge storage for clinics.",
      sectorNodeIds: [],
      raise: { amount: "1500000.00", currency: "USD" },
      organisationVerified: true,
      facts: [],
      deck: { title: "Kivu seed deck", sharedAt: "2026-09-30T10:00:00.000Z" },
      team: [
        {
          name: "Ada Obi",
          relationshipType: "team_member",
          businessTitle: "CEO",
          isFounder: true,
          shortBio: "Built grid storage at two utilities.",
        },
        {
          name: "Kemi Ade",
          relationshipType: "advisor",
          businessTitle: null,
          isFounder: false,
          shortBio: null,
        },
      ],
    },
    videos: [video(VIDEO_A, "The pitch"), video(VIDEO_B, null)],
    ...overrides,
  };
}

const FOUNDER_VIEW: CompanyProfileDto = {
  ...investorProfile(),
  viewer: "FOUNDER",
  overview: null,
  videos: [video(VIDEO_B, "Open to the network")],
};

function renderProfile(
  profile: CompanyProfileDto,
  tab: "overview" | "videos" = "overview",
) {
  return render(
    <CompanyProfileView
      profile={profile}
      tab={profile.overview === null ? "videos" : tab}
      interest={null}
      connected={false}
      sectorLabels={["Energy storage"]}
    />,
  );
}

beforeEach(() => {
  recordDecisionAction.mockReset();
  undoPassAction.mockReset();
  authorisePlaybackAction.mockReset();
  downloadDeckAction.mockReset();
  authorisePlaybackAction.mockResolvedValue({ ok: false, message: "no" });
});
afterEach(cleanup);

describe("the avatar over a Discover pitch", () => {
  it("is a 44px link into the profile, named for the company, with a plain mark until a photo loads", () => {
    const { container } = render(
      <CompanyAvatarLink companyId={COMPANY_ID} companyName="Kivu Grid" />,
    );
    const link = screen.getByRole("link", { name: "Open Kivu Grid profile" });
    expect(link.getAttribute("href")).toBe(`/company/${COMPANY_ID}`);
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("min-w-11");
    const avatar = container.querySelector("[data-company-avatar]");
    expect(avatar?.getAttribute("data-company-avatar")).toBe("mark");
    // No initials, no generated decoration: the only text is the name.
    expect(link.textContent).toBe("");
    // The photo is asked for lazily, through the redirect route.
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`/api/company-photo/${COMPANY_ID}`);
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("keeps the mark when the photo cannot be shown", () => {
    const { container } = render(
      <CompanyAvatarLink companyId={COMPANY_ID} companyName="Kivu Grid" />,
    );
    const img = container.querySelector("img");
    if (img === null) throw new Error("expected the photo request");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container
        .querySelector("[data-company-avatar]")
        ?.getAttribute("data-company-avatar"),
    ).toBe("mark");
  });
});

describe("the profile, for an investor", () => {
  it("has Overview and Videos, the dossier, and the decisions", () => {
    renderProfile(investorProfile());
    expect(
      screen.getByRole("heading", { level: 1, name: "Kivu Grid" }),
    ).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "Kivu Grid profile" });
    expect(tabs.textContent).toContain("Overview");
    expect(tabs.textContent).toContain("Videos");
    expect(
      screen
        .getByRole("link", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("USD 1,500,000")).toBeTruthy();
    expect(screen.getByText("Energy storage")).toBeTruthy();
    expect(
      screen.getAllByText("Organisation verified by Capital Q").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Download pitch deck/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Express interest/i }),
    ).toBeTruthy();
  });

  it("keeps Pass neutral, optimistic and undoable", async () => {
    recordDecisionAction.mockResolvedValue({ ok: true, value: {} });
    undoPassAction.mockResolvedValue({ ok: true, value: {} });
    renderProfile(investorProfile());
    const pass = screen.getByRole("button", { name: "Pass" });
    expect(pass.getAttribute("data-variant")).not.toBe("danger");
    fireEvent.click(pass);
    // Optimistic: said before the server answers.
    expect(screen.getByRole("status").textContent).toBe("Passed on Kivu Grid");
    await waitFor(() => {
      expect(recordDecisionAction).toHaveBeenCalledTimes(1);
    });
    expect(recordDecisionAction.mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      intent: "PASS",
      surface: "COMPANY_PROFILE",
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
    });
    expect(undoPassAction.mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      surface: "COMPANY_PROFILE",
    });
  });

  it("says a deck and a raise were not shared, never that they do not exist", () => {
    const base = investorProfile();
    if (base.overview === null) throw new Error("expected an overview");
    renderProfile({
      ...base,
      overview: { ...base.overview, raise: null, deck: null },
    });
    expect(screen.getAllByText("Not shared with you")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /Download pitch deck/ }),
    ).toBeNull();
  });

  it("formats money from its decimal string without a float", () => {
    expect(moneyText({ amount: "1500000.00", currency: "USD" })).toBe(
      "USD 1,500,000",
    );
    expect(moneyText({ amount: "250000.50", currency: "NGN" })).toBe(
      "NGN 250,000.50",
    );
  });
});

describe("the team (ADR 0041)", () => {
  it("lists names, declared roles in words and short bios for an investor", () => {
    renderProfile(investorProfile());
    const team = screen.getByRole("region", { name: "Team" });
    expect(team.textContent).toContain("Ada Obi");
    expect(team.textContent).toContain("Founder · CEO");
    expect(team.textContent).toContain("Built grid storage at two utilities.");
    expect(team.textContent).toContain("Advisor");
  });

  it("shows no team section when none is shown to this reader", () => {
    const base = investorProfile();
    if (base.overview === null) throw new Error("expected an overview");
    renderProfile({ ...base, overview: { ...base.overview, team: [] } });
    expect(screen.queryByRole("region", { name: "Team" })).toBeNull();
  });
});

describe("the profile, for a founder viewing another company", () => {
  it("shows identity and the videos tab only: no overview, deck, raise or actions", () => {
    const { container } = renderProfile(FOUNDER_VIEW);
    expect(
      screen.getByRole("heading", { level: 1, name: "Kivu Grid" }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Videos/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: /interest/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deck/i })).toBeNull();
    expect(container.textContent).not.toContain("Raising");
    expect(container.textContent).not.toContain("1,500,000");
    expect(container.querySelector("[data-profile-actions]")).toBeNull();
    expect(container.querySelector("[data-profile-team]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Play Open to the network" }),
    ).toBeTruthy();
  });
});

describe("the Videos tab", () => {
  it("signs nothing until Play, then exactly the pressed video, one player at a time", async () => {
    const { container } = renderProfile(investorProfile(), "videos");
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(2);
    expect(authorisePlaybackAction).not.toHaveBeenCalled();
    expect(container.querySelector("video")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play The pitch" }));
    await waitFor(() => {
      expect(authorisePlaybackAction).toHaveBeenCalledWith(COMPANY_ID, VIDEO_A);
    });
    expect(
      authorisePlaybackAction.mock.calls.every(([, id]) => id === VIDEO_A),
    ).toBe(true);

    // Playing the second replaces the first: never two players.
    fireEvent.click(screen.getByRole("button", { name: "Play Video 2" }));
    await waitFor(() => {
      expect(authorisePlaybackAction).toHaveBeenCalledWith(COMPANY_ID, VIDEO_B);
    });
    expect(
      container.querySelectorAll("[data-company-pitch]").length,
    ).toBeLessThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Play The pitch" })).toBeTruthy();
  });
});
