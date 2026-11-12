// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { FormStep } from "../src/features/gateq/form/form-model";
import {
  historyStep,
  useStepHistory,
} from "../src/features/gateq/form/step-history";

/**
 * Owner, 13 Nov: Back and Continue navigate reliably. The GateQ form's steps
 * lived in React state only, so the browser's Back left the application.
 */
let goTo: (step: FormStep) => void = () => undefined;

function Harness({ enabled = true }: { readonly enabled?: boolean }) {
  const [step, setStep] = useState<FormStep>("company");
  goTo = setStep;
  useStepHistory(step, setStep, enabled);
  return <p data-testid="step">{step}</p>;
}

const shown = () => screen.getByTestId("step").textContent;
const back = async (expected: string) => {
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(shown()).toBe(expected);
  });
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "");
});

describe("GateQ steps in the browser's history", () => {
  it("Back returns to the previous step and Forward goes on again", async () => {
    window.history.replaceState({ __next: "kept" }, "");
    render(<Harness />);
    expect(historyStep(window.history.state)).toBe("company");
    // Next.js's own entry state is kept.
    expect((window.history.state as { __next?: string }).__next).toBe("kept");
    act(() => {
      goTo("contact");
    });
    act(() => {
      goTo("interview");
    });
    expect(historyStep(window.history.state)).toBe("interview");
    await back("contact");
    await back("company");
    act(() => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(shown()).toBe("contact");
    });
  });

  it("once sent, Back does not reopen the review", async () => {
    render(<Harness />);
    act(() => {
      goTo("review");
    });
    act(() => {
      goTo("sent");
    });
    act(() => {
      window.history.back();
    });
    // The popstate is answered by putting "sent" back.
    await waitFor(() => {
      expect(historyStep(window.history.state)).toBe("sent");
    });
    expect(shown()).toBe("sent");
  });

  it("the publisher's preview leaves the page's history alone", () => {
    window.history.replaceState(null, "");
    render(<Harness enabled={false} />);
    act(() => {
      goTo("contact");
    });
    expect(historyStep(window.history.state)).toBeNull();
  });
});
