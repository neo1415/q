"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buttonClassName, cx } from "@capital-q/ui";

import type { QApertureState } from "../q-aperture/aperture-state";
import { QAperture } from "../q-aperture/q-aperture";
import { WATCH } from "./landing-copy";
import { prefersReducedMotion, useInView } from "./use-in-view";

/**
 * "Watch Q work": a scripted illustration of prepare → approve → act,
 * labelled as one. Every line is in the DOM from the start (screen readers
 * get the whole story, and nothing reflows as it plays); the script only
 * reveals them. It starts when the section is on screen and runs once.
 * Reduced motion shows the finished state at once, with no timers.
 *
 * The visitor may tap Approve themselves; if they don't, the script does,
 * after a beat, so the story always finishes.
 */

/** 0 nothing · 1 ask · 2 working · 3 card · 4 approved. */
export type WatchStep = 0 | 1 | 2 | 3 | 4;

const SCRIPT: readonly { readonly to: WatchStep; readonly after: number }[] = [
  { to: 1, after: 300 },
  { to: 2, after: 1100 },
  { to: 3, after: 1500 },
  { to: 4, after: 2600 },
];

const APERTURE: Readonly<Record<WatchStep, QApertureState>> = {
  0: "IDLE",
  1: "LISTENING",
  2: "WORKING",
  3: "NEEDS_APPROVAL",
  4: "COMPLETE",
};

export function WatchQWork() {
  const root = useRef<HTMLDivElement>(null);
  const visible = useInView(root, { rootMargin: "0px", threshold: 0.35 });
  const [played, setStep] = useState<WatchStep>(0);
  // Read once: this island never renders on the server.
  const [reduced] = useState(prefersReducedMotion);
  // Reduced motion shows the finished story; nothing is scheduled.
  const step: WatchStep = reduced ? (visible ? 4 : 0) : played;
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  useEffect(() => {
    if (!visible || reduced) return;
    let elapsed = 0;
    for (const { to, after } of SCRIPT) {
      elapsed += after;
      timers.current.push(
        window.setTimeout(() => setStep((s) => (s < to ? to : s)), elapsed),
      );
    }
    return clear;
  }, [visible, reduced, run]);

  const approve = useCallback(() => {
    clear();
    setStep(4);
  }, []);

  const shown = (at: WatchStep) =>
    cx("cq-landing-step", step >= at ? "is-shown" : undefined);

  return (
    <div ref={root} className="cq-landing-watch-stage" data-step={step}>
      <div className="flex items-center gap-3">
        <QAperture state={APERTURE[step]} size="panel" />
        <p className="cq-caption text-(--cq-text-secondary)">{WATCH.label}</p>
      </div>

      <ol className="mt-6 flex flex-col gap-4" aria-label="Illustration steps">
        <li className={cx(shown(1), "self-end")}>
          <p className="cq-landing-ask cq-body">{WATCH.ask}</p>
        </li>
        <li className={shown(2)}>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            <span className="text-(--cq-text-primary) font-medium">Q</span>{" "}
            {WATCH.working}
          </p>
        </li>
        <li className={shown(3)}>
          <section
            className="cq-landing-approval"
            aria-label={WATCH.card.heading}
            data-approved={step >= 4 || undefined}
          >
            <h3 className="cq-label text-(--cq-text-primary)">
              {WATCH.card.heading}
            </h3>
            <p className="cq-caption mt-3 text-(--cq-text-secondary)">
              {WATCH.card.to}
            </p>
            <p className="cq-body-sm mt-1 font-medium text-(--cq-text-primary)">
              {WATCH.card.subject}
            </p>
            <p className="cq-body-sm mt-2 text-(--cq-text-primary)">
              {WATCH.card.body}
            </p>
            <p className="cq-caption mt-3 text-(--cq-text-secondary)">
              {WATCH.card.note}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={buttonClassName("primary", "regular")}
                onClick={approve}
                disabled={step < 3 || step >= 4}
                aria-pressed={step >= 4}
              >
                {step >= 4 ? "Approved" : WATCH.card.approve}
              </button>
              <span className="cq-caption text-(--cq-text-tertiary)">
                {WATCH.names}
              </span>
            </div>
          </section>
        </li>
        <li className={shown(4)}>
          <p className="cq-body-sm text-(--cq-text-primary)">
            <span aria-hidden="true">✓ </span>
            {WATCH.done}
          </p>
        </li>
      </ol>

      <button
        type="button"
        className={cx(buttonClassName("quiet", "compact"), "mt-4 self-start")}
        onClick={() => {
          clear();
          setStep(0);
          setRun((r) => r + 1);
        }}
        disabled={step < 4}
      >
        {WATCH.replay}
      </button>
    </div>
  );
}
