// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FictionalNames,
  withoutFictionalMark,
} from "@/components/app-shell/fictional-names";

afterEach(cleanup);

describe("fictional names (demo audit 2026-10-03)", () => {
  it("drops the mark from a name, and only the mark", () => {
    expect(withoutFictionalMark("Savanna Seed Partners (fictional)")).toBe(
      "Savanna Seed Partners",
    );
    expect(withoutFictionalMark("Ledgerfold")).toBe("Ledgerfold");
  });

  it("shows names without it and says so once, at the foot of the page", async () => {
    render(
      <main>
        <h1>Savanna Seed Partners (fictional)</h1>
        <p>Lagoon Angels Circle (fictional) declined.</p>
        <textarea defaultValue="Kept as typed (fictional)" />
        <FictionalNames />
      </main>,
    );
    await act(async () => {});
    expect(screen.getByRole("heading").textContent).toBe(
      "Savanna Seed Partners",
    );
    expect(screen.getByText("Lagoon Angels Circle declined.")).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Kept as typed (fictional)",
    );
    expect(document.querySelectorAll("[data-fictional-note]")).toHaveLength(1);
  });

  it("says nothing on a page with no marked name", async () => {
    render(
      <main>
        <h1>Ledgerfold</h1>
        <FictionalNames />
      </main>,
    );
    await act(async () => {});
    expect(document.querySelector("[data-fictional-note]")).toBeNull();
  });
});
