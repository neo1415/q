// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FounderOnboardingActions } from "../src/features/founder-onboarding/controller/use-founder-onboarding";
import { CompanyBasicsStep } from "../src/features/founder-onboarding/steps/company-basics-step";
import type { StepProps } from "../src/features/founder-onboarding/steps/step-props";

/**
 * Founder live 2026-10-05: research found the company's website, and the
 * form never offered it. It is offered in place, as one tap, and nothing
 * is recorded until the person continues.
 */
function props(
  suggestedWebsite: string | undefined,
): StepProps<"company_basics"> {
  const submit = vi.fn(() => Promise.resolve());
  return {
    step: {
      id: "company_basics",
      kind: "company_basics",
      section: "company",
      title: "Your company",
      prompt: "What is it called?",
      optional: false,
      skipped: false,
      countries: [],
      ...(suggestedWebsite === undefined ? {} : { suggestedWebsite }),
    },
    formId: "f",
    busy: false,
    // Only submit is reached from this step; the rest are never called.
    actions: new Proxy({ submit } as Partial<FounderOnboardingActions>, {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : vi.fn(),
    }) as FounderOnboardingActions,
  };
}

describe("the website Q found, on the form", () => {
  it("fills the website with one tap", () => {
    render(<CompanyBasicsStep {...props("https://www.zinoaviation.com/")} />);
    expect(screen.getByText(/Q found zinoaviation\.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    const input = screen.getByLabelText("Website") as HTMLInputElement;
    expect(input.value).toBe("https://www.zinoaviation.com/");
    // Offered once: a filled field needs no suggestion beside it.
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
  });

  it("offers nothing when research found nothing", () => {
    render(<CompanyBasicsStep {...props(undefined)} />);
    expect(document.querySelector("[data-suggested-website]")).toBeNull();
  });
});
