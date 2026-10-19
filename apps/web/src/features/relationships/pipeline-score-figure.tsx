"use client";

import Link from "next/link";

import { cx } from "@capital-q/ui";

import { useT } from "@/features/i18n/language";

import type { PipelineScores, UnicornCell } from "./pipeline-scores";

/**
 * One score as the Pipeline shows it: the number in tabular figures, or
 * "—" read aloud as "not known yet" (never 0). Meaning is in the words and
 * the number, never in colour.
 *
 *   cell    a column under a visible header (Table): the header names it
 *   column  a List column whose header row is decorative: names itself to
 *           assistive technology
 *   inline  a phone card or a Board card: the label is printed beside it
 */
export function ScoreFigure({
  label,
  value,
  variant,
}: {
  readonly label: "Suitability" | "Investability";
  readonly value: number | null;
  readonly variant: "cell" | "column" | "inline";
}) {
  const t = useT();
  const figure =
    value === null ? (
      <>
        <span aria-hidden="true" className="text-(--cq-text-tertiary)">
          —
        </span>
        <span className="sr-only">{t("Not known yet")}</span>
      </>
    ) : (
      <span className="font-semibold text-(--cq-text-primary)">
        {String(value)}
      </span>
    );
  if (variant === "inline") {
    return (
      <span
        className="inline-flex items-baseline gap-1"
        data-pipeline-score={label.toLowerCase()}
      >
        <span className="cq-caption text-(--cq-text-secondary)">
          {t(label)}
        </span>
        <span className="cq-body-sm cq-numeric">{figure}</span>
      </span>
    );
  }
  return (
    <span
      className={cx("cq-body-sm cq-numeric", variant === "column" && "block")}
      data-pipeline-score={label.toLowerCase()}
    >
      {variant === "column" ? (
        <span className="sr-only">{t(label)} </span>
      ) : null}
      {figure}
    </span>
  );
}

/** The company's own assessment on its profile (no second detail view). */
export function unicornAssessmentHref(companyId: string): string {
  const id = encodeURIComponent(companyId);
  return `/company/${id}#unicorn-potential-${id}`;
}

/**
 * Unicorn Potential as a row shows it: the persisted score, or the honest
 * words ("Insufficient evidence", "Not assessed"), never 0. Either way it
 * opens the company's assessment, where the missing evidence is listed and
 * Q's evidence questions are one step away. `relative` lifts it above the
 * row's stretched link.
 */
export function UnicornFigure({
  cell,
  companyId,
  variant,
}: {
  readonly cell: UnicornCell;
  readonly companyId: string;
  readonly variant: "cell" | "column" | "inline";
}) {
  const t = useT();
  const words =
    cell.score !== null
      ? null
      : cell.status === "NOT_ASSESSED"
        ? t("Not assessed")
        : t("Insufficient evidence");
  const figure = (
    <Link
      href={unicornAssessmentHref(companyId)}
      className={cx(
        "relative rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
        words === null
          ? "font-semibold text-(--cq-text-primary)"
          : "cq-caption text-(--cq-text-secondary)",
      )}
      aria-label={
        words === null
          ? t(`Unicorn Potential ${String(cell.score)}. Open the assessment`)
          : t(`Unicorn Potential: ${words}. Open the assessment`)
      }
      data-unicorn-link
    >
      {words ?? String(cell.score)}
    </Link>
  );
  // How far the evidence has got, so an unscored company still says
  // something (owner 2026-10-19); the engine scores from 60%.
  const progress =
    cell.score === null && cell.coverage !== undefined
      ? t(`${String(Math.round(cell.coverage * 100))}% of evidence`)
      : null;
  if (variant === "inline") {
    return (
      <span
        className="inline-flex items-baseline gap-1"
        data-pipeline-score="unicorn"
      >
        <span className="cq-caption text-(--cq-text-secondary)">
          {t("Unicorn Potential")}
        </span>
        <span className="cq-body-sm cq-numeric">{figure}</span>
        {progress === null ? null : (
          <span
            className="cq-caption text-(--cq-text-tertiary)"
            data-unicorn-coverage
          >
            · {progress}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className={cx("cq-body-sm cq-numeric", variant === "column" && "block")}
      data-pipeline-score="unicorn"
    >
      {figure}
      {progress === null ? null : (
        <span
          className="cq-caption block text-(--cq-text-tertiary)"
          data-unicorn-coverage
        >
          {progress}
        </span>
      )}
    </span>
  );
}

/** The scores on one line, labelled: a phone card or a Board card. */
export function ScoreLine({
  scores,
  companyId,
  className,
}: {
  readonly scores: PipelineScores;
  /** Needed for Unicorn Potential's link to its assessment. */
  readonly companyId?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <p
      className={cx(
        "flex flex-wrap items-baseline gap-x-4 gap-y-0.5",
        className,
      )}
      data-pipeline-scores
    >
      <ScoreFigure
        label="Suitability"
        value={scores.suitability}
        variant="inline"
      />
      <ScoreFigure
        label="Investability"
        value={scores.investability}
        variant="inline"
      />
      {scores.unicorn === undefined || companyId === undefined ? null : (
        <UnicornFigure
          cell={scores.unicorn}
          companyId={companyId}
          variant="inline"
        />
      )}
    </p>
  );
}
