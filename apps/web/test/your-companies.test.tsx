// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  YourCompaniesPageDto,
  YourCompanyPitchItemDto,
} from "@capital-q/contracts";

vi.mock("../src/features/discover/player/pitch-player", () => ({
  PitchPlayer: ({
    company,
    policy,
    hold,
  }: {
    company: { companyId: string };
    policy: string;
    hold: boolean;
  }) => (
    <div
      data-testid={`player-${company.companyId}`}
      data-policy={policy}
      data-hold={String(hold)}
    />
  ),
}));
vi.mock("../src/features/discover/player/hls-source", () => ({
  attachHlsOrNativeSource: () => () => undefined,
}));
vi.mock("../src/features/discover/feed/action-feed-transport", () => ({
  actionPlaybackSource: () => () => Promise.reject(new Error("not used")),
}));
const loads: (string | null)[] = [];
let served: YourCompaniesPageDto = { items: [], nextCursor: null };
vi.mock("../src/features/discover/feed/feed-actions", () => ({
  loadYourCompaniesAction: (cursor: string | null) => {
    loads.push(cursor);
    return Promise.resolve({ ok: true, value: served });
  },
}));
vi.mock("../src/features/q/q-subject", () => ({
  QPageSubject: ({ subject }: { subject: { companyId: string } }) => (
    <span data-testid="q-subject" data-company={subject.companyId} />
  ),
}));

const { YourCompaniesFeed, yourCompaniesPolicy } =
  await import("../src/features/discover/your-companies");
const { DiscoverTabs } = await import("../src/features/discover/discover-tabs");
const { setDiscoverTab } =
  await import("../src/features/discover/discover-tab");
const { recordPagePath } = await import("../src/features/q/client-actions");
const { destinationPath } = await import("../src/features/voice/destinations");

/**
 * Discover's two tabs (follow-55; founder decision 2026-10-04): "For you"
 * and "Your companies". Zino, connected with Nixo after a meeting, finds
 * Nixo in Your companies with its pitch; a company that has not shared
 * its pitch is a card that says so, never a broken player.
 */

const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const KAZIKIT = "c2000000-0000-4000-8000-000000000002";
const AJOPOT = "c2000000-0000-4000-8000-000000000003";
const item = (
  companyId: string,
  canonicalName: string,
  label: YourCompanyPitchItemDto["label"],
  shared = true,
): YourCompanyPitchItemDto => ({
  companyId,
  canonicalName,
  shortDescription: null,
  headquartersCountry: "NG",
  currentStageCode: "seed",
  label,
  readyAt: shared ? "2026-10-02T08:04:06.000Z" : null,
  activityAt: "2026-10-03T09:48:33.414Z",
  pitch: shared
    ? {
        mediaAssetId: "38579af4-cfa2-4fd8-9381-d9f562768c03",
        aspectRatio: "9:16",
        durationSeconds: 60,
        captionState: "NOT_REQUESTED",
        title: null,
      }
    : null,
});

beforeEach(() => {
  loads.length = 0;
  served = { items: [], nextCursor: null };
  window.history.replaceState(null, "", "/discover");
});
afterEach(() => {
  cleanup();
  act(() => setDiscoverTab("FOR_YOU"));
});

describe("Your companies feed", () => {
  it("one active player: the card in view plays, the next is a poster at most, the rest fetch nothing", () => {
    expect(yourCompaniesPolicy(0, 0)).toBe("ACTIVE");
    expect(yourCompaniesPolicy(1, 0)).toBe("POSTER");
    expect(yourCompaniesPolicy(2, 0)).toBe("NONE");
    expect(yourCompaniesPolicy(0, 1)).toBe("NONE");
  });

  it("shows Nixo with its pitch and label, and a company without a pitch it can show as 'No pitch to show yet' with its profile (unknown stays unknown)", () => {
    act(() => setDiscoverTab("YOURS"));
    render(
      <YourCompaniesFeed
        initial={{
          items: [
            item(NIXO, "Nixo", "CONNECTED"),
            item(KAZIKIT, "Kazikit", "INTERESTED", false),
            item(AJOPOT, "Ajopot", "SAVED"),
          ],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByTestId(`player-${NIXO}`).dataset["policy"]).toBe(
      "ACTIVE",
    );
    expect(screen.getByTestId(`player-${NIXO}`).dataset["hold"]).toBe("false");
    const kazikit = screen.getByRole("article", { name: "Kazikit" });
    expect(kazikit.textContent).toContain("No pitch to show yet");
    // Never claimed as withheld: the API cannot say a pitch exists.
    expect(kazikit.textContent).not.toContain("not shared");
    expect(kazikit.querySelector("[data-testid^='player-']")).toBeNull();
    expect(
      kazikit
        .querySelector("[data-your-company-profile]")
        ?.getAttribute("href"),
    ).toBe(`/company/${KAZIKIT}`);
    // Beyond the next card nothing is mounted, so nothing is fetched.
    expect(screen.queryByTestId(`player-${AJOPOT}`)).toBeNull();
    const labels = [
      ...document.querySelectorAll("[data-your-company-label]"),
    ].map((node) => node.textContent);
    expect(labels).toEqual(["Connected", "Interest expressed", "Saved"]);
    expect(screen.getByTestId("q-subject").dataset["company"]).toBe(NIXO);
  });

  it("holds its player and declares no subject while For you is showing", () => {
    render(
      <YourCompaniesFeed
        initial={{ items: [item(NIXO, "Nixo", "CONNECTED")], nextCursor: null }}
      />,
    );
    expect(screen.getByTestId(`player-${NIXO}`).dataset["hold"]).toBe("true");
    expect(screen.queryByTestId("q-subject")).toBeNull();
  });
});

describe("Discover's tabs", () => {
  it("For you first; Your companies is read only when first opened, and switching back keeps both", async () => {
    served = { items: [item(NIXO, "Nixo", "CONNECTED")], nextCursor: null };
    render(
      <DiscoverTabs
        initialTab="FOR_YOU"
        yoursInitial={null}
        focusCompanyId={null}
        forYou={<p data-testid="for-you">For you feed</p>}
      />,
    );
    const forYou = screen.getByRole("button", { name: "For you" });
    const yours = screen.getByRole("button", { name: "Your companies" });
    expect(forYou.getAttribute("aria-pressed")).toBe("true");
    expect(loads).toEqual([]);
    await userEvent.click(yours);
    expect(yours.getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?tab=yours");
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Nixo" })).toBeTruthy(),
    );
    expect(loads).toEqual([null]);
    // Both stay mounted; only the one showing is visible.
    expect(screen.getByTestId("for-you").closest("[hidden]")).not.toBeNull();
    await userEvent.click(forYou);
    expect(window.location.search).toBe("");
    expect(screen.getByTestId("for-you").closest("[hidden]")).toBeNull();
    expect(
      screen.getByRole("article", { name: "Nixo", hidden: true }),
    ).toBeTruthy();
    // Coming back reads nothing again.
    await userEvent.click(yours);
    expect(loads).toEqual([null]);
  });

  it("each tab is a control named in words, with the 44px tab class", () => {
    render(
      <DiscoverTabs
        initialTab="YOURS"
        yoursInitial={{ items: [], nextCursor: null }}
        focusCompanyId={null}
        forYou={<p>For you feed</p>}
      />,
    );
    for (const name of ["For you", "Your companies"]) {
      expect(
        screen
          .getByRole("button", { name })
          .classList.contains("cq-discover-tab"),
      ).toBe(true);
    }
    expect(screen.getByText("No companies here yet.")).toBeTruthy();
  });
});

describe("Q lands on the tab, or on that company's item", () => {
  it("'open my companies' and 'show me Nixo's pitch' deep-link into Your companies", () => {
    expect(destinationPath("YOUR_COMPANIES")).toBe("/discover?tab=yours");
    expect(recordPagePath("COMPANY_PITCH", NIXO)).toBe(
      `/discover?tab=yours&company=${NIXO}`,
    );
  });

  it("opens on the focused company's card", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.getAttribute("data-your-company") ?? "");
    };
    act(() => setDiscoverTab("YOURS"));
    render(
      <YourCompaniesFeed
        initial={{
          items: [
            item(AJOPOT, "Ajopot", "SAVED"),
            item(NIXO, "Nixo", "CONNECTED"),
          ],
          nextCursor: null,
        }}
        focusCompanyId={NIXO}
      />,
    );
    await waitFor(() => expect(scrolled).toEqual([NIXO]));
    expect(screen.getByTestId(`player-${NIXO}`).dataset["policy"]).toBe(
      "ACTIVE",
    );
  });
});
