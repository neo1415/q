import Link from "next/link";

import type {
  FitProfileDto,
  InterestDto,
  RelationshipGateqApplicationsDto,
} from "@capital-q/contracts";
import { ArrowUpRight, ICON_SIZE } from "@capital-q/ui/icons";

import { RelationshipFitChips } from "@/features/fit/relationship-fit-chips";

import { dealDay } from "./deal-stage-strip";
import {
  fitState,
  interestWords,
  recordGateq,
  type Read,
  type RecordWorkRow,
} from "./record-workspace";

/**
 * Fit and interest, side by side and never merged (CLAUDE.md invariants:
 * Fit ≠ Interest). Fit is the code-derived match with the investor's own
 * declared mandate; interest is what the investor did. Neither is a score
 * for the relationship, and an unreadable one says so instead of looking
 * like "none".
 */
export function FitAndInterest({
  fit,
  interest,
}: {
  readonly fit: Read<FitProfileDto | null>;
  readonly interest: Read<InterestDto | null>;
}) {
  const state = fitState(fit);
  return (
    <dl className="flex flex-col gap-4" data-fit-and-interest>
      <div className="flex flex-col gap-1.5">
        <dt className="cq-body-sm font-medium text-(--cq-text-primary)">
          Fit with your mandate
        </dt>
        <dd className="flex flex-col gap-1.5">
          {state === "UNAVAILABLE" ? (
            <span className="cq-body-sm text-(--cq-text-secondary)">
              Couldn&apos;t be read right now
            </span>
          ) : (
            <RelationshipFitChips
              profile={fit.kind === "READ" ? fit.value : null}
            />
          )}
          <span className="cq-caption text-(--cq-text-secondary)">
            From your declared mandate and what the company has shared. Unknown
            stays unknown.
          </span>
        </dd>
      </div>
      <div className="flex flex-col gap-1.5">
        <dt className="cq-body-sm font-medium text-(--cq-text-primary)">
          Your interest
        </dt>
        <dd
          className="cq-body-sm text-(--cq-text-secondary)"
          data-interest-words
        >
          {interestWords(interest, dealDay)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Q's work with this counterpart: each job that has a lane for them, with
 * where it stands and Q's first-stage report when written. Q's verdict is
 * Q's inference, labelled as Q's; the decision stays the person's.
 */
export function RecordQWork({
  rows,
}: {
  readonly rows: Read<readonly RecordWorkRow[]>;
}) {
  if (rows.kind === "UNAVAILABLE") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Q&apos;s work couldn&apos;t be read right now. Nothing is lost.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {rows.value.map((row) => (
        <li
          key={row.key}
          className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Link
              href={row.href}
              className="cq-body inline-flex min-h-11 items-center gap-1 font-medium text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              {row.title}
              <ArrowUpRight
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className="text-(--cq-text-tertiary)"
              />
            </Link>
            <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
              {`${row.status} · ${row.stage} · ${dealDay(row.updatedAt)}`}
            </span>
          </div>
          {row.report === null ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              <span className="text-(--cq-text-primary)">
                {row.report.headline}
              </span>
              {` · ${row.report.verdict} · `}
              <Link
                href={row.report.href}
                className="underline underline-offset-4 hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                Read the report
              </Link>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The Q Work section's content, or null when Q has no work with them. */
export function recordWorkSlot(rows: Read<readonly RecordWorkRow[]>) {
  return rows.kind === "READ" && rows.value.length === 0 ? null : (
    <RecordQWork rows={rows} />
  );
}

/**
 * GateQ on the record: each application on this relationship with where
 * it stands and the one place it opens. Nothing when there are none; an
 * unreadable read says so.
 */
export function recordGateqSlot(read: Read<RelationshipGateqApplicationsDto>) {
  if (read.kind === "UNAVAILABLE") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        GateQ applications couldn&apos;t be read right now.
      </p>
    );
  }
  const rows = recordGateq(read.value, dealDay);
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
          data-record-gateq
        >
          <div className="flex min-w-0 flex-col">
            <span className="cq-body font-medium text-(--cq-text-primary)">
              {row.title}
            </span>
            <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
              {row.status}
            </span>
          </div>
          <Link
            href={row.href}
            className="cq-body-sm inline-flex min-h-11 items-center gap-1 text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {row.action}
            <ArrowUpRight
              size={ICON_SIZE.compact}
              aria-hidden="true"
              className="text-(--cq-text-tertiary)"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
