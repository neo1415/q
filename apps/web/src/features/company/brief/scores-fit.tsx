"use client";

import { useState } from "react";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  INVESTABILITY_BAND_LABELS,
  SCORE_CONFIDENCE_LABELS,
  type CompanyScoresDto,
  type ScoreFactor,
} from "@capital-q/contracts";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";

import { FitBreakdownSheet } from "@/features/fit";
import { FitGlyph, glyphKindOf, outcomeWord } from "@/features/fit/fit-glyph";
import { useT } from "@/features/i18n/language";

import { useProfileFit } from "../material/fit-panel-slot";

/**
 * Investability and Suitability with their evidence (profile option 1):
 * each number with the range the evidence still allows, or the words when
 * there is no number; a tap says what it rests on. Then the fit with the
 * reader's mandate, criterion by criterion. Both come from the profile's
 * one fit read; nothing is computed here.
 */
export function ScoresCard({ companyName }: { readonly companyName: string }) {
  const fit = useProfileFit();
  if (fit.status !== "READY" || fit.fit.scores === undefined) return null;
  return (
    <section
      className="cq-brief-card"
      data-profile-scores
      data-company-scores="brief"
    >
      <Scores scores={fit.fit.scores} companyName={companyName} />
    </section>
  );
}

function Factors({
  title,
  factors,
}: {
  readonly title: string;
  readonly factors: readonly ScoreFactor[];
}) {
  if (factors.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <b className="cq-label text-(--cq-text-primary)">{title}</b>
      <ul className="flex flex-col gap-0.5">
        {factors.map((f) => (
          <li key={`${f.label}:${f.detail}`}>
            {f.label} · {f.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Scores({
  scores,
  companyName,
}: {
  readonly scores: CompanyScoresDto;
  readonly companyName: string;
}) {
  const t = useT();
  const inv = scores.investability;
  const suit = scores.suitability;
  const invWords =
    inv.status === "SCORED" && inv.band !== null && inv.confidence !== null
      ? `${INVESTABILITY_BAND_LABELS[inv.band]}, ${SCORE_CONFIDENCE_LABELS[inv.confidence].toLowerCase()}.`
      : inv.status === "NOT_ASSESSED"
        ? "Not assessed yet."
        : inv.status === "NO_MATERIAL"
          ? "No pitch or deck shared yet."
          : "Not enough shared evidence yet.";
  const factors =
    inv.status === "NOT_ASSESSED"
      ? ""
      : ` ${String(inv.coverage.criteriaScored)} of ${String(inv.coverage.criteriaApplicable)} factors.`;
  const range = inv.range;
  return (
    <div className="cq-brief-scores">
      <PopoverRoot>
        <PopoverTrigger>
          <button
            type="button"
            className="cq-brief-score"
            data-score="investability"
          >
            <span className="cq-brief-label">{t("Investability")}</span>
            {inv.score === null ? (
              <span className="sv" data-none="">
                {t("No score yet")}
              </span>
            ) : (
              <span className="sv">
                {inv.score}
                <small>/100</small>
              </span>
            )}
            {range === undefined || inv.score === null ? null : (
              <span
                className="cq-brief-range"
                role="img"
                aria-label={`Evidence range ${String(range.low)} to ${String(range.high)}`}
              >
                <span className="track" />
                <span
                  className="band"
                  style={{
                    insetInlineStart: `${String(range.low)}%`,
                    width: `${String(Math.max(1, range.high - range.low))}%`,
                  }}
                />
                <span
                  className="mk"
                  style={{ insetInlineStart: `${String(inv.score)}%` }}
                />
              </span>
            )}
            <span className="cq-brief-label">
              {invWords}
              {factors}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          title={
            inv.score === null
              ? "Investability"
              : `Investability ${String(inv.score)}${inv.confidence === null ? "" : `, ${SCORE_CONFIDENCE_LABELS[inv.confidence].toLowerCase()}`}`
          }
        >
          <div className="cq-brief-pop">
            <p>
              {inv.status === "NOT_ASSESSED"
                ? `${companyName} is assessed once it is listed.`
                : `Read from ${String(inv.coverage.criteriaScored)} of ${String(inv.coverage.criteriaApplicable)} factors in ${String(inv.coverage.areasScored)} of ${String(inv.coverage.areasTotal)} areas.`}
              {range === undefined || inv.score === null
                ? ""
                : ` With the evidence still missing, the score could sit anywhere from ${String(range.low)} to ${String(range.high)}.`}{" "}
              {`Unknown factors are not counted against ${companyName}.`}
            </p>
            <Factors title={t("Raised by")} factors={inv.up} />
            <Factors title={t("Lowered or held back by")} factors={inv.down} />
            {inv.missing.length === 0 ? null : (
              <Factors
                title={t("Would raise coverage or confidence")}
                factors={inv.missing.map((m) => ({
                  label: m,
                  detail: "missing",
                }))}
              />
            )}
          </div>
        </PopoverContent>
      </PopoverRoot>
      {suit === null ? null : (
        <PopoverRoot>
          <PopoverTrigger>
            <button
              type="button"
              className="cq-brief-score"
              data-score="suitability"
            >
              <span className="cq-brief-label">{t("Suitability for you")}</span>
              {suit.score === null ? (
                <span className="sv" data-none="">
                  {suit.status === "OUTSIDE_MANDATE"
                    ? t("Outside your mandate")
                    : t("No score yet")}
                </span>
              ) : (
                <span className="sv">
                  {suit.score}
                  <small>/100</small>
                </span>
              )}
              <span
                className="cq-brief-bar"
                data-size="sm"
                style={{ margin: "6px 0" }}
                role="img"
                aria-label={`${String(suit.coverage.known)} of ${String(suit.coverage.applicable)} criteria known`}
              >
                {Array.from({ length: suit.coverage.applicable }, (_, k) => (
                  <i
                    key={k}
                    data-k={k < suit.coverage.known ? "ok" : undefined}
                  />
                ))}
              </span>
              <span className="cq-brief-label">
                {FIT_BAND_LABELS[suit.band]},{" "}
                {FIT_CONFIDENCE_LABELS[suit.confidence].toLowerCase()}.{" "}
                {suit.coverage.known} of {suit.coverage.applicable} criteria
                known.
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            title={
              suit.score === null
                ? "Suitability for your mandate"
                : `Suitability ${String(suit.score)} for your mandate`
            }
          >
            <div className="cq-brief-pop">
              <p>
                {suit.coverage.known} of your {suit.coverage.applicable}{" "}
                criteria can be checked.
                {suit.missing.length === 0
                  ? ""
                  : ` Still open: ${suit.missing.join("; ").toLowerCase()}.`}
              </p>
              <Factors title={t("Raised by")} factors={suit.up} />
              <Factors
                title={t("Lowered or held back by")}
                factors={suit.down}
              />
            </div>
          </PopoverContent>
        </PopoverRoot>
      )}
    </div>
  );
}

/** "Fit with your mandate": the band, then each declared criterion. */
export function FitCard({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}) {
  const t = useT();
  const fit = useProfileFit();
  const [open, setOpen] = useState(false);
  if (fit.status === "NONE") return null;
  if (fit.status === "LOADING") {
    return (
      <section
        className="cq-brief-card"
        aria-busy="true"
        data-fit-panel="LOADING"
      >
        <h3>{t("Fit with your mandate")}</h3>
        <p className="cq-brief-label">{t("Reading your fit…")}</p>
      </section>
    );
  }
  const profile = fit.fit.profile;
  const rows = profile.parameters.filter(
    (p) => p.applicable || (p.context?.items.length ?? 0) > 0,
  );
  return (
    <section
      className="cq-brief-card"
      aria-label={`How ${companyName} fits your mandate`}
      data-fit-panel="READY"
      data-fit-panel-slot={companyId}
    >
      <h3>{t("Fit with your mandate")}</h3>
      <p className="cq-brief-title" style={{ fontSize: 20 }}>
        {t(FIT_BAND_LABELS[profile.band])}{" "}
        <span className="cq-brief-label" style={{ fontSize: 13 }}>
          {t(FIT_CONFIDENCE_LABELS[profile.confidence]).toLowerCase()}
        </span>
      </p>
      <div className="cq-brief-fit">
        {rows.map((p) => {
          const kind = glyphKindOf(p);
          return (
            <button
              key={p.parameter}
              type="button"
              onClick={() => setOpen(true)}
              data-fit-row={p.parameter}
              title={p.reason}
            >
              <FitGlyph kind={kind} size={20} />
              <span>{t(FIT_PARAMETER_LABELS[p.parameter])}</span>
              <span>{outcomeWord(kind)}</span>
            </button>
          );
        })}
      </div>
      <FitBreakdownSheet
        open={open}
        onOpenChange={setOpen}
        name={companyName}
        companyId={companyId}
        profile={profile}
      />
    </section>
  );
}
