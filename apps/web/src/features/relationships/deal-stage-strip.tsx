import type { DealViewDto } from "@capital-q/contracts";

/**
 * The deal stage strip (design 2026-10-08/deal-close): the same strip on
 * both sides of the ONE relationship, read from the server's deal-stage.v1
 * fold. A reached stage shows its date; the current one carries the
 * accent and aria-current; a passed relationship ends at "Not proceeding"
 * (neutral, never red). Words always carry the meaning; the bar repeats it.
 */

export const DEAL_STAGE_WORDS: Readonly<
  Record<DealViewDto["stages"][number]["stage"], string>
> = {
  MET: "Met",
  DILIGENCE: "Diligence",
  SOFT_COMMIT: "Soft commit",
  TERMS: "Terms",
  SIGNED: "Signed",
  FUNDS_RECEIVED: "Funds received",
  CLOSED: "Closed",
};

/** "18 Sept": a day, in UTC, so both sides read the same date. */
export function dealDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(at);
}

export type StripStep = {
  readonly key: string;
  readonly label: string;
  readonly date: string | null;
  readonly status: "done" | "current" | "next" | "ended";
};

/** The strip's steps: pure, so the harness and the page agree. */
export function stripSteps(
  view: Pick<DealViewDto, "stages" | "current" | "end">,
): StripStep[] {
  if (view.end?.kind === "PASSED") {
    const reached = view.stages.filter((stage) => stage.reachedAt !== null);
    return [
      ...reached.map((stage) => ({
        key: stage.stage,
        label: DEAL_STAGE_WORDS[stage.stage],
        date: stage.reachedAt === null ? null : dealDay(stage.reachedAt),
        status: "done" as const,
      })),
      {
        key: "PASSED",
        label: "Not proceeding",
        date: dealDay(view.end.at),
        status: "ended",
      },
    ];
  }
  const currentIndex =
    view.current === null
      ? -1
      : view.stages.findIndex((stage) => stage.stage === view.current);
  return view.stages.map((stage, index) => {
    const closed = view.end?.kind === "CLOSED";
    const status: StripStep["status"] =
      closed && stage.stage === "CLOSED"
        ? "ended"
        : stage.reachedAt !== null && index <= currentIndex
          ? index === currentIndex && !closed
            ? "current"
            : "done"
          : "next";
    return {
      key: stage.stage,
      label: DEAL_STAGE_WORDS[stage.stage],
      date: stage.reachedAt === null ? null : dealDay(stage.reachedAt),
      status,
    };
  });
}

const BAR: Readonly<Record<StripStep["status"], string>> = {
  done: "bg-(--cq-text-tertiary)",
  current: "bg-(--cq-accent)",
  ended: "bg-(--cq-text-secondary)",
  next: "bg-(--cq-border-subtle)",
};

export function DealStageStrip({
  view,
}: {
  readonly view: Pick<DealViewDto, "stages" | "current" | "end">;
}) {
  const steps = stripSteps(view);
  return (
    <ol
      aria-label="Where this deal is"
      className="grid grid-cols-1 gap-1 sm:grid-flow-col sm:auto-cols-fr sm:gap-1.5"
      data-deal-strip
    >
      {steps.map((step) => (
        <li
          key={step.key}
          className="flex items-center justify-between gap-3 sm:flex-col sm:items-stretch sm:gap-1.5"
          data-stage={step.key}
          data-status={step.status}
          aria-current={
            step.status === "current" || step.status === "ended"
              ? "step"
              : undefined
          }
        >
          <span
            aria-hidden="true"
            className={`order-first hidden h-1.5 rounded-full sm:block ${BAR[step.status]}`}
          />
          <span
            className={`cq-body-sm ${
              step.status === "current" || step.status === "ended"
                ? "font-semibold text-(--cq-text-primary)"
                : step.status === "done"
                  ? "text-(--cq-text-secondary)"
                  : "text-(--cq-text-tertiary)"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mr-2 inline-block size-2 rounded-full sm:hidden ${BAR[step.status]}`}
            />
            {step.label}
          </span>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {step.date ?? ""}
            <span className="sr-only">
              {step.status === "next"
                ? " not reached"
                : step.status === "current"
                  ? " (current)"
                  : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
