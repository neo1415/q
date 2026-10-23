// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  IncomingInterestDto,
  InvestorGateFitDto,
  PublicCardDto,
} from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/search",
}));
vi.mock("../src/features/network/interest-actions", () => ({
  answerInterestAction: vi.fn(),
}));
vi.mock("../src/features/network/connection-actions", () => ({
  connectionStatusAction: vi.fn(() => new Promise(() => undefined)),
  requestConnectionAction: vi.fn(),
}));
vi.mock("../src/features/search/search-actions", () => ({
  searchPaletteAction: vi.fn(),
}));

import {
  InterestCards,
  whenWords,
  type InterestAnswerPort,
} from "../src/features/network/interest-cards";
import { InvestorDirectory } from "../src/features/investors/investor-directory";
import {
  dimensionMatches,
  focusLine,
  publishedMandate,
  reachOf,
} from "../src/features/investors/published-focus";
import {
  OPEN_SEARCH,
  withRecent,
  type RecentItem,
} from "../src/features/search/recent-opened";
import type { PaletteResult } from "../src/features/search/search-actions";
import {
  SearchPalette,
  durationWords,
} from "../src/features/search/search-palette";

/**
 * The chosen discovery designs (app prototypes 2026-10-21): what an
 * investor publishes is read honestly (unknown is never a no), interest is
 * answered only from the server's word, the directory filters what it was
 * given, and search opens as a palette with the rules Search always had.
 */
afterEach(cleanup);

const INVESTOR = "a1000000-0000-4000-8000-000000000001";

function gate(
  criteria: InvestorGateFitDto["criteria"],
  accepting = true,
): InvestorGateFitDto {
  return {
    investorOrganisationId: INVESTOR,
    publicId: "northbound",
    title: "Northbound seed gate",
    acceptingApplications: accepting,
    criteria,
  };
}

describe("what an investor publishes", () => {
  it("reads the card's mandate fields only for an investor card, unknown as absent", () => {
    const card: PublicCardDto = {
      kind: "CARD",
      handle: "northbound",
      subjectType: "INVESTOR_ORGANISATION",
      name: "Northbound Capital (fictional)",
      fields: [
        {
          key: "mandateStages",
          value: "Seed; Series A",
          scope: "network_visible",
        },
        { key: "mandateSectors", value: "Security", scope: "public_external" },
        {
          key: "mandateTypicalCheque",
          value: "USD 250,000",
          scope: "network_visible",
        },
      ],
      verified: [],
      demoAttested: [],
      audience: "PARTICIPANT",
      indexable: false,
    };
    const mandate = publishedMandate(card);
    expect(mandate.stages).toEqual(["Seed", "Series A"]);
    expect(mandate.geographies).toEqual([]);
    expect(mandate.cheque).toBe("USD 250,000");
    expect(focusLine(mandate)).toBe("Seed and Series A. Security.");
    // A public (anonymous) projection never shows members-only fields.
    expect(publishedMandate({ ...card, audience: "PUBLIC" }).stages).toEqual(
      [],
    );
    expect(publishedMandate(null).cheque).toBeNull();
  });

  it("says matches, partly, doesn't, or not known yet, never a score", () => {
    const matches = dimensionMatches(
      gate([
        {
          label: "Seed",
          requiredness: "REQUIRED",
          dimension: "STAGE",
          standing: "MET",
        },
        {
          label: "Security",
          requiredness: "REQUIRED",
          dimension: "TAXONOMY",
          standing: "MET",
        },
        {
          label: "No crypto",
          requiredness: "REQUIRED",
          dimension: "EXCLUDED_TAXONOMY",
          standing: "NOT_MET",
        },
        {
          label: "Kenya",
          requiredness: "PREFERRED",
          dimension: "GEOGRAPHY",
          standing: "UNKNOWN",
        },
      ]),
      [],
    );
    expect(matches).toEqual({ STAGE: "ok", SECTOR: "part", GEOGRAPHY: "unk" });
    // No gate: only Discover's public-profile reasons count as a match.
    expect(
      dimensionMatches(null, [{ kind: "GEOGRAPHY_MATCH", detail: "Kenya" }]),
    ).toEqual({ STAGE: "unk", SECTOR: "unk", GEOGRAPHY: "ok" });
  });

  it("takes the investor's own reach choice, with their gate first and closed above all", () => {
    expect(reachOf("CLOSED", gate([]))).toBe("CLOSED");
    expect(reachOf("OPEN", gate([]))).toBe("GATE");
    expect(reachOf("OPEN", gate([], false))).toBe("OPEN");
    expect(reachOf(null, null)).toBe("NOT_STATED");
  });
});

describe("the investor directory", () => {
  const entry = (
    id: string,
    name: string,
    type: string,
    reach: "OPEN" | "CLOSED",
  ) => ({
    investorOrganisationId: id,
    name,
    photoUrl: null,
    type,
    deployment: "Actively investing",
    focus: null,
    looksFor: null,
    cheque: null,
    matches: { STAGE: "unk", SECTOR: "unk", GEOGRAPHY: "unk" } as const,
    reach,
    gateHref: null,
    where: null,
  });

  it("filters by type and by who takes requests, and says when none match", () => {
    render(
      <InvestorDirectory
        entries={[
          entry(
            "a0000000-0000-4000-8000-000000000001",
            "Fund One",
            "Venture fund",
            "OPEN",
          ),
          entry(
            "a0000000-0000-4000-8000-000000000002",
            "Angels Two",
            "Syndicate",
            "CLOSED",
          ),
        ]}
      />,
    );
    expect(screen.getAllByText("Focus not published yet")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Syndicate" }));
    expect(screen.queryByText("Fund One")).toBeNull();
    expect(screen.getByText("Angels Two")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Taking requests" }));
    expect(screen.getByText("No investors of that type yet")).toBeTruthy();
  });

  it("says plainly when an investor is not taking requests, with no request button", () => {
    render(
      <InvestorDirectory
        entries={[entry(INVESTOR, "Angels Two", "Syndicate", "CLOSED")]}
      />,
    );
    const open = document.querySelector<HTMLElement>(
      `[data-investor-open="${INVESTOR}"]`,
    );
    if (open === null) throw new Error("no card");
    fireEvent.click(open);
    expect(document.querySelector('[data-connection="CLOSED"]')).not.toBeNull();
    expect(document.querySelector("[data-connection-request]")).toBeNull();
  });
});

describe("investor interest", () => {
  const interest: IncomingInterestDto = {
    interestId: "b0000000-0000-4000-8000-000000000001",
    investorOrganisationId: INVESTOR,
    investorName: "Northbound Capital (fictional)",
    investorType: "VC",
    expressedAt: "2026-10-19T09:00:00.000Z",
    response: "PENDING",
    respondedAt: null,
    connection: null,
  };
  const facts = new Map([
    [
      INVESTOR,
      {
        deployment: null,
        looksFor: null,
        matches: { STAGE: "ok", SECTOR: "unk", GEOGRAPHY: "no" } as const,
      },
    ],
  ]);

  it("shows no invented note and says connected only from the server's answer", async () => {
    type Answer = Awaited<ReturnType<InterestAnswerPort>>;
    let finish: (value: Answer) => void = () => undefined;
    const answer = vi.fn<InterestAnswerPort>(
      () =>
        new Promise<Answer>((resolve) => {
          finish = resolve;
        }),
    );
    render(<InterestCards items={[interest]} facts={facts} answer={answer} />);
    expect(screen.getByText("No note with their interest.")).toBeTruthy();
    expect(
      screen.getByText("Looks for: not on their profile yet"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByText("Accepting…")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    await act(async () => {
      finish({
        ok: true,
        value: {
          interest: {
            ...interest,
            response: "ACCEPTED",
            respondedAt: interest.expressedAt,
          },
          deduplicated: false,
        },
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(document.querySelector('[data-response="ACCEPTED"]')).not.toBeNull();
  });

  it("shows the investor's own note, exactly as sent (decision B)", () => {
    render(
      <InterestCards
        items={[{ ...interest, note: "We lead seed rounds in fintech." }]}
        facts={facts}
        answer={vi.fn<InterestAnswerPort>()}
      />,
    );
    const note = document.querySelector("[data-interest-note]");
    expect(note?.textContent).toContain("We lead seed rounds in fintech.");
    expect(screen.queryByText("No note with their interest.")).toBeNull();
  });

  it("words when, without a clock in the page", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    expect(whenWords("2026-10-21T08:00:00.000Z", now)).toBe("Today");
    expect(whenWords("2026-10-19T08:00:00.000Z", now)).toBe("2 days ago");
  });
});

describe("search as a palette", () => {
  it("opens with /, groups people and videos, and opens a card by handle", async () => {
    const search = vi.fn((query: string): Promise<PaletteResult> =>
      Promise.resolve(
        query.startsWith("@")
          ? {
              kind: "CARD",
              card: {
                handle: "kivu",
                name: "Kivu Freight (fictional)",
                subjectType: "COMPANY",
                descriptor: "Seed · Rwanda",
                tagline: null,
                place: "Kigali, Rwanda",
                website: null,
                verified: [],
                connectHref: null,
              },
            }
          : {
              kind: "NAMES",
              query,
              people: [
                {
                  name: "Northbound Capital (fictional)",
                  detail: "In your Discover",
                  href: `/investors/${INVESTOR}`,
                  kind: "investor",
                },
              ],
              videos: [],
            },
      ),
    );
    render(<SearchPalette viewer="viewer-1" search={search} />);
    expect(document.querySelector("[data-search-palette]")).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "/" });
    });
    const input = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>(
        "[data-search-input]",
      );
      if (found === null) throw new Error("palette not open");
      return found;
    });
    fireEvent.change(input, { target: { value: "north" } });
    await waitFor(() =>
      expect(screen.getByText("People you can see")).toBeTruthy(),
    );
    expect(screen.getByText("In Discover")).toBeTruthy();
    fireEvent.change(input, { target: { value: "@kivu" } });
    await waitFor(() =>
      expect(
        document.querySelector('[data-palette-card="kivu"]'),
      ).not.toBeNull(),
    );
    expect(screen.getByText("Identity not verified by Capital Q")).toBeTruthy();
    // No subject this viewer already sees: the card opens in full instead.
    expect(
      screen
        .getByRole("link", { name: "Open their Q Card" })
        .getAttribute("href"),
    ).toBe("/@kivu");
  });

  it("opens from the page's bar with a query", async () => {
    const search = vi.fn((): Promise<PaletteResult> =>
      Promise.resolve({ kind: "NAMES", query: "zed", people: [], videos: [] }),
    );
    render(<SearchPalette viewer="viewer-1" search={search} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_SEARCH, { detail: { query: "zed" } }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "No one by that name among your relationships or Discover. Anyone else is found by their @handle.",
        ),
      ).toBeTruthy(),
    );
  });

  it("keeps recently opened newest first, without repeats", () => {
    const person = (href: string): RecentItem => ({
      kind: "person",
      name: href,
      href,
      entity: "company",
      where: "In your CRM",
      line: null,
    });
    const list = withRecent(
      withRecent([person("/a"), person("/b")], person("/b")),
      person("/c"),
    );
    expect(
      list.map((item) => (item.kind === "person" ? item.href : "")),
    ).toEqual(["/c", "/b", "/a"]);
    expect(durationWords(58)).toBe("0:58");
    expect(durationWords(null)).toBeNull();
  });
});
