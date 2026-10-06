// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FounderOnboardingActions } from "../src/features/founder-onboarding/controller/use-founder-onboarding";
import type { StepViewOfKind } from "../src/features/founder-onboarding/models/presentation";
import { TaxonomyStep } from "../src/features/founder-onboarding/steps/taxonomy-step";

/**
 * F2: the category step searches. A founder whose description does not use
 * a category's own words finds it by name and keeps it; reaching the limit
 * says so instead of silently stopping (the F18 lesson, here too).
 */

afterEach(() => {
  cleanup();
});

const FINTECH = {
  nodeId: "00000000-0000-4000-8000-000000000f01",
  label: "Fintech",
  vocabularyLabel: "Industry",
};

describe("TaxonomyStep search", () => {
  it("finds a category by name and keeps it on Continue", async () => {
    const find = vi.fn((text: string) =>
      Promise.resolve(text === "fintech" ? [FINTECH] : []),
    );
    const submit = vi.fn(() => Promise.resolve());
    const actions = {
      findTaxonomyCandidates: find,
      submit,
      skip: vi.fn(),
    } as unknown as FounderOnboardingActions;
    const step = {
      id: "taxonomy",
      kind: "taxonomy_select",
      title: "Categories",
      optional: true,
      sourceText: "We check every invoice and file VAT returns",
      maxItems: 8,
      selected: [],
    } as unknown as StepViewOfKind<"taxonomy_select">;
    render(
      <TaxonomyStep step={step} formId="f" busy={false} actions={actions} />,
    );
    // The description is still the first source of suggestions.
    await waitFor(() => {
      expect(find).toHaveBeenCalledWith(
        "We check every invoice and file VAT returns",
      );
    });
    fireEvent.change(screen.getByLabelText("Search for a category"), {
      target: { value: "fintech" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const chip = await screen.findByRole("button", { name: /Fintech/u });
    fireEvent.click(chip);
    // Kept: it moves up among the chosen ones, pressed.
    const kept = screen.getByRole("button", {
      name: /Fintech/u,
      pressed: true,
    });
    fireEvent.submit(kept.closest("form") as HTMLFormElement);
    expect(submit).toHaveBeenCalledWith({
      kind: "taxonomy_select",
      nodeIds: [FINTECH.nodeId],
    });
  });
});
