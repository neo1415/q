// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QResultCard } from "@/features/q/q-result-blocks";

describe("QResultCard title (QA F-72)", () => {
  it("does not repeat a title that only restates the label", () => {
    render(<QResultCard label="Side by side" title="Side by side" />);
    expect(screen.getAllByText("Side by side")).toHaveLength(1);
  });

  it("keeps a title that says something of its own", () => {
    render(<QResultCard label="Side by side" title="Mizan and Silo Credit" />);
    expect(screen.getByText("Mizan and Silo Credit")).toBeTruthy();
  });
});
