// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StageStrip } from "@/features/relationships/stage-strip";

describe("StageStrip (owner reference design, 24 Oct)", () => {
  it("is one bar of stages with the biggest named in words", () => {
    const { container } = render(
      <StageStrip
        counts={{ CONNECTED: 7, IN_DILIGENCE: 1, INTEREST_EXPRESSED: 1 }}
        needsYou={2}
      />,
    );
    expect(container.querySelectorAll("[data-stage-segment]")).toHaveLength(3);
    expect(
      screen.getByText(/7 connected · 1 .+ · 2 waiting on you/u),
    ).toBeTruthy();
  });

  it("shows nothing for an empty pipeline", () => {
    const { container } = render(<StageStrip counts={{}} needsYou={0} />);
    expect(container.querySelector("[data-stage-strip]")).toBeNull();
  });
});
