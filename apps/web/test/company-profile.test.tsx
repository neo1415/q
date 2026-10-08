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

// The router's search params follow history, as Next.js's do for a
// shallow pushState (and for Back and Forward).
const locationListeners = new Set<() => void>();
vi.mock("next/navigation", async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original<typeof import("next/navigation")>()),
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (listener) => {
            locationListeners.add(listener);
            return () => locationListeners.delete(listener);
          },
          () => window.location.search,
        ),
      ),
  };
});
const { ProfileTabs } = await import("../src/features/company/profile-tabs");

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
      pitchClaims: [],
      raiseFromPitch: null,
      pitchRaiseNotice: null,
      deck: {
        title: "Kivu seed deck",
        sharedAt: "2026-09-30T10:00:00.000Z",
        scanned: true,
      },
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
  tab: "overview" | "elevator" = "overview",
) {
  return render(
    <CompanyProfileView
      profile={profile}
      tab={profile.overview === null ? "elevator" : tab}
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
    // The shared EntityAvatar, company-shaped: its plain mark until loaded.
    const avatar = container.querySelector('[data-entity-avatar="company"]');
    expect(avatar?.getAttribute("data-entity-avatar-state")).toBe("fallback");
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
        .querySelector('[data-entity-avatar="company"]')
        ?.getAttribute("data-entity-avatar-state"),
    ).toBe("fallback");
  });
});

describe("the profile, for an investor", () => {
  it("has Overview, Elevator, Data room, Pitch deck and Team, the dossier, and the decisions", () => {
    renderProfile(investorProfile());
    expect(
      screen.getByRole("heading", { level: 1, name: "Kivu Grid" }),
    ).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "Kivu Grid profile" });
    expect(tabs.textContent).toContain("Overview");
    expect(tabs.textContent).toContain("Elevator");
    for (const name of ["Data room", "Pitch deck", "Team"]) {
      expect(tabs.textContent).toContain(name);
    }
    expect(
      screen
        .getByRole("link", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    // Short in the summary strip, exact under The raise.
    expect(
      document.querySelector("[data-profile-key-facts]")?.textContent,
    ).toContain("$1.5M");
    expect(screen.getAllByText("USD 1,500,000")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "In their words" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Energy storage").length).toBeGreaterThan(0);
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

  it("keeps Interest and Pass alone in the decision row and folds the details on a phone (design-48)", () => {
    renderProfile(investorProfile());
    const row = document.querySelector("[data-profile-actions]");
    const buttons = [...(row?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent,
    );
    expect(buttons.some((text) => /deck/i.test(text ?? ""))).toBe(false);
    const fold = document.querySelector(
      "details[data-overview-fold=company-details]",
    );
    expect(fold?.hasAttribute("open")).toBe(false);
    expect(
      screen.getByRole("heading", { name: "Company details" }),
    ).toBeTruthy();
  });

  it("ADR 0042: an unscanned deck says 'Not virus-scanned yet' beside its download; a scanned one does not", () => {
    const base = investorProfile();
    const overview = base.overview;
    if (overview === null || overview.deck === null) throw new Error("fixture");
    const { unmount } = renderProfile(
      investorProfile({
        overview: { ...overview, deck: { ...overview.deck, scanned: false } },
      }),
    );
    expect(screen.getByText("Not virus-scanned yet")).toBeTruthy();
    unmount();
    renderProfile(investorProfile());
    expect(screen.queryByText("Not virus-scanned yet")).toBeNull();
  });

  it("keeps Pass neutral, optimistic and undoable", async () => {
    recordDecisionAction.mockResolvedValue({ ok: true, value: {} });
    undoPassAction.mockResolvedValue({ ok: true, value: {} });
    renderProfile(investorProfile());
    const pass = screen.getByRole("button", { name: "Pass" });
    expect(pass.getAttribute("data-variant")).not.toBe("danger");
    // A 44px target, like the profile's other actions (QA sweep 2026-10-03).
    expect(pass.className).toContain("min-h-11");
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
    expect(screen.getByRole("button", { name: "Undo" }).className).toContain(
      "min-h-11",
    );
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

  it("in diligence, turns 'not shared' into a next step and names what was shared there", () => {
    const base = investorProfile();
    if (base.overview === null) throw new Error("expected an overview");
    render(
      <CompanyProfileView
        profile={{
          ...base,
          overview: { ...base.overview, raise: null, deck: null },
        }}
        tab="overview"
        interest={null}
        connected={true}
        sectorLabels={["Energy storage"]}
        diligence={{
          href: "/relationships/company/x#diligence",
          titles: ["Cap table"],
        }}
      />,
    );
    expect(screen.queryByText("Not shared with you")).toBeNull();
    expect(screen.getAllByText("Not shared with you yet")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "Ask in diligence" }),
    ).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Cap table" })).toBeTruthy();
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
      screen
        .getByRole("link", { name: /Elevator/ })
        .getAttribute("aria-current"),
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

describe("the Elevator tab (A2: replaces Videos)", () => {
  it("signs nothing until Play, then exactly the pressed video, one player at a time", async () => {
    const { container } = renderProfile(investorProfile(), "elevator");
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

/**
 * The overview declutter and the pitch as a source (founder, 2026-10-08):
 * every section is a closed fold that still says what is inside, and the
 * raise said in a pitch is shown as said there, with its moment.
 */
const PITCH_ID = "00000000-0000-4000-8000-0000000a0001";
const saidRaise = {
  kind: "RAISE" as const,
  statement: "served. We're raising a $4 million seed.",
  pitchId: PITCH_ID,
  pitchTitle: null,
  atSeconds: 43,
  money: { amount: "4000000", currency: "USD" },
  stageCode: "seed",
  instrument: null,
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  source: "PITCH_VIDEO" as const,
};
const traction = {
  ...saidRaise,
  kind: "TRACTION" as const,
  statement: "31 million requests served",
  atSeconds: 38,
  money: null,
  stageCode: null,
};

function withPitch(
  overview: Partial<NonNullable<CompanyProfileDto["overview"]>>,
  viewer: CompanyProfileDto["viewer"] = "INVESTOR",
): CompanyProfileDto {
  const base = investorProfile();
  if (base.overview === null) throw new Error("fixture has an overview");
  return {
    ...base,
    viewer,
    overview: { ...base.overview, raise: null, ...overview },
  };
}

describe("the overview, decluttered, with what the pitch says", () => {
  it("shows the raise as said in the pitch, with the moment, where the raise is not shared", () => {
    renderProfile(
      withPitch({
        raiseFromPitch: saidRaise,
        pitchClaims: [saidRaise, traction],
      }),
    );
    const strip = document.querySelector("[data-profile-key-facts]");
    expect(strip?.textContent).toContain("$4M seed");
    expect(strip?.textContent).toContain("Said in their pitch, 0:43");
    expect(strip?.textContent).not.toContain("Not shared");
    const quote = document.querySelector("blockquote[data-pitch-claim=RAISE]");
    expect(quote?.textContent).toContain("raising a $4 million seed");
    expect(quote?.textContent).toContain("0:43");
    expect(quote?.textContent).toContain("own claim, self-reported");
    expect(
      document.querySelector("li[data-pitch-claim=TRACTION]")?.textContent,
    ).toContain("31 million requests served · said at 0:38");
  });

  it("still says not shared when there is no raise from the pitch (unknown stays unknown)", () => {
    renderProfile(withPitch({ raiseFromPitch: null, pitchClaims: [] }));
    const strip = document.querySelector("[data-profile-key-facts]");
    expect(strip?.textContent).toContain("Not shared");
    expect(
      document.querySelector("[data-overview-fold=company-traction]")
        ?.textContent,
    ).toContain("Nothing stated in their pitch yet");
  });

  it("folds every section, closed, each with a one-line summary", () => {
    renderProfile(withPitch({ raiseFromPitch: saidRaise }));
    const folds = [...document.querySelectorAll("details[data-overview-fold]")];
    expect(
      folds.map((fold) => fold.getAttribute("data-overview-fold")),
    ).toEqual([
      "company-raise",
      "company-traction",
      "company-team",
      "company-market",
      "company-unknowns",
      "company-details",
    ]);
    for (const fold of folds) {
      expect(fold.hasAttribute("open")).toBe(false);
      const line = fold.querySelector("summary p")?.textContent ?? "";
      expect(line.length).toBeGreaterThan(3);
    }
    expect(
      document.querySelector("[data-overview-fold=company-raise] summary p")
        ?.textContent,
    ).toBe("$4M seed, said in their pitch · deck shared with you");
  });

  it("tells the owner when their pitch says a raise the profile does not show", () => {
    renderProfile(
      withPitch(
        {
          pitchRaiseNotice: { state: "HIDDEN_BY_FOUNDER", said: saidRaise },
        },
        "OWNER",
      ),
    );
    const notice = document.querySelector(
      "[data-pitch-raise-notice=HIDDEN_BY_FOUNDER]",
    );
    expect(notice?.textContent).toContain(
      "Your pitch video says you’re raising $4M seed (0:43).",
    );
    expect(notice?.textContent).toContain("still hears it");
  });
});

describe("moving between a profile's tabs", () => {
  it("switches in place: a shallow URL, no request, the panel kept, Back works", async () => {
    const profile = investorProfile();
    const base = `/company/${profile.companyId}`;
    window.history.replaceState(null, "", base);
    const pushState = window.history.pushState.bind(window.history);
    const pushes: string[] = [];
    const spy = vi
      .spyOn(window.history, "pushState")
      .mockImplementation((state, unused, url) => {
        pushes.push(String(url));
        pushState(state, unused, url);
        for (const listener of locationListeners) listener();
      });
    const onPop = () => {
      for (const listener of locationListeners) listener();
    };
    window.addEventListener("popstate", onPop);
    const { container } = render(
      <ProfileTabs
        base={base}
        initial="overview"
        available={["overview", "elevator", "dataroom", "deck", "team"]}
      >
        <CompanyProfileView
          profile={profile}
          tab="overview"
          interest={null}
          connected={false}
          sectorLabels={["Energy storage"]}
          deck={null}
        />
      </ProfileTabs>,
    );
    const overview = container.querySelector("[data-profile-overview]");
    expect(overview).not.toBeNull();
    const team = container.querySelector<HTMLAnchorElement>(
      '[data-profile-tab="team"]',
    );
    expect(team?.getAttribute("href")).toBe(`${base}?tab=team`);
    if (team === null) throw new Error("no Team tab");
    fireEvent.click(team);

    // A shallow URL change, and the Team panel shown at once.
    expect(pushes).toEqual([`${base}?tab=team`]);
    expect(team.getAttribute("aria-current")).toBe("page");
    expect(
      container
        .querySelector('[data-profile-panel="team"]')
        ?.hasAttribute("hidden"),
    ).toBe(false);
    // The overview is the same element, kept and hidden, not rebuilt.
    expect(container.querySelector("[data-profile-overview]")).toBe(overview);
    expect(
      container
        .querySelector('[data-profile-panel="overview"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);

    // Back returns to the overview the same way.
    window.history.back();
    await waitFor(() =>
      expect(
        container
          .querySelector('[data-profile-panel="overview"]')
          ?.hasAttribute("hidden"),
      ).toBe(false),
    );
    expect(
      container
        .querySelector('[data-profile-tab="overview"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    window.removeEventListener("popstate", onPop);
    spy.mockRestore();
  });

  it("leaves a modified click (a new browser tab) to the browser", () => {
    const profile = investorProfile();
    const base = `/company/${profile.companyId}`;
    window.history.replaceState(null, "", base);
    const spy = vi.spyOn(window.history, "pushState");
    const { container } = render(
      <ProfileTabs
        base={base}
        initial="overview"
        available={["overview", "elevator", "dataroom", "deck", "team"]}
      >
        <CompanyProfileView
          profile={profile}
          tab="overview"
          interest={null}
          connected={false}
          sectorLabels={[]}
        />
      </ProfileTabs>,
    );
    const deck = container.querySelector('[data-profile-tab="deck"]');
    if (deck === null) throw new Error("no deck tab");
    fireEvent.click(deck, { metaKey: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
