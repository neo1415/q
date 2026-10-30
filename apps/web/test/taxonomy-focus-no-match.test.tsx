// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  noMatchLine,
  TaxonomyFocusStep,
} from "../src/features/investor-onboarding/steps/taxonomy-focus-step";

/**
 * Live onboarding sweep 2026-10-29 (D2): the investor geography search for
 * "Benelux" found nothing and the screen said nothing at all.
 */
afterEach(cleanup);

describe("a geography search that finds nothing", () => {
  it("says so in words, naming what was searched", async () => {
    const findTaxonomyCandidates = vi.fn(() => Promise.resolve([]));
    const props = {
      step: {
        id: "geography",
        kind: "taxonomy_focus",
        title: "Where do you invest?",
        prompt: "Where do you invest?",
        searchLabel: "Search places",
        searchPlaceholder: "A country or region",
        emptyHint: "Nothing chosen yet.",
        selected: [],
        avoidSelected: [],
        maxItems: 20,
        allowAvoid: false,
      },
      formId: "f",
      busy: false,
      actions: new Proxy(
        { findTaxonomyCandidates },
        {
          get: (target, key) =>
            key in target ? target[key as keyof typeof target] : vi.fn(),
        },
      ),
    } as unknown as Parameters<typeof TaxonomyFocusStep>[0];
    render(<TaxonomyFocusStep {...props} />);
    fireEvent.change(screen.getByLabelText("Search places"), {
      target: { value: "Benelux" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        noMatchLine("Benelux"),
      ),
    );
    expect(noMatchLine("Benelux")).toContain("“Benelux”");
  });
});
