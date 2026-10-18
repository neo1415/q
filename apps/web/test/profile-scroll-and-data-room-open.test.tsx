// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lane sc 2026-10-16 (owner, release AF): on the profile Overview the page
 * jumped back up whenever the reader scrolled, and in the Data room one
 * slow or failed open left every other document's Open disabled.
 *
 * Root causes: the section carousel re-subscribed its IntersectionObserver
 * on every render (an inline onIndex), whose first callback set the
 * parent's state and called chip.scrollIntoView -- which scrolls the page,
 * not just the chip strip -- so it looped. The data room shared one
 * transition's pending flag across every document.
 */

type Opened =
  | {
      ok: true;
      value: {
        url: string;
        downloadable: boolean;
        watermark: string | null;
        downloadUrl: string | null;
      };
    }
  | { ok: false; message: string };
const openDocumentAction = vi.fn<(c: string, d: string) => Promise<Opened>>();

vi.mock("../src/features/company/material/material-actions", () => ({
  openDocumentAction: (c: string, d: string) => openDocumentAction(c, d),
  openDeckAction: vi.fn(),
  requestAccessAction: vi.fn(),
  decideRequestAction: vi.fn(),
  setLevelAction: vi.fn(),
  setOutlineAction: vi.fn(),
  newRequestKey: vi.fn(() => Promise.resolve("dr-key-0001")),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const { InvestorDataRoom } =
  await import("../src/features/company/material/data-room");
const { DeckCarousel } =
  await import("../src/features/company/material/deck-sections");
const fixtures =
  await import("../src/features/company/material/review-fixtures");

const observers: { callback: IntersectionObserverCallback }[] = [];
class FakeObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  // Like a browser: the first callback reports the card already in view.
  observe(target: Element) {
    if (target.parentElement?.firstElementChild === target) {
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    }
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

const scrollIntoView = vi.fn();
const windowScroll = vi.fn();
beforeEach(() => {
  observers.length = 0;
  scrollIntoView.mockClear();
  windowScroll.mockClear();
  openDocumentAction.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Element.prototype.scrollIntoView = scrollIntoView;
  window.scrollTo = windowScroll;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sections = fixtures.reviewDeck("INVESTOR").extraction?.sections ?? [];

function Parent() {
  const [, setPicked] = useState<{ at: number } | null>(null);
  // An inline callback that sets a fresh object: what the profile Overview
  // passes. It must not make the carousel loop or move the page.
  return (
    <DeckCarousel
      sections={sections}
      downloadable={false}
      companyName="Kora Health"
      index={0}
      onIndex={(at) => setPicked({ at })}
    />
  );
}

describe("the Overview section carousel", () => {
  it("never scrolls the page on render or re-render without a navigation target", () => {
    const view = render(<Parent />);
    for (let n = 0; n < 5; n += 1) view.rerender(<Parent />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScroll).not.toHaveBeenCalled();
    // One observer for the track, not one per render.
    expect(observers.length).toBe(1);
  });

  it("moves only the chip strip sideways when the visible card changes", () => {
    render(<Parent />);
    const strip = screen.getByRole("tablist");
    const stripScroll = vi.fn();
    strip.scrollTo = stripScroll;
    Object.defineProperty(strip, "clientWidth", { value: 100 });
    const chip = screen.getAllByRole("tab")[5];
    if (chip === undefined) throw new Error("no chip");
    Object.defineProperty(chip, "offsetLeft", { value: 500 });
    Object.defineProperty(chip, "offsetWidth", { value: 80 });
    const card = screen.getAllByRole("group")[5];
    const observer = observers[0];
    if (card === undefined || observer === undefined) throw new Error("none");
    act(() => {
      observer.callback(
        [
          {
            target: card,
            isIntersecting: true,
            intersectionRatio: 1,
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });
    expect(stripScroll).toHaveBeenCalledWith({ left: 480 });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(chip.getAttribute("aria-selected")).toBe("true");
  });
});

const ok = (url: string): Opened => ({
  ok: true,
  value: {
    url,
    downloadable: false,
    watermark: "D · view only",
    downloadUrl: null,
  },
});

describe("opening data room documents", () => {
  const room = () =>
    render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={fixtures.reviewInvestorRoom()}
      />,
    );

  it("keeps every other document openable while one is opening, and the newest click wins", async () => {
    let finishFirst: (value: Opened) => void = () => undefined;
    openDocumentAction
      .mockImplementationOnce(
        () => new Promise<Opened>((resolve) => (finishFirst = resolve)),
      )
      .mockImplementationOnce(() => Promise.resolve(ok("https://s.example/b")));
    room();
    const buttons = screen.getAllByRole("button", { name: "Open" });
    expect(buttons.length).toBeGreaterThan(1);
    const [first, second] = buttons;
    if (first === undefined || second === undefined) throw new Error("none");
    fireEvent.click(first);
    await waitFor(() => expect(first.hasAttribute("disabled")).toBe(true));
    // The rest stay enabled while the first never answers.
    for (const other of screen.getAllByRole("button", { name: "Open" }))
      expect(other.hasAttribute("disabled")).toBe(false);
    fireEvent.click(second);
    await waitFor(() =>
      expect(document.querySelector("iframe")?.getAttribute("src")).toContain(
        "https://s.example/b",
      ),
    );
    // The superseded open answering late does not replace the newer file.
    await act(async () => {
      finishFirst(ok("https://s.example/a"));
      await Promise.resolve();
    });
    expect(document.querySelector("iframe")?.getAttribute("src")).toContain(
      "https://s.example/b",
    );
  });

  it("re-enables Open after a failed or thrown open", async () => {
    openDocumentAction
      .mockResolvedValueOnce({
        ok: false,
        message: "That couldn't be opened. Try again.",
      })
      .mockRejectedValueOnce(new Error("network"));
    room();
    const first = screen.getAllByRole("button", { name: "Open" })[0];
    if (first === undefined) throw new Error("none");
    fireEvent.click(first);
    await screen.findByText("That couldn't be opened. Try again.");
    const again = screen.getAllByRole("button", { name: "Open" })[0];
    expect(again?.hasAttribute("disabled")).toBe(false);
    if (again === undefined) throw new Error("none");
    fireEvent.click(again);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "Open" })
          .every((button) => !button.hasAttribute("disabled")),
      ).toBe(true),
    );
    expect(openDocumentAction).toHaveBeenCalledTimes(2);
  });
});
