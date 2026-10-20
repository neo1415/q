"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import type {
  FitProfileDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { crmButton, CrmSheet, QRing } from "./crm-kit";
import { JOURNEY, journeyStep } from "./journey";
import { PIPELINE_NEXT_WORDS } from "./pipeline-presentation";
import type { PipelineScores } from "./pipeline-scores";
import { SuitabilityFigure } from "./pipeline-toolbar";
import { CounterpartAvatar } from "./relationships-board";
import { relationshipHref, STATE_WORDS } from "./relationship-words";
import { isOwnStep, since, type NextStep } from "./relationships-view";
import { useT } from "@/features/i18n/language";

/**
 * The record peek (design 2026-10-20): a list row or a board card opens a
 * sheet with where the relationship stands, its one next step and, for an
 * investor, fit with their declared mandate, with a way into the full
 * relationship. Fit is not interest; nothing here changes the record.
 */
export function RelationshipPeek({
  item,
  onClose,
  side,
  now,
  step,
  activity,
  scores,
  fit,
}: {
  /** Null: closed. */
  readonly item: RelationshipSummaryDto | null;
  readonly onClose: () => void;
  readonly side: "INVESTOR" | "COMPANY";
  readonly now: number;
  /** The relationship's one next step, when this layout knows it. */
  readonly step?: NextStep | undefined;
  /** When anything last happened; the state change when not known. */
  readonly activity?: string | undefined;
  readonly scores?: PipelineScores | undefined;
  /** Fit with the investor's own mandate; null: no mandate to fit. */
  readonly fit?: FitProfileDto | null | undefined;
}) {
  const t = useT();
  if (item === null) return null;
  const reached = journeyStep({ state: item.state, milestones: [] });
  const last = activity ?? item.stateSince;
  const own = step !== undefined && isOwnStep(step);
  const title =
    step === undefined
      ? t(PIPELINE_NEXT_WORDS[item.nextStep])
      : t(step.label ?? (step.why === "" ? PIPELINE_NEXT_WORDS[item.nextStep] : step.why));
  const why = own
    ? t("This is waiting on you.")
    : item.nextStep === "AWAIT_ANSWER"
      ? t("Nothing to do until they reply.")
      : t("Suggested from where the relationship stands.");
  const known =
    fit === undefined || fit === null
      ? null
      : {
          known: fit.parameters.filter(
            (parameter) => parameter.applicable && parameter.outcome !== "UNKNOWN",
          ).length,
          of: fit.parameters.filter((parameter) => parameter.applicable).length,
        };
  return (
    <CrmSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item.counterpart.name}
      sub={t(`${STATE_WORDS[item.state]}, last activity ${since(last, now)}`)}
      avatar={<CounterpartAvatar item={item} size={36} />}
      data-relationship-peek={item.relationshipId}
    >
      <div
        className="grid grid-cols-5 gap-1.5"
        aria-label={t(`Stage: ${STATE_WORDS[item.state]}`)}
        role="img"
      >
        {JOURNEY.map((entry, index) => {
          const position = index + 1;
          const done = reached !== null && position < reached;
          const current = reached !== null && position === reached;
          return (
            <div
              key={entry.label}
              className={cx(
                "flex min-w-0 flex-col gap-1.5 text-xs",
                current
                  ? "font-semibold text-(--cq-text-primary)"
                  : "text-(--cq-text-tertiary)",
              )}
            >
              <i
                aria-hidden="true"
                className={cx(
                  "block h-1.5 rounded-full",
                  done
                    ? "bg-(--cq-positive)"
                    : current
                      ? "bg-(--cq-accent)"
                      : "bg-(--cq-surface-strong)",
                )}
              />
              <span className="truncate">
                {done ? (
                  <span aria-hidden="true" className="text-(--cq-positive)">
                    ✓{" "}
                  </span>
                ) : null}
                {t(entry.label)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-accent)/60 bg-(--cq-surface-raised) py-3.5 ps-[18px] pe-4 shadow-[inset_4px_0_0_var(--cq-accent)] sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-(--cq-accent)">
            <QRing />
            {t("Next step")}
          </p>
          <p className="text-base font-semibold tracking-[-0.005em] text-(--cq-text-primary)">
            {title}
          </p>
          <p className="mt-0.5 text-[13px] text-(--cq-text-secondary)">{why}</p>
        </div>
        {step?.label != null && step.href !== null ? (
          <Link
            href={step.href}
            className={crmButton(own ? "primary" : "secondary")}
            data-next-step
          >
            {t(step.label)}
          </Link>
        ) : null}
      </div>

      {side !== "INVESTOR" || scores === undefined ? null : (
        <div className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5">
          <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
            {t("Fit with your mandate")}
          </h3>
          <div className="flex flex-wrap items-baseline gap-6">
            <SuitabilityFigure value={scores.suitability} />
            {known === null || known.of === 0 ? null : (
              <span className="text-xs text-(--cq-text-tertiary)">
                {t(`${String(known.known)} of ${String(known.of)} criteria known`)}
              </span>
            )}
          </div>
          <p className="text-xs text-(--cq-text-tertiary)">
            {t(
              "Fit is not interest. It reads their profile against your declared mandate.",
            )}
          </p>
        </div>
      )}

      <Link href={relationshipHref(item)} className={crmButton("secondary", "w-full")}>
        {t("Open relationship")}
        <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
      </Link>
    </CrmSheet>
  );
}

/**
 * A plain click opens the peek; a modified click (new tab, new window)
 * still follows the row's link to the relationship.
 */
export function peekClick(
  event: MouseEvent<HTMLAnchorElement>,
  open: () => void,
): void {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  open();
}
