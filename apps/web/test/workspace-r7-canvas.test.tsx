// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * R7 (owner live test 2026-11-07): in the Q Workspace's narrow pane on a
 * wide screen, answer cards were laid out for the viewport ("wide") and
 * squeezed side by side until their text broke per letter. The canvas now
 * lays out by its own measured width; where it cannot be measured, the
 * viewport decides as before.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { demoTop } = await import("../src/features/q/answer-canvas-fixtures");
const { wideEnough } = await import("../src/features/workspace/q-pane-width");
const { loadWire } = await import("../src/features/q/wire");

beforeAll(async () => {
  await loadWire();
}, 30_000);

let canvasWidth = 0;
// Kept as a property descriptor so restoring it never detaches `this`.
const realRect = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "getBoundingClientRect",
);
beforeEach(() => {
  // A wide viewport, as a desktop screen with the Q pane beside the page.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.getBoundingClientRect = function rect(
    this: HTMLElement,
  ) {
    const width = this.classList.contains("cq-ac") ? canvasWidth : 0;
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      toJSON: () => ({}),
    };
  };
});
afterEach(() => {
  cleanup();
  if (realRect !== undefined) {
    Object.defineProperty(
      HTMLElement.prototype,
      "getBoundingClientRect",
      realRect,
    );
  }
});

async function settled(): Promise<void> {
  await waitFor(
    () => expect(document.querySelector(".cq-ac-cards")).not.toBeNull(),
    { timeout: 10_000 },
  );
}

function layoutOf(): { layout: string | null; tiles: boolean } {
  const cards = document.querySelector(".cq-ac-cards");
  return {
    layout: cards?.getAttribute("data-layout") ?? null,
    tiles: cards?.hasAttribute("data-tiles") ?? false,
  };
}

describe("answer cards follow the canvas's own width", () => {
  it("a 1000 px canvas is wide: five cards in the grid", async () => {
    canvasWidth = 1000;
    render(<QResultBlocks blocks={[demoTop(5)]} turnId="w1000" />);
    await settled();
    expect(layoutOf()).toEqual({ layout: "grid", tiles: false });
  });

  it("a 380 px canvas on the same wide screen is narrow: no grid, phone tiles", async () => {
    canvasWidth = 380;
    render(<QResultBlocks blocks={[demoTop(5)]} turnId="w380" />);
    await settled();
    expect(layoutOf()).toEqual({ layout: "row", tiles: true });
  });

  it("unmeasured (not laid out): the viewport decides, as before", async () => {
    canvasWidth = 0;
    render(<QResultBlocks blocks={[demoTop(5)]} turnId="w0" />);
    await settled();
    expect(layoutOf()).toEqual({ layout: "grid", tiles: false });
  });
});

describe("wideEnough (room for cards beside Q)", () => {
  it("is the pane's width inside the pane, the viewport's answer elsewhere", () => {
    expect(wideEnough(null, true, 1280)).toBe(true);
    expect(wideEnough(null, false, 1280)).toBe(false);
    expect(wideEnough(380, true, 1280)).toBe(false);
    expect(wideEnough(1376, false, 1280)).toBe(true);
  });
});
