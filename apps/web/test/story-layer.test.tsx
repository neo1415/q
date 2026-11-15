// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryLayer } from "../src/features/q-pitch/story/story-layer";

/**
 * Live 2026-11-15 (/q-pitch at 390): the story was drawn inside the page
 * pane, which a phone hides as a closed sheet, so its stage, captions and
 * controls were hidden while the narration played. On a phone the story
 * is drawn at the document's top level; a desktop keeps it in place.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function viewport(phone: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: phone,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

function hiddenSheet() {
  return render(
    <div data-ws-page data-ws-sheet="closed" inert>
      <StoryLayer>
        <nav aria-label="Story controls" data-probe />
      </StoryLayer>
    </div>,
  );
}

describe("the story's layer", () => {
  it("on a phone, is drawn outside the page sheet, so a closed sheet cannot hide it", () => {
    viewport(true);
    const { container } = hiddenSheet();
    const probe = document.querySelector("[data-probe]");
    expect(probe).not.toBeNull();
    expect(container.contains(probe)).toBe(false);
    expect(probe?.closest("[data-ws-page]")).toBeNull();
    expect(probe?.closest("[inert]")).toBeNull();
  });

  it("on a desktop, stays in the page pane", () => {
    viewport(false);
    const { container } = hiddenSheet();
    expect(container.querySelector("[data-probe]")).not.toBeNull();
  });
});
