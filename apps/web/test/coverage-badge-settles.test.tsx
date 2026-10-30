// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnboardingCoverage } from "@capital-q/contracts";

const onboardingCoverageAction = vi.fn();
vi.mock("../src/features/onboarding-kit/api-actions", () => ({
  onboardingCoverageAction: (id: string) =>
    onboardingCoverageAction(id) as unknown,
}));

const { useOnboardingCoverage } =
  await import("../src/features/onboarding-kit/components/coverage-summary");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  onboardingCoverageAction.mockReset();
});

const SESSION = "f0000000-0000-4000-8000-000000000031";

function coverageWith(unconfirmed: number): OnboardingCoverage {
  return {
    summary: {
      applicable: 10,
      settled: 10 - unconfirmed,
      essentialTotal: 10,
      essentialSettled: 10,
      unconfirmed,
      contradictory: 0,
      missing: 0,
      deferrable: 0,
      evidenceNeeded: 0,
      pendingSaves: 0,
      canComplete: true,
      minutesLeft: 0,
    },
  } as unknown as OnboardingCoverage;
}

/**
 * Live 2026-10-30 (production 4bcfa584b, Hydrolume, typed): the person's
 * yes to Q's summary was saved by a reading that landed after Q's reply;
 * this screen never read the session again, and "1 to confirm" stayed.
 */
describe("the coverage badge catches up with saves it did not make", () => {
  it("reads again while something waits for confirmation, and stops once nothing does", async () => {
    vi.useFakeTimers();
    onboardingCoverageAction
      .mockResolvedValueOnce({ ok: true, value: coverageWith(1) })
      .mockResolvedValue({ ok: true, value: coverageWith(0) });
    const { result } = renderHook(() => useOnboardingCoverage(SESSION, 7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current?.summary.unconfirmed).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current?.summary.unconfirmed).toBe(0);
    const reads = onboardingCoverageAction.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(onboardingCoverageAction.mock.calls.length).toBe(reads);
  });

  it("is bounded when something stays unconfirmed", async () => {
    vi.useFakeTimers();
    onboardingCoverageAction.mockResolvedValue({
      ok: true,
      value: coverageWith(2),
    });
    renderHook(() => useOnboardingCoverage(SESSION, 7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(onboardingCoverageAction.mock.calls.length).toBeLessThanOrEqual(12);
  });
});
