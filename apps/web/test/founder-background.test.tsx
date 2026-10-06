// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
vi.mock("../src/features/profile/founder-background-actions", () => ({
  saveFounderBackgroundAction: (input: unknown) =>
    save(input) as Promise<unknown>,
}));

import { FounderBackground } from "../src/features/profile/founder-background";

/**
 * F4: a founder states their title, previous roles and education on
 * /profile; only what changed is saved, against the version read.
 */

afterEach(() => {
  cleanup();
  save.mockReset();
});

describe("FounderBackground", () => {
  it("saves the title and the background, with the version read", async () => {
    save.mockResolvedValue({ ok: true, version: 3 });
    render(
      <FounderBackground
        initial={{
          businessTitle: "CEO",
          previousRoles: "",
          education: "",
          version: 2,
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your title at the company"), {
      target: { value: "Co-founder & CEO" },
    });
    fireEvent.change(screen.getByLabelText("Education and background"), {
      target: { value: "BSc Computer Science, University of Lagos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save background" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(save).toHaveBeenCalledWith({
      businessTitle: "Co-founder & CEO",
      previousRoles: "",
      education: "BSc Computer Science, University of Lagos",
      titleChanged: true,
      summariesChanged: true,
      expectedVersion: 2,
    });
  });

  it("does not call the API when nothing changed", () => {
    render(
      <FounderBackground
        initial={{
          businessTitle: "CEO",
          previousRoles: "",
          education: "",
          version: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save background" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing changed.")).toBeTruthy();
  });
});
