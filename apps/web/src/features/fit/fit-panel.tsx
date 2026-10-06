"use client";

import { useState } from "react";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  Q_VIEW_VERDICT_LABELS,
  type QViewDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import { Skeleton } from "@capital-q/ui/states";

import { FitBreakdownSheet } from "./fit-breakdown";
import { FitGlyph, glyphKindOf, outcomeWord } from "./fit-glyph";
import { QViewMark, useQView, type QViewPort } from "./q-view-note";
import type { CompanyFit } from "./use-company-fit";

/**
 * "Fit with your mandate" on a company's profile (B3; company.html rail).
 * The band and confidence in words, the nine parameters with a glyph and a
 * word each, "See why" for the reasons; Q's view below it, labelled as
 * Q's view and never a verified fact. Renders nothing when there is no
 * fit to show (see useCompanyFit).
 */
export function FitPanel({
  companyId,
  name,
  fit,
  qView,
  qViewPort,
  className,
  defaultOpen = false,
}: {
  readonly companyId: string;
  readonly name: string;
  readonly fit: CompanyFit;
  /** Open the breakdown at once (design review). */
  readonly defaultOpen?: boolean | undefined;
  /** A view in hand; undefined asks the Q API after the panel renders. */
  readonly qView?: QViewDto | null | undefined;
  readonly qViewPort?: QViewPort | undefined;
  readonly className?: string | undefined;
}) {
  if (fit.status === "NONE") return null;
  return (
    <aside
      aria-label="Fit and Q's view"
      className={cx("flex flex-col gap-3", className)}
      data-fit-panel={fit.status}
    >
      {fit.status === "LOADING" ? (
        <section className="flex flex-col gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]">
          <h2 className="cq-label text-(--cq-text-secondary)">
            Fit with your mandate
          </h2>
          <Skeleton lines={5} />
        </section>
      ) : (
        <ReadyPanel
          companyId={companyId}
          name={name}
          fit={fit}
          qView={qView}
          qViewPort={qViewPort}
          defaultOpen={defaultOpen}
        />
      )}
    </aside>
  );
}

function ReadyPanel({
  companyId,
  name,
  fit,
  qView,
  qViewPort,
  defaultOpen,
}: {
  readonly companyId: string;
  readonly name: string;
  readonly fit: Extract<CompanyFit, { status: "READY" }>;
  readonly defaultOpen: boolean;
  readonly qView: QViewDto | null | undefined;
  readonly qViewPort: QViewPort | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const view = useQView(companyId, qView, qViewPort);
  const profile = fit.fit.profile;
  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]">
        <h2 className="cq-label text-(--cq-text-secondary)">
          Fit with your mandate
        </h2>
        <p className="flex items-baseline gap-2">
          <span className="cq-title-md text-(--cq-text-primary)">
            {FIT_BAND_LABELS[profile.band]}
          </span>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            · {FIT_CONFIDENCE_LABELS[profile.confidence]}
          </span>
        </p>
        <ul className="flex flex-col gap-0.5">
          {profile.parameters.map((p) => {
            const kind = glyphKindOf(p);
            return (
              <li
                key={p.parameter}
                className="flex min-h-[30px] items-center gap-2.5 text-sm"
              >
                <FitGlyph kind={kind} />
                <span className="flex-1 text-(--cq-text-primary)">
                  {FIT_PARAMETER_LABELS[p.parameter]}
                </span>
                <span className="text-(--cq-text-secondary)">
                  {outcomeWord(kind)}
                </span>
              </li>
            );
          })}
        </ul>
        <Button
          variant="secondary"
          size="compact"
          className="self-start"
          onClick={() => setOpen(true)}
        >
          See why
        </Button>
      </section>
      {view === null || view.status !== "READY" ? null : (
        <section
          className="flex flex-col gap-2 rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) p-[18px]"
          data-q-view={view.verdict}
        >
          <div className="flex items-center gap-2.5">
            <QViewMark size={22} />
            <span className="cq-caption text-(--cq-text-secondary)">
              Q&apos;s view, not a verified fact
            </span>
          </div>
          <p className="cq-title-sm text-(--cq-text-primary)">
            {Q_VIEW_VERDICT_LABELS[view.verdict]}.
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {view.summary}
          </p>
        </section>
      )}
      <FitBreakdownSheet
        open={open}
        onOpenChange={setOpen}
        name={name}
        companyId={companyId}
        profile={profile}
      />
    </>
  );
}
