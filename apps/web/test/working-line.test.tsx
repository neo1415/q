// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkingLine,
  WorkingProgress,
} from "../src/components/working/working-line";

/**
 * The shared one-line working component (round 4), as other areas use it
 * (onboarding: "Saving your round size"): plain words in, one line out,
 * and a determinate bar only when a real total is given.
 */

afterEach(cleanup);

describe("WorkingLine", () => {
  it("is one polite line with the words given", () => {
    render(<WorkingLine label="Saving your round size" />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe("Saving your round size");
    // One line high: the words truncate, never wrap.
    expect(line.querySelector("span")?.className).toContain("truncate");
    // No live mark unless real work is said to be running.
    expect(line.querySelector("[data-working-mark]")).toBeNull();
  });

  it("turns the live mark beside the words only while real work runs", () => {
    const { container, rerender } = render(
      <WorkingLine label="Looking at Nixo" active />,
    );
    const mark = container.querySelector("[data-working-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelector(".cq-working-sweep")).not.toBeNull();
    // Nothing to say: no mark, even if active.
    rerender(<WorkingLine label={null} active reserve />);
    expect(container.querySelector("[data-working-mark]")).toBeNull();
  });

  it("holds its line with nothing to say when reserved, and is gone otherwise", () => {
    const { container, rerender } = render(
      <WorkingLine label={null} reserve />,
    );
    expect(container.querySelector("p")?.textContent).toBe(" ");
    rerender(<WorkingLine label={null} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("does not announce inside a region that already does", () => {
    render(<WorkingLine label="Looking up Nixo" live={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("WorkingProgress", () => {
  it("shows the real count as a determinate bar", () => {
    render(
      <WorkingProgress
        title="Deck for Nixo"
        detail={["2 of 4", "Laying out each page"]}
        progress={{ step: 2, of: 4 }}
        progressText="2 of 4: Laying out each page"
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect(bar.children).toHaveLength(4);
    expect(screen.getByRole("status").textContent).toBe(
      "Deck for Nixo · 2 of 4 · Laying out each page",
    );
  });

  it("draws no bar when no real total is known", () => {
    render(<WorkingProgress title="Brief for Nixo" detail={["Writing"]} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
