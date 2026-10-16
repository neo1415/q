"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { useT } from "@/features/i18n/language";

/**
 * "Continue later" (owner 2026-10-16), in the form and in the Q interview.
 *
 * Every answer is saved the moment it is confirmed, so leaving loses
 * nothing that was saved; what is said is exactly that, no more. Q says it
 * in one warm line, then the person is let into the app (Home), where one
 * tap on the occasional reminder brings them back to the same place, in
 * the mode they last used. It records nothing of its own and snoozes no
 * reminder: putting it off is a separate, explicit choice.
 */
export const CONTINUE_LATER_LINE =
  "Of course. Everything you've confirmed is saved, so we'll pick up right here whenever you're ready.";

/** How long the line stays before Home opens: long enough to read it. */
export const CONTINUE_LATER_PAUSE_MS = 1_600;

export function ContinueLater({
  className,
  destination = "/home",
}: {
  readonly className?: string | undefined;
  readonly destination?: string | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className={className ?? buttonClassName("quiet", "regular", "px-3")}
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          window.setTimeout(() => {
            router.push(destination);
          }, CONTINUE_LATER_PAUSE_MS);
        }}
        data-continue-later
      >
        {t("Continue later")}
      </button>
      {leaving ? (
        // Polite and visible: read out without taking focus.
        <span
          role="status"
          className="cq-body-sm max-w-xs text-(--cq-text-secondary)"
          data-continue-later-line
        >
          {CONTINUE_LATER_LINE}
        </span>
      ) : null}
    </span>
  );
}
