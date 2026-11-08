// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Batch 13 (owner, 8 Nov): after Q executed an approved action from the
 * chat, the page beside it kept its old state ("Express interest"). An
 * announced change refreshes the page's server reads, once per burst.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { announcePageDataChanged, PAGE_REFRESH_DEBOUNCE_MS, PageDataRefresher } =
  await import("../src/features/q/page-data-changed");

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the page reads again when Q has changed its data", () => {
  it("refreshes once after an executed action is announced", () => {
    render(<PageDataRefresher />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      announcePageDataChanged();
      announcePageDataChanged();
    });
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PAGE_REFRESH_DEBOUNCE_MS + 10);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an announcement (never polls)", () => {
    render(<PageDataRefresher />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
