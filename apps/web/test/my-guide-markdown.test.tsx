// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MyEtiquetteGuideDto } from "@capital-q/contracts";

vi.mock("../src/features/etiquette/etiquette-actions", () => ({
  removeMyGuideAction: vi.fn(),
  saveMyGuideAction: vi.fn(),
}));

import { MyGuide } from "../src/features/etiquette/my-guide";

/** F13: an uploaded Markdown guide reads as formatted text, not raw `#` and `**`. */

afterEach(() => {
  cleanup();
});

describe("MyGuide", () => {
  it("shows a Markdown guide formatted", () => {
    const initial = {
      guide: {
        version: 1,
        savedAt: "2026-10-06T10:00:00.000Z",
        fileName: "guide.md",
        text: "# How I write\n\n**Short** sentences.\n\n1. Greet\n2. Ask",
      },
      house: {},
    } as unknown as MyEtiquetteGuideDto;
    const { container } = render(<MyGuide initial={initial} />);
    expect(screen.getByText("Short").tagName).toBe("STRONG");
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.textContent).not.toContain("**");
  });
});
