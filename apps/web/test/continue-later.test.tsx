// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-10-16: "Continue later", in the form and in the Q interview.
 * One warm line that what was confirmed is saved, then into the app; it
 * records nothing of its own, so every saved answer stays where it is, and
 * the reminder's one tap reopens the mode last used.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { ContinueLater, CONTINUE_LATER_LINE, CONTINUE_LATER_PAUSE_MS } =
  await import("../src/features/onboarding-kit/components/continue-later");
const { openingMode, readLastMode, writeLastMode } =
  await import("../src/features/onboarding-kit/last-mode");
const { createFixtureRuntimePort } =
  await import("../src/features/founder-onboarding/adapters/fixture-port");
const { createRuntimeFounderClient } =
  await import("../src/features/founder-onboarding/adapters/runtime-port");

beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Continue later", () => {
  it("says, in one line, that what was confirmed is saved, then lets them into the app", () => {
    vi.useFakeTimers();
    render(<ContinueLater />);
    act(() => {
      screen.getByRole("button", { name: "Continue later" }).click();
    });
    expect(screen.getByRole("status").textContent).toBe(CONTINUE_LATER_LINE);
    expect(push).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(CONTINUE_LATER_PAUSE_MS);
    });
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("keeps every saved answer: the session resumes exactly where it was", async () => {
    const SOURCE = { adapter: "fixture", synthetic: true } as const;
    const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
    const before = createRuntimeFounderClient(port, SOURCE);
    await before.getSession();
    await before.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising_now" },
    });
    const left = await port.current();
    // ...they press Continue later, use the app, and come back...
    const after = createRuntimeFounderClient(port, SOURCE);
    const resumed = await after.getSession();
    const view = await port.current();
    expect(view?.responses).toEqual(left?.responses);
    expect(view?.session.currentStepKey).toBe(left?.session.currentStepKey);
    expect(resumed.currentStepId).not.toBe("intent");
  });
});

describe("resuming in the mode last used", () => {
  it("reopens the form, the typed conversation or Q's voice", () => {
    writeLastMode("founder", "form");
    expect(
      openingMode({ journey: "founder", startTalking: false, resuming: true }),
    ).toEqual({ mode: "form", talk: false });
    writeLastMode("founder", "voice");
    expect(
      openingMode({ journey: "founder", startTalking: false, resuming: true }),
    ).toEqual({ mode: "conversation", talk: true });
    writeLastMode("investor", "conversation");
    expect(
      openingMode({ journey: "investor", startTalking: false, resuming: true }),
    ).toEqual({ mode: "conversation", talk: false });
  });

  it("opens voice only on a resume, never unasked on a plain visit", () => {
    writeLastMode("investor", "voice");
    expect(
      openingMode({
        journey: "investor",
        startTalking: false,
        resuming: false,
      }),
    ).toEqual({ mode: "conversation", talk: false });
  });

  it("keeps the founder's earlier remembered choice (same key)", () => {
    window.localStorage.setItem("cq.onboarding.founder.mode", "form");
    expect(readLastMode("founder")).toBe("form");
  });
});

describe("the reminder as one thing waiting on Home arrival", () => {
  it("counts once, only when today's reminder is due for an unfinished setup", async () => {
    const { setupRemindersWaiting } =
      await import("../src/features/home/returning");
    const base = {
      context: { kind: "NONE" },
      name: null,
      feed: "UNKNOWN",
      pitch: "UNKNOWN",
      deck: { kind: "UNKNOWN" },
    } as const;
    expect(
      setupRemindersWaiting({
        ...base,
        unfinished: "founder",
        setupReminder: "WELCOME",
      }),
    ).toBe(1);
    expect(setupRemindersWaiting({ ...base, unfinished: "founder" })).toBe(0);
    expect(
      setupRemindersWaiting({
        ...base,
        unfinished: null,
        setupReminder: "WELCOME",
      }),
    ).toBe(0);
  });
});

describe("a typed turn's navigate (coordinator 2026-10-28)", () => {
  it("a plain reply, or any other destination, never leaves the screen by itself", async () => {
    const { pausingDestination } =
      await import("../src/features/onboarding-kit/components/continue-later");
    expect(pausingDestination(null, "investor")).toBeNull();
    expect(pausingDestination(undefined, "founder")).toBeNull();
    expect(pausingDestination("DISCOVER", "investor")).toBeNull();
    expect(pausingDestination("PROFILE", "founder")).toBeNull();
  });

  it("a pausing result leaves to the journey's own destination, as Continue later does", async () => {
    const { pausingDestination } =
      await import("../src/features/onboarding-kit/components/continue-later");
    expect(pausingDestination("HOME", "investor")).toBe("/discover");
    expect(pausingDestination("HOME", "founder")).toBe("/home");
    expect(pausingDestination("HOME", undefined)).toBe("/home");
  });
});
