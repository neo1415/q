// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerCardsDrawn,
  SETTLE_MAX_MS,
  SETTLE_QUIET_MS,
  useSettledReveal,
} from "../src/features/q/settled-reveal";

/**
 * CLS (batch 7, 0.55 at 390 on /home?c=): restored history landed over
 * several frames. It is now drawn hidden until it has settled; a question
 * the person asks is never hidden.
 */
function Thread({ count }: { readonly count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useSettledReveal(ref, count);
  return (
    <div ref={ref} data-settling={settling ? "yes" : "no"}>
      {count}
    </div>
  );
}

const state = () =>
  document.querySelector("[data-settling]")?.getAttribute("data-settling");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a restored conversation is shown once settled", () => {
  it("history arriving (none, then several) is hidden until quiet", () => {
    const view = render(<Thread count={0} />);
    expect(state()).toBe("no");
    view.rerender(<Thread count={5} />);
    expect(state()).toBe("yes");
    act(() => {
      vi.advanceTimersByTime(SETTLE_QUIET_MS + 10);
    });
    expect(state()).toBe("no");
  });

  it("is never hidden longer than the cap", () => {
    const view = render(<Thread count={0} />);
    view.rerender(<Thread count={4} />);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MAX_MS + 10);
    });
    expect(state()).toBe("no");
  });

  it("waits for lazily drawn answer cards, within the cap", () => {
    function Cards({ drawn }: { readonly drawn: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const settling = useSettledReveal(ref, 3, answerCardsDrawn, true);
      return (
        <div ref={ref} data-settling={settling ? "yes" : "no"}>
          <div data-q-static-cards>{drawn ? <section data-ac /> : null}</div>
        </div>
      );
    }
    const view = render(<Cards drawn={false} />);
    // Mounted with several rows already (the Workspace pane): settling.
    expect(state()).toBe("yes");
    act(() => {
      vi.advanceTimersByTime(SETTLE_QUIET_MS * 3);
    });
    expect(state()).toBe("yes");
    view.rerender(<Cards drawn />);
    act(() => {
      vi.advanceTimersByTime(SETTLE_QUIET_MS + 10);
    });
    expect(state()).toBe("no");
  });

  it("without settleOnMount, a thread mounting with rows is shown at once", () => {
    render(<Thread count={4} />);
    expect(state()).toBe("no");
  });

  it("a question being asked (none, then one) is never hidden", () => {
    const view = render(<Thread count={0} />);
    view.rerender(<Thread count={1} />);
    expect(state()).toBe("no");
    view.rerender(<Thread count={2} />);
    expect(state()).toBe("no");
  });
});
