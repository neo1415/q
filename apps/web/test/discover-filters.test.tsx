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
 * Discover filters in the browser (ux/discover-filters): the stored
 * convenience, Q's intent, the sheet and the row, and that a change of
 * filters restarts the feed from its first page. Server actions are
 * mocked at the module boundary, as in the feed surface suite.
 */

type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const loadSlatePageAction =
  vi.fn<
    (cursor: string | null, filters: unknown) => Promise<ActionResult<unknown>>
  >();

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  loadSlatePageAction: (cursor: string | null, filters: unknown = null) =>
    loadSlatePageAction(cursor, filters),
  recordDecisionAction: () => Promise.resolve({ ok: false, message: "no" }),
}));
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: () =>
    Promise.resolve({ ok: false, message: "no", retryable: false }),
}));
vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: () => Promise.resolve({ ok: false, message: "no" }),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: () => undefined }),
  useQMomentSource: () => undefined,
}));
vi.mock("@/features/q/q-subject", () => ({ QPageSubject: () => null }));

const { InvestorFeedScreen } =
  await import("../src/features/discover/investor-feed-screen");
const model = await import("../src/features/discover/filters/discover-filters");

configure({ asyncUtilTimeout: 8000 });

const SLATE_ID = "11111111-1111-4111-8111-111111111111";
const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";
const FINANCIAL = "31a21318-4936-5c6e-9e60-ed6b35c565b6";
const SECTORS = [
  {
    nodeId: FINANCIAL,
    code: "financial_services",
    label: "Financial Services",
    depth: 0,
  },
  { nodeId: FINTECH, code: "fintech", label: "Fintech", depth: 1 },
];

function company(
  n: number,
  overrides: Partial<DiscoveredCompanyDto> = {},
): DiscoveredCompanyDto {
  return {
    companyId: `0000000${n}-0000-4000-8000-000000000000`,
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: "NG",
    currentStageCode: "seed",
    shortDescription: `What company ${n} does.`,
    reasons: [],
    reasonCodes: [],
    pitch: null,
    ...overrides,
  };
}

function page(
  items: readonly DiscoveredCompanyDto[],
  notes: readonly string[] = [],
) {
  return {
    ok: true as const,
    value: {
      slateId: SLATE_ID,
      rankingVersion: "r.v1",
      items,
      notes,
      nextCursor: null,
    },
  };
}

const STORED = "cq.discover.filters.v1";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  loadSlatePageAction.mockReset();
  loadSlatePageAction.mockResolvedValue(page([company(1)]));
});
afterEach(() => {
  cleanup();
});

describe("the filter model", () => {
  it("stored filters are a convenience: garbage or a throwing store is no filters", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(model.readStoredFilters(throwing)).toEqual(
      model.NO_DISCOVER_FILTERS,
    );
    expect(() =>
      model.storeFilters(
        { ...model.NO_DISCOVER_FILTERS, hasPitch: true },
        throwing,
      ),
    ).not.toThrow();
    window.localStorage.setItem(STORED, "{not json");
    expect(model.readStoredFilters()).toEqual(model.NO_DISCOVER_FILTERS);
    window.localStorage.setItem(
      STORED,
      JSON.stringify({ countryCodes: ["Nigeria"] }),
    );
    expect(model.readStoredFilters()).toEqual(model.NO_DISCOVER_FILTERS);
  });

  it("Q's sector codes resolve against the listed vocabulary; an unknown one is reported, not guessed", () => {
    const { filters, unresolved } = model.filtersFromIntent(
      {
        kind: "SET_DISCOVER_FILTERS",
        sectorCodes: ["fintech", "spacetech"],
        stageCodes: [],
        countryCodes: ["NG"],
        raise: null,
        raiseDisclosedOnly: false,
        verifiedOnly: false,
        hasPitch: false,
      },
      SECTORS,
    );
    expect(filters.sectorNodeIds).toEqual([FINTECH]);
    expect(filters.countryCodes).toEqual(["NG"]);
    expect(unresolved).toEqual(["spacetech"]);
  });

  it("each active value is a removable chip, and the raise reads in words", () => {
    const filters = {
      ...model.NO_DISCOVER_FILTERS,
      countryCodes: ["NG"],
      raise: { min: "250000", max: "2000000", currency: "USD" },
    };
    const chips = model.activeFilterChips(filters, SECTORS);
    expect(chips.map((c) => c.label)).toEqual([
      "Nigeria",
      "USD 250,000–2,000,000",
    ]);
    expect(chips[0]?.without.countryCodes).toEqual([]);
    expect(model.activeDiscoverFilterCount(filters)).toBe(2);
  });
});

describe("Discover with filters", () => {
  it("a stored filter applies after hydration, from the first page, with its count on the button", async () => {
    window.localStorage.setItem(
      STORED,
      JSON.stringify({ ...model.NO_DISCOVER_FILTERS, countryCodes: ["NG"] }),
    );
    render(<InvestorFeedScreen sectors={SECTORS} />);
    await screen.findByRole("heading", { name: "Company 1" });
    await waitFor(() =>
      expect(loadSlatePageAction).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ countryCodes: ["NG"] }),
      ),
    );
    // The phone's button and the desktop row's, one of them shown by CSS.
    expect(
      screen.getAllByRole("button", { name: "Filters, 1 active" }).length,
    ).toBe(2);
    // The desktop row names the active value, removable.
    expect(
      screen.getByRole("button", { name: "Remove filter: Nigeria" }),
    ).toBeTruthy();
  });

  it("nothing matching says so and clears back to the unfiltered first page", async () => {
    window.localStorage.setItem(
      STORED,
      JSON.stringify({ ...model.NO_DISCOVER_FILTERS, verifiedOnly: true }),
    );
    loadSlatePageAction.mockImplementation((_cursor, filters) =>
      Promise.resolve(
        filters === null
          ? page([company(2)])
          : page([], ["NONE_MATCH_FILTERS"]),
      ),
    );
    render(<InvestorFeedScreen sectors={SECTORS} />);
    await screen.findByText("No companies match these filters.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("heading", { name: "Company 2" });
    expect(loadSlatePageAction).toHaveBeenLastCalledWith(null, null);
    expect(window.localStorage.getItem(STORED)).toBeNull();
  });

  it("the sheet edits a draft; Show companies restarts the feed under the new filters", async () => {
    render(<InvestorFeedScreen sectors={SECTORS} />);
    await screen.findByRole("heading", { name: "Company 1" });
    loadSlatePageAction.mockClear();
    const [phoneButton] = screen.getAllByRole("button", { name: "Filters" });
    if (phoneButton === undefined) throw new Error("no filter button");
    fireEvent.click(phoneButton);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(
      Array.from(sheet.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Has pitch video") === true,
      ) ?? sheet,
    );
    // A draft: nothing reloads until it is applied.
    expect(loadSlatePageAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show companies" }));
    await waitFor(() =>
      expect(loadSlatePageAction).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ hasPitch: true }),
      ),
    );
  });

  it("a card the filters could not check says which, and stays", async () => {
    loadSlatePageAction.mockResolvedValue(
      page([company(3, { filterUnknown: ["raise"] })]),
    );
    window.localStorage.setItem(
      STORED,
      JSON.stringify({
        ...model.NO_DISCOVER_FILTERS,
        raise: { max: "1000000", currency: "USD" },
      }),
    );
    render(<InvestorFeedScreen sectors={SECTORS} />);
    await screen.findByText("Raise not shared");
  });

  it("Q's set_discover_filters applies on an open Discover", async () => {
    render(<InvestorFeedScreen sectors={SECTORS} />);
    await screen.findByRole("heading", { name: "Company 1" });
    act(() => {
      model.queueDiscoverFiltersIntent({
        kind: "SET_DISCOVER_FILTERS",
        sectorCodes: ["fintech"],
        stageCodes: [],
        countryCodes: ["NG"],
        raise: null,
        raiseDisclosedOnly: false,
        verifiedOnly: false,
        hasPitch: false,
      });
    });
    await waitFor(() =>
      expect(loadSlatePageAction).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          sectorNodeIds: [FINTECH],
          countryCodes: ["NG"],
        }),
      ),
    );
    expect(
      window.localStorage.getItem("cq.discover.filters.pending.v1"),
    ).toBeNull();
  });
});
