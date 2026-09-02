// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BUTTON_VARIANTS,
  Button,
  buttonClassName,
  IconButton,
} from "../src/components/button.js";

describe("Button", () => {
  it.each(BUTTON_VARIANTS)(
    "renders the %s variant as a real button",
    (variant) => {
      render(<Button variant={variant}>Continue</Button>);
      const button = screen.getByRole("button", { name: "Continue" });
      expect(button.dataset["variant"]).toBe(variant);
      expect(button.getAttribute("type")).toBe("button");
    },
  );

  it("defaults to secondary at the regular (44px) size", () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole("button", { name: "Default" });
    expect(button.dataset["variant"]).toBe("secondary");
    expect(button.dataset["size"]).toBe("regular");
    expect(button.className).toContain("h-11");
  });

  it("exposes its classes for router links without a router dependency", () => {
    expect(buttonClassName("primary")).toContain("bg-(--cq-accent)");
    expect(buttonClassName("secondary", "compact", "w-full")).toContain(
      "w-full",
    );
  });

  it("uses only --cq-* tokens, never raw colours", () => {
    for (const variant of BUTTON_VARIANTS) {
      expect(buttonClassName(variant)).not.toMatch(/#[0-9a-f]{3,6}|--color-/i);
    }
  });
});

describe("IconButton", () => {
  it("carries an accessible name and a 44px touch target", () => {
    render(
      <IconButton aria-label="Send to Q">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Send to Q" });
    expect(button.className).toContain("size-11");
  });
});
