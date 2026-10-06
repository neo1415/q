"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  type FitProfileDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { FitGlyph, FitPips, glyphKindOf, outcomeWord } from "./fit-glyph";

/**
 * The fit score and its breakdown (ADR 0052; mockups match.html and
 * company.html). The score is a button: the band in words, the nine
 * glyphs, the confidence in words. It opens every parameter with its word
 * and reason. No number anywhere.
 */

export function fitSummaryLabel(profile: FitProfileDto): string {
  const unknown = profile.parameters.filter(
    (p) => p.applicable && p.outcome === "UNKNOWN",
  ).length;
  return `${FIT_BAND_LABELS[profile.band]}, ${FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}${unknown > 0 ? `, ${String(unknown)} unknown` : ""}. Show why`;
}

export function FitScoreButton({
  profile,
  onOpen,
  chevron = true,
}: {
  readonly profile: FitProfileDto;
  readonly onOpen: () => void;
  readonly chevron?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={fitSummaryLabel(profile)}
      data-fit-band={profile.band}
      className="relative inline-flex min-h-11 items-center gap-2.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-1 pr-3 pl-2.5 text-left hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
    >
      <span className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold whitespace-nowrap text-(--cq-text-primary)">
          {FIT_BAND_LABELS[profile.band]}
        </span>
        <FitPips parameters={profile.parameters} />
        <span className="text-xs whitespace-nowrap text-(--cq-text-tertiary)">
          {FIT_CONFIDENCE_LABELS[profile.confidence]}
        </span>
      </span>
      {chevron ? (
        <ChevronRight
          size={ICON_SIZE.compact}
          aria-hidden="true"
          className="text-(--cq-text-tertiary)"
        />
      ) : null}
    </button>
  );
}

/** Every parameter, its word and its reason, in FIT_PARAMETERS order. */
export function FitRows({
  profile,
  sources,
}: {
  readonly profile: FitProfileDto;
  readonly sources?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {profile.parameters.map((p) => {
        const kind = glyphKindOf(p);
        const source = sources?.[p.parameter];
        return (
          <li
            key={p.parameter}
            className="grid grid-cols-[20px_1fr_auto] items-start gap-x-2.5 gap-y-0.5 py-2.5"
            data-fit-parameter={p.parameter}
          >
            <FitGlyph kind={kind} className="mt-0.5" />
            <span className="font-medium text-(--cq-text-primary)">
              {FIT_PARAMETER_LABELS[p.parameter]}
            </span>
            <span className="cq-body-sm text-(--cq-text-secondary)">
              {outcomeWord(kind)}
              {p.stale ? " · older data" : ""}
            </span>
            <span />
            <span className="cq-body-sm col-span-2 text-(--cq-text-primary)">
              {p.reason}
            </span>
            {source === undefined ? null : (
              <>
                <span />
                <span className="cq-caption col-span-2 text-(--cq-text-tertiary)">
                  From: {source}
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function FitBreakdownSheet({
  open,
  onOpenChange,
  name,
  companyId,
  profile,
  footer,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly name: string;
  readonly companyId: string;
  readonly profile: FitProfileDto;
  readonly footer?: ReactNode | undefined;
}) {
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="side"
        title={`${name}: ${FIT_BAND_LABELS[profile.band].toLowerCase()}`}
        description={FIT_CONFIDENCE_LABELS[profile.confidence]}
      >
        <div className="flex flex-col gap-3.5" data-fit-breakdown>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Measured against your mandate, the same way for every company.
            Unknown never counts against a company; it only lowers confidence.
          </p>
          {profile.hardRule === null ? null : (
            <p className="cq-body-sm rounded-(--cq-radius-md) bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-primary)">
              {profile.hardRule.label}
            </p>
          )}
          <FitRows profile={profile} />
          <p className="cq-caption text-(--cq-text-tertiary)">
            Fit rules version {profile.configLabel}. Q&apos;s view sits beside
            this and never changes it.
          </p>
          {footer ?? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/company/${companyId}`}
                className={buttonClassName("secondary", "compact")}
              >
                Open profile
              </Link>
              <Link
                href="/profile"
                className={buttonClassName("quiet", "compact")}
              >
                Change your mandate
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

/** The score button wired to its own breakdown. */
export function FitScore({
  name,
  companyId,
  profile,
  defaultOpen = false,
  className,
}: {
  readonly name: string;
  readonly companyId: string;
  readonly profile: FitProfileDto;
  readonly defaultOpen?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <span className={cx("inline-flex", className)}>
      <FitScoreButton profile={profile} onOpen={() => setOpen(true)} />
      <FitBreakdownSheet
        open={open}
        onOpenChange={setOpen}
        name={name}
        companyId={companyId}
        profile={profile}
      />
    </span>
  );
}
