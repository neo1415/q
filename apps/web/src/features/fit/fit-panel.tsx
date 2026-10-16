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

import { useGlobalQ } from "@/components/app-shell/global-q";

import { FitBreakdownSheet } from "./fit-breakdown";
import { FitContextValues } from "./fit-context";
import { FitGlyph, glyphKindOf, outcomeWord } from "./fit-glyph";
import { QViewMark, useQView, type QViewPort } from "./q-view-note";
import type { CompanyFit } from "./use-company-fit";

/**
 * "Fit with your mandate" on a company's profile (B3; company.html rail).
 * Progressive disclosure (2026-10-12): the band and confidence in words,
 * then only the parameters the mandate declares, each with a glyph and a
 * word ("Stated" where the company said it but did not formally share it);
 * "See why" holds every parameter, its reason and its source. Q's view
 * below: the verdict and at most two sentences, the one qualification,
 * and up to three open questions, each a question to Q. Labelled as Q's
 * view, never a verified fact. Renders nothing when there is no fit to
 * show (see useCompanyFit).
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
        <section className="flex flex-col gap-3.5 border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]">
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
      <section className="flex flex-col gap-3.5 border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]">
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
          {/* Parameters the mandate declares nothing on are in "See why",
              unless something is known for them (a stated raise). */}
          {profile.parameters
            .filter((p) => p.applicable || (p.context?.items.length ?? 0) > 0)
            .map((p) => {
              const kind = glyphKindOf(p);
              return (
                <li
                  key={p.parameter}
                  className="flex flex-col gap-1 py-0.5"
                  data-fit-row={p.parameter}
                >
                  <span className="flex min-h-[30px] items-center gap-2.5 text-sm">
                    <FitGlyph kind={kind} />
                    <span className="flex-1 text-(--cq-text-primary)">
                      {FIT_PARAMETER_LABELS[p.parameter]}
                    </span>
                    <span className="text-(--cq-text-secondary)">
                      {outcomeWord(kind)}
                    </span>
                  </span>
                  {p.context === undefined ? null : (
                    <FitContextValues
                      context={p.context}
                      className="ps-[26px]"
                    />
                  )}
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
          className="flex flex-col gap-3 bg-(--cq-surface-subtle) p-[18px]"
          data-q-view={view.verdict}
        >
          <div className="flex items-center gap-2.5">
            <QViewMark size={22} />
            <span className="cq-caption text-(--cq-text-secondary)">
              Q&apos;s view · not verified
            </span>
          </div>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            <span className="cq-title-sm me-1.5 text-(--cq-text-primary)">
              {Q_VIEW_VERDICT_LABELS[view.verdict]}.
            </span>
            {view.summary}
          </p>
          {view.mainRisk === null ? null : (
            <div className="flex flex-col gap-0.5" data-q-view-part="RISK">
              <span className="cq-caption text-(--cq-text-secondary)">
                Main qualification
              </span>
              <p className="cq-body-sm text-(--cq-text-primary)">
                {view.mainRisk}
              </p>
            </div>
          )}
          <OpenQuestions name={name} questions={view.unknowns.slice(0, 3)} />
          <GoDeeper name={name} />
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

/**
 * Up to three open questions, most important first. Each one asks Q, on
 * this company's page, what the evidence this investor may see says about
 * it: depth on demand, never a background sweep.
 */
function OpenQuestions({
  name,
  questions,
}: {
  readonly name: string;
  readonly questions: readonly string[];
}) {
  const { askNow } = useGlobalQ();
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-q-view-part="UNKNOWNS">
      <span className="cq-caption text-(--cq-text-secondary)">
        Open questions
      </span>
      <ul className="flex flex-col gap-1">
        {questions.map((question) => (
          <li key={question}>
            <button
              type="button"
              className="cq-body-sm min-h-[44px] w-full py-1 text-start text-(--cq-text-primary) underline decoration-(--cq-border-strong) underline-offset-4 hover:decoration-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) sm:min-h-0"
              onClick={() =>
                askNow(
                  `For ${name}: ${question} What does the evidence I can see say, and if it doesn't, how do I find out?`,
                )
              }
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The deeper reading is Q's conversation about this company, which reads
 * the evidence this investor may see, on the page's own subject; each
 * press asks one question, never a background sweep.
 */
function GoDeeper({ name }: { readonly name: string }) {
  const { askNow } = useGlobalQ();
  const asks: readonly (readonly [string, string])[] = [
    [
      "Full assessment",
      `Give me your investment assessment of ${name}: business model, traction, market, team and fundraising, from the evidence I can see. Separate what the company claims, what is evidenced, what is missing and what you infer.`,
    ],
    [
      "Risks and gaps",
      `What are the biggest risks, contradictions and evidence gaps for ${name}, and what would you ask the founder first?`,
    ],
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-(--cq-border-subtle) pt-3"
      data-q-view-part="DEEPER"
    >
      {asks.map(([label, question]) => (
        <Button
          key={label}
          variant="secondary"
          size="compact"
          onClick={() => askNow(question)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
