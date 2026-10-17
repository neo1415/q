"use client";

import { cx } from "@capital-q/ui";

import { useT } from "@/features/i18n/language";

import type { PipelineScores } from "./pipeline-scores";

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

/** Both scores on one line, labelled: a phone card or a Board card. */
export function ScoreLine({
  scores,
  className,
}: {
  readonly scores: PipelineScores;
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
    </p>
  );
}
