import { afterEach, describe, expect, it, vi } from "vitest";

import { nativeTimeoutSignal, timerTimeoutSignal } from "../src/index.js";
import { pictureBlock } from "../src/q/result-blocks.js";

/**
 * W4-G (audit finding 9): the timeout seam changes nothing in production.
 * Unless a test passes another, every deadline is the platform's own
 * AbortSignal.timeout; the timer variant tests use aborts the same way,
 * on fake time.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the timeout seam", () => {
  it("the default is the platform's AbortSignal.timeout, called as before", () => {
    const native = vi.spyOn(AbortSignal, "timeout");
    const signal = nativeTimeoutSignal(1_234);
    expect(native).toHaveBeenCalledWith(1_234);
    expect(signal).toBe(native.mock.results[0]?.value);
  });

  it("a deadline left to its default goes through AbortSignal.timeout (the picture's wait)", async () => {
    const native = vi.spyOn(AbortSignal, "timeout");
    const block = await pictureBlock({
      result: { visual: "PICTURE", pictureQuery: "baobab tree" },
      // Never answers: only the wait can end it.
      pictures: { find: () => new Promise<null>(() => undefined) },
      userText: "Show me a baobab tree.",
      earlierUserText: [],
      waitMs: 15,
    });
    expect(block).toBeNull();
    expect(native).toHaveBeenCalledWith(15);
  });

  it("the timer variant aborts with the same TimeoutError, on fake time", async () => {
    vi.useFakeTimers();
    const signal = timerTimeoutSignal(100);
    await vi.advanceTimersByTimeAsync(99);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    const reason: unknown = signal.reason;
    expect(reason).toBeInstanceOf(DOMException);
    expect((reason as DOMException).name).toBe("TimeoutError");
    const native = AbortSignal.timeout(0);
    vi.useRealTimers();
    await new Promise((resolve) => {
      native.addEventListener("abort", resolve);
    });
    expect((native.reason as DOMException).name).toBe("TimeoutError");
  });
});
