// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArrivalRoom,
  setRoomFilled,
} from "../src/features/briefing/arrival-room";

/**
 * Live 2026-10-29 (desktop Home, 1440x900): with the readiness lowdown and
 * "Finish setup with Q" under the welcome, Talk to Q sat at y 842-894,
 * past the stage's bottom edge and clipped behind the composer. Q's room
 * was a fixed square, so any welcome taller than what was left pushed the
 * room's own button out of sight; an earlier patch shrank Q only for the
 * weekly briefing. The invariant, whatever the welcome holds: Q's room
 * yields height first, and if even that is not enough the stage scrolls
 * (the arrival grows, never clips). Browser proof is a Playwright check of
 * the Talk to Q and composer rects; this pins the layout contract.
 */

// jsdom's URL is not Node's, so the paths are joined as strings.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../app/globals.css"), "utf8").replace(
  /\s+/gu,
  " ",
);
const conversation = readFileSync(
  join(here, "../src/features/q/q-conversation.tsx"),
  "utf8",
);

afterEach(() => {
  act(() => {
    setRoomFilled(false, "needs");
    setRoomFilled(false, "stage");
  });
  cleanup();
});

describe("Home: nothing under the composer, whatever the welcome holds", () => {
  it("Q's room is the arrival's flexible item: basis 0, a floor, its full size as the cap", () => {
    expect(css).toContain(
      ".cq-arrival .cq-room-presence { flex: 1 1 0; height: auto; min-height: calc(var(--cq-room-box) / 3); max-height: var(--cq-room-box); }",
    );
    // The canvas is scaled to the box it got, about its centre, at rest
    // and gathered alike.
    expect(css).toContain(
      "transform: translate(-50%, -50%) scale(var(--cq-room-fit, 1));",
    );
    expect(css).toContain(
      "scale(calc(var(--cq-room-gather) * var(--cq-room-fit, 1)));",
    );
    expect(conversation).toContain("ref={fitRoomPresence}");
  });

  it("no per-content special case is left", () => {
    expect(css).not.toContain(".cq-arrival:has(");
  });

  it("the arrival grows past the stage rather than clipping (min-height, not height)", () => {
    expect(conversation).toContain(
      '"cq-arrival mx-auto flex min-h-full w-full max-w-2xl flex-col',
    );
    expect(conversation).toContain(
      'className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto',
    );
  });

  it("before the room fills, its wrappers step out of the layout and the columns take no part", () => {
    const { container } = render(
      <ArrivalRoom>
        <div data-testid="presence" />
      </ArrivalRoom>,
    );
    const room = container.querySelector("[data-q-room]");
    expect(room?.getAttribute("data-q-room")).toBe("empty");
    expect(room?.className).toBe("contents");
    const slots = container.querySelectorAll("[data-q-room-slot]");
    // Still mounted: they are the stage's portal targets.
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.className).toContain("hidden");
      expect(slot.className).not.toContain("xl:flex");
    }
    expect(
      container.querySelector("[data-testid=presence]")?.parentElement
        ?.className,
    ).toBe("contents");
  });

  it("filled, or the conversing stage, keeps the columns layout", () => {
    const wide = render(
      <ArrivalRoom wide>
        <div />
      </ArrivalRoom>,
    );
    expect(wide.container.querySelector("[data-q-room]")?.className).toContain(
      "flex w-full flex-col items-center",
    );
    wide.unmount();

    act(() => {
      setRoomFilled(true, "needs");
    });
    const { container } = render(
      <ArrivalRoom>
        <div />
      </ArrivalRoom>,
    );
    const room = container.querySelector("[data-q-room]");
    expect(room?.getAttribute("data-q-room")).toBe("filled");
    expect(room?.className).toContain("xl:grid");
    for (const slot of container.querySelectorAll("[data-q-room-slot]")) {
      expect(slot.className).toContain("xl:flex");
    }
  });
});
