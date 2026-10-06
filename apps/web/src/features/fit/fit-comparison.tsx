"use client";

import Link from "next/link";
import { useState } from "react";

import {
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  Q_VIEW_VERDICT_LABELS,
  type FitComparisonDto,
  type FitComparisonEntryDto,
  type FitParameter,
  type QViewDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Check, ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { fitHeadline } from "./fit-breakdown";
import { FitGlyph, glyphKindOf } from "./fit-glyph";
import { QViewMark, useQViews, type QViewPort } from "./q-view-note";

/**
 * Top N side by side (brief B2; match.html "top3"). Q does not choose:
 * the order is the fit model's. Desktop is one table, rows aligned across
 * columns so the eye compares horizontally; a phone gets one card per
 * company, one open at a time. A row's best is marked with a word and a
 * check, never colour alone, and only where one company is strictly
 * better. Works for any N (C1): 1 to 3 columns, more scroll sideways with
 * the labels fixed.
 *
 * Exported for the Q answer canvas too: it renders the same
 * `FitComparison` DTO the `fit_top_candidates` tool returns.
 */

const ordinal = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

export function comparisonTitle(count: number): string {
  if (count === 1) return "Your top company right now";
  return `Your top ${ordinal[count - 1] ?? String(count)} right now`;
}

function Rank({ n }: { readonly n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] shrink-0 place-items-center rounded-full bg-(--cq-text-primary) text-[13px] font-semibold text-(--cq-canvas)"
    >
      {n}
    </span>
  );
}

function Best({ of }: { readonly of: number }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-(--cq-border) px-[7px] py-px text-[11.5px] whitespace-nowrap text-(--cq-text-secondary)">
      <Check size={11} aria-hidden="true" />
      {of > 3 ? "Best" : `Best${of === 3 ? " of 3" : ""}`}
    </span>
  );
}

function Actions({
  entry,
  onSave,
  onPass,
}: {
  readonly entry: FitComparisonEntryDto;
  readonly onSave?: ((companyId: string) => void) | undefined;
  readonly onPass?: ((companyId: string) => void) | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/company/${entry.companyId}`}
        className={buttonClassName("primary", "compact")}
      >
        Open profile
      </Link>
      {onSave === undefined ? null : (
        <Button
          variant="secondary"
          size="compact"
          onClick={() => onSave(entry.companyId)}
        >
          Save
        </Button>
      )}
      {onPass === undefined ? null : (
        <Button
          variant="secondary"
          size="compact"
          onClick={() => onPass(entry.companyId)}
        >
          Pass
        </Button>
      )}
    </div>
  );
}

function ViewText({ view }: { readonly view: QViewDto | null }) {
  if (view === null || view.status !== "READY") {
    return (
      <span className="cq-body-sm text-(--cq-text-tertiary)">No view yet.</span>
    );
  }
  return (
    <>
      <b className="text-(--cq-text-primary)">
        {Q_VIEW_VERDICT_LABELS[view.verdict]}
      </b>
      <span className="cq-body-sm text-(--cq-text-secondary)">
        {view.summary}
      </span>
    </>
  );
}

export function FitComparisonView({
  comparison,
  qViews,
  qViewPort,
  onSave,
  onPass,
  active = 0,
}: {
  readonly comparison: FitComparisonDto;
  readonly qViews?: ReadonlyMap<string, QViewDto | null> | undefined;
  readonly qViewPort?: QViewPort | undefined;
  readonly onSave?: ((companyId: string) => void) | undefined;
  readonly onPass?: ((companyId: string) => void) | undefined;
  /** The column Q is talking about (C2): highlighted on desktop, open on a phone. */
  readonly active?: number | undefined;
}) {
  const entries = comparison.entries;
  const byId = useQViews(
    entries.map((e) => e.companyId),
    qViews,
    qViewPort,
  );
  const views = entries.map((e) => byId.get(e.companyId) ?? null);
  const [open, setOpen] = useState(active);
  const n = entries.length;
  const cell = (j: number) =>
    cx(
      "flex min-w-0 items-center gap-2 border-t border-(--cq-border-subtle) px-4 py-3 text-sm",
      j === active && "bg-(--cq-surface-subtle)",
    );
  const label =
    "flex items-center border-t border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-4 py-3 text-sm text-(--cq-text-secondary)";
  const row = (parameter: FitParameter) =>
    entries.map((e, j) => {
      const r = e.profile.parameters.find((p) => p.parameter === parameter);
      return (
        <div key={e.companyId} role="cell" className={cell(j)}>
          {r === undefined ? null : (
            <>
              <FitGlyph kind={glyphKindOf(r)} />
              <span className="min-w-0 text-(--cq-text-primary)">
                {r.reason}
              </span>
              {e.bestOn.includes(parameter) ? <Best of={n} /> : null}
            </>
          )}
        </div>
      );
    });

  return (
    <div data-fit-comparison={n}>
      {/* Desktop: one table, rows aligned across columns. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) lg:block">
        <div
          role="table"
          aria-label={`Top ${String(n)} side by side`}
          className="grid"
          style={{
            gridTemplateColumns: `170px repeat(${String(n)}, minmax(${n > 3 ? "260px" : "0"}, 1fr))`,
          }}
        >
          <div
            role="columnheader"
            className="sticky left-0 bg-(--cq-surface-subtle)"
          />
          {entries.map((e, j) => (
            <div
              key={e.companyId}
              role="columnheader"
              className={cx(
                "flex flex-col items-start gap-2.5 px-4 py-[18px]",
                j === active && "bg-(--cq-surface-subtle)",
              )}
            >
              <span className="flex items-center gap-2.5">
                <Rank n={e.position} />
                <EntityAvatar
                  kind="company"
                  name={e.name}
                  companyId={e.companyId}
                  size={40}
                  decorative
                />
                <span className="min-w-0">
                  <Link
                    href={`/company/${e.companyId}`}
                    className="cq-title-sm text-(--cq-text-primary) hover:underline"
                  >
                    {e.name}
                  </Link>
                  {e.line === null ? null : (
                    <span className="cq-caption block text-(--cq-text-secondary)">
                      {e.line}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="cq-title-md text-(--cq-text-primary)">
                  {fitHeadline(e.profile)}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {FIT_CONFIDENCE_LABELS[e.profile.confidence]}
                </span>
              </span>
            </div>
          ))}
          {comparison.parameters.map((parameter) => (
            <div key={parameter} role="row" className="contents">
              <div role="rowheader" className={cx(label, "sticky left-0")}>
                {FIT_PARAMETER_LABELS[parameter]}
              </div>
              {row(parameter)}
            </div>
          ))}
          <div role="row" className="contents">
            <div role="rowheader" className={cx(label, "sticky left-0")}>
              Q&apos;s view
            </div>
            {entries.map((e, j) => (
              <div
                key={e.companyId}
                role="cell"
                className={cx(cell(j), "flex-col items-start gap-1")}
              >
                <ViewText view={views[j] ?? null} />
              </div>
            ))}
          </div>
          <div role="row" className="contents">
            <div className={cx(label, "sticky left-0")} />
            {entries.map((e, j) => (
              <div key={e.companyId} role="cell" className={cell(j)}>
                <Actions entry={e} onSave={onSave} onPass={onPass} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phone: one card per company, one open at a time. */}
      <div className="flex flex-col gap-2.5 lg:hidden">
        {entries.map((e, j) => {
          const isOpen = open === j;
          const view = views[j] ?? null;
          return (
            <article
              key={e.companyId}
              className={cx(
                "overflow-hidden rounded-(--cq-radius-lg) border bg-(--cq-surface-raised)",
                isOpen
                  ? "border-(--cq-border-strong)"
                  : "border-(--cq-border-subtle)",
              )}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? -1 : j)}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                <Rank n={e.position} />
                <EntityAvatar
                  kind="company"
                  name={e.name}
                  companyId={e.companyId}
                  size={36}
                  decorative
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="cq-title-sm text-(--cq-text-primary)">
                    {e.name}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {fitHeadline(e.profile)} ·{" "}
                    {FIT_CONFIDENCE_LABELS[e.profile.confidence].toLowerCase()}
                  </span>
                </span>
                <ChevronDown
                  size={ICON_SIZE.compact}
                  aria-hidden="true"
                  className={cx(
                    "text-(--cq-text-tertiary) transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              {isOpen ? (
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {e.line === null ? null : (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      {e.line}
                    </p>
                  )}
                  <div>
                    {e.profile.parameters.map((r) => (
                      <div
                        key={r.parameter}
                        className="grid grid-cols-[16px_110px_1fr] items-start gap-2 border-t border-(--cq-border-subtle) py-2 text-sm"
                      >
                        <FitGlyph kind={glyphKindOf(r)} className="mt-0.5" />
                        <span className="text-(--cq-text-secondary)">
                          {FIT_PARAMETER_LABELS[r.parameter]}
                        </span>
                        <span className="text-(--cq-text-primary)">
                          {r.reason}
                          {e.bestOn.includes(r.parameter) ? (
                            <span className="ml-1 inline-flex align-middle">
                              <Best of={n} />
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                  {view === null || view.status !== "READY" ? null : (
                    <div className="flex items-start gap-2.5 rounded-xl bg-(--cq-surface-subtle) px-3 py-2.5 text-sm">
                      <span className="mt-px">
                        <QViewMark />
                      </span>
                      <p>
                        <b className="font-semibold">
                          Q&apos;s view: {Q_VIEW_VERDICT_LABELS[view.verdict]}.
                        </b>{" "}
                        <span className="text-(--cq-text-secondary)">
                          {view.summary}
                        </span>
                      </p>
                    </div>
                  )}
                  <Actions entry={e} onSave={onSave} onPass={onPass} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** "Why these three?": what was considered, left out and why, and how it was ordered. */
export function WhyTheseSheet({
  comparison,
  open,
  onOpenChange,
}: {
  readonly comparison: FitComparisonDto;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const n = comparison.entries.length;
  const { outsideMandate, notEnoughInformation } = comparison.leftOut;
  const ranked = comparison.considered - outsideMandate - notEnoughInformation;
  const lines: readonly (readonly [number, string])[] = [
    [
      comparison.considered,
      "companies of yours to compare: your relationships, Company requests and your feed",
    ],
    [outsideMandate, "left out by rules you set in your mandate"],
    [
      notEnoughInformation,
      "left out for now: too little shared to rank them yet",
    ],
    [ranked, "ranked by fit with your mandate; ties go to better evidence"],
    [n, "shown"],
  ];
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="side"
        title={`Why ${n === 3 ? "these three" : "these"}?`}
      >
        <div className="flex flex-col gap-3.5">
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {lines.map(([count, text]) => (
              <li key={text} className="flex gap-3.5 py-3">
                <b className="cq-title-sm cq-numeric w-10 shrink-0 text-(--cq-text-primary)">
                  {count}
                </b>
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {text}
                </span>
              </li>
            ))}
          </ul>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Fit rules version {comparison.configLabel}. Nobody pays to be
            ranked. What you watch or open never changes your mandate.
          </p>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
