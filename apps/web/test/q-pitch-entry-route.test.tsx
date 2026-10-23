// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn() }),
}));
// The host itself is not under test: a stub that names the tour it was given.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Host({
      tour,
      edition,
      onExit,
    }: {
      readonly tour?: string;
      readonly edition?: string;
      readonly onExit: () => void;
    }) {
      return (
        <button
          type="button"
          data-host={tour ?? "story"}
          data-edition={edition}
          onClick={onExit}
        >
          End tour
        </button>
      );
    },
}));

import { QPitchEntry } from "../src/features/q-pitch/tour-entry";

afterEach(() => {
  cleanup();
  search = "";
});

/**
 * Q Pitch v6, live 2026-10-17: Q's natural-language trigger moves the tab
 * to "/home?qpitch=investor-v6" by a client navigation. The entry lives in
 * the app layout, so it must start the tour on that route change, not only
 * on the address the page was first loaded with.
 */
describe("the Q Pitch entry follows client navigation", () => {
  it("starts when the address gains ?qpitch after the first load", () => {
    const view = render(<QPitchEntry account="a" role="INVESTOR" />);
    expect(document.querySelector("[data-host]")).toBeNull();
    search = "qpitch=investor-v6";
    view.rerender(<QPitchEntry account="a" role="INVESTOR" />);
    expect(
      document.querySelector("[data-host]")?.getAttribute("data-host"),
    ).toBe("investor-v6");
  });

  it("stays started when the tour moves to a page without the parameter", () => {
    search = "qpitch=founder-v6";
    const view = render(<QPitchEntry account="a" role="FOUNDER" />);
    search = "";
    view.rerender(<QPitchEntry account="a" role="FOUNDER" />);
    expect(
      document.querySelector("[data-host]")?.getAttribute("data-host"),
    ).toBe("founder-v6");
  });

  it("starts again on a new ask after End tour", () => {
    search = "qpitch=investor-v6";
    const view = render(<QPitchEntry account="a" role="INVESTOR" />);
    act(() => {
      screen.getByRole("button", { name: "End tour" }).click();
    });
    expect(document.querySelector("[data-host]")).toBeNull();
    search = "";
    view.rerender(<QPitchEntry account="a" role="INVESTOR" />);
    search = "qpitch=investor-v6";
    view.rerender(<QPitchEntry account="a" role="INVESTOR" />);
    expect(document.querySelector("[data-host]")).not.toBeNull();
  });

  it("a new ask while the story is up starts the cut asked for", () => {
    search = "qpitch=story&new=1&edition=investor&start=a1";
    const view = render(<QPitchEntry account="a" role="FOUNDER" />);
    const edition = () =>
      document.querySelector("[data-host]")?.getAttribute("data-edition");
    expect(edition()).toBe("INVESTOR");
    // The story moves on to a page without the parameter...
    search = "";
    view.rerender(<QPitchEntry account="a" role="FOUNDER" />);
    expect(edition()).toBe("INVESTOR");
    // ...then "pitch yourself to founders": a new address, a new token.
    search = "qpitch=story&new=1&edition=founder&start=b2";
    view.rerender(<QPitchEntry account="a" role="FOUNDER" />);
    expect(edition()).toBe("FOUNDER");
  });
});
