import type { DealViewDto } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

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
  /**
   * skipped: an earlier stage the relationship moved past with no event
   * of its own (diligence started without a recorded meeting). Passed,
   * not pending: never "not reached".
   */
  readonly status: "done" | "current" | "next" | "ended" | "skipped";
};

/**
 * What establishes each stage and who acts, in plain words, from the
 * deal-stage.v1 fold and the deal-close service (either side records
 * terms, a signature and the close). Honest about what Capital Q does
 * not do: it records a signature made elsewhere and money the company
 * confirms; it never signs or moves money.
 */
export const DEAL_STAGE_GUIDE: Readonly<
  Record<DealViewDto["stages"][number]["stage"], string>
> = {
  MET: "Reached when a meeting is recorded on this relationship.",
  DILIGENCE: "Either side starts diligence after meeting.",
  SOFT_COMMIT:
    "The investor states an amount on the Commitment card and the company confirms it. A soft commit is not binding.",
  TERMS:
    "Either side records the proposed terms. Any change is a new version; nothing is overwritten.",
  SIGNED:
    "Either side records that this exact version of the terms was signed, attaching the signed copy. Signing happens outside Capital Q.",
  FUNDS_RECEIVED:
    "The company confirms the money arrived. Capital Q records it; it does not move money.",
  CLOSED:
    "Either side closes once the terms are signed and the money has arrived.",
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
          : index < currentIndex
            ? "skipped"
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
  skipped: "bg-(--cq-border)",
  current: "bg-(--cq-accent)",
  ended: "bg-(--cq-text-secondary)",
  next: "bg-(--cq-border-subtle)",
};

export function DealStageStrip({
  view,
}: {
  readonly view: Pick<DealViewDto, "stages" | "current" | "end">;
}) {
  // Rendered only inside the client deal card; dealDay above stays usable
  // from server code.
  const t = useT();
  const steps = stripSteps(view);
  return (
    <ol
      aria-label={t("Where this deal is")}
      className="grid grid-cols-1 gap-1 sm:grid-flow-col sm:auto-cols-fr sm:gap-1.5"
      data-deal-strip
    >
      {steps.map((step) => (
        <li
          key={step.key}
          className="flex items-center justify-between gap-3 sm:flex-col sm:items-stretch sm:justify-start sm:gap-1.5"
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
            className={`order-first hidden h-1.5 sm:block ${BAR[step.status]}`}
          />
          <span
            className={`cq-body-sm ${
              step.status === "current" || step.status === "ended"
                ? "font-semibold text-(--cq-text-primary)"
                : step.status === "done" || step.status === "skipped"
                  ? "text-(--cq-text-secondary)"
                  : "text-(--cq-text-tertiary)"
            }`}
          >
            <span
              aria-hidden="true"
              className={`me-2 inline-block size-2 rounded-full sm:hidden ${BAR[step.status]}`}
            />
            {t(step.label)}
          </span>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {step.status === "skipped" ? t("Not recorded") : (step.date ?? "")}
            <span className="sr-only">
              {step.status === "next"
                ? ` ${t("still ahead")}`
                : step.status === "current"
                  ? ` ${t("(current)")}`
                  : step.status === "skipped"
                    ? `, ${t("passed without its own record")}`
                    : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Where the deal stands and what moves it on, in words: the current stage,
 * the next one with what establishes it and who acts. Read from the same
 * fold as the strip; it states, it never acts.
 */
export function DealGuide({
  view,
}: {
  readonly view: Pick<DealViewDto, "stages" | "current" | "end">;
}) {
  const t = useT();
  if (view.end !== null) return null;
  const index =
    view.current === null
      ? -1
      : view.stages.findIndex((stage) => stage.stage === view.current);
  const next = view.stages[index + 1];
  if (next === undefined) return null;
  const now =
    view.current === null
      ? "No stage is recorded yet."
      : `Now: ${DEAL_STAGE_WORDS[view.current]}${
          view.stages[index]?.reachedAt
            ? `, since ${dealDay(view.stages[index]?.reachedAt ?? "")}`
            : ""
        }.`;
  return (
    <p
      className="cq-body-sm text-(--cq-text-secondary)"
      data-deal-guide={next.stage}
    >
      {t(now)}{" "}
      <span className="text-(--cq-text-primary)">
        {t(`Next: ${DEAL_STAGE_WORDS[next.stage]}.`)}
      </span>{" "}
      {t(DEAL_STAGE_GUIDE[next.stage])}
    </p>
  );
}
