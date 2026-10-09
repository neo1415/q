import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_AVAILABLE_TIMEOUT_MS,
  liveVoiceAvailable,
} from "../src/features/voice/live/live-call";

/**
 * V (2026-10-09 regression): anything but a clear yes from the Q API is
 * "not available", at once, so the voice start opens the existing line.
 */
describe("whether GPT-Live is available", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is yes only when the Q API says so", async () => {
    const yes = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ available: true })),
    );
    expect(await liveVoiceAvailable(yes)).toBe(true);
    const no = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ available: false })),
    );
    expect(await liveVoiceAvailable(no)).toBe(false);
  });

  it("is no on a 404 (the line is off and its route is not there)", async () => {
    const missing = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    );
    expect(await liveVoiceAvailable(missing)).toBe(false);
  });

  it("is no on a network error", async () => {
    const broken = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(await liveVoiceAvailable(broken)).toBe(false);
  });

  it("is no when the answer does not come within the timeout", async () => {
    vi.useFakeTimers();
    const hangs = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined),
    );
    const answer = liveVoiceAvailable(hangs);
    await vi.advanceTimersByTimeAsync(LIVE_AVAILABLE_TIMEOUT_MS);
    expect(await answer).toBe(false);
  });
});
