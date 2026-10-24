// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QStreamEvent } from "@capital-q/contracts";

/**
 * Egress review (2026-10-24): a run Q prepares is followed on its event
 * stream, read once when it settles, not every 1.2 s; the paced poll is
 * only the fallback when the stream is unavailable.
 */

const actions = vi.hoisted(() => ({ preparedAction: vi.fn() }));
vi.mock("@/features/work/work-page-actions", () => actions);

type Handlers = { onEvent: (event: QStreamEvent) => void };
const transport = vi.hoisted(() => ({
  streamQRunEvents: vi.fn(),
}));
vi.mock("@/features/q/q-stream-transport", () => transport);

const { usePrepared, settlesPrepared } =
  await import("../src/features/work/use-prepared");

const RUN = "a0000000-0000-4000-8000-0000000000aa";
const WORKING = { ok: true, value: { state: "WORKING" } } as const;
const CARD = {
  ok: true,
  value: {
    state: "APPROVAL",
    approvalId: "b0000000-0000-4000-8000-0000000000bb",
  },
} as const;

beforeEach(() => {
  actions.preparedAction.mockReset();
  transport.streamQRunEvents.mockReset();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePrepared", () => {
  it("reads once, then waits on the stream and reads again when the run settles", async () => {
    let handlers: Handlers | undefined;
    let close: ((value: { reason: string }) => void) | undefined;
    transport.streamQRunEvents.mockImplementation(
      (_session: unknown, _run: string, options: Handlers) => {
        handlers = options;
        return new Promise((resolve) => {
          close = resolve;
        });
      },
    );
    actions.preparedAction.mockResolvedValueOnce(WORKING);
    const { result } = renderHook(() => usePrepared(RUN));
    await waitFor(() => expect(handlers).toBeDefined());
    expect(result.current).toEqual({ state: "WORKING" });
    expect(actions.preparedAction).toHaveBeenCalledTimes(1);

    actions.preparedAction.mockResolvedValueOnce(CARD);
    act(() => {
      handlers?.onEvent({ type: "q.approval.required" } as QStreamEvent);
    });
    await waitFor(() => expect(result.current).toEqual(CARD.value));
    expect(actions.preparedAction).toHaveBeenCalledTimes(2);
    close?.({ reason: "ABORTED" });
  });

  it("falls back to a paced poll when the stream is unavailable", async () => {
    vi.useFakeTimers();
    transport.streamQRunEvents.mockResolvedValue({ reason: "GAVE_UP" });
    actions.preparedAction.mockResolvedValue(WORKING);
    renderHook(() => usePrepared(RUN));
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.preparedAction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(actions.preparedAction).toHaveBeenCalledTimes(2);
    // Backed off: not again within the first pace.
    await vi.advanceTimersByTimeAsync(1_200);
    expect(actions.preparedAction).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(actions.preparedAction).toHaveBeenCalledTimes(3);
  });

  it("settles on approval, input, completion and failure, not on progress", () => {
    for (const type of [
      "q.approval.required",
      "q.input.required",
      "q.run.completed",
      "q.run.failed",
    ])
      expect(settlesPrepared({ type } as QStreamEvent)).toBe(true);
    expect(settlesPrepared({ type: "q.stage.changed" } as QStreamEvent)).toBe(
      false,
    );
  });
});
