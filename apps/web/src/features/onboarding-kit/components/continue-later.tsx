"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

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

/**
 * Where leaving takes them (owner 2026-10-28): into Capital Q itself. An
 * investor goes to Discover, which already works from what they have told
 * Q; a founder goes Home. The occasional reminder brings them back.
 */
export function continueLaterDestination(
  journey: "investor" | "founder" | undefined,
): string {
  return journey === "investor" ? "/discover" : "/home";
}

/**
 * Where a typed turn's `navigate` leaves to, if it is a leave at all
 * (coordinator 2026-10-28): the interviewer sends HOME on the typed channel
 * only when the person is pausing ("I'll continue later"), never for a
 * plain reply or for finishing. A pause then takes the same way out as the
 * Continue later button, to the journey's own destination. Null for
 * anything else, so a plain reply never moves the page by itself.
 */
export function pausingDestination(
  navigate: string | null | undefined,
  journey: "investor" | "founder" | undefined,
): string | null {
  return navigate === "HOME" ? continueLaterDestination(journey) : null;
}

/** How long the line stays before Home opens: long enough to read it. */
export const CONTINUE_LATER_PAUSE_MS = 1_600;

/**
 * The same leaving, for a surface with its own control (the voice stage):
 * `leave` shows the line, runs `before` (ending a live call, so its last
 * words are sent), and opens Home once both the pause and `before` are
 * done. Pressed twice, it leaves once.
 */
export function useContinueLater(destination = "/home"): {
  readonly leaving: boolean;
  readonly leave: (before?: () => Promise<void>) => void;
} {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const leave = useCallback(
    (before?: () => Promise<void>) => {
      if (left.current) return;
      left.current = true;
      setLeaving(true);
      const pause = new Promise<void>((resolve) => {
        window.setTimeout(resolve, CONTINUE_LATER_PAUSE_MS);
      });
      const ended = (before?.() ?? Promise.resolve()).catch(() => undefined);
      void Promise.all([pause, ended]).then(() => {
        router.push(destination);
      });
    },
    [router, destination],
  );
  return { leaving, leave };
}

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
        // A bordered button by default (owner 2026-10-17: it read as text
        // and was missed); always takes them into the app.
        className={className ?? buttonClassName("secondary", "compact")}
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
          {t(CONTINUE_LATER_LINE)}
        </span>
      ) : null}
    </span>
  );
}
