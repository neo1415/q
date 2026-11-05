"use client";

import { ICON_SIZE, ICON_STROKE, Mic } from "@capital-q/ui/icons";

import { useWakePreference } from "./wake-preference";
import { setWakePausedByYou, useWakePausedByYou } from "./wake-status";
import { useT } from "@/features/i18n/language";

/**
 * "Resume “Hey Q”": shown only while the person paused it from the corner
 * button. A pause hides that button (the microphone is closed, so there is
 * nothing to disclose), so the way back lives here: Settings → Q and the
 * Q room's microphone area.
 */
export function WakeResume({
  className,
}: {
  readonly className?: string | undefined;
}) {
  const t = useT();
  const on = useWakePreference();
  const paused = useWakePausedByYou();
  if (!on || !paused) return null;
  return (
    <button
      type="button"
      onClick={() => setWakePausedByYou(false)}
      className={
        className ??
        "inline-flex min-h-11 items-center gap-2 rounded-full border border-(--cq-border-subtle) px-3 cq-body-sm font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
      }
      data-wake-resume
    >
      <Mic
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
      {t("Resume “Hey Q”")}
    </button>
  );
}
