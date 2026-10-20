import Link from "next/link";

import {
  FIT_PARAMETER_LABELS,
  type FitProfileDto,
  type InterestDto,
  type MeetingDto,
  type RelationshipGateqApplicationsDto,
} from "@capital-q/contracts";
import { ArrowUpRight, ICON_SIZE } from "@capital-q/ui/icons";

import { FitGlyph, glyphKindOf, outcomeWord } from "@/features/fit/fit-glyph";
import { RelationshipFitChips } from "@/features/fit/relationship-fit-chips";
import { CompanyScoresLive } from "@/features/scores";

import { dealDay } from "./deal-stage-strip";
import {
  fitState,
  interestWords,
  recordGateq,
  type Read,
  type RecordWorkRow,
} from "./record-workspace";
import { serverTNow } from "@/features/i18n/server-now";

/**
 * Fit and interest, side by side and never merged (CLAUDE.md invariants:
 * Fit ≠ Interest). Fit is the code-derived match with the investor's own
 * declared mandate; interest is what the investor did. Neither is a score
 * for the relationship, and an unreadable one says so instead of looking
 * like "none".
 */
export function FitAndInterest({
  companyId,
  fit,
  interest,
  meetings = [],
  now,
}: {
  /** Investability and Suitability beside the fit (ADR 0074); absent: not shown. */
  readonly companyId?: string | undefined;
  readonly fit: Read<FitProfileDto | null>;
  readonly interest: Read<InterestDto | null>;
  /** The relationship's calls, for "held" and "booked" in Interest. */
  readonly meetings?: readonly MeetingDto[] | undefined;
  /** When the page was read: a call ended before it is held. */
  readonly now?: number | undefined;
}) {
  const t = serverTNow();

  const state = fitState(fit);
  const profile = fit.kind === "READ" ? fit.value : null;
  // Only what the investor declared counts: an undeclared parameter is
  // neither known nor unknown here.
  const declared =
    profile === null
      ? []
      : profile.parameters.filter((parameter) => parameter.applicable);
  const known = declared.filter((p) => p.outcome !== "UNKNOWN").length;
  const read = now ?? 0;
  const live = meetings.filter((m) => m.status === "SCHEDULED");
  const held = live.filter((m) => Date.parse(m.endsAt) <= read).length;
  const booked = live.length - held;
  const card =
    "flex min-w-0 flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]";
  const heading = "cq-body-sm font-medium text-(--cq-text-secondary)";
  return (
    <div className="grid gap-3.5 md:grid-cols-2" data-fit-and-interest>
      <section aria-labelledby="rec-fit" className={card}>
        <h3 id="rec-fit" className={heading}>
          {t("Fit with your mandate")}
        </h3>
        {companyId === undefined ? null : (
          <CompanyScoresLive companyId={companyId} variant="compact" />
        )}
        {state === "UNAVAILABLE" ? (
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {t("Couldn't be read right now")}
          </span>
        ) : profile === null ? (
          <RelationshipFitChips profile={null} />
        ) : (
          <>
            <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {t(
                `${String(known)} of ${String(declared.length)} criteria known`,
              )}
            </span>
            <ul className="flex flex-col">
              {declared.map((parameter) => {
                const kind = glyphKindOf(parameter);
                return (
                  <li
                    key={parameter.parameter}
                    className="cq-body-sm flex min-h-7 items-center gap-2.5"
                    data-fit-row={kind}
                  >
                    <FitGlyph kind={kind} size={18} />
                    <span className="flex-1 text-(--cq-text-primary)">
                      {t(FIT_PARAMETER_LABELS[parameter.parameter])}
                    </span>
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      {t(outcomeWord(kind))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "From your declared mandate and what the company has shared. Unknown stays unknown.",
          )}
        </span>
      </section>
      <section aria-labelledby="rec-interest" className={card}>
        <h3 id="rec-interest" className={heading}>
          {t("Interest")}
        </h3>
        <div
          className="cq-body-sm flex flex-col gap-2 text-(--cq-text-primary)"
          data-interest-words
        >
          {interest.kind === "UNAVAILABLE" || interest.value === null ? (
            <span>{t(interestWords(interest, dealDay))}</span>
          ) : (
            <>
              <span>
                {interest.value.status === "WITHDRAWN"
                  ? t("You withdrew your interest.")
                  : t(
                      `You expressed interest on ${dealDay(interest.value.expressedAt)}.`,
                    )}
              </span>
              {interest.value.status === "WITHDRAWN" ? null : (
                <span>
                  {t(
                    acceptedWords(
                      interest.value.response,
                      interest.value.expressedAt,
                      interest.value.respondedAt,
                    ),
                  )}
                </span>
              )}
            </>
          )}
          {now === undefined || live.length === 0 ? null : (
            <span>
              {t(
                `You've held ${String(held)} ${held === 1 ? "call" : "calls"}; ${String(booked)} ${booked === 1 ? "is" : "are"} booked.`,
              )}
            </span>
          )}
        </div>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "What you did, kept apart from fit. Neither is a score for the relationship.",
          )}
        </span>
      </section>
    </div>
  );
}

/** Their answer to the interest, in words, with its day when known. */
function acceptedWords(
  response: InterestDto["response"],
  expressedAt: string,
  respondedAt: string | null,
): string {
  if (response === "PENDING") return "They haven't answered yet.";
  const verb = response === "ACCEPTED" ? "accepted" : "declined";
  if (respondedAt === null) return `They ${verb}.`;
  return dealDay(respondedAt) === dealDay(expressedAt)
    ? `They ${verb} the same day.`
    : `They ${verb} on ${dealDay(respondedAt)}.`;
}

/**
 * The pitch's round in one line, as their claim (record prototype's Pitch
 * card): what the company stated and where, never verified here. Null when
 * nothing is stated.
 */
export function PitchClaim({
  terms,
}: {
  readonly terms: readonly {
    readonly label: string;
    readonly value: string;
    readonly source: string;
  }[];
}) {
  const t = serverTNow();
  if (terms.length === 0) return null;
  const sources = [...new Set(terms.map((term) => term.source))];
  return (
    <div className="flex flex-col gap-1.5" data-pitch-claim>
      <p className="cq-body text-(--cq-text-primary)">
        {terms.map((term) => `${t(term.label)} ${term.value}`).join(" · ")}{" "}
        <span className="cq-caption inline-flex items-center rounded-full bg-(--cq-warning-soft) px-2 py-0.5 whitespace-nowrap text-(--cq-warning)">
          {t("Founder's claim")}
        </span>
      </p>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t(`${capitalise(sources.join(" and "))}. Not verified.`)}
      </span>
    </div>
  );
}

const capitalise = (text: string) =>
  text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

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
  const t = serverTNow();

  if (rows.kind === "UNAVAILABLE") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("Q's work couldn't be read right now. Nothing is lost.")}
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
              {t(row.title)}
              <ArrowUpRight
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className="text-(--cq-text-tertiary)"
              />
            </Link>
            <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
              {t(`${row.status} · ${row.stage} · ${dealDay(row.updatedAt)}`)}
            </span>
          </div>
          {row.report === null ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              <span className="text-(--cq-text-primary)">
                {t(row.report.headline)}
              </span>
              {t(` · ${row.report.verdict} · `)}
              <Link
                href={row.report.href}
                className="underline underline-offset-4 hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                {t("Read the report")}
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
  const t = serverTNow();

  if (read.kind === "UNAVAILABLE") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("GateQ applications couldn't be read right now.")}
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
              {t(row.title)}
            </span>
            <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
              {t(row.status)}
            </span>
          </div>
          <Link
            href={row.href}
            className="cq-body-sm inline-flex min-h-11 items-center gap-1 text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {t(row.action)}
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
