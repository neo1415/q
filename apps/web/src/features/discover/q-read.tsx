"use client";

import { useId, useState } from "react";

import {
  SCORE_CONFIDENCE_LABELS,
  type CompanyScoresDto,
} from "@capital-q/contracts";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { useT } from "@/features/i18n/language";

/**
 * Q's read of a company in the feed (Discover A): one row per score, the
 * number on the right and, under it, a bar for how much of the score has
 * evidence -- coverage, never the score itself, so a thin bar reads as
 * "little is known", not "poor company". A press opens what the number is
 * made of, and says plainly that unknown factors are unknown, never
 * counted against the company. Separate scores, never blended (ADR 0074).
 */

function Row({
  label,
  value,
  share,
  coverage,
  children,
  data,
}: {
  readonly label: string;
  /** The number, or the honest words when there is none. */
  readonly value: string;
  /** 0..1 of the score's inputs that have evidence; null: no bar. */
  readonly share: number | null;
  readonly coverage: string;
  readonly children?: React.ReactNode;
  readonly data: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const explains = children !== undefined;
  const head = (
    <>
      <span className="cq-q-read-label">{label}</span>
      <span className="cq-q-read-value cq-numeric">{value}</span>
      {share === null ? null : (
        <span className="cq-q-read-bar" aria-hidden="true">
          <span style={{ width: `${String(Math.round(share * 100))}%` }} />
        </span>
      )}
      <span className="cq-q-read-coverage">{coverage}</span>
    </>
  );
  return (
    <div className="cq-q-read-row" data-score={data}>
      {explains ? (
        <button
          type="button"
          className="cq-q-read-head"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((was) => !was)}
        >
          {head}
        </button>
      ) : (
        <div className="cq-q-read-head">{head}</div>
      )}
      {explains ? (
        <div
          id={panel}
          className="cq-q-read-why"
          data-open={open ? "" : undefined}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function QRead({
  scores,
  companyName,
}: {
  readonly scores: CompanyScoresDto;
  readonly companyName: string;
}) {
  const t = useT();
  const inv = scores.investability;
  const suit = scores.suitability;
  const unicorn = scores.unicornPotential;
  const scored = inv.coverage.criteriaScored;
  const applicable = inv.coverage.criteriaApplicable;
  const unknown = Math.max(0, applicable - scored);
  return (
    <section className="cq-q-read" aria-label={t("Q's read")} data-feed-q-read>
      <h3 className="cq-q-read-title">
        <QNavIcon size={20} aria-hidden="true" />
        {t("Q's read")}
      </h3>
      <Row
        data="investability"
        label={t("Investability")}
        value={
          inv.score === null ? t("Not enough evidence") : String(inv.score)
        }
        share={applicable > 0 ? scored / applicable : null}
        coverage={
          inv.status === "NOT_ASSESSED"
            ? t("Assessed once the company is listed")
            : `${String(scored)} ${t("of")} ${String(applicable)} ${t("factors have evidence")}${inv.confidence === null ? "" : ` · ${t(SCORE_CONFIDENCE_LABELS[inv.confidence])}`}`
        }
      >
        <div className="pt-2">
          <p className="cq-caption text-(--cq-text-secondary)">
            {inv.score === null
              ? `${t("There is not enough shared evidence for a number yet.")} `
              : `${String(inv.score)} ${t("is read from")} ${String(scored)} ${t("of")} ${String(applicable)} ${t("factors.")} `}
            {unknown > 0
              ? `${t("The other")} ${String(unknown)} ${t("have no evidence yet. They count as unknown, never against")} ${companyName}.`
              : ""}
          </p>
        </div>
      </Row>
      {suit === null ? null : (
        <Row
          data="suitability"
          label={t("Suitability for you")}
          value={
            suit.status === "OUTSIDE_MANDATE"
              ? t("Outside your mandate")
              : suit.score === null
                ? t("Not enough known")
                : String(suit.score)
          }
          share={
            suit.coverage.applicable > 0
              ? suit.coverage.known / suit.coverage.applicable
              : null
          }
          coverage={`${String(suit.coverage.known)} ${t("of")} ${String(suit.coverage.applicable)} ${t("mandate checks known")}`}
        />
      )}
      {unicorn === undefined ? null : (
        <Row
          data="unicorn-potential"
          label={t("Unicorn potential")}
          value={
            unicorn.overallScore === null
              ? t(
                  unicorn.status === "NOT_ASSESSED"
                    ? "Not assessed yet"
                    : "Insufficient evidence",
                )
              : String(unicorn.overallScore)
          }
          share={null}
          coverage=""
        />
      )}
    </section>
  );
}
