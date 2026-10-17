// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_DISCOVER_FILTERS } from "@capital-q/contracts";
import { DiscoverFilterSheet } from "../src/features/discover/filters/discover-filter-controls";
import { activeFilterChips } from "../src/features/discover/filters/discover-filters";

afterEach(cleanup);

describe("premium Unicorn Potential Discover control", () => {
  it("does not allow a free client to choose a premium threshold", () => {
    render(
      <DiscoverFilterSheet
        filters={NO_DISCOVER_FILTERS}
        sectors={[]}
        onChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>(
      "Minimum indicator score",
    );
    expect(select.disabled).toBe(true);
    expect(
      screen.getByText("Available with premium investor intelligence."),
    ).toBeTruthy();
  });
  it("applies an explicit premium filter only when submitted and supports clearing it", () => {
    const onChange = vi.fn();
    render(
      <DiscoverFilterSheet
        filters={NO_DISCOVER_FILTERS}
        sectors={[]}
        onChange={onChange}
        open
        onOpenChange={vi.fn()}
        canUnicorn
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>(
      "Minimum indicator score",
    );
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "80" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show companies" }));
    expect(onChange).toHaveBeenCalledWith({
      ...NO_DISCOVER_FILTERS,
      unicornMinimum: 80,
    });
    const chips = activeFilterChips(
      { ...NO_DISCOVER_FILTERS, unicornMinimum: 80 },
      [],
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe("Unicorn Potential 80+");
    expect(chips[0]?.without.unicornMinimum).toBeNull();
  });
});
