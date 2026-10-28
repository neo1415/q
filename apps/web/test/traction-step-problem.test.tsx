// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FounderOnboardingActions } from "../src/features/founder-onboarding/controller/use-founder-onboarding";
import { TractionStep } from "../src/features/founder-onboarding/steps/traction-step";
import type { StepProps } from "../src/features/founder-onboarding/steps/step-props";

/**
 * Live typed run 2026-10-28, D3 (form fallback): Continue did nothing eight
 * times on an unanswered required radio, because the message printed at
 * the foot of a fourteen-question step, under the sticky bar. The message
 * now sits beside its field, is announced, and is scrolled into view; the
 * button stays enabled.
 */
function props(): StepProps<"traction"> & {
  readonly submit: ReturnType<typeof vi.fn>;
} {
  const submit = vi.fn(() => Promise.resolve());
  const reached: Partial<FounderOnboardingActions> = { submit };
  return {
    submit,
    step: {
      id: "traction",
      kind: "traction",
      section: "business",
      title: "Business",
      prompt: "How is the business doing?",
      optional: false,
      skipped: false,
      variant: "revenue",
      intro: "Rough figures are fine.",
      metrics: [
        {
          id: "monthly_revenue",
          kind: "number",
          label: "What is your monthly revenue?",
          optional: true,
        },
        {
          id: "revenue_trend",
          kind: "choice",
          label: "How has monthly revenue moved lately?",
          optional: false,
          options: [
            { value: "up", label: "Up" },
            { value: "flat", label: "Flat" },
          ],
        },
      ],
    },
    formId: "f",
    busy: false,
    actions: new Proxy(reached, {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : vi.fn(),
    }) as FounderOnboardingActions,
  };
}

afterEach(cleanup);

describe("an unanswered required metric on the form", () => {
  it("names it beside its own field, scrolls it into view, and submits nothing", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const p = props();
    const { container } = render(
      <>
        <TractionStep {...p} />
        <button type="submit" form="f">
          Continue
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Answer “How has monthly revenue moved lately?” to continue.",
    );
    // Beside the field it is about, not at the foot of the form.
    const field = container.querySelector("[data-metric='revenue_trend']");
    expect(field?.contains(alert)).toBe(true);
    expect(field?.hasAttribute("data-metric-problem")).toBe(true);
    expect(scrolled).toHaveBeenCalled();
    expect(p.submit).not.toHaveBeenCalled();
    // The field's first radio takes focus, so the next tap answers it.
    expect(document.activeElement?.getAttribute("name")).toBe("revenue_trend");
    // Continue is still a button that can be pressed.
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("clears once the field is answered, and then submits", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const p = props();
    render(
      <>
        <TractionStep {...p} />
        <button type="submit" form="f">
          Continue
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Up"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(p.submit).toHaveBeenCalledWith({
      kind: "traction",
      metrics: { revenue_trend: { value: "up" } },
    });
  });
});
