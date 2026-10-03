// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DockAvoidZone } from "@/features/q-dock";
import { avoidRects, subscribeAvoid } from "@/features/q-dock/dock-avoid";

afterEach(cleanup);

describe("DockAvoidZone (ADR 0017 F1)", () => {
  it("registers its controls with the dock while mounted, and lets go after", () => {
    const changed = vi.fn();
    const stop = subscribeAvoid(changed);
    const { unmount, container } = render(
      <DockAvoidZone>
        <button type="button">Send a message</button>
      </DockAvoidZone>,
    );
    const zone = container.querySelector("[data-dock-avoid]");
    if (!(zone instanceof HTMLElement)) throw new Error("no zone");
    zone.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 300, y: 700, width: 90, height: 60 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(avoidRects()).toContainEqual({
      left: 300,
      top: 700,
      right: 390,
      bottom: 760,
    });
    unmount();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(avoidRects()).toEqual([]);
    stop();
  });
});
