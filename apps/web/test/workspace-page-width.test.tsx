// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PagePaneWidthContext,
  usePageAtLeast,
  usePageNarrowerThan,
} from "../src/features/workspace/page-pane-width";

/**
 * Batch 13: a page's layout decisions made in code read the Q Workspace
 * page pane's width, not the viewport's. On a 1440 px screen a 560 px pane
 * gets the phone layout (the Discover card's video was a 60 px strip).
 */
const original = Object.getOwnPropertyDescriptor(window, "matchMedia");

function viewport(width: number): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width: (\d+)px/u.exec(query);
      const max = /max-width: (\d+)px/u.exec(query);
      return {
        matches:
          (min !== null && width >= Number(min[1])) ||
          (max !== null && width <= Number(max[1])),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    },
  });
}

function Probe({ server = false }: { readonly server?: boolean }) {
  return <p>{usePageAtLeast(1024, server) ? "desktop" : "phone"}</p>;
}

afterEach(() => {
  cleanup();
  if (original === undefined) {
    Reflect.deleteProperty(window, "matchMedia");
  } else {
    Object.defineProperty(window, "matchMedia", original);
  }
});

describe("usePageAtLeast", () => {
  it("follows the viewport outside the workspace, as before", () => {
    viewport(1440);
    render(<Probe />);
    expect(screen.getByText("desktop")).toBeTruthy();
    cleanup();
    viewport(390);
    render(<Probe />);
    expect(screen.getByText("phone")).toBeTruthy();
  });

  it("reads a narrow page pane as a phone on a wide screen", () => {
    viewport(1440);
    render(
      <PagePaneWidthContext.Provider value={560}>
        <Probe />
      </PagePaneWidthContext.Provider>,
    );
    expect(screen.getByText("phone")).toBeTruthy();
  });

  it("reads a wide page pane as a desktop", () => {
    viewport(1920);
    render(
      <PagePaneWidthContext.Provider value={1300}>
        <Probe />
      </PagePaneWidthContext.Provider>,
    );
    expect(screen.getByText("desktop")).toBeTruthy();
  });

  it("keeps the page's own answer where media queries are unavailable", () => {
    Reflect.deleteProperty(window, "matchMedia");
    render(<Probe server />);
    expect(screen.getByText("desktop")).toBeTruthy();
  });

  it("answers the phone side the same way (the next-step dock)", () => {
    function Narrow() {
      return <p>{usePageNarrowerThan(1024, false) ? "dock" : "ribbon"}</p>;
    }
    viewport(1440);
    render(
      <PagePaneWidthContext.Provider value={560}>
        <Narrow />
      </PagePaneWidthContext.Provider>,
    );
    expect(screen.getByText("dock")).toBeTruthy();
    cleanup();
    render(<Narrow />);
    expect(screen.getByText("ribbon")).toBeTruthy();
  });
});
