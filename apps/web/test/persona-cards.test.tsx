// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PersonaCards } from "../src/features/persona/persona-cards";

/**
 * Choosing which side of the table you are on (QX-001 §12; QX-002 §A5).
 *
 * The same component answers Q's first question and sits on Home, so
 * these hold for both. What matters is that it is a real radio group: a
 * person arrows between the options, the selected one says so in words
 * rather than only by its outline, and nothing is committed until they
 * commit it. Two divs with click handlers would pass a screenshot and
 * fail every one of these.
 */

describe("the two roles", () => {
  it("are offered as a radio group with one tab stop", () => {
    render(<PersonaCards />);
    const group = screen.getByRole("radiogroup", {
      name: "What are you here to do?",
    });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(2);
    // One stop into the group, then arrows within it.
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });

  it("say which is selected in words, never by outline alone", () => {
    render(<PersonaCards />);
    const [first, second] = screen.getAllByRole("radio");
    expect(first?.getAttribute("aria-checked")).toBe("true");
    expect(first?.textContent).toContain("selected");
    expect(second?.getAttribute("aria-checked")).toBe("false");
    expect(second?.textContent).not.toContain("selected");
  });

  it("move with the arrow keys", () => {
    render(<PersonaCards />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    const [founder, investor] = screen.getAllByRole("radio");
    expect(founder?.getAttribute("aria-checked")).toBe("false");
    expect(investor?.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getAllByRole("radio")[0]?.getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("commit nothing until the person commits it", () => {
    render(<PersonaCards />);
    // Selecting is reading, not deciding.
    fireEvent.click(screen.getAllByRole("radio")[1] as HTMLElement);
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Continue as investor" }),
    ).toBeTruthy();
  });
});

describe("continuing", () => {
  it("sends a founder to the founder path and says so first", () => {
    push.mockClear();
    const chosen = vi.fn();
    render(<PersonaCards onChoose={chosen} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue as founder" }),
    );
    expect(chosen).toHaveBeenCalledWith("founder");
    expect(push).toHaveBeenCalledWith("/onboarding/founder");
  });

  it("sends an investor to the investor path", () => {
    push.mockClear();
    render(<PersonaCards />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue as investor" }),
    );
    // The canonical role is established by the onboarding path under the
    // person's own authority. This component only takes them there.
    expect(push).toHaveBeenCalledWith("/onboarding/investor");
  });
});
