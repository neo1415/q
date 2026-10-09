// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArrivalData } from "../src/features/briefing/arrival";

/**
 * Live 2026-10-09: every call after the first opened "Good evening.
 * What's on your mind?". The briefing read (about 40 reads behind one
 * server action) took longer than the 2.5 s a call waits, its late result
 * was thrown away, and a page load that had already greeted never read it
 * at all. These pin the repair: read early, keep a late read, never drop.
 */

const { resetArrival, startArrival, arrivalForVoice } =
  await import("../src/features/briefing/arrival-store");
const { resetArrivalGate } =
  await import("../src/features/briefing/arrival-gate");

const DATA: ArrivalData = {
  firstName: "Zino",
  timeZone: "Europe/London",
  activity: {},
  hoursAway: 9,
  cards: [],
};

beforeEach(() => {
  resetArrival();
  resetArrivalGate();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("what a call opens with", () => {
  it("reads the briefing early when this page load gives no cards, so the call has it at once", async () => {
    // Already greeted in this browser session: the gate gives no cards.
    window.sessionStorage.setItem("cq.q.arrived", "1");
    window.localStorage.setItem("cq.q.last-seen", new Date().toISOString());
    const loader = vi.fn(() => Promise.resolve(DATA));
    startArrival(loader);
    expect(loader).toHaveBeenCalledTimes(1);

    const data = await arrivalForVoice(loader, 2_500);
    expect(data?.firstName).toBe("Zino");
    // The early read is used, not a second one.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps a read that lands after the call opened, so the cards and the lowdown still come", async () => {
    vi.useFakeTimers();
    let land: (data: ArrivalData) => void = () => undefined;
    const loader = vi.fn(
      () =>
        new Promise<ArrivalData | null>((resolve) => {
          land = resolve;
        }),
    );
    const opening = arrivalForVoice(loader, 2_500);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await opening).toBeNull();

    const { arrivalForVoice: again } =
      await import("../src/features/briefing/arrival-store");
    land(DATA);
    await vi.advanceTimersByTimeAsync(0);
    // Now on screen: a second ask answers at once, without reading again.
    const now = await again(loader, 2_500);
    expect(now?.firstName).toBe("Zino");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
