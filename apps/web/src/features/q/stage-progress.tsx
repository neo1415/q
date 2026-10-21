"use client";

import type { QVisibleStage } from "@capital-q/contracts";
import { Check, ICON_STROKE } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { useWire } from "./use-wire";

/**
 * Where Q has been and where it is now, as a step list (owner 2026-10-21:
 * "while Q works, show each stage as it happens").
 *
 * Driven only by the run's real stage events (the stream's stage history,
 * or a voice turn's stages through the room feed). It is determinate and
 * honest: every step shown happened, the last one is where Q is, there is
 * no percentage and no next step guessed. Nothing spins or shimmers; a new
 * step fades in (opacity only, kept under reduced motion).
 *
 * Done and current differ by shape (a check against a ring), by weight of
 * colour and by `aria-current`, never by colour alone. The list itself is
 * not a live region; one polite status line announces the current step,
 * so a screen reader hears each step once rather than the whole list.
 */

/** Steps shown in full; earlier ones are counted, not dropped silently. */
export const STAGE_PROGRESS_VISIBLE = 4;

export function StageProgress({
  steps,
  className,
}: {
  /** The run's steps, oldest first; the last is where Q is now. */
  readonly steps: readonly QVisibleStage[];
  readonly className?: string | undefined;
}) {
  const t = useT();
  // The labels come with the wire's contracts (W7); until then nothing is
  // said rather than a guess.
  const labels = useWire()?.Q_VISIBLE_STAGE_LABELS;
  if (steps.length === 0 || labels === undefined) return null;
  const shown = steps.slice(-STAGE_PROGRESS_VISIBLE);
  const earlier = steps.length - shown.length;
  const current = steps.at(-1);
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}
      data-q-stage-progress
      data-q-stage-current={current}
    >
      {earlier > 0 ? (
        <span className="cq-caption ps-6 text-(--cq-text-tertiary)">
          {earlier === 1
            ? t("1 earlier step")
            : `${String(earlier)} ${t("earlier steps")}`}
        </span>
      ) : null}
      <ol
        aria-label={t("What Q has done so far")}
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {shown.map((stage, index) => {
          const now = index === shown.length - 1;
          return (
            <li
              // The step's place in the run, so a step already shown keeps
              // its node and only a new one fades in.
              key={`${String(earlier + index)}-${stage}`}
              aria-current={now ? "step" : undefined}
              data-q-stage-step={stage}
              data-q-stage-done={now ? undefined : ""}
              className={`cq-stage-line flex min-w-0 items-start gap-2 cq-caption ${
                now ? "text-(--cq-text-primary)" : "text-(--cq-text-secondary)"
              }`}
            >
              <span
                aria-hidden="true"
                className="mt-px flex size-4 shrink-0 items-center justify-center"
              >
                {now ? (
                  <span className="size-3 rounded-full border-2 border-current" />
                ) : (
                  <Check size={14} strokeWidth={ICON_STROKE} />
                )}
              </span>
              <span className="min-w-0">
                {labels[stage]}
                {now ? null : (
                  <span className="sr-only">{`, ${t("done")}`}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {current === undefined ? null : (
        <span role="status" className="sr-only">
          {labels[current]}
        </span>
      )}
    </div>
  );
}
