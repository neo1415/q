// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComparisonCards, monogram } from "../src/features/q/comparison-cards";

/**
 * A comparison as cards (founder design 2026-09-28): the items in the
 * order Q wrote them, each with its points and a real way to ask about it,
 * and nothing that reads as a rank.
 */

afterEach(cleanup);

const BLOCK = {
  kind: "COMPARISON_CARDS" as const,
  title: "Ledgerfold and Kivu Freight",
  items: [
    { name: "Ledgerfold", subtitle: "Seed · Lagos", points: ["USD 40k MRR"] },
    { name: "Kivu Freight", subtitle: null, points: ["Not known", "Pre-seed"] },
  ],
};

describe("comparison cards", () => {
  it("keeps the written order, shows every point and marks no winner", () => {
    render(<ComparisonCards block={BLOCK} />);
    const region = screen.getByRole("region", {
      name: "Ledgerfold and Kivu Freight",
    });
    const cards = region.querySelectorAll("[data-q-comparison-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Ledgerfold");
    expect(cards[1]?.textContent).toContain("Kivu Freight");
    expect(within(region).getByText("Not known")).toBeTruthy();
    expect(region.textContent).not.toMatch(/#1|best|winner|recommended/i);
    // No ask button without somewhere to ask.
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("asks Q about one item in the same thread", () => {
    const onAsk = vi.fn<(question: string) => void>();
    render(<ComparisonCards block={BLOCK} onAsk={onAsk} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ask Q about Kivu Freight" }),
    );
    expect(onAsk).toHaveBeenCalledWith("Tell me more about Kivu Freight.");
  });

  it("draws a monogram from the name", () => {
    expect(monogram("Kivu Freight Ltd")).toBe("KF");
    expect(monogram("ledgerfold")).toBe("LE");
    expect(monogram("Ölçü")).toBe("ÖL");
  });
});
