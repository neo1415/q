// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useHeldReply } from "../src/features/onboarding-conversation/held-reply";

/**
 * Coordinator 25 Oct (fresh founder e2e-f-1403): after Q read the deck
 * back, the onboarding heading still showed Q's previous question. A
 * reply is bound to the step on screen whether or not the turn moved it.
 */
describe("useHeldReply", () => {
  it("binds Q's read-back to the heading when the step did not move", () => {
    const bind = vi.fn();
    const prompt = { stepKey: "founder.deck" };
    const { result } = renderHook(() => useHeldReply(prompt, bind));
    act(() => {
      result.current.hold("Your deck says ARR is $1.2M. Is that right?");
    });
    expect(bind).toHaveBeenLastCalledWith({
      stepKey: "founder.deck",
      text: "Your deck says ARR is $1.2M. Is that right?",
    });
    // And the next reply on the same step replaces it.
    act(() => {
      result.current.hold("Thanks. What's your monthly burn?");
    });
    expect(bind).toHaveBeenLastCalledWith({
      stepKey: "founder.deck",
      text: "Thanks. What's your monthly burn?",
    });
  });

  it("binds to the step Q moved to, once the screen has it", () => {
    const bind = vi.fn();
    const { result, rerender } = renderHook(
      ({ step }: { step: string }) => useHeldReply({ stepKey: step }, bind),
      { initialProps: { step: "founder.company" } },
    );
    bind.mockClear();
    act(() => {
      // The re-read session moves the step in the same update.
      result.current.hold("What stage is the company at?");
      rerender({ step: "founder.stage" });
    });
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenLastCalledWith({
      stepKey: "founder.stage",
      text: "What stage is the company at?",
    });
  });

  it("a dropped reply is never bound", () => {
    const bind = vi.fn();
    const prompt = { stepKey: "founder.deck" };
    const { result } = renderHook(() => useHeldReply(prompt, bind));
    act(() => {
      result.current.drop();
    });
    expect(bind).not.toHaveBeenCalled();
  });
});
