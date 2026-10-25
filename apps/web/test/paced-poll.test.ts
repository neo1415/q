// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextPollDelay,
  startPacedPoll,
  type PollOutcome,
} from "../src/features/polling/paced-poll";

/**
 * Egress review (2026-10-24): every client poll reads nothing while the
 * tab is hidden, backs off while nothing changes and reads at once when
 * the person comes back.
 */

let visibility: DocumentVisibilityState = "visible";
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});
afterEach(() => {
  vi.useRealTimers();
});

const PACE = { firstMs: 1_000, maxMs: 8_000, factor: 2 } as const;

describe("nextPollDelay", () => {
  it("backs off while nothing changes, up to the ceiling, and resets on a change", () => {
    expect(nextPollDelay(1_000, "same", PACE)).toBe(2_000);
    expect(nextPollDelay(6_000, "same", PACE)).toBe(8_000);
    expect(nextPollDelay(8_000, "changed", PACE)).toBe(1_000);
  });
});

describe("startPacedPoll", () => {
  it("reads at a growing interval while nothing changes", async () => {
    const read = vi.fn((): Promise<PollOutcome> => Promise.resolve("same"));
    const poll = startPacedPoll(read, PACE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(read).toHaveBeenCalledTimes(3);
    // At the ceiling it stays there.
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(read).toHaveBeenCalledTimes(5);
    poll.stop();
  });

  it("returns to the first pace after a change", async () => {
    const outcomes: PollOutcome[] = ["same", "same", "changed", "same"];
    const read = vi.fn(() => Promise.resolve(outcomes.shift() ?? "same"));
    const poll = startPacedPoll(read, PACE);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    expect(read).toHaveBeenCalledTimes(3);
    // The third read changed: the next one is a first pace away.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  it("reads nothing while hidden and reads at once on coming back", async () => {
    const read = vi.fn((): Promise<PollOutcome> => Promise.resolve("same"));
    const poll = startPacedPoll(read, PACE);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).not.toHaveBeenCalled();
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it("stops after a read that says it is done, and on stop", async () => {
    const read = vi.fn((): Promise<PollOutcome> => Promise.resolve("done"));
    startPacedPoll(read, PACE, { immediate: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);

    const other = vi.fn((): Promise<PollOutcome> => Promise.resolve("same"));
    const poll = startPacedPoll(other, PACE);
    poll.stop();
    setVisibility("hidden");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(other).not.toHaveBeenCalled();
  });

  it("never overlaps a slow read, and a failed read slows rather than bursts", async () => {
    let finish: (() => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<PollOutcome>((resolve, reject) => {
          if (read.mock.calls.length === 1) finish = () => resolve("same");
          else reject(new Error("offline"));
        }),
    );
    const poll = startPacedPoll(read, PACE, { immediate: true });
    poll.now();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(1);
    finish?.();
    // The asked-for read runs once the slow one is back.
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    // It failed: the next is a backed-off pace away, not at once.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);
    poll.stop();
  });
});
