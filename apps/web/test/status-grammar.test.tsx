// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountUp } from "@/components/status/count-up";
import { StatusDot } from "@/components/status/status-dot";

describe("status grammar (owner reference design, 24 Oct)", () => {
  it("is a dot and its word; only working breathes", () => {
    const { container, rerender } = render(
      <StatusDot tone="working" label="Working" />,
    );
    expect(screen.getByText("Working")).toBeTruthy();
    expect(container.querySelector(".cq-status-breathe")).not.toBeNull();
    rerender(<StatusDot tone="waiting" label="Waiting for you" />);
    expect(container.querySelector(".cq-status-breathe")).toBeNull();
    expect(container.querySelector("[data-status=waiting]")).not.toBeNull();
  });

  it("gives assistive tech the settled count", () => {
    render(<CountUp value={12} />);
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });
});
