// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canCompare,
  compareQuestion,
  toggleSelection,
} from "../src/features/discover/saved-compare";

/**
 * Compare from Saved (doc 10 §9, §15.1 step 6): 2 to 5 saved companies,
 * handed to Q as a draft question the person sends themselves.
 */
const askAbout = vi.fn();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: vi.fn(), askAbout }),
}));

afterEach(() => {
  cleanup();
  askAbout.mockReset();
});

describe("saved-compare helpers", () => {
  it("allows 2 to 5 companies", () => {
    expect([0, 1, 2, 5, 6].map(canCompare)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("words the question and keeps missing values missing", () => {
    expect(compareQuestion(["Acme", "Beta", "Cora"])).toBe(
      "Compare Acme, Beta and Cora against my mandate. Keep anything not on record as not stated.",
    );
  });

  it("refuses a sixth pick instead of swapping one out", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(toggleSelection(five, "f")).toBe(five);
    expect(toggleSelection(five, "c")).toEqual(["a", "b", "d", "e"]);
  });
});

describe("SavedCompanies", () => {
  it("opens Q with the comparison drafted once two are ticked", async () => {
    const { SavedCompanies } =
      await import("../src/features/discover/saved-companies");
    render(
      <SavedCompanies
        companies={[
          { companyId: "1", name: "Acme", facts: null, description: null },
          { companyId: "2", name: "Beta", facts: "Seed", description: null },
          { companyId: "3", name: "Cora", facts: null, description: null },
        ]}
      />,
    );
    const compare = screen.getByRole("button", { name: "Compare with Q" });
    expect(compare).toHaveProperty("disabled", true);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Select Acme to compare"));
    expect(compare).toHaveProperty("disabled", true);
    await user.click(screen.getByLabelText("Select Beta to compare"));
    expect(compare).toHaveProperty("disabled", false);
    await user.click(compare);
    expect(askAbout).toHaveBeenCalledWith(
      "Compare Acme and Beta against my mandate. Keep anything not on record as not stated.",
    );
  });
});
