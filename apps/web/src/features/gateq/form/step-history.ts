"use client";

import { useEffect } from "react";

import { FORM_STEPS, type FormStep } from "./form-model";

/**
 * GateQ applicants use the browser's Back and Forward (owner, 13 Nov: "Back
 * and Continue navigate reliably"). The form's steps lived in React state
 * only, so Back left the application altogether. Each step is now an entry
 * in the page's history on the same address: Back returns to the previous
 * step, Forward goes on again, and the answers stay where they are (they
 * live in the form's state and its session recovery, never in history).
 *
 * Once sent, Back does not reopen the review: the application stays sent.
 * Next.js's own history state is kept on every entry.
 */
const KEY = "cqGateqStep";

const STEPS: readonly FormStep[] = [
  "contact",
  ...FORM_STEPS,
  "check",
  "interview",
  "review",
  "sent",
];

export function historyStep(state: unknown): FormStep | null {
  if (state === null || typeof state !== "object") return null;
  const step = (state as Record<string, unknown>)[KEY];
  return typeof step === "string" && (STEPS as readonly string[]).includes(step)
    ? (step as FormStep)
    : null;
}

function withStep(step: FormStep): Record<string, unknown> {
  const current: unknown = window.history.state;
  return {
    ...(current !== null && typeof current === "object"
      ? (current as Record<string, unknown>)
      : {}),
    [KEY]: step,
  };
}

export function useStepHistory(
  step: FormStep,
  go: (step: FormStep) => void,
  enabled: boolean,
): void {
  // Each step it reaches is one entry; the first is written in place.
  useEffect(() => {
    if (!enabled) return;
    const shown = historyStep(window.history.state);
    if (shown === step) return;
    if (shown === null) window.history.replaceState(withStep(step), "");
    else window.history.pushState(withStep(step), "");
  }, [step, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onPop = (event: PopStateEvent) => {
      const wanted = historyStep(event.state);
      if (wanted === null) return;
      if (step === "sent") {
        // Sent stays sent: put the entry back rather than reopen the review.
        window.history.pushState(withStep("sent"), "");
        return;
      }
      go(wanted);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, [step, go, enabled]);
}
