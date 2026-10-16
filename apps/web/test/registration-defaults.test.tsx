// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FounderOnboardingActions } from "../src/features/founder-onboarding/controller/use-founder-onboarding";
import { CompanyBasicsStep } from "../src/features/founder-onboarding/steps/company-basics-step";
import type { StepProps } from "../src/features/founder-onboarding/steps/step-props";
import { RegistrationDefaultsProvider } from "../src/features/onboarding-kit/registration-defaults";

/**
 * Owner directive 2026-10-16: registration facts are known context. The
 * company typed at sign-up is the form's starting value, recorded only when
 * the founder continues; an answer already saved always wins.
 */
afterEach(cleanup);

function props(
  saved: string | undefined,
): StepProps<"company_basics"> & { submit: ReturnType<typeof vi.fn> } {
  const submit = vi.fn(() => Promise.resolve());
  const reached: Partial<FounderOnboardingActions> = { submit };
  return {
    submit,
    step: {
      id: "company_basics",
      kind: "company_basics",
      section: "company",
      title: "Your company",
      prompt: "What is it called?",
      optional: false,
      skipped: false,
      countries: [],
      ...(saved === undefined
        ? {}
        : { response: { kind: "company_basics", name: saved } }),
    },
    formId: "f",
    busy: false,
    actions: new Proxy(reached, {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : vi.fn(),
    }) as FounderOnboardingActions,
  };
}

function renderWith(saved: string | undefined, registered: string | null) {
  const p = props(saved);
  render(
    <RegistrationDefaultsProvider value={{ organisationName: registered }}>
      <CompanyBasicsStep {...p} />
    </RegistrationDefaultsProvider>,
  );
  return p;
}

describe("the company name from registration", () => {
  it("starts from what was typed at sign-up, and says where it came from", () => {
    renderWith(undefined, "Harbourline Cargo");
    const input = screen.getByLabelText<HTMLInputElement>(/Company name/);
    expect(input.value).toBe("Harbourline Cargo");
    expect(screen.getByText(/From your sign-up/)).toBeTruthy();
  });

  it("is recorded only through the ordinary submit, when they continue", () => {
    const p = renderWith(undefined, "Harbourline Cargo");
    expect(p.submit).not.toHaveBeenCalled();
    const form = screen.getByLabelText(/Company name/).closest("form");
    if (form === null) throw new Error("the step renders its own form");
    fireEvent.submit(form);
    expect(p.submit).toHaveBeenCalledWith({
      kind: "company_basics",
      name: "Harbourline Cargo",
    });
  });

  it("never overrides a saved answer", () => {
    renderWith("Harbourline Logistics", "Harbourline Cargo");
    const input = screen.getByLabelText<HTMLInputElement>(/Company name/);
    expect(input.value).toBe("Harbourline Logistics");
    expect(screen.queryByText(/From your sign-up/)).toBeNull();
  });

  it("starts empty when nothing was typed at sign-up", () => {
    renderWith(undefined, null);
    expect(screen.getByLabelText<HTMLInputElement>(/Company name/).value).toBe(
      "",
    );
  });
});
