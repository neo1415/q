// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngagementEventInput } from "@capital-q/contracts";

import { useDeckEngagement } from "../src/features/engagement/use-engagement";

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const DECK = "f0000000-0000-4000-8000-000000000002";

/** Every event the page sent, from the batched reporter's requests. */
function sentEvents(
  fetchMock: ReturnType<typeof vi.fn>,
): EngagementEventInput[] {
  return fetchMock.mock.calls.flatMap((call) => {
    const init = call[1] as { body?: string } | undefined;
    const body = JSON.parse(init?.body ?? "{}") as {
      events?: EngagementEventInput[];
    };
    return body.events ?? [];
  });
}

describe("deck collection point (Q Workspace §8 A1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 202 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports the open once, then time per slide, and never a flick past one", () => {
    const { rerender, unmount } = renderHook(
      (props: { slide: number; enabled: boolean }) =>
        useDeckEngagement({
          enabled: props.enabled,
          companyId: COMPANY,
          documentId: DECK,
          slide: props.slide,
        }),
      { initialProps: { slide: 1, enabled: true } },
    );
    vi.advanceTimersByTime(4_000);
    rerender({ slide: 2, enabled: true });
    // A flick: well under a second on slide 2.
    vi.advanceTimersByTime(300);
    rerender({ slide: 3, enabled: true });
    vi.advanceTimersByTime(2_500);
    unmount();
    window.dispatchEvent(new Event("pagehide"));

    const events = sentEvents(fetchMock);
    expect(events.filter((event) => event.type === "DECK_OPEN")).toHaveLength(
      1,
    );
    const dwell = events
      .filter((event) => event.type === "DECK_SLIDE_DWELL")
      .map((event) =>
        event.type === "DECK_SLIDE_DWELL"
          ? [event.slideNumber, event.durationMs]
          : null,
      );
    expect(dwell).toEqual([
      [1, 4_000],
      [3, 2_500],
    ]);
    for (const event of events) {
      expect(Object.keys(event)).not.toContain("viewerUserId");
    }
  });

  it("reports nothing for the owner's own preview", () => {
    const { unmount } = renderHook(() =>
      useDeckEngagement({
        enabled: false,
        companyId: COMPANY,
        documentId: DECK,
        slide: 1,
      }),
    );
    vi.advanceTimersByTime(5_000);
    unmount();
    window.dispatchEvent(new Event("pagehide"));
    expect(sentEvents(fetchMock)).toEqual([]);
  });
});
