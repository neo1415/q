// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DOCS: the document-ready card on every page (founder directive
 * 2026-10-01). One owner; a card per document version, never a flood of
 * old documents; Open and the downloads on it; it leaves on its own unless
 * the person is looking at it; reduced motion is a fade (CSS).
 */

const readQArtifactAction = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: (id: string) => readQArtifactAction(id),
  readQArtifactVersionAction: () => Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

const {
  announceDocument,
  expectDocument,
  readyChanges,
  resetReadyDocuments,
  useReadyDocuments,
  READY_TOASTS_MAX,
} = await import("../src/features/documents/document-ready");
const { DocumentReadyCenter } =
  await import("../src/features/documents/document-ready-center");

const DECK = "a0000000-0000-4000-8000-000000000001";
const BRIEF = "a0000000-0000-4000-8000-000000000002";

const listed = (over: Record<string, unknown> = {}) => ({
  artifactId: DECK,
  type: "PITCH_DECK",
  status: "READY",
  title: "Northstar — investor deck",
  currentVersion: 1,
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

describe("what a listing says changed", () => {
  const OPENED = Date.parse("2026-10-01T10:05:00.000Z");

  it("the first listing is a baseline, not a flood of old documents", () => {
    const first = readyChanges(new Map(), [listed()], OPENED);
    expect(first.announce).toEqual([]);
    expect(first.known.get(DECK)).toEqual({ version: 1, status: "READY" });
  });

  it("announces a document made after the page opened", () => {
    const made = readyChanges(
      new Map(),
      [listed({ updatedAt: "2026-10-01T10:06:00.000Z" })],
      OPENED,
    );
    expect(made.announce).toEqual([
      {
        artifactId: DECK,
        type: "PITCH_DECK",
        title: "Northstar — investor deck",
        version: 1,
        status: "READY",
      },
    ]);
  });

  it("announces a new version and a preparing document that became ready or failed", () => {
    const known = new Map([
      [DECK, { version: 1, status: "READY" }],
      [BRIEF, { version: 0, status: "PREPARING" }],
    ]);
    const next = readyChanges(
      known,
      [
        listed({ currentVersion: 2 }),
        listed({
          artifactId: BRIEF,
          type: "INVESTMENT_BRIEF",
          status: "FAILED",
          currentVersion: 0,
        }),
      ],
      OPENED,
    );
    expect(next.announce.map((d) => [d.version, d.status])).toEqual([
      [2, "READY"],
      [0, "FAILED"],
    ]);
    // Seen once: the same listing again announces nothing.
    expect(
      readyChanges(next.known, [listed({ currentVersion: 2 })], OPENED)
        .announce,
    ).toEqual([]);
  });
});

function Probe() {
  const ready = useReadyDocuments();
  return <output data-testid="count">{ready.length}</output>;
}

describe("the store", () => {
  beforeEach(() => resetReadyDocuments());

  it("shows one card per document version, newest on top, at most three", () => {
    render(<Probe />);
    const doc = {
      artifactId: DECK,
      type: "PITCH_DECK",
      title: "Deck",
      version: 1,
      status: "READY" as const,
    };
    act(() => {
      announceDocument(doc);
      announceDocument(doc);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
    act(() => {
      for (let index = 2; index <= 6; index += 1) {
        announceDocument({
          ...doc,
          artifactId: `a0000000-0000-4000-8000-00000000000${String(index)}`,
        });
      }
    });
    expect(screen.getByTestId("count").textContent).toBe(
      String(READY_TOASTS_MAX),
    );
  });
});

describe("the document-ready card, on any page", () => {
  let responses: unknown[];
  beforeEach(() => {
    resetReadyDocuments();
    responses = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(responses.shift() ?? { items: [] }), {
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("pops up when a document is ready, with Open and its downloads", async () => {
    responses.push({
      items: [
        listed({ updatedAt: new Date(Date.now() + 60_000).toISOString() }),
      ],
    });
    readQArtifactAction.mockResolvedValue({ ok: false, message: "Not now." });
    render(<DocumentReadyCenter connected />);
    // P9: the first check waits ~2 s for the page to settle.
    const card = await screen.findByRole(
      "status",
      { name: /Investor deck: Northstar — investor deck\. Ready\./i },
      { timeout: 4_000 },
    );
    expect(card.textContent).toContain("Northstar — investor deck");
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/q-artifact/recent",
      expect.objectContaining({ cache: "no-store" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(readQArtifactAction).toHaveBeenCalledWith(DECK);
    });
    // Opening it takes the card away.
    expect(screen.queryByRole("status", { name: /Ready\./ })).toBeNull();
  });

  it("leaves on its own, but not while the person is looking at it", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DocumentReadyCenter connected={false} />);
    act(() => {
      announceDocument({
        artifactId: DECK,
        type: "PITCH_DECK",
        title: "Deck",
        version: 3,
        status: "READY",
      });
    });
    const card = screen.getByRole("status", { name: /Version 3 ready/ });
    fireEvent.pointerEnter(card);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(
      screen.queryByRole("status", { name: /Version 3 ready/ }),
    ).not.toBeNull();
    fireEvent.pointerLeave(card);
    act(() => {
      vi.advanceTimersByTime(13_000);
    });
    expect(
      screen.queryByRole("status", { name: /Version 3 ready/ }),
    ).toBeNull();
  });

  it("says plainly when Q could not finish, with nothing to open", () => {
    render(<DocumentReadyCenter connected={false} />);
    act(() => {
      announceDocument({
        artifactId: BRIEF,
        type: "INVESTMENT_BRIEF",
        title: "Brief",
        version: 0,
        status: "FAILED",
      });
    });
    expect(
      screen.getByRole("status", { name: /couldn't finish this one/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("checks closely while a document is being prepared", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DocumentReadyCenter connected />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    act(() => expectDocument());
    // The loop restarts at the watching pace (seconds, not half a minute).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
