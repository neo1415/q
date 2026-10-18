"use client";

import {
  UNICORN_POTENTIAL_CAVEAT,
  type UnicornPotentialDto,
  type UnicornSource,
} from "@capital-q/contracts";
import { useRef } from "react";
import Link from "next/link";
import { useGlobalQ } from "@/components/app-shell/global-q";

import { useQControl } from "@/features/q/control/q-control";

const BANDS = {
  LIMITED_INDICATORS: "Limited indicators",
  DEVELOPING: "Developing",
  STRONG_SIGNALS: "Strong signals",
  EXCEPTIONAL_SIGNALS: "Exceptional signals",
} as const;
const CONFIDENCE = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
} as const;
const STAGES = {
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A_GROWTH: "Series A / Growth",
} as const;

function words(code: string): string {
  return code.toLowerCase().replaceAll("_", " ");
}
function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}
function date(value: string | null): string {
  return value === null
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value));
}
function decimal(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function unicornPotentialLine(score: UnicornPotentialDto): string {
  return score.overallScore === null
    ? `Unicorn Potential: ${score.status === "NOT_ASSESSED" ? "not assessed yet" : "insufficient evidence"}`
    : `Unicorn Potential ${String(score.overallScore)}/100`;
}

function Source({ source }: { readonly source: UnicornSource }) {
  return (
    <li className="min-w-0 break-words border-l border-(--cq-border-subtle) pl-3">
      <p className="cq-body-sm text-(--cq-text-primary)">{source.label}</p>
      <p className="cq-caption text-(--cq-text-secondary)">
        {words(source.truthClass)} · {words(source.evidenceStatus)} ·{" "}
        {words(source.lifecycleStatus)}
      </p>
      <p className="cq-caption text-(--cq-text-tertiary)">
        {date(source.at)} · {words(source.kind)} ·{" "}
        {words(source.visibilityScope)}
      </p>
      <p className="cq-caption break-all text-(--cq-text-tertiary)">
        Source {source.id} · revision {source.revision}
      </p>
    </li>
  );
}

/** Authorized, precomputed assessment only; no scoring or fetching at render. */
export function UnicornPotential({
  score,
  companyId,
  audience = "INVESTOR",
}: {
  readonly score: UnicornPotentialDto;
  readonly companyId: string;
  readonly audience?: "FOUNDER" | "INVESTOR";
}) {
  const { askAbout } = useGlobalQ();
  const summaryRef = useRef<HTMLElement>(null);
  useQControl({
    id: "disclosure.unicorn-potential",
    kind: "DISCLOSURE",
    ref: summaryRef,
  });
  return (
    <details
      id={`unicorn-potential-${companyId}`}
      data-score="unicorn-potential"
      className="group min-w-0 rounded-xl border border-(--cq-border-subtle) sm:col-span-2"
    >
      <summary
        ref={summaryRef}
        data-q-control="disclosure.unicorn-potential"
        className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-text-primary)"
      >
        <span className="min-w-0">
          <span className="cq-label block text-(--cq-text-primary)">
            Unicorn Potential
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            {score.band === null
              ? score.status === "NOT_ASSESSED"
                ? "Not assessed yet"
                : "Insufficient evidence"
              : BANDS[score.band]}
            {" · "}
            {CONFIDENCE[score.confidence]}
            {" · "}
            {percent(score.coverage)} coverage
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-3">
          {score.overallScore === null ? null : (
            <span className="text-2xl font-semibold tabular-nums text-(--cq-text-primary)">
              {score.overallScore}
              <span className="cq-caption ml-1 text-(--cq-text-tertiary)">
                /100
              </span>
            </span>
          )}
          <span className="cq-caption text-(--cq-text-secondary)">
            <span className="group-open:hidden">View assessment</span>
            <span className="hidden group-open:inline">Close assessment</span>
          </span>
        </span>
      </summary>
      <div className="flex min-w-0 flex-col gap-6 border-t border-(--cq-border-subtle) p-4">
        <div className="flex flex-col gap-2">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {UNICORN_POTENTIAL_CAVEAT}
          </p>
          <p className="cq-caption text-(--cq-text-tertiary)">
            {score.stage === null
              ? "Stage not established"
              : STAGES[score.stage]}
            {" · "}
            {score.assessedAt === null
              ? "Not yet assessed"
              : `Assessed ${date(score.assessedAt)}`}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
          {score.up.length === 0 ? null : (
            <div>
              <h3 className="cq-label mb-2 text-(--cq-text-primary)">
                Strengths
              </h3>
              <ul className="space-y-2">
                {score.up.map((reason) => (
                  <li
                    key={reason.label}
                    className="cq-body-sm text-(--cq-text-secondary)"
                  >
                    <span className="text-(--cq-text-primary)">
                      {reason.label}
                    </span>
                    {" · "}
                    {reason.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score.down.length + score.missing.length === 0 ? null : (
            <div>
              <h3 className="cq-label mb-2 text-(--cq-text-primary)">
                Gaps and next evidence
              </h3>
              <ul className="space-y-2 cq-body-sm text-(--cq-text-secondary)">
                {score.down.map((reason) => (
                  <li key={reason.label}>
                    {reason.label} · {reason.detail}
                  </li>
                ))}
                {score.missing.map((gap) => (
                  <li key={gap} className="flex flex-col items-start gap-1">
                    <span>{gap}</span>
                    <button
                      type="button"
                      className="cq-caption min-h-11 text-start underline underline-offset-4"
                      aria-label={`Ask Q about missing evidence: ${gap}`}
                      onClick={() =>
                        askAbout(
                          `For company ${companyId}, explain this Unicorn Potential evidence gap: ${JSON.stringify(gap)}. What specific evidence would resolve it? Use only information I am authorized to see; distinguish missing evidence from poor performance. Do not send messages or change records.`,
                        )
                      }
                    >
                      Ask Q about this gap
                    </button>
                  </li>
                ))}
              </ul>
              {score.missing.length === 0 ? null : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {audience === "FOUNDER" ? (
                    <>
                      <Link
                        href="/documents?tab=mine"
                        className="cq-caption min-h-11 py-3 underline underline-offset-4"
                      >
                        Add evidence in your documents
                      </Link>
                      <Link
                        href="/profile"
                        className="cq-caption min-h-11 py-3 underline underline-offset-4"
                      >
                        Update your company profile
                      </Link>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="cq-caption min-h-11 text-start underline underline-offset-4"
                      onClick={() =>
                        askAbout(
                          `For company ${companyId}, prepare a draft evidence request covering these Unicorn Potential gaps: ${JSON.stringify(score.missing.slice(0, 3))}. Keep it courteous and specific. Prepare the text for my review only; do not contact anyone, send it or change records.`,
                        )
                      }
                    >
                      Draft an evidence request with Q
                    </button>
                  )}
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    {audience === "INVESTOR"
                      ? "Draft requests cover up to three priority gaps. "
                      : ""}
                    Q opens with a draft question for you to review. Nothing is
                    sent automatically.
                    {audience === "FOUNDER"
                      ? " Use your document controls to choose what to share; private uploads do not automatically become investor-visible."
                      : ""}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <section aria-label="Twelve assessment pillars" className="min-w-0">
          <h3 className="cq-label mb-2 text-(--cq-text-primary)">
            Pillar breakdown
          </h3>
          <p className="cq-caption mb-3 text-(--cq-text-tertiary)">
            Grades are out of 4. Contributions are points in the overall
            indicator. Missing evidence is unscored.
          </p>
          <div className="divide-y divide-(--cq-border-subtle)">
            {score.pillars.map((pillar) => (
              <details
                key={pillar.id}
                data-unicorn-pillar={pillar.id}
                className="min-w-0"
              >
                <summary className="grid min-h-11 cursor-pointer grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <span className="cq-body-sm min-w-0 text-(--cq-text-primary)">
                    {pillar.id} · {pillar.label}
                    <span
                      aria-hidden="true"
                      className="ml-2 text-(--cq-text-tertiary)"
                    >
                      ⌄
                    </span>
                  </span>
                  <span className="cq-caption flex flex-wrap gap-x-3 gap-y-1 tabular-nums text-(--cq-text-secondary)">
                    <span>
                      {pillar.grade === null
                        ? "Unscored"
                        : `${decimal(pillar.grade)}/4 grade`}
                    </span>
                    <span>
                      {pillar.weight === null
                        ? "Weight unavailable"
                        : `${decimal(pillar.weight)}% weight`}
                    </span>
                    <span>
                      {pillar.contribution === null
                        ? "No contribution"
                        : `${decimal(pillar.contribution)} points`}
                    </span>
                    <span>{percent(pillar.coverage)} coverage</span>
                  </span>
                </summary>
                <div className="grid min-w-0 grid-cols-1 gap-4 pb-4 md:grid-cols-2">
                  {pillar.criteria.map((criterion) => (
                    <div
                      key={criterion.id}
                      className="min-w-0 rounded-lg border border-(--cq-border-subtle) p-3"
                    >
                      <h4 className="cq-body-sm text-(--cq-text-primary)">
                        {criterion.label}
                      </h4>
                      <p className="cq-caption my-1 text-(--cq-text-tertiary)">
                        {words(criterion.state)} ·{" "}
                        {criterion.grade === null
                          ? "Not graded"
                          : `${String(criterion.grade)}/4`}
                      </p>
                      <p className="cq-body-sm mb-3 break-words text-(--cq-text-secondary)">
                        {criterion.anchor}
                      </p>
                      {criterion.sources.length === 0 ? (
                        <p className="cq-caption text-(--cq-text-tertiary)">
                          No eligible source recorded
                        </p>
                      ) : (
                        <ul
                          aria-label={`${pillar.id}${criterion.id} sources`}
                          className="min-w-0 space-y-3"
                        >
                          {criterion.sources.map((source) => (
                            <Source
                              key={`${source.kind}:${source.id}:${source.revision}`}
                              source={source}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
        <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
          <section aria-label="Unicorn Momentum">
            <h3 className="cq-label mb-2 text-(--cq-text-primary)">
              Unicorn Momentum
            </h3>
            {score.momentum === null || score.overallScore === null ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Not enough history
              </p>
            ) : (
              <>
                <p className="cq-body-sm text-(--cq-text-primary)">
                  {score.momentum.delta > 0 ? "+" : ""}
                  {score.momentum.delta} points · {score.momentum.previousScore}
                  /100 on {date(score.momentum.previousAt)} →{" "}
                  {score.overallScore}/100 on {date(score.assessedAt)}
                </p>
                <ul className="cq-body-sm mt-2 space-y-1 text-(--cq-text-secondary)">
                  {score.momentum.drivers.map((driver) => (
                    <li key={driver}>{driver}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="cq-caption mt-2 text-(--cq-text-tertiary)">
              Comparable snapshots only. Changes may reflect evidence updates
              rather than business growth.
            </p>
          </section>
          <section aria-label="Scoring methodology">
            <h3 className="cq-label mb-2 text-(--cq-text-primary)">
              Methodology
            </h3>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Provisional stage-weighted rubric. Observed criterion grades are
              averaged within each pillar, then weighted across scored pillars
              and multiplied by 25. Only the final score is rounded. Unknown
              inputs are never zero. Confidence describes evidence support,
              separately from the grade.
            </p>
            <p className="cq-caption mt-2 break-words text-(--cq-text-tertiary)">
              {score.methodVersion} · {score.inputRulesVersion}
            </p>
            <p className="cq-caption mt-2 text-(--cq-text-tertiary)">
              {score.benchmark}
            </p>
          </section>
        </div>
      </div>
    </details>
  );
}
