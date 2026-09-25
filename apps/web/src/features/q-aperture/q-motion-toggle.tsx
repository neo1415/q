"use client";

import { useId } from "react";

import { cx } from "@capital-q/ui";

import type { QMotion } from "./aperture-frame";
import {
  Q_MOTION_CHOICES,
  Q_MOTION_LABELS,
  storeQMotion,
  useQMotion,
} from "./q-motion";

/**
 * "Q motion: Full · Calm · Off", beside the theme wherever the theme is
 * (spec §5.3, §11). The pressed option is the person's own choice; when
 * the device asks for reduced motion, Full is honoured as Calm and the
 * control says so.
 */
export function QMotionToggle({
  size = "regular",
  className,
}: {
  readonly size?: "regular" | "touch" | undefined;
  readonly className?: string | undefined;
}) {
  const { choice, motion } = useQMotion();
  const reduced = choice === "full" && motion === "calm";
  const noteId = useId();
  return (
    <div
      role="group"
      aria-label="Q motion"
      aria-describedby={reduced ? noteId : undefined}
      className={cx(
        "cq-theme-switch is-text",
        size === "touch" ? "is-touch" : "",
        className,
      )}
      data-q-motion-toggle
    >
      {Q_MOTION_CHOICES.map((option: QMotion) => (
        <button
          key={option}
          type="button"
          aria-pressed={choice === option}
          onClick={() => {
            storeQMotion(option);
          }}
          className={cx(
            "cq-theme-switch-option",
            choice === option ? "is-active" : "",
          )}
        >
          {Q_MOTION_LABELS[option]}
        </button>
      ))}
      {reduced ? (
        <span id={noteId} className="sr-only">
          Your device asks for reduced motion, so Q stays calm.
        </span>
      ) : null}
    </div>
  );
}
