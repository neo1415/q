"use client";

import { useState } from "react";

import type {
  QWorkDto,
  WorkforceAgentRunDto,
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import { CrmSheet } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { usdWords, workButton } from "./work-kit";
import { jobTitle } from "./workforce-view";

/**
 * Cost, option 3: day by day (owner 2026-10-21; prototype workcost-3,
 * warm charcoal). This month's spend against the person's limit, one bar
 * per day so far with its own figure, the picked day split into the steps
 * it went on, and the month by job. Every figure is the usage ledger's
 * (the overview's `byDay`, the jobs' and instructions' own spend); a day
 * the server could not split stays unknown, never a made-up zero.
 */

type Role = WorkforceAgentRunDto["role"];

/** What each kind of step is, in plain words: never an agent's name. */
export const STEP_WORDS: Readonly<Record<Role, string>> = {
  LEAD: "Planning",
  OUTREACH: "Outreach",
  MANDATE_WATCHER: "Watching mandates",
  CONVERSATION: "Conversations",
  WRITER: "Writing",
  REVIEWER: "Checking",
  SCHEDULER: "Scheduling",
  DOCUMENTS: "Documents",
  RESEARCH: "Research",
  AD_HOC: "Other steps",
};

export type CostDay = {
  /** Day of the month, 1-based. */
  readonly day: number;
  readonly usd: number;
  readonly steps: readonly { readonly name: string; readonly usd: number }[];
};

/**
 * The month's days so far (UTC), each with its spend. A day the ledger
 * lists no spend for spent nothing (the contract says so); without
 * `byDay` at all the days are unknown and this returns null.
 */
export function costDays(
  overview: WorkforceOverviewDto,
  now: number,
): readonly CostDay[] | null {
  if (overview.byDay === undefined) return null;
  const [year, month] = overview.month.split("-").map(Number);
  if (year === undefined || month === undefined) return null;
  const today = new Date(now);
  const sameMonth =
    today.getUTCFullYear() === year && today.getUTCMonth() + 1 === month;
  const last = sameMonth
    ? today.getUTCDate()
    : new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = new Map(
    overview.byDay.map((one) => [Number(one.day.slice(8, 10)), one]),
  );
  return Array.from({ length: last }, (_, index) => {
    const day = index + 1;
    const row = byDay.get(day);
    return {
      day,
      usd: row === undefined ? 0 : Number(row.usd),
      steps:
        row === undefined
          ? []
          : row.byRole.map((one) => ({
              name: STEP_WORDS[one.role],
              usd: Number(one.usd),
            })),
    };
  });
}

export type JobCost = { readonly name: string; readonly usd: number };

const SHOWN_JOBS = 5;

/** What each piece of work cost, largest first; the long tail folded. */
export function costByJob(
  jobs: readonly WorkforceJobDetailDto[],
  work: readonly QWorkDto[] | null,
): readonly JobCost[] {
  const rows: JobCost[] = [
    ...jobs.map((one) => ({
      name: jobTitle(one.job.goal),
      usd: Number(one.job.costUsd),
    })),
    ...(work ?? []).flatMap((item) =>
      item.spend === null
        ? []
        : [
            {
              name: item.goal ?? item.summary ?? "Standing instruction",
              usd: Number(item.spend.spentUsdMonth),
            },
          ],
    ),
  ]
    .filter((row) => Number.isFinite(row.usd) && row.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  if (rows.length <= SHOWN_JOBS) return rows;
  const rest = rows.slice(SHOWN_JOBS - 1);
  return [
    ...rows.slice(0, SHOWN_JOBS - 1),
    {
      name: `Smaller tasks (${String(rest.length)})`,
      usd: rest.reduce((sum, row) => sum + row.usd, 0),
    },
  ];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function WorkCostDays({
  overview,
  jobs,
  work,
  now,
}: {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly work: readonly QWorkDto[] | null;
  readonly now: number;
}) {
  const t = useT();
  const days = costDays(overview, now);
  const byJob = costByJob(jobs, work);
  const monthName = MONTHS[Number(overview.month.slice(5, 7)) - 1] ?? "";
  const spent = Number(overview.spentUsd) || 0;
  const limit = overview.limitUsd === null ? null : Number(overview.limitUsd);
  const share =
    limit === null || limit <= 0 ? null : Math.min(100, (spent / limit) * 100);
  const busiest =
    days === null || days.length === 0
      ? null
      : days.reduce((best, one) => (one.usd > best.usd ? one : best)).day;
  const [picked, setPicked] = useState<number | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const day =
    days === null
      ? null
      : (days.find((one) => one.day === (picked ?? busiest)) ?? null);
  const max = days === null ? 0 : Math.max(0, ...days.map((one) => one.usd));
  const jobMax = byJob[0]?.usd ?? 0;
  const limitWords = limit === null ? null : usdWords(limit).replace(".00", "");

  return (
    <div className="flex max-w-[1000px] flex-col gap-4" data-workforce-cost>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="cq-label font-normal text-(--cq-text-tertiary)">
            {t(`${monthName} so far`)}
          </div>
          <div className="cq-wk-big" data-cost-spent>
            {t(usdWords(spent))}{" "}
            <small>
              {limitWords === null ? t("no limit set") : t(`of ${limitWords}`)}
            </small>
          </div>
        </div>
        {share === null ? null : (
          <div
            role="meter"
            aria-label={t("Spent of your monthly limit")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share)}
            className="cq-wk-meter max-w-[360px] min-w-[140px] flex-1"
            data-reached={overview.paused ? true : undefined}
          >
            <i style={{ width: `${String(share)}%` }} />
          </div>
        )}
        <button
          type="button"
          className={workButton("primary", "w-full lg:ms-auto lg:w-auto")}
          onClick={() => setLimitOpen(true)}
          data-cost-limit
        >
          {t("Change limit")}
        </button>
      </div>
      {overview.paused ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(
            `Your ${limitWords ?? ""} limit is reached: Q starts no new work this month until it is raised.`,
          )}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section
          aria-labelledby="cost-days"
          className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
        >
          <h3 id="cost-days" className="m-0 text-base font-semibold">
            {t("Each day")}
          </h3>
          {days === null ? (
            <p className="m-0 cq-body-sm text-(--cq-text-secondary)" data-cost-days-unknown>
              {t(
                "Spending by day isn’t available yet. The month’s total above is from the same ledger.",
              )}
            </p>
          ) : (
            <div className="cq-wk-days" role="group" aria-label={t("Each day")}>
              {days.map((one) => (
                <button
                  key={one.day}
                  type="button"
                  className="cq-wk-dbar"
                  aria-pressed={day?.day === one.day}
                  aria-label={t(`${String(one.day)} ${monthName}, ${usdWords(one.usd)}`)}
                  onClick={() => setPicked(one.day)}
                  data-cost-day={one.day}
                >
                  <span className="cq-wk-dv">
                    {one.usd > 0 ? t(usdWords(one.usd)) : "0"}
                  </span>
                  <i
                    style={{
                      height: `${String(max <= 0 ? 2 : Math.max(2, (one.usd / max) * 160))}px`,
                    }}
                  />
                  <span className="cq-wk-dd">{one.day}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section
          aria-live="polite"
          className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
          data-cost-day-info
        >
          {day === null ? (
            <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
              {t("Pick a day to see what it went on.")}
            </p>
          ) : (
            <div key={day.day} className="cq-wk-in">
              <div className="cq-label font-normal text-(--cq-text-tertiary)">
                {t(`${String(day.day)} ${monthName}`)}
              </div>
              <div className="cq-wk-big">{t(usdWords(day.usd))}</div>
              {day.usd > 0 ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  {day.steps.map((step) => (
                    <div key={step.name} className="flex items-center gap-3 text-sm">
                      <span className="flex-1">{t(step.name)}</span>
                      <span className="cq-numeric">{t(usdWords(step.usd))}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="m-0 mt-2 cq-body-sm text-(--cq-text-secondary)">
                  {t("Nothing spent this day.")}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <section
        aria-labelledby="cost-job"
        className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
      >
        <h3 id="cost-job" className="m-0 text-base font-semibold">
          {t("By job")}
        </h3>
        {byJob.length === 0 ? (
          <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
            {t("Nothing spent yet this month.")}
          </p>
        ) : (
          <div className="cq-wk-bars">
            {byJob.map((row) => (
              <div key={row.name} className="cq-wk-br" data-cost-job>
                <span className="min-w-0 truncate">{t(row.name)}</span>
                <span className="cq-wk-bt" aria-hidden="true">
                  <i
                    style={{
                      width: `${String(jobMax <= 0 ? 0 : (row.usd / jobMax) * 100)}%`,
                    }}
                  />
                </span>
                <span className="cq-numeric text-end">{t(usdWords(row.usd))}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <CrmSheet
        open={limitOpen}
        onOpenChange={setLimitOpen}
        title={t("Monthly limit for Q’s work")}
        data-cost-limit-sheet
      >
        <p className="m-0 text-(--cq-text-secondary)">
          {t(
            "When Q’s work reaches your limit, it pauses and asks you before spending more.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <span
            className={cx(
              "inline-flex min-h-11 items-center rounded-full border px-[18px] text-sm font-medium",
              "border-[var(--cq-tile,var(--cq-text-primary))] bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]",
            )}
          >
            {limitWords === null ? t("No limit") : t(`${limitWords} a month`)}
          </span>
        </div>
        <p className="m-0 cq-label font-normal text-(--cq-text-tertiary)">
          {t(
            `So far this month: ${usdWords(spent)}. Changing the limit never cancels work already approved.`,
          )}
        </p>
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Your limit is set for your Capital Q workspace. Ask your workspace admin to change it.",
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={workButton("primary")}
            onClick={() => setLimitOpen(false)}
          >
            {t("Done")}
          </button>
        </div>
      </CrmSheet>
    </div>
  );
}
