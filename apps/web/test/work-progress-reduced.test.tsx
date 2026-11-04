// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runProgress, workStreams } from "../src/features/q/work-progress";

/**
 * N2 under reduced motion (CLAUDE.md, ADR-001): nothing moves. The steps
 * are drawn at rest, with the words and check marks carrying the state.
 * A file of its own: Motion reads the preference once per page.
 */
beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
});

describe("reduced motion", () => {
  it("draws every step at rest, with its words", async () => {
    const { WorkProgressList } =
      await import("../src/features/q/work-progress-view");
    const streams = workStreams(
      runProgress({
        runId: "r",
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "PREPARING_DOCUMENT" },
        ],
        working: true,
        awaitingApproval: false,
        awaitingReply: false,
        failure: null,
        label: (stage) => stage.stage,
      }),
      [],
    );
    render(<WorkProgressList streams={streams} />);
    const steps = document.querySelectorAll<HTMLElement>("[data-q-work-step]");
    expect(steps.length).toBe(2);
    for (const step of steps) expect(step.style.opacity).not.toBe("0");
    expect(screen.getByText("PREPARING_DOCUMENT")).toBeTruthy();
  });
});
