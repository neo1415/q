// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/home/setup-nudge-actions", () => ({
  claimSetupReminderAction: () => Promise.resolve(true),
  remindSetupLaterAction: () => Promise.resolve(true),
}));

const { resetSetupReminderClaim, useClaimWhenSeen } =
  await import("../src/features/home/use-claim-when-seen");

/**
 * Today's setup reminder is counted only when its card is really seen: on
 * screen in a visible tab. A prefetched Home never mounts the card, a
 * background tab waits, and one page load claims once.
 */

let observed: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
let visibility: DocumentVisibilityState = "visible";

class FakeObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
}

function Card({ claim }: { readonly claim: () => Promise<unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  useClaimWhenSeen(ref, true, claim);
  return <div ref={ref}>card</div>;
}

beforeEach(() => {
  observed = [];
  visibility = "visible";
  resetSetupReminderClaim();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const seen = (isIntersecting: boolean) => {
  act(() => {
    for (const callback of observed) callback([{ isIntersecting }]);
  });
};

describe("claiming today's setup reminder", () => {
  it("waits until the card is on screen", () => {
    const claim = vi.fn(() => Promise.resolve());
    render(<Card claim={claim} />);
    expect(claim).not.toHaveBeenCalled();
    seen(false);
    expect(claim).not.toHaveBeenCalled();
    seen(true);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("waits in a background tab until it is shown", () => {
    visibility = "hidden";
    const claim = vi.fn(() => Promise.resolve());
    render(<Card claim={claim} />);
    seen(true);
    expect(claim).not.toHaveBeenCalled();
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("claims once per page load, whichever surface carries it", () => {
    const claim = vi.fn(() => Promise.resolve());
    render(
      <>
        <Card claim={claim} />
        <Card claim={claim} />
      </>,
    );
    seen(true);
    seen(true);
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
