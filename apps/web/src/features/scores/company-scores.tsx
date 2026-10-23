"use client";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  INVESTABILITY_BAND_LABELS,
  INVESTABILITY_METHOD_LABEL,
  SCORE_CONFIDENCE_LABELS,
  investabilityLine,
  suitabilityLine,
  type CompanyScoresDto,
  type InvestabilityDto,
  type ScoreFactor,
  type SuitabilityDto,
} from "@capital-q/contracts";
import type { ReactNode } from "react";
import Link from "next/link";

import { cx } from "@capital-q/ui";

import { useT } from "@/features/i18n/language";

import { useCompanyScores } from "./use-company-scores";
import { UnicornPotential, unicornPotentialLine } from "./unicorn-potential";

/**
 * Investability and Suitability, side by side and never blended (owner
 * 2026-10-16; ADR 0074). Every surface that shows a company uses this one
 * component with the DTO the Q API computed. An authorized Unicorn Potential
 * assessment is optional and separate, with its own progressive detail:
 *
 *   full     the company profile, beside "Fit with you": each score with its
 *            band and confidence in words, its coverage, and "Why" (what
 *            raised it, what lowered it, what would raise confidence)
 *   compact  a card (Discover, CRM, search, saved, comparison): one line each
 *   minimal  an Explore tile: the two numbers with short labels; the full
 *            sentence is the accessible name
 *
 * No number is made here. "Not enough shared evidence yet" is words, never
 * a low number; meaning is never carried by colour alone.
 */

export type CompanyScoresVariant = "full" | "compact" | "minimal";

function investabilityWords(dto: InvestabilityDto): string {
  if (dto.status !== "SCORED" || dto.band === null || dto.confidence === null) {
    return dto.status === "NOT_ASSESSED"
      ? "Not assessed yet"
      : dto.status === "NO_MATERIAL"
        ? "No pitch or deck shared yet"
        : "Not enough shared evidence yet";
  }
  // ADR 0075: a screening signal on a thin basis says so.
  return `${INVESTABILITY_BAND_LABELS[dto.band]} · ${SCORE_CONFIDENCE_LABELS[dto.confidence]}${dto.provisional === true ? " · early read" : ""}`;
}

function suitabilityWords(dto: SuitabilityDto): string {
  return `${FIT_BAND_LABELS[dto.band]} · ${FIT_CONFIDENCE_LABELS[dto.confidence]}`;
}

/** Accessible descriptions of the assessments actually authorized. */
export function companyScoresLabel(scores: CompanyScoresDto): string {
  return [
    `${investabilityLine(scores.investability)}, ${investabilityWords(scores.investability).toLowerCase()}`,
    scores.suitability === null
      ? null
      : `${suitabilityLine(scores.suitability)}, ${suitabilityWords(scores.suitability).toLowerCase()}`,
    scores.unicornPotential === undefined
      ? null
      : unicornPotentialLine(scores.unicornPotential),
  ]
    .filter((part) => part !== null)
    .join(". ");
}

function Factors({
  title,
  factors,
}: {
  readonly title: string;
  readonly factors: readonly ScoreFactor[];
}) {
  const t = useT();
  if (factors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="cq-label text-(--cq-text-primary)">{t(title)}</h4>
      <ul className="flex flex-col gap-1">
        {factors.map((f) => (
          <li key={`${f.label}:${f.detail}`} className="cq-body-sm">
            <span className="text-(--cq-text-primary)">{f.label}</span>
            <span className="text-(--cq-text-secondary)"> · {f.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Why({
  up,
  down,
  missing,
  id,
}: {
  readonly up: readonly ScoreFactor[];
  readonly down: readonly ScoreFactor[];
  readonly missing: readonly string[];
  readonly id: string;
}) {
  const t = useT();
  if (up.length + down.length + missing.length === 0) return null;
  return (
    <details className="group" data-score-why={id}>
      <summary className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center text-(--cq-text-secondary) underline-offset-4 hover:text-(--cq-text-primary) hover:underline">
        {t("Why")}
      </summary>
      <div className="flex flex-col gap-3 pb-2">
        <Factors title="Raised by" factors={up} />
        <Factors title="Lowered or held back by" factors={down} />
        {missing.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <h4 className="cq-label text-(--cq-text-primary)">
              {t("Would raise coverage or confidence")}
            </h4>
            <ul className="flex flex-col gap-1">
              {missing.map((m) => (
                <li key={m} className="cq-body-sm text-(--cq-text-secondary)">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function ScoreCell({
  label,
  caption,
  value,
  words,
  coverage,
  children,
  data,
}: {
  readonly label: string;
  readonly caption: string;
  readonly value: number | null;
  readonly words: string;
  readonly coverage: string;
  readonly children?: ReactNode;
  readonly data: string;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-1" data-score={data}>
      <div className="flex flex-col">
        <span className="cq-label text-(--cq-text-primary)">{t(label)}</span>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(caption)}
        </span>
      </div>
      <p className="flex items-baseline gap-1">
        {value === null ? (
          <span className="cq-body-sm text-(--cq-text-secondary)">—</span>
        ) : (
          <>
            <span className="text-2xl font-semibold tabular-nums text-(--cq-text-primary)">
              {value}
            </span>
            <span className="cq-caption text-(--cq-text-tertiary)">/100</span>
          </>
        )}
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">{words}</p>
      <p className="cq-caption text-(--cq-text-tertiary)">{coverage}</p>
      {children}
    </div>
  );
}

export function CompanyScores({
  scores,
  variant = "full",
  unicornDetails = true,
  className,
}: {
  readonly scores: CompanyScoresDto;
  readonly variant?: CompanyScoresVariant | undefined;
  /** Profiles place the full assessment in the overview, outside the fit rail. */
  readonly unicornDetails?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const inv = scores.investability;
  const suit = scores.suitability;

  if (variant === "minimal") {
    return (
      // A tile is narrow (Explore on a phone is three across): the line may
      // wrap rather than be cut mid-word, and Unicorn Potential appears only
      // when it has a score -- "insufficient evidence" stays in the label
      // and on the profile (owner QA 23 Oct: "Suit. 80 · Un" cut off).
      <p
        className={cx("cq-caption whitespace-normal tabular-nums", className)}
        aria-label={companyScoresLabel(scores)}
        title={companyScoresLabel(scores)}
        data-company-scores="minimal"
      >
        <span aria-hidden="true">
          {`${t("Inv.")} ${inv.score === null ? "—" : String(inv.score)}`}
          {suit === null
            ? ""
            : ` · ${t("Suit.")} ${suit.score === null ? "—" : String(suit.score)}`}
          {scores.unicornPotential === undefined ||
          scores.unicornPotential.overallScore === null
            ? null
            : ` · ${unicornPotentialLine(scores.unicornPotential)}`}
        </span>
      </p>
    );
  }

  if (variant === "compact") {
    return (
      <p
        className={cx(
          "cq-caption flex flex-wrap gap-x-3 gap-y-0.5 text-(--cq-text-secondary)",
          className,
        )}
        aria-label={companyScoresLabel(scores)}
        data-company-scores="compact"
      >
        <span aria-hidden="true" data-score="investability">
          {investabilityLine(inv)}
        </span>
        {suit === null ? null : (
          <span aria-hidden="true" data-score="suitability">
            {suitabilityLine(suit)}
          </span>
        )}
        {scores.unicornPotential === undefined ? null : (
          <span aria-hidden="true" data-score="unicorn-potential">
            {unicornPotentialLine(scores.unicornPotential)}
          </span>
        )}
      </p>
    );
  }

  return (
    <section
      aria-label={t(
        scores.unicornPotential === undefined
          ? "Investability and Suitability"
          : "Company assessments",
      )}
      className={cx(
        "grid grid-cols-1 gap-4 border-y border-(--cq-border-subtle) py-3 sm:grid-cols-2",
        className,
      )}
      data-company-scores="full"
    >
      <ScoreCell
        data="investability"
        label="Investability"
        caption={`${INVESTABILITY_METHOD_LABEL} · on shared evidence`}
        value={inv.score}
        words={investabilityWords(inv)}
        coverage={
          inv.status === "NOT_ASSESSED"
            ? "Assessed once the company is listed"
            : `Based on ${inv.coverage.criteriaScored} of ${inv.coverage.criteriaApplicable} factors · ${inv.coverage.areasScored} of ${inv.coverage.areasTotal} areas${inv.range === undefined ? "" : ` · evidence range ${String(inv.range.low)}–${String(inv.range.high)}`}`
        }
      >
        <Why
          id={`${scores.companyId}-investability`}
          up={inv.up}
          down={inv.down}
          missing={inv.missing}
        />
      </ScoreCell>
      {suit === null ? null : (
        <ScoreCell
          data="suitability"
          label="Suitability"
          caption="Fit with your mandate"
          value={suit.score}
          words={
            suit.status === "OUTSIDE_MANDATE"
              ? FIT_BAND_LABELS.OUTSIDE_MANDATE
              : suitabilityWords(suit)
          }
          coverage={`${suit.coverage.known} of ${suit.coverage.applicable} of your criteria known`}
        >
          <Why
            id={`${scores.companyId}-suitability`}
            up={suit.up}
            down={suit.down}
            missing={suit.missing}
          />
        </ScoreCell>
      )}
      {scores.unicornPotential === undefined ? null : !unicornDetails ? (
        <Link
          href={`/company/${encodeURIComponent(scores.companyId)}?tab=overview#unicorn-potential-${scores.companyId}`}
          className="cq-caption min-h-11 py-3 text-(--cq-text-secondary) underline underline-offset-4 sm:col-span-2"
          data-score="unicorn-potential"
        >
          {unicornPotentialLine(scores.unicornPotential)} · View assessment
        </Link>
      ) : (
        <UnicornPotential
          companyId={scores.companyId}
          score={scores.unicornPotential}
        />
      )}
    </section>
  );
}

/** A card's scores, read in the page's one batched call; nothing while unknown. */
export function CompanyScoresFor({
  scores,
  companyId,
  variant = "compact",
  className,
}: {
  readonly scores: ReadonlyMap<string, CompanyScoresDto>;
  readonly companyId: string;
  readonly variant?: CompanyScoresVariant | undefined;
  readonly className?: string | undefined;
}) {
  const found = scores.get(companyId);
  if (found === undefined) return null;
  return (
    <CompanyScores scores={found} variant={variant} className={className} />
  );
}

/**
 * Self-reading scores for one company, for surfaces that do not hold the
 * DTO (CRM rows and records, search results, saved lists, pipeline cards).
 * Rows on the same page share one batched read.
 */
export function CompanyScoresLive({
  companyId,
  variant = "compact",
  className,
}: {
  readonly companyId: string;
  readonly variant?: CompanyScoresVariant | undefined;
  readonly className?: string | undefined;
}) {
  const scores = useCompanyScores([companyId]);
  return (
    <CompanyScoresFor
      scores={scores}
      companyId={companyId}
      variant={variant}
      className={className}
    />
  );
}
