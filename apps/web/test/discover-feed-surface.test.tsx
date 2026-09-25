// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoveredCompanyDto } from "@capital-q/contracts";

/**
 * The Discover feed surface (CQ-WEB-022).
 *
 * The controller and the player already have their own suites; this is
 * about the surface composed from them — that a card shows what was
 * declared and nothing resembling a score, that the keyboard drives the
 * same controller the buttons do, that Save and Pass each reach the
 * transport exactly once, and that Ask Q names the card as the subject.
 *
 * The server actions are mocked at the module boundary: they are
 * `"use server"` files and calling the real ones would need a session, an
 * API and a network.
 */

/**
 * Typed doubles.
 *
 * The signatures are not decoration: an untyped `vi.fn()` returns `any`,
 * and the wrappers below would then quietly hand `any` to the component
 * under test — which is the one place a test must not be looser than the
 * code it checks.
 */
type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const loadSlatePageAction =
  vi.fn<(cursor: string | null) => Promise<ActionResult<unknown>>>();
const recordDecisionAction =
  vi.fn<(input: unknown) => Promise<ActionResult<unknown>>>();
const authorisePlaybackAction =
  vi.fn<
    (companyId: string, mediaAssetId: string) => Promise<ActionResult<unknown>>
  >();
const setOpen = vi.fn<(open: boolean) => void>();
const declaredSubjects: unknown[] = [];

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  loadSlatePageAction: (cursor: string | null) => loadSlatePageAction(cursor),
  recordDecisionAction: (input: unknown) => recordDecisionAction(input),
}));

type InterestResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryable: boolean;
    };
const expressInterestAction =
  vi.fn<(input: unknown) => Promise<InterestResult>>();

vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: (input: unknown) => expressInterestAction(input),
}));

vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: (companyId: string, mediaAssetId: string) =>
    authorisePlaybackAction(companyId, mediaAssetId),
}));

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen }),
}));

vi.mock("@/features/q/q-subject", () => ({
  QPageSubject: ({ subject }: { subject: unknown }) => {
    declaredSubjects.push(subject);
    return null;
  },
}));

const { InvestorFeedScreen } =
  await import("../src/features/discover/investor-feed-screen");
const { FeedCard } = await import("../src/features/discover/feed-card");

/**
 * This suite runs on a shared machine alongside other agents' work, where
 * a render that takes 60ms alone can take several seconds under load. The
 * default one-second budget for `findBy*`/`waitFor` then expires before
 * React has committed, which reads as a failure and is not one. Raising
 * the budget weakens nothing: every expectation below is unchanged, it is
 * only allowed to arrive late.
 */
configure({ asyncUtilTimeout: 8000 });

/**
 * Clicks go through `fireEvent`, not `userEvent`.
 *
 * `userEvent` drives a pointer state machine bound to the document, and
 * across nineteen tests sharing one jsdom it proved order-dependent here:
 * a click would be swallowed and the handler never ran. These are plain
 * buttons, so a dispatched click is the whole interaction and there is
 * nothing userEvent would additionally prove.
 */
const SLATE_ID = "11111111-1111-4111-8111-111111111111";

function companyId(n: number): string {
  return `0000000${n}-0000-4000-8000-000000000000`;
}

function company(
  n: number,
  overrides: Partial<DiscoveredCompanyDto> = {},
): DiscoveredCompanyDto {
  return {
    companyId: companyId(n),
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: "GB",
    currentStageCode: "SEED",
    shortDescription: `What company ${n} does.`,
    reasons: [{ kind: "STAGE_IN_RANGE", detail: "Seed, as you declared" }],
    reasonCodes: ["STAGE_IN_RANGE"],
    pitch: null,
    ...overrides,
  };
}

function slate(companies: readonly number[], nextCursor: string | null = null) {
  return {
    ok: true as const,
    value: {
      slateId: SLATE_ID,
      rankingVersion: "declared.v1",
      items: companies.map((n) => company(n)),
      notes: [],
      nextCursor,
    },
  };
}

beforeEach(() => {
  /**
   * The controller remembers where the reader was, in `sessionStorage`,
   * keyed by slate. One jsdom is shared by every test in this file and
   * they all use the same slate id, so without this each test would
   * restore the card the previous one finished on -- the feature working
   * exactly as designed, and a test reading the wrong card because of it.
   */
  window.sessionStorage.clear();

  loadSlatePageAction.mockReset();
  recordDecisionAction.mockReset();
  expressInterestAction.mockReset();
  authorisePlaybackAction.mockReset();
  setOpen.mockReset();
  declaredSubjects.length = 0;

  loadSlatePageAction.mockResolvedValue(slate([1, 2, 3]));
  recordDecisionAction.mockResolvedValue({
    ok: true,
    value: {
      recorded: true,
      deduplicated: false,
      state: { saved: true, passed: false },
    },
  });
});

/**
 * Unmount before the next test mounts.
 *
 * The feed listens for keys on `window`, so a tree left mounted between
 * tests would still answer them and the next test would start on a card it
 * did not choose. Auto-cleanup should cover this; doing it explicitly
 * means the suite does not depend on that being configured.
 */
afterEach(() => {
  cleanup();
});

async function renderFeed() {
  const view = render(<InvestorFeedScreen />);
  await screen.findByRole("heading", { name: "Company 1" });
  return view;
}

/** The feed owns its keys; they are not dispatched at the window. */
function feedRegion(): HTMLElement {
  return screen.getByRole("group", { name: "Companies to review" });
}

describe("a card", () => {
  it("shows what was declared, and nothing that reads as a score", () => {
    const { container } = render(
      <FeedCard
        company={company(1)}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
    expect(screen.getByText("What company 1 does.")).toBeTruthy();
    expect(screen.getByText("Seed, as you declared")).toBeTruthy();

    // No percentage, no "match", no score, anywhere in the rendered card.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/score/i);
    expect(text).not.toMatch(/\bmatch\b/i);
    expect(text).not.toMatch(/top pick|hot|trending/i);
  });

  it("reads a slate's alignment codes when the item carries no reasons (CQ-ACCEPT-001)", () => {
    const { container } = render(
      <FeedCard
        company={company(1, {
          headquartersCountry: "NG",
          currentStageCode: "pre_seed",
          reasons: [],
          reasonCodes: ["STAGE_ALIGNED", "GEOGRAPHY_MISMATCH"],
        })}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    expect(screen.getByText("Pre-seed, in your range")).toBeTruthy();
    expect(screen.getByText("Nigeria · Pre-seed")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/nothing declared in common/);
    // Missingness and mismatch are never shown as a reason.
    expect(text).not.toMatch(/mismatch/i);
  });

  it("says plainly when there is no pitch, and shows no player", () => {
    const { container } = render(
      <FeedCard
        company={company(1)}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    expect(screen.getByText(/No pitch video yet/i)).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
    // No empty frame held open for a video that does not exist: the
    // company leads (CQ-ACCEPT-001).
    expect(container.querySelector('[style*="aspect-ratio"]')).toBeNull();
  });

  it("keeps Pass neutral -- never the danger variant", () => {
    render(
      <FeedCard
        company={company(1)}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    const pass = screen.getByRole("button", { name: "Pass" });
    expect(pass.dataset["variant"]).toBe("quiet");
    expect(pass.dataset["variant"]).not.toBe("danger");
  });

  it("states saved in words, not by appearance alone", () => {
    render(
      <FeedCard
        company={company(1)}
        policy="ACTIVE"
        reducedMotion={false}
        saved={true}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    const save = screen.getByRole("button", { name: "Saved" });
    expect(save.getAttribute("aria-pressed")).toBe("true");
  });

  it("links to the company profile", () => {
    render(
      <FeedCard
        company={company(1)}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open company" }).getAttribute("href"),
    ).toBe(`/company/${companyId(1)}`);
  });
});

describe("moving through the feed", () => {
  it("advances and retreats on the arrow keys", async () => {
    await renderFeed();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    });
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowUp" });
    });
    expect(
      await screen.findByRole("heading", { name: "Company 1" }),
    ).toBeTruthy();
  });

  it("accepts j and k as well", async () => {
    await renderFeed();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "j" });
    });
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "k" });
    });
    expect(
      await screen.findByRole("heading", { name: "Company 1" }),
    ).toBeTruthy();
  });

  it("makes no request when the reader moves -- viewing is not interest", async () => {
    await renderFeed();
    const loadsAfterFirstPage = loadSlatePageAction.mock.calls.length;

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    });
    await screen.findByRole("heading", { name: "Company 2" });

    expect(recordDecisionAction).not.toHaveBeenCalled();
    expect(loadSlatePageAction.mock.calls.length).toBe(loadsAfterFirstPage);
  });

  it("leaves typing alone", async () => {
    await renderFeed();
    // A field inside the feed region, so the key really does reach the
    // feed's own handler and is turned away by the guard rather than by
    // never arriving.
    const input = document.createElement("input");
    feedRegion().appendChild(input);
    try {
      input.focus();
      act(() => {
        fireEvent.keyDown(input, { key: "j" });
      });

      // Still on the first card: the keystroke belonged to the field.
      expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
    } finally {
      input.remove();
    }
  });

  it("offers explicit Previous and Next as well as the gesture", async () => {
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Next company" }));
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();
  });
});

describe("deciding", () => {
  it("records a save once, optimistically", async () => {
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(recordDecisionAction).toHaveBeenCalledTimes(1));
    expect(recordDecisionAction.mock.calls[0]?.[0]).toMatchObject({
      companyId: companyId(1),
      intent: "SAVE",
      slateId: SLATE_ID,
    });
    expect(await screen.findByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("records a pass once and moves on", async () => {
    recordDecisionAction.mockResolvedValue({
      ok: true,
      value: {
        recorded: true,
        deduplicated: false,
        state: { saved: false, passed: true },
      },
    });
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Pass" }));

    await waitFor(() => expect(recordDecisionAction).toHaveBeenCalledTimes(1));
    expect(recordDecisionAction.mock.calls[0]?.[0]).toMatchObject({
      companyId: companyId(1),
      intent: "PASS",
    });
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();
  });

  it("puts a rejected save back", async () => {
    recordDecisionAction.mockResolvedValue({
      ok: false,
      message: "That did not save. Try again.",
    });
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save" })
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
  });
});

describe("Express Interest (CQ-NET-010)", () => {
  const INTEREST = {
    interestId: "22222222-2222-4222-8222-222222222222",
    relationshipId: "33333333-3333-4333-8333-333333333333",
    companyId: companyId(1),
    status: "EXPRESSED" as const,
    expressedAt: "2026-09-24T10:00:00.000Z",
  };

  /** A promise the test resolves, so the pending state can be observed. */
  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  async function confirmInterest() {
    fireEvent.click(screen.getByRole("button", { name: "Express interest" }));
    // Doc 17 §70: the consequence is stated before it happens.
    expect(
      await screen.findByText(/It is not a commitment to invest\./),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Express interest" }));
  }

  it("asks first, then shows sending, and says sent only when the server confirms", async () => {
    const answer = deferred<InterestResult>();
    expressInterestAction.mockReturnValue(answer.promise);
    await renderFeed();

    await confirmInterest();

    expect(
      await screen.findByRole("button", { name: "Sending interest…" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Interest expressed/)).toBeNull();
    expect(expressInterestAction).toHaveBeenCalledTimes(1);
    expect(expressInterestAction.mock.calls[0]?.[0]).toMatchObject({
      companyId: companyId(1),
      surface: "RECOMMENDATION_FEED",
    });

    await act(async () => {
      answer.resolve({
        ok: true,
        value: { interest: INTEREST, deduplicated: false },
      });
      await answer.promise;
    });

    expect(
      await screen.findByText("Interest expressed in Company 1."),
    ).toBeTruthy();
    // Interest is not a Save: the optimistic decision path never ran.
    expect(recordDecisionAction).not.toHaveBeenCalled();
  });

  it("says plainly when interest was already expressed", async () => {
    expressInterestAction.mockResolvedValue({
      ok: true,
      value: { interest: INTEREST, deduplicated: true },
    });
    await renderFeed();

    await confirmInterest();

    expect(
      await screen.findByText(
        "Your organisation has already expressed interest in Company 1.",
      ),
    ).toBeTruthy();
  });

  it("shows a refusal honestly and never claims it was sent", async () => {
    expressInterestAction.mockResolvedValue({
      ok: false,
      message:
        "Only a member of an investor organisation can express interest.",
      retryable: false,
    });
    await renderFeed();

    await confirmInterest();

    expect(
      await screen.findByText(
        "Only a member of an investor organisation can express interest.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Interest expressed/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("retries a failed send with the same idempotency key", async () => {
    expressInterestAction
      .mockResolvedValueOnce({
        ok: false,
        message: "Your interest was not sent. Try again.",
        retryable: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { interest: INTEREST, deduplicated: false },
      });
    await renderFeed();

    await confirmInterest();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Interest expressed in Company 1."),
    ).toBeTruthy();
    expect(expressInterestAction).toHaveBeenCalledTimes(2);
    const keys = expressInterestAction.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("is not sent by Save or Pass", async () => {
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recordDecisionAction).toHaveBeenCalledTimes(1));

    expect(expressInterestAction).not.toHaveBeenCalled();
  });
});

describe("Ask Q", () => {
  it("names the active card as Q's subject", async () => {
    await renderFeed();

    expect(declaredSubjects.at(-1)).toEqual({
      kind: "COMPANY",
      companyId: companyId(1),
      label: "Company 1",
      scope: "network_visible",
    });
  });

  it("follows the reader to the next card", async () => {
    await renderFeed();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    });
    await screen.findByRole("heading", { name: "Company 2" });

    expect(declaredSubjects.at(-1)).toMatchObject({
      kind: "COMPANY",
      companyId: companyId(2),
      label: "Company 2",
    });
  });

  it("opens the global Q sheet", async () => {
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "Ask Q" }));

    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(true));
  });
});

describe("company profile, then Back", () => {
  it("restores the same card the reader left from", async () => {
    await renderFeed();

    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    });
    await screen.findByRole("heading", { name: "Company 2" });

    // Opening the profile is a navigation: this tree goes away.
    cleanup();

    // Back to /discover mounts a fresh feed against the same slate. The
    // position was persisted by card id, not by index, so the restore
    // survives even though nothing about the list was kept.
    render(<InvestorFeedScreen />);

    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();
  });

  it("starts at the top when the slate is a different one", async () => {
    await renderFeed();
    act(() => {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    });
    await screen.findByRole("heading", { name: "Company 2" });
    cleanup();

    loadSlatePageAction.mockResolvedValue({
      ok: true,
      value: {
        slateId: "99999999-9999-4999-8999-999999999999",
        rankingVersion: "declared.v1",
        items: [company(1), company(2), company(3)],
        notes: [],
        nextCursor: null,
      },
    });
    render(<InvestorFeedScreen />);

    expect(
      await screen.findByRole("heading", { name: "Company 1" }),
    ).toBeTruthy();
  });
});

describe("the founder view is untouched", () => {
  it("still renders investors as a plain server list", async () => {
    const { DiscoverInvestors } =
      await import("../src/features/discover/discover-screen");

    render(
      <DiscoverInvestors
        items={[
          {
            investorOrganisationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            displayName: "Northbank Capital",
            investorType: "VC",
            websiteUrl: null,
            hqCountry: "GB",
            publicDescription: "Seed and Series A.",
            deploymentState: null,
            reasons: [],
          },
        ]}
        notes={[]}
      />,
    );

    // A list entry, not a feed card: no player, no Save, no Pass.
    expect(
      screen.getByRole("heading", { name: "Northbank Capital" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });
});

describe("degraded and empty states", () => {
  it("states a refresh calmly, with no error tone", async () => {
    loadSlatePageAction.mockResolvedValue({
      ok: true,
      value: {
        slateId: null,
        rankingVersion: "declared.v1",
        items: [],
        notes: ["RECOMMENDATIONS_REFRESHING"],
        nextCursor: null,
      },
    });

    render(<InvestorFeedScreen />);

    const note = await screen.findByText(/being prepared/i);
    expect(note.className).toContain("cq-status-line");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nobody is discoverable yet without blaming the reader", async () => {
    loadSlatePageAction.mockResolvedValue({
      ok: true,
      value: {
        slateId: null,
        rankingVersion: "declared.v1",
        items: [],
        notes: ["NO_DISCOVERABLE_COUNTERPARTS"],
        nextCursor: null,
      },
    });

    render(<InvestorFeedScreen />);

    expect(
      await screen.findByText(/as founders choose to be found/i),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing to review yet/i)).toBeTruthy();
  });

  it("says a mandate is missing without calling it an error", async () => {
    loadSlatePageAction.mockResolvedValue({
      ok: true,
      value: {
        slateId: null,
        rankingVersion: "declared.v1",
        items: [],
        notes: ["NO_ACTIVE_MANDATE"],
        nextCursor: null,
      },
    });

    render(<InvestorFeedScreen />);

    expect(await screen.findByText(/mandate isn't active yet/i)).toBeTruthy();
    // The way forward, not a claim about the market (CQ-ACCEPT-001).
    expect(
      screen
        .getByRole("link", { name: "Finish my mandate" })
        .getAttribute("href"),
    ).toBe("/onboarding/investor");
    expect(screen.queryByText(/founders choose to be discoverable/i)).toBe(
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Q" }));
    expect(setOpen).toHaveBeenCalledWith(true);
  });
});
