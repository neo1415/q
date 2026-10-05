"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { FitCompanyDto, QViewDto } from "@capital-q/contracts";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { FitScore } from "./fit-breakdown";
import { FitGlyph, glyphKindOf } from "./fit-glyph";
import { askedAgo, cardReasons } from "./fit-words";
import { LazyQViewNote, type QViewPort } from "./q-view-note";

/**
 * One Company request (brief B4; match.html "requests"): the company, its
 * fit with the investor's own mandate (band, glyphs, confidence; tap for
 * every reason), the top reasons and the main mismatch, Q's view beside
 * it, and the answer. The whole card opens the company's profile; the
 * score, Q's view and the answer stay their own controls above that link.
 */
export function CompanyRequestCard({
  companyId,
  name,
  requestedAt,
  fit,
  qView,
  qViewPort,
  note,
  now,
  waitingLongest,
  outcome,
  openFit = false,
}: {
  /** Open the fit breakdown at once (design review). */
  readonly openFit?: boolean | undefined;
  readonly companyId: string;
  readonly name: string;
  readonly requestedAt: string;
  readonly fit: FitCompanyDto | null;
  readonly qView?: QViewDto | null | undefined;
  readonly qViewPort?: QViewPort | undefined;
  /** The company's own words with the request, if any. */
  readonly note?: string | null | undefined;
  readonly now: number;
  readonly waitingLongest?: boolean | undefined;
  /** The answer controls or the answer's outcome. */
  readonly outcome: ReactNode;
}) {
  const titleId = `company-request-${companyId}`;
  const reasons = fit === null ? [] : cardReasons(fit.profile);
  return (
    <article
      aria-labelledby={titleId}
      className="relative flex flex-col gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 hover:border-(--cq-border)"
      data-company-request={companyId}
    >
      <Link
        href={`/company/${companyId}`}
        aria-label={`Open ${name}'s profile`}
        className="absolute inset-0 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      />
      <div className="flex items-start gap-3.5">
        <span className="relative aspect-[9/16] w-[60px] shrink-0 overflow-hidden rounded-[10px] bg-(--cq-surface-strong)">
          <EntityAvatar
            kind="company"
            name={name}
            companyId={companyId}
            size={60}
            decorative
            className="absolute inset-0 size-full rounded-none object-cover"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={titleId} className="cq-title-sm text-(--cq-text-primary)">
            {name}
          </h2>
          {fit?.line == null ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">{fit.line}</p>
          )}
        </div>
      </div>
      {fit === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" data-fit-missing>
          Fit shows once your mandate is set and the company has shared enough
          to compare.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <FitScore
            name={name}
            companyId={companyId}
            profile={fit.profile}
            defaultOpen={openFit}
          />
          <ul
            aria-label="Why"
            className="flex min-w-[220px] flex-1 flex-col gap-1.5"
          >
            {reasons.map((r) => (
              <li
                key={r.parameter}
                className="grid grid-cols-[16px_1fr] items-start gap-2 text-sm leading-snug text-(--cq-text-primary)"
              >
                <FitGlyph kind={glyphKindOf(r)} className="mt-0.5" />
                <span>{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fit === null ? null : (
        <LazyQViewNote companyId={companyId} initial={qView} port={qViewPort} />
      )}
      {note == null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          &ldquo;{note}&rdquo;
        </p>
      )}
      <div className="relative flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[12.5px] text-(--cq-text-tertiary) max-sm:basis-full">
          {askedAgo(requestedAt, now)}
          {waitingLongest === true ? " · waiting longest" : ""}
        </span>
        {outcome}
      </div>
    </article>
  );
}
