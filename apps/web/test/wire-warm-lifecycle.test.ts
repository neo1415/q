import { afterEach, describe, expect, it, vi } from "vitest";

// The schemas are exercised in wire.test; isolate the delayed browser
// callback here so import compilation cannot become another timing race.
vi.mock("../src/features/q/wire-contracts", () => ({}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Q's deferred contract warm-up", () => {
  it("finishes without an uncaught error when its browser global has gone away", async () => {
    vi.resetModules();
    let tick: (() => void) | undefined;
    const idle = vi.fn((callback: () => void) => callback());
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      requestIdleCallback: idle,
    });
    const { wireWarmed } = await import("../src/features/q/wire");
    const warmed = wireWarmed();
    if (tick === undefined) throw new Error("Expected the deferred warm-up");
    const fire = tick;
    vi.unstubAllGlobals();
    expect(() => fire()).not.toThrow();
    await warmed;
    expect(idle).toHaveBeenCalledOnce();
  });

  it("uses the browser that scheduled it when another global window replaces it", async () => {
    vi.resetModules();
    let tick: (() => void) | undefined;
    const originalIdle = vi.fn((callback: () => void) => callback());
    const replacementIdle = vi.fn((callback: () => void) => callback());
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      requestIdleCallback: originalIdle,
    });
    const { wireWarmed } = await import("../src/features/q/wire");
    const warmed = wireWarmed();
    if (tick === undefined) throw new Error("Expected the deferred warm-up");
    vi.stubGlobal("window", { requestIdleCallback: replacementIdle });
    tick();
    await warmed;
    expect(originalIdle).toHaveBeenCalledOnce();
    expect(replacementIdle).not.toHaveBeenCalled();
  });
});
